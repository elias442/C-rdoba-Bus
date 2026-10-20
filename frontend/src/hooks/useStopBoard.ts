import { useEffect, useMemo, useRef, useState } from 'react'
import { observeFrequency } from '../lib/frequency'
import { VEHICLE_POLL_MS } from '../lib/layout'
import { coordKey, peekAddress, reverseAddress } from '../lib/reverseGeocode'
import { routeEta, type RouteEta } from '../lib/stopEta'
import { noteTraceStops, routeKey, servicesAtStop, subscribeStopIndex } from '../lib/stopIndex'
import { ensureStopIndex, pauseStopIndex, stopScanStatus } from '../lib/stopScan'
import { arrivalSecondsOf } from '../lib/tripGuide'
import { fetchVehicles, isAbort } from '../services/api'
import { useTransitStore } from '../stores/useTransitStore'
import type { IndexedService } from '../lib/stopIndex'
import type { Stop } from '../types'

export interface StopBoardLine {
  key: string
  lineKey: string
  lineName: string
  color: string
  directionLabel: string
  routeName: string
  routeId: string
  eta: RouteEta
  selected: boolean
}

export interface StopBoardModel {
  lines: StopBoardLine[]
  count: number
  countLabel: string
  searchNote: string | null
  address: string | null
  addressStatus: 'loading' | 'ready' | 'fallback'
  openLine: (lineKey: string, routeId: string) => void
}

export function useStopBoard(stop: Stop | null): StopBoardModel | null {
  const lines = useTransitStore((state) => state.lines)
  const trace = useTransitStore((state) => state.trace)
  const vehicles = useTransitStore((state) => state.vehicles)
  const vehicleStatus = useTransitStore((state) => state.vehicleStatus)
  const vehicleRefreshing = useTransitStore((state) => state.vehicleRefreshing)
  const selectedClientId = useTransitStore((state) => state.selectedClientId)
  const selectedRouteId = useTransitStore((state) => state.selectedRouteId)
  const [revision, setRevision] = useState(0)
  const [labels, setLabels] = useState<Record<string, RouteEta>>({})
  const [address, setAddress] = useState<string | null>(() => initialAddress(stop).text)
  const [addressStatus, setAddressStatus] = useState<'loading' | 'ready' | 'fallback'>(() => initialAddress(stop).status)
  const [arrivalsReady, setArrivalsReady] = useState(false)
  const labelsRef = useRef(labels)
  const inFlight = useRef(new Set<string>())
  const etaAbort = useRef<AbortController | null>(null)
  const sawRefresh = useRef(false)
  const stopCode = stop?.code ?? null
  const addressKey = stop ? coordKey(stop.lat, stop.lon) : ''
  const [trackedStop, setTrackedStop] = useState(stopCode)
  const [trackedAddress, setTrackedAddress] = useState(addressKey)
  if (stopCode !== trackedStop) {
    setTrackedStop(stopCode)
    labelsRef.current = {}
    inFlight.current.clear()
    setLabels({})
    setArrivalsReady(false)
    sawRefresh.current = false
  }
  if (addressKey !== trackedAddress) {
    setTrackedAddress(addressKey)
    const known = stop ? peekAddress(stop.lat, stop.lon) : undefined
    setAddress(known ?? null)
    setAddressStatus(!stop ? 'loading' : known === undefined ? 'loading' : known ? 'ready' : 'fallback')
  }

  useEffect(() => subscribeStopIndex(() => setRevision((value) => value + 1)), [])

  useEffect(() => {
    if (!stop?.code || !trace) return
    if (!trace.stops.some((item) => item.code === stop.code)) return
    noteTraceStops(trace.clientId, trace.routeId, trace.stops.map((item) => item.code))
  }, [stop?.code, trace])

  useEffect(() => {
    if (!stop?.code) {
      pauseStopIndex()
      return
    }
    ensureStopIndex(lines)
  }, [stop?.code, lines])

  useEffect(() => {
    labelsRef.current = {}
    inFlight.current.clear()
    setLabels({})
    etaAbort.current?.abort()
    const controller = new AbortController()
    etaAbort.current = controller
    return () => controller.abort()
  }, [stop?.code])

  const services = useMemo(() => {
    if (!stop) return []
    const extra = selectedClientId !== null && selectedRouteId
      ? [routeKey(selectedClientId, selectedRouteId)]
      : []
    const selected = extra[0] ?? ''
    return servicesAtStop(lines, stop.code, extra).sort((a, b) => {
      const aSelected = a.routeKey === selected ? 0 : 1
      const bSelected = b.routeKey === selected ? 0 : 1
      if (aSelected !== bSelected) return aSelected - bSelected
      const byName = a.lineName.localeCompare(b.lineName, 'es', { numeric: true })
      if (byName !== 0) return byName
      return a.directionLabel.localeCompare(b.directionLabel, 'es')
    })
  }, [stop, lines, selectedClientId, selectedRouteId, revision])

  const servicesRef = useRef(services)
  servicesRef.current = services
  const serviceKey = services.map((service) => service.routeKey).join('|')

  useEffect(() => {
    const controller = etaAbort.current
    if (!stop?.code || !controller) return
    const selected = selectedKey(selectedClientId, selectedRouteId)
    const missing = services.filter((service) => service.routeKey !== selected && !labelsRef.current[service.routeKey])
    void pullEtas(missing, stop.code, controller.signal, false, inFlight.current, labelsRef, setLabels)
  }, [stop?.code, serviceKey, selectedClientId, selectedRouteId, services])

  useEffect(() => {
    if (!stop?.code) return
    const timer = window.setInterval(() => {
      const controller = etaAbort.current
      if (!controller || controller.signal.aborted || document.visibilityState === 'hidden') return
      const selected = selectedKey(selectedClientId, selectedRouteId)
      const current = servicesRef.current.filter((service) => service.routeKey !== selected)
      void pullEtas(current, stop.code, controller.signal, true, inFlight.current, labelsRef, setLabels)
    }, VEHICLE_POLL_MS)
    return () => window.clearInterval(timer)
  }, [stop?.code, selectedClientId, selectedRouteId])

  useEffect(() => {
    sawRefresh.current = false
    setArrivalsReady(false)
  }, [stop?.code, selectedClientId, selectedRouteId])

  useEffect(() => {
    if (vehicleRefreshing) sawRefresh.current = true
    if (!sawRefresh.current || vehicleRefreshing) return
    if (vehicleStatus === 'idle' || vehicleStatus === 'loading') return
    setArrivalsReady(true)
  }, [vehicleRefreshing, vehicleStatus])

  useEffect(() => {
    if (!stop) return
    if (peekAddress(stop.lat, stop.lon) !== undefined) return
    const controller = new AbortController()
    void reverseAddress(stop.lat, stop.lon, controller.signal).then((label) => {
      if (controller.signal.aborted) return
      setAddress(label)
      setAddressStatus(label ? 'ready' : 'fallback')
    })
    return () => controller.abort()
  }, [stop?.lat, stop?.lon])

  const selectedEta = useMemo(() => {
    if (selectedClientId === null || !selectedRouteId) return { text: 'Calculando…', live: false }
    const cached = labels[routeKey(selectedClientId, selectedRouteId)]
    if (!arrivalsReady) return cached ?? { text: 'Calculando…', live: false }
    const status = vehicleStatus === 'idle' || vehicleStatus === 'loading' ? 'loading' as const : 'ready' as const
    return routeEta(vehicles, status, selectedClientId, selectedRouteId)
  }, [arrivalsReady, labels, vehicles, vehicleStatus, selectedClientId, selectedRouteId])

  if (!stop) return null

  const scan = stopScanStatus(lines)
  const rows: StopBoardLine[] = services.map((service) => {
    const selected = service.clientId === selectedClientId && service.routeId === selectedRouteId
    const eta = selected ? selectedEta : labels[service.routeKey] ?? { text: 'Calculando…', live: false }
    return {
      key: service.routeKey,
      lineKey: service.lineKey,
      lineName: service.lineName,
      color: service.color,
      directionLabel: service.directionLabel,
      routeName: service.routeName,
      routeId: service.routeId,
      eta,
      selected,
    }
  })
  const count = rows.length
  const countLabel = count === 0
    ? (scan.complete ? 'Sin líneas en esta parada' : 'Buscando líneas…')
    : count === 1
      ? '1 línea'
      : `${count} líneas`
  const searchNote = scan.complete
    ? null
    : scan.scanning
      ? (count > 0 ? 'Buscando otras líneas…' : null)
      : scan.note

  return {
    lines: rows,
    count,
    countLabel,
    searchNote,
    address,
    addressStatus,
    openLine: (lineKey, routeId) => {
      const line = useTransitStore.getState().lines.find((item) => item.key === lineKey)
      if (line) useTransitStore.getState().focusLineAtStop(line, routeId)
    },
  }
}

