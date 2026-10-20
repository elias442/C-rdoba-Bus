import { useEffect } from 'react'
import { observeFrequency } from '../lib/frequency'
import { loadTrace } from '../lib/traceCache'
import { arrivalSecondsOf } from '../lib/tripGuide'
import { ApiError, fetchCatalog, fetchTrace, fetchVehicles, isAbort, searchTrip } from '../services/api'
import { VEHICLE_POLL_MS } from '../lib/layout'
import { useTransitStore } from '../stores/useTransitStore'

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

export function useCatalog() {
  const nonce = useTransitStore((state) => state.catalogNonce)
  const hydrateCatalog = useTransitStore((state) => state.hydrateCatalog)
  const setLinesError = useTransitStore((state) => state.setLinesError)
  const setLinesLoading = useTransitStore((state) => state.setLinesLoading)

  useEffect(() => {
    const abort = new AbortController()
    setLinesLoading()
    fetchCatalog(abort.signal)
      .then((catalog) => {
        if (!abort.signal.aborted) hydrateCatalog(catalog)
      })
      .catch((error: unknown) => {
        if (isAbort(error)) return
        setLinesError(messageFrom(error, 'No se pudieron cargar las líneas.'))
      })
    return () => abort.abort()
  }, [nonce, hydrateCatalog, setLinesError, setLinesLoading])
}

export function useTrace() {
  const clientId = useTransitStore((state) => state.selectedClientId)
  const routeId = useTransitStore((state) => state.selectedRouteId)
  const nonce = useTransitStore((state) => state.traceNonce)
  const tripSelectedId = useTransitStore((state) => state.tripSelectedId)
  const setTrace = useTransitStore((state) => state.setTrace)
  const setTraceError = useTransitStore((state) => state.setTraceError)
  const setTraceLoading = useTransitStore((state) => state.setTraceLoading)

  useEffect(() => {
    if (!clientId || !routeId) return
    const current = useTransitStore.getState().trace
    if (current?.clientId === clientId && current.routeId === routeId && current.coordinates.length >= 2) return
    let stopped = false
    setTraceLoading()
    loadTrace(clientId, routeId, () => fetchTrace(clientId, routeId))
      .then((trace) => {
        if (!stopped) setTrace(trace)
      })
      .catch((error: unknown) => {
        if (stopped || isAbort(error)) return
        const latest = useTransitStore.getState()
        if (latest.selectedClientId !== clientId || latest.selectedRouteId !== routeId) return
        setTraceError(messageFrom(error, 'No se pudo cargar el recorrido.'))
      })
    return () => {
      stopped = true
    }
  }, [clientId, routeId, nonce, tripSelectedId, setTrace, setTraceError, setTraceLoading])
}

/** Carga la segunda pierna cuando el viaje seleccionado es una combinación. */
export function useTransferTrace() {
  const clientId = useTransitStore((state) => state.transferClientId)
  const routeId = useTransitStore((state) => state.transferRouteId)
  const tripSelectedId = useTransitStore((state) => state.tripSelectedId)
  const setTransferTrace = useTransitStore((state) => state.setTransferTrace)
  const setTransferTraceLoading = useTransitStore((state) => state.setTransferTraceLoading)

  useEffect(() => {
    if (!clientId || !routeId) return
    const current = useTransitStore.getState().transferTrace
    if (current?.clientId === clientId && current.routeId === routeId && current.coordinates.length >= 2) return
    let stopped = false
    setTransferTraceLoading()
    loadTrace(clientId, routeId, () => fetchTrace(clientId, routeId))
      .then((trace) => {
        if (!stopped) setTransferTrace(trace)
      })
      .catch((error: unknown) => {
        if (stopped || isAbort(error)) return
        const latest = useTransitStore.getState()
        if (latest.transferClientId !== clientId || latest.transferRouteId !== routeId) return
        setTransferTrace(null)
      })
    return () => {
      stopped = true
    }
  }, [clientId, routeId, tripSelectedId, setTransferTrace, setTransferTraceLoading])
}