function initialAddress(stop: Stop | null): { text: string | null; status: 'loading' | 'ready' | 'fallback' } {
  if (!stop) return { text: null, status: 'loading' }
  const known = peekAddress(stop.lat, stop.lon)
  if (known === undefined) return { text: null, status: 'loading' }
  return { text: known, status: known ? 'ready' : 'fallback' }
}

function selectedKey(clientId: number | null, routeId: string | null): string {
  if (clientId === null || !routeId) return ''
  return routeKey(clientId, routeId)
}

async function pullEtas(
  services: IndexedService[],
  stopCode: string,
  signal: AbortSignal,
  refresh: boolean,
  inFlight: Set<string>,
  labelsRef: { current: Record<string, RouteEta> },
  setLabels: (update: (current: Record<string, RouteEta>) => Record<string, RouteEta>) => void,
) {
  await runPool(services, 3, signal, async (service) => {
    if (signal.aborted) return
    if (!refresh && labelsRef.current[service.routeKey]) return
    if (inFlight.has(service.routeKey)) return
    inFlight.add(service.routeKey)
    try {
      const snapshot = await fetchVehicles(service.clientId, service.routeId, stopCode, signal)
      if (signal.aborted) return
      observeFrequency(
        snapshot.clientId,
        snapshot.routeId,
        snapshot.vehicles.flatMap((vehicle) => {
          const seconds = arrivalSecondsOf(vehicle)
          return seconds === null ? [] : [{ id: vehicle.id, seconds }]
        }),
      )
      const eta = routeEta(snapshot.vehicles, 'ready', service.clientId, service.routeId)
      labelsRef.current = { ...labelsRef.current, [service.routeKey]: eta }
      setLabels((current) => ({ ...current, [service.routeKey]: eta }))
    } catch (error) {
      if (isAbort(error) || signal.aborted) return
      const eta = routeEta([], 'ready', service.clientId, service.routeId)
      labelsRef.current = { ...labelsRef.current, [service.routeKey]: eta }
      setLabels((current) => ({ ...current, [service.routeKey]: eta }))
    } finally {
      inFlight.delete(service.routeKey)
    }
  })
}

async function runPool<T>(items: T[], limit: number, signal: AbortSignal, task: (item: T) => Promise<void>) {
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!signal.aborted) {
      const index = cursor
      cursor += 1
      const item = items[index]
      if (item === undefined) return
      await task(item)
    }
  })
  await Promise.all(workers)
}