export function useVehiclePolling() {
  const clientId = useTransitStore((state) => state.selectedClientId)
  const routeId = useTransitStore((state) => state.selectedRouteId)
  const transferClientId = useTransitStore((state) => state.transferClientId)
  const transferRouteId = useTransitStore((state) => state.transferRouteId)
  const tripSelectedId = useTransitStore((state) => state.tripSelectedId)
  const stopCode = useTransitStore((state) => state.selectedStop?.code ?? null)
  const nonce = useTransitStore((state) => state.vehicleNonce)
  const applyVehicleSnapshot = useTransitStore((state) => state.applyVehicleSnapshot)
  const setVehicleError = useTransitStore((state) => state.setVehicleError)
  const setVehicleRefreshing = useTransitStore((state) => state.setVehicleRefreshing)

  useEffect(() => {
    if (!clientId || !routeId) return
    let timer = 0
    let abort: AbortController | null = null
    let stopped = false

    const schedule = (delay: number) => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        void tick()
      }, delay)
    }

    const tick = async () => {
      if (stopped) return
      window.clearTimeout(timer)
      if (document.visibilityState === 'hidden') {
        schedule(1500)
        return
      }
      abort?.abort()
      const current = new AbortController()
      abort = current
      setVehicleRefreshing(true)
      try {
        const active = useTransitStore.getState()
        const trip = active.tripOptions.find((item) => item.id === active.tripSelectedId) ?? null
        const primaryStop = trip?.boardStopCode ?? stopCode
        const transferStop = trip?.transferBoardStopCode ?? trip?.transferStopCode ?? null

        const requests: Array<{ legIndex: number; promise: Promise<Awaited<ReturnType<typeof fetchVehicles>>> }> = [
          { legIndex: 0, promise: fetchVehicles(clientId, routeId, primaryStop, current.signal) },
        ]
        if (transferClientId && transferRouteId) {
          requests.push({
            legIndex: 1,
            promise: fetchVehicles(transferClientId, transferRouteId, transferStop, current.signal),
          })
        }

        const settled = await Promise.allSettled(requests.map((item) => item.promise))
        if (stopped || current.signal.aborted) return
        const latest = useTransitStore.getState()
        if (latest.selectedClientId !== clientId || latest.selectedRouteId !== routeId) return
        if (latest.transferClientId !== transferClientId || latest.transferRouteId !== transferRouteId) return
        if (latest.tripSelectedId !== tripSelectedId) return
        if ((latest.selectedStop?.code ?? null) !== stopCode) return

        for (const result of settled) {
          if (result.status !== 'fulfilled') continue
          observeFrequency(
            result.value.clientId,
            result.value.routeId,
            result.value.vehicles.flatMap((vehicle) => {
              const seconds = arrivalSecondsOf(vehicle)
              return seconds === null ? [] : [{ id: vehicle.id, seconds }]
            }),
          )
        }

        const tripNow = latest.tripOptions.find((item) => item.id === latest.tripSelectedId) ?? null
        const enriched = settled.flatMap((result, index) => {
          if (result.status !== 'fulfilled') return []
          const leg = tripNow?.legs[requests[index]!.legIndex]
          const snapshot = result.value
          if (!leg) return [snapshot]
          return [{
            ...snapshot,
            vehicles: snapshot.vehicles.map((vehicle) => ({
              ...vehicle,
              lineName: leg.lineName || vehicle.lineName,
              color: leg.color || vehicle.color,
              tripLeg: requests[index]!.legIndex,
            })),
          }]
        })
        if (enriched.length === 0) {
          const firstError = settled.find((item) => item.status === 'rejected')
          throw firstError && firstError.status === 'rejected' ? firstError.reason : new Error('GPS vacío')
        }
        applyVehicleSnapshot(enriched.length === 1 ? enriched[0]! : enriched)
        schedule(VEHICLE_POLL_MS)
      } catch (error) {
        if (isAbort(error) || stopped) return
        setVehicleError(messageFrom(error, 'No se pudo actualizar el GPS.'))
        const retryAfter = error instanceof ApiError ? error.retryAfterMs : null
        schedule(Math.max(VEHICLE_POLL_MS, retryAfter ?? 0))
      }
    }

    void tick()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      abort?.abort()
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [
    clientId,
    routeId,
    transferClientId,
    transferRouteId,
    tripSelectedId,
    stopCode,
    nonce,
    applyVehicleSnapshot,
    setVehicleError,
    setVehicleRefreshing,
  ])
}

export function useTripSearch() {
  const nonce = useTransitStore((state) => state.tripNonce)
  const origin = useTransitStore((state) => state.tripOrigin)
  const destination = useTransitStore((state) => state.tripDestination)
  const setTripLoading = useTransitStore((state) => state.setTripLoading)
  const setTripResults = useTransitStore((state) => state.setTripResults)
  const setTripError = useTransitStore((state) => state.setTripError)

  useEffect(() => {
    if (!origin || !destination) return
    const flags = useTransitStore.getState()
    if (!flags.tripIncludeDirect && !flags.tripIncludeTransfer) {
      setTripError('Elegí directos, combinaciones o ambos.')
      return
    }
    const abort = new AbortController()
    setTripLoading()
    const input = {
      from: { lat: origin.lat, lon: origin.lon, label: origin.label },
      to: { lat: destination.lat, lon: destination.lon, label: destination.label },
      maxWalkMeters: null,
      includeDirect: true,
      includeTransfer: true,
    }
    searchTrip({ ...input, preferComplete: false }, abort.signal)
      .then(async (first) => {
        if (abort.signal.aborted) return
        setTripResults(first.options, !first.complete)
        if (first.complete) return
        const full = await searchTrip({ ...input, preferComplete: true }, abort.signal)
        if (!abort.signal.aborted) setTripResults(full.options, false)
      })
      .catch((error: unknown) => {
        if (isAbort(error) || abort.signal.aborted) return
        setTripError(messageFrom(error, 'No se pudo buscar el viaje.'))
      })
    return () => abort.abort()
  }, [
    nonce,
    origin,
    destination,
    setTripLoading,
    setTripResults,
    setTripError,
  ])
}

export function useRouteHash() {
  const linesStatus = useTransitStore((state) => state.linesStatus)
  const clientId = useTransitStore((state) => state.selectedClientId)
  const routeId = useTransitStore((state) => state.selectedRouteId)

  useEffect(() => {
    if (linesStatus !== 'ready') return
    const next = clientId && routeId ? `#/${clientId}/${routeId}` : ''
    const current = window.location.hash
    if (next === current) return
    const base = `${window.location.pathname}${window.location.search}`
    window.history.replaceState(null, '', next ? `${base}${next}` : base)
  }, [linesStatus, clientId, routeId])
}
