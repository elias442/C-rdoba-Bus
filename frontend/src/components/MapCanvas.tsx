import { useEffect, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl'
import { estimateWaitSeconds } from '../lib/frequency'
import { boundsFrom, CORDOBA_CENTER, haversineMeters, sliceTraceSegment, snapToTrace } from '../lib/geo'
import { arrivalAtStop, buildTripGuide } from '../lib/tripGuide'
import type { TripOption } from '../types'
import { formatFrequencyWait, formatLiveWait, reduceMotion } from '../lib/format'
import { MAP_STYLES, mobileSheetHeight } from '../lib/layout'
import { useViewportHeight } from '../hooks/useViewport'
import { useTransitStore } from '../stores/useTransitStore'
import type { Stop, TrackedVehicle, TraceResponse } from '../types'
import { MapControls } from './MapControls'

const EMPTY = { type: 'FeatureCollection' as const, features: [] as never[] }
const JUMP_METERS = 1500
const BUS_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.5 6.2C6.5 4.4 8.7 3 12 3s5.5 1.4 5.5 3.2V16a1.8 1.8 0 0 1-1.6 1.8v1a1 1 0 0 1-1 1h-.6a1 1 0 0 1-1-1v-.8h-2.6V18a1 1 0 0 1-1 1h-.6a1 1 0 0 1-1-1v-1A1.8 1.8 0 0 1 6.5 16V6.2Zm2 2.2h7a.7.7 0 0 1 .7.7v2.5a.7.7 0 0 1-.7.7h-7a.7.7 0 0 1-.7-.7V9.1a.7.7 0 0 1 .7-.7Z"/></svg>`

interface Anim {
  fromLng: number
  fromLat: number
  toLng: number
  toLat: number
  start: number
  duration: number
}

interface PoolItem {
  marker: maplibregl.Marker
  element: HTMLButtonElement
  lng: number
  lat: number
  anim: Anim | null
}

type MarkerModel =
  | { kind: 'vehicle'; id: string; vehicle: TrackedVehicle }
  | { kind: 'cluster'; id: string; lng: number; lat: number; count: number }

export function MapCanvas({ mobile }: { mobile: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const poolRef = useRef(new Map<string, PoolItem>())
  const loopRef = useRef(0)
  const ensureLoopRef = useRef<() => void>(() => {})
  const traceRef = useRef<TraceResponse | null>(null)
  const stopRef = useRef<Stop | null>(null)
  const userMarkerRef = useRef<maplibregl.Marker | null>(null)
  const tripMarkersRef = useRef({
    origin: null as maplibregl.Marker | null,
    destination: null as maplibregl.Marker | null,
    board: null as maplibregl.Marker | null,
    transfer: null as maplibregl.Marker | null,
    alight: null as maplibregl.Marker | null,
  })
  const fittedKey = useRef('')
  const [mapReady, setMapReady] = useState(false)
  const [mapFailed, setMapFailed] = useState(false)
  const [zoom, setZoom] = useState(12.15)
  const [locateMessage, setLocateMessage] = useState<string | null>(null)

  const mapStyle = useTransitStore((state) => state.mapStyle)
  const trace = useTransitStore((state) => state.trace)
  const selectedStop = useTransitStore((state) => state.selectedStop)
  const vehicles = useTransitStore((state) => state.vehicles)
  const selectedVehicleId = useTransitStore((state) => state.selectedVehicleId)
  const vehicleFocusNonce = useTransitStore((state) => state.vehicleFocusNonce)
  const stopFocusNonce = useTransitStore((state) => state.stopFocusNonce)
  const clientId = useTransitStore((state) => state.selectedClientId)
  const routeId = useTransitStore((state) => state.selectedRouteId)
  const sheetSnap = useTransitStore((state) => state.sheetSnap)
  const tripOrigin = useTransitStore((state) => state.tripOrigin)
  const tripDestination = useTransitStore((state) => state.tripDestination)
  const tripPinTarget = useTransitStore((state) => state.tripPinTarget)
  const tripSelectedId = useTransitStore((state) => state.tripSelectedId)
  const tripOptions = useTransitStore((state) => state.tripOptions)
  const transferTrace = useTransitStore((state) => state.transferTrace)
  const tripNavigating = useTransitStore((state) => state.tripNavigating)
  const tripNavStep = useTransitStore((state) => state.tripNavStep)
  const viewport = useViewportHeight()
  const styleUrl = MAP_STYLES[mapStyle]
  const styleUrlRef = useRef(styleUrl)
  const selectedTrip = tripOptions.find((option) => option.id === tripSelectedId) ?? null
  const transferTraceRef = useRef(transferTrace)
  const selectedTripRef = useRef(selectedTrip)

  traceRef.current = trace
  stopRef.current = selectedStop
  transferTraceRef.current = transferTrace
  selectedTripRef.current = selectedTrip

  const overlayBottom = mobile ? mobileSheetHeight(sheetSnap, viewport, tripNavigating) + 8 : 12

  useEffect(() => {
    const step = (now: number) => {
      let moving = false
      for (const item of poolRef.current.values()) {
        if (!item.anim) continue
        moving = true
        const t = Math.min(1, (now - item.anim.start) / item.anim.duration)
        const eased = 1 - (1 - t) ** 3
        item.lng = item.anim.fromLng + (item.anim.toLng - item.anim.fromLng) * eased
        item.lat = item.anim.fromLat + (item.anim.toLat - item.anim.fromLat) * eased
        item.marker.setLngLat([item.lng, item.lat])
        if (t >= 1) item.anim = null
      }
      loopRef.current = moving ? requestAnimationFrame(step) : 0
    }
    ensureLoopRef.current = () => {
      if (loopRef.current) return
      loopRef.current = requestAnimationFrame(step)
    }
    return () => {
      if (loopRef.current) cancelAnimationFrame(loopRef.current)
      loopRef.current = 0
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const map = new maplibregl.Map({
      container,
      style: styleUrlRef.current,
      center: CORDOBA_CENTER,
      zoom: 12.15,
      minZoom: 9,
      maxZoom: 18,
      maxBounds: [[-65.4, -32.2], [-63.5, -30.6]],
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    })
    mapRef.current = map
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')

    const onMapClick = (event: maplibregl.MapMouseEvent) => {
      const target = event.originalEvent.target
      if (target instanceof Element && target.closest('.bus-marker, .cluster-marker, .trip-pin, .trip-stop')) return

      const pinTarget = useTransitStore.getState().tripPinTarget
      if (pinTarget) {
        const label = pinTarget === 'origin' ? 'Origen en el mapa' : 'Destino en el mapa'
        useTransitStore.getState().placeTripPin({
          lat: event.lngLat.lat,
          lon: event.lngLat.lng,
          label,
        })
        return
      }

      if (!map.getLayer('stops')) {
        useTransitStore.getState().clearMapSelection()
        return
      }
      const hits = map.queryRenderedFeatures(event.point, { layers: ['stops'] })
      const feature = hits[0]
      if (!feature || feature.geometry.type !== 'Point') {
        useTransitStore.getState().clearMapSelection()
        return
      }
      const [lon, lat] = feature.geometry.coordinates
      const props = feature.properties ?? {}
      useTransitStore.getState().selectStopFromMap({
        code: String(props.code ?? ''),
        name: String(props.name ?? 'Parada'),
        shortLabel: props.shortLabel ? String(props.shortLabel) : null,
        order: Number(props.order) || 0,
        lon: Number(lon),
        lat: Number(lat),
        direction: String(props.direction ?? ''),
        directionLabel: String(props.directionLabel ?? ''),
      })
    }

    map.on('load', () => {
      installLayers(map)
      paint(
        map,
        traceRef.current,
        transferTraceRef.current,
        selectedTripRef.current,
        stopRef.current,
        useTransitStore.getState().tripOrigin,
        useTransitStore.getState().tripDestination,
      )
      setMapReady(true)
      setZoom(map.getZoom())
    })
    map.on('zoom', () => {
      const scale = markerScale(map.getZoom()).toFixed(3)
      for (const item of poolRef.current.values()) item.element.style.setProperty('--scale', scale)
    })
    map.on('zoomend', () => setZoom(map.getZoom()))
    map.on('mousemove', (event) => {
      if (useTransitStore.getState().tripPinTarget) {
        map.getCanvas().style.cursor = 'crosshair'
        return
      }
      if (!map.getLayer('stops')) {
        map.getCanvas().style.cursor = ''
        return
      }
      const hits = map.queryRenderedFeatures(event.point, { layers: ['stops'] })
      map.getCanvas().style.cursor = hits.length ? 'pointer' : ''
    })
    map.on('click', onMapClick)

    const failTimer = window.setTimeout(() => {
      if (!map.loaded()) setMapFailed(true)
    }, 8000)

    return () => {
      window.clearTimeout(failTimer)
      for (const item of poolRef.current.values()) item.marker.remove()
      poolRef.current.clear()
      userMarkerRef.current?.remove()
      tripMarkersRef.current.origin?.remove()
      tripMarkersRef.current.destination?.remove()
      tripMarkersRef.current.transfer?.remove()
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || styleUrlRef.current === styleUrl) return
    styleUrlRef.current = styleUrl
    map.setStyle(styleUrl)
    map.once('style.load', () => {
      installLayers(map)
      paint(
        map,
        traceRef.current,
        transferTraceRef.current,
        selectedTripRef.current,
        stopRef.current,
        useTransitStore.getState().tripOrigin,
        useTransitStore.getState().tripDestination,
      )
    })
  }, [styleUrl, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    paint(map, trace, transferTrace, selectedTrip, selectedStop, tripOrigin, tripDestination)
  }, [trace, transferTrace, selectedTrip, selectedStop, tripOrigin, tripDestination, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const bag = tripMarkersRef.current
    syncTripMarker(map, bag, 'origin', tripOrigin ? [tripOrigin.lon, tripOrigin.lat] : null, 'A', 'trip-pin trip-pin--origin')
    syncTripMarker(map, bag, 'destination', tripDestination ? [tripDestination.lon, tripDestination.lat] : null, 'B', 'trip-pin trip-pin--destination')

    const points = tripStopMarkers(selectedTrip, trace, transferTrace)
    const state = useTransitStore.getState()
    if (points.board) points.board.wait = stopWaitLabel(state.selectedClientId, state.selectedRouteId, vehicles, 0)
    if (points.transfer) {
      points.transfer.wait = stopWaitLabel(state.transferClientId, state.transferRouteId, vehicles, 1)
    }
    const active = tripNavigating ? activeStopKey(selectedTrip, tripNavStep, trace, transferTrace, tripOrigin, tripDestination) : null
    syncTripStopMarker(map, bag, 'board', points.board, active === 'board')
    syncTripStopMarker(map, bag, 'transfer', points.transfer, active === 'transfer')
    syncTripStopMarker(map, bag, 'alight', points.alight, active === 'alight')
  }, [tripOrigin, tripDestination, selectedTrip, trace, transferTrace, mapReady, tripNavigating, tripNavStep, vehicles])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    map.getCanvas().style.cursor = tripPinTarget ? 'crosshair' : ''
  }, [tripPinTarget, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    if (selectedTrip && !tripNavigating) {
      const leg = selectedTrip.legs[0]
      if (!trace || trace.coordinates.length < 2 || !leg || trace.clientId !== leg.clientId) return
      const key = `trip:${selectedTrip.id}:${trace.clientId}:${trace.routeId}:${transferTrace?.clientId ?? ''}:${transferTrace?.routeId ?? ''}`
      if (fittedKey.current === key) return
      const coords = tripFitCoordinates(selectedTrip, trace, transferTrace, tripOrigin, tripDestination)
      if (coords.length < 2) return
      fittedKey.current = key
      map.fitBounds(boundsFrom(coords), {
        padding: cameraPadding(mobile),
        duration: reduceMotion() ? 0 : 850,
        maxZoom: 14.5,
      })
      return
    }

    if (!trace || clientId === null || !routeId) return
    if (trace.clientId !== clientId || trace.routeId !== routeId || trace.coordinates.length < 2) return
    const key = `${clientId}:${routeId}`
    if (fittedKey.current === key) return
    fittedKey.current = key
    map.fitBounds(boundsFrom(trace.coordinates), {
      padding: cameraPadding(mobile),
      duration: reduceMotion() ? 0 : 850,
      maxZoom: 15,
    })
  }, [trace, transferTrace, selectedTrip, tripOrigin, tripDestination, mapReady, clientId, routeId, mobile, tripNavigating])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !tripNavigating || !selectedTrip) return
    const state = useTransitStore.getState()
    const guide = buildTripGuide({
      trip: selectedTrip,
      origin: state.tripOrigin,
      destination: state.tripDestination,
      firstTrace: trace,
      secondTrace: transferTrace,
      vehicles: state.vehicles,
    })
    const step = guide.steps[tripNavStep]
    if (!step?.target) return
    const user = state.userLocation
    const padding = cameraPadding(mobile)
    if (user && haversineMeters(user.lon, user.lat, step.target.lon, step.target.lat) > 40) {
      map.fitBounds(boundsFrom([[user.lon, user.lat], [step.target.lon, step.target.lat]]), {
        padding,
        duration: reduceMotion() ? 0 : 700,
        maxZoom: 16,
      })
      return
    }
    map.easeTo({
      center: [step.target.lon, step.target.lat],
      zoom: Math.max(map.getZoom(), 15.2),
      duration: reduceMotion() ? 0 : 700,
      padding,
    })
  }, [tripNavigating, tripNavStep, selectedTrip, trace, transferTrace, mapReady, mobile])

  useEffect(() => {
    if (!tripNavigating || !mapReady || !navigator.geolocation) return
    const map = mapRef.current
    if (!map) return
    const watch = navigator.geolocation.watchPosition(
      (position) => {
        const lng = position.coords.longitude
        const lat = position.coords.latitude
        useTransitStore.getState().setUserLocation({
          lat,
          lon: lng,
          accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : 999,
        })
        const current = mapRef.current
        if (!current) return
        if (!userMarkerRef.current) {
          const element = document.createElement('div')
          element.className = 'user-dot'
          userMarkerRef.current = new maplibregl.Marker({ element, anchor: 'center' })
        }
        userMarkerRef.current.setLngLat([lng, lat]).addTo(current)
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 15000 },
    )
    return () => navigator.geolocation.clearWatch(watch)
  }, [tripNavigating, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !selectedVehicleId) return
    const vehicle = useTransitStore.getState().vehicles.find((item) => item.id === selectedVehicleId)
    if (!vehicle) return
    const collapsed = useTransitStore.getState().sidebarCollapsed
    map.easeTo({
      center: [vehicle.lon, vehicle.lat],
      zoom: Math.max(map.getZoom(), 14),
      duration: reduceMotion() ? 0 : 650,
      offset: mobile ? [0, -24] : [collapsed ? -24 : -150, 0],
    })
  }, [vehicleFocusNonce, selectedVehicleId, mapReady, mobile])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || stopFocusNonce === 0) return
    const stop = useTransitStore.getState().selectedStop
    if (!stop) return
    map.easeTo({
      center: [stop.lon, stop.lat],
      zoom: Math.max(map.getZoom(), 15.2),
      duration: reduceMotion() ? 0 : 650,
    })
  }, [stopFocusNonce, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const models = clusterModels(vehiclesOnRoute(vehicles), zoom, selectedVehicleId)
    const seen = new Set<string>()
    const scale = markerScale(map.getZoom()).toFixed(3)

    for (const model of models) {
      seen.add(model.id)
      const existing = poolRef.current.get(model.id)
      if (model.kind === 'cluster') {
        if (!existing) {
          const element = clusterButton(model.count, model.lng, model.lat)
          element.style.setProperty('--scale', scale)
          element.addEventListener('click', (event) => {
            event.stopPropagation()
            const lng = Number(element.dataset.lng)
            const lat = Number(element.dataset.lat)
            mapRef.current?.easeTo({
              center: [lng, lat],
              zoom: Math.min((mapRef.current?.getZoom() ?? zoom) + 1.8, 16),
              duration: reduceMotion() ? 0 : 500,
            })
          })
          const marker = new maplibregl.Marker({ element, anchor: 'center', subpixelPositioning: true }).setLngLat([model.lng, model.lat]).addTo(map)
          poolRef.current.set(model.id, { marker, element, lng: model.lng, lat: model.lat, anim: null })
        } else {
          const label = existing.element.querySelector('.marker-scale')
          if (label) label.textContent = String(model.count)
          else existing.element.textContent = String(model.count)
          existing.marker.setSubpixelPositioning(true)
          existing.element.dataset.lng = String(model.lng)
          existing.element.dataset.lat = String(model.lat)
          retarget(existing, model.lng, model.lat, ensureLoopRef.current)
        }
        continue
      }

      const { vehicle } = model
      if (!existing) {
        const element = vehicleButton(vehicle, vehicle.id === selectedVehicleId)
        element.style.setProperty('--scale', scale)
        element.addEventListener('click', (event) => {
          event.stopPropagation()
          const id = element.dataset.id
          if (id) useTransitStore.getState().focusVehicle(id)
        })
        const marker = new maplibregl.Marker({ element, anchor: 'center', subpixelPositioning: true }).setLngLat([vehicle.lon, vehicle.lat]).addTo(map)
        poolRef.current.set(model.id, { marker, element, lng: vehicle.lon, lat: vehicle.lat, anim: null })
      } else {
        paintVehicle(existing.element, vehicle, vehicle.id === selectedVehicleId)
        existing.marker.setSubpixelPositioning(true)
        retarget(existing, vehicle.lon, vehicle.lat, ensureLoopRef.current)
      }
    }

    for (const [id, item] of poolRef.current) {
      if (seen.has(id)) continue
      item.marker.remove()
      poolRef.current.delete(id)
    }
  }, [vehicles, trace, transferTrace, zoom, selectedVehicleId, mapReady])

  const locate = () => {
    if (!navigator.geolocation) {
      setLocateMessage('Este dispositivo no comparte la ubicación.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const map = mapRef.current
        if (!map) return
        const lng = position.coords.longitude
        const lat = position.coords.latitude
        if (!userMarkerRef.current) {
          const element = document.createElement('div')
          element.className = 'user-dot'
          userMarkerRef.current = new maplibregl.Marker({ element, anchor: 'center' })
        }
        userMarkerRef.current.setLngLat([lng, lat]).addTo(map)
        map.easeTo({
          center: [lng, lat],
          zoom: Math.max(map.getZoom(), 15),
          duration: reduceMotion() ? 0 : 700,
        })
        setLocateMessage(null)
      },
      () => setLocateMessage('No se pudo obtener tu ubicación.'),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 20000 },
    )
  }

  return (
    <div
      className="map-stage absolute inset-0"
      style={{ ['--overlay-bottom' as string]: `${overlayBottom}px` }}
    >
      <div ref={containerRef} className="absolute inset-0" />
      {mapFailed ? (
        <div className="absolute left-1/2 top-24 z-10 -translate-x-1/2 rounded-2xl bg-white px-4 py-3 text-sm shadow-panel">
          No se pudo cargar el mapa base.
        </div>
      ) : null}
      <MapControls
        bottom={overlayBottom + 46}
        onZoomIn={() => mapRef.current?.zoomIn({ duration: reduceMotion() ? 0 : 250 })}
        onZoomOut={() => mapRef.current?.zoomOut({ duration: reduceMotion() ? 0 : 250 })}
        onLocate={locate}
        locateMessage={locateMessage}
      />
    </div>
  )
}

function cameraPadding(mobile: boolean): maplibregl.PaddingOptions {
  if (mobile) {
    const state = useTransitStore.getState()
    const bottom = mobileSheetHeight(state.sheetSnap, window.innerHeight, state.tripNavigating) + 24
    return { top: 92, right: 24, bottom, left: 20 }
  }
  const left = useTransitStore.getState().sidebarCollapsed ? 124 : 440
  return { top: 56, right: 64, bottom: 56, left }
}

const ROUTE_SNAP_METERS = 160

function vehiclesOnRoute(vehicles: TrackedVehicle[]): TrackedVehicle[] {
  const state = useTransitStore.getState()
  return vehicles.map((vehicle) => {
    const path = vehicle.tripLeg === 1 ? state.transferTrace : state.trace
    if (!path || path.coordinates.length < 2) return vehicle
    if (state.tripSelectedId && vehicle.tripLeg !== 0 && vehicle.tripLeg !== 1) return vehicle
    const snapped = snapToTrace(path.coordinates, vehicle.lon, vehicle.lat, ROUTE_SNAP_METERS)
    if (!snapped) return vehicle
    return { ...vehicle, lon: snapped.lon, lat: snapped.lat }
  })
}

function markerScale(zoom: number): number {
  return Math.min(1.12, Math.max(0.78, 0.64 + (zoom - 10) * 0.07))
}

function retarget(item: PoolItem, lng: number, lat: number, ensureLoop: () => void) {
  const distance = haversineMeters(item.lng, item.lat, lng, lat)
  if (reduceMotion() || distance > JUMP_METERS || distance < 0.4) {
    item.anim = null
    item.lng = lng
    item.lat = lat
    item.marker.setLngLat([lng, lat])
    return
  }
  item.anim = {
    fromLng: item.lng,
    fromLat: item.lat,
    toLng: lng,
    toLat: lat,
    start: performance.now(),
    duration: 1400,
  }
  ensureLoop()
}

function clusterModels(vehicles: TrackedVehicle[], zoom: number, selectedId: string | null): MarkerModel[] {
  const selected = vehicles.filter((vehicle) => vehicle.id === selectedId)
  const rest = vehicles.filter((vehicle) => vehicle.id !== selectedId)
  const individuals = (list: TrackedVehicle[]): MarkerModel[] => list.map((vehicle) => ({
    kind: 'vehicle',
    id: vehicle.id,
    vehicle,
  }))
  const pinned = rest.filter((vehicle) => vehicle.tripLeg === 0 || vehicle.tripLeg === 1)
  const crowd = rest.filter((vehicle) => vehicle.tripLeg !== 0 && vehicle.tripLeg !== 1)
  if (crowd.length < 16 || zoom >= 13.2) return [...individuals(crowd), ...individuals(pinned), ...individuals(selected)]

  const cell = zoom < 11.5 ? 0.018 : 0.008
  const buckets = new Map<string, TrackedVehicle[]>()
  for (const vehicle of crowd) {
    const key = `${Math.round(vehicle.lon / cell)}:${Math.round(vehicle.lat / cell)}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(vehicle)
    else buckets.set(key, [vehicle])
  }
  const models: MarkerModel[] = []
  for (const [key, group] of buckets) {
    if (group.length === 1 && group[0]) {
      models.push({ kind: 'vehicle', id: group[0].id, vehicle: group[0] })
      continue
    }
    const lng = group.reduce((sum, vehicle) => sum + vehicle.lon, 0) / group.length
    const lat = group.reduce((sum, vehicle) => sum + vehicle.lat, 0) / group.length
    const anchor = group.reduce((best, vehicle) => {
      const distance = (vehicle.lon - lng) ** 2 + (vehicle.lat - lat) ** 2
      return distance < best.distance ? { distance, vehicle } : best
    }, { distance: Infinity, vehicle: group[0]! })
    models.push({
      kind: 'cluster',
      id: `cluster:${key}`,
      lng: anchor.vehicle.lon,
      lat: anchor.vehicle.lat,
      count: group.length,
    })
  }
  return [...models, ...individuals(pinned), ...individuals(selected)]
}

function waitChip(vehicle: TrackedVehicle): string | null {
  const state = useTransitStore.getState()
  const trip = state.tripOptions.find((option) => option.id === state.tripSelectedId) ?? null
  if (!trip && !state.selectedStop) return null
  if (trip && vehicle.tripLeg !== 0 && vehicle.tripLeg !== 1) return null

  const target = targetStop(vehicle, trip, state.trace, state.transferTrace, state.selectedStop)
  const trace = vehicle.tripLeg === 1 ? state.transferTrace : state.trace
  const estimate = arrivalAtStop(vehicle, trace, target)
  return estimate ? formatLiveWait(estimate.seconds, estimate.approximate) : null
}

function targetStop(
  vehicle: TrackedVehicle,
  trip: TripOption | null,
  trace: TraceResponse | null,
  transferTrace: TraceResponse | null,
  selectedStop: Stop | null,
): Stop | null {
  if (trip && vehicle.tripLeg === 0) return stopByCode(trace, trip.boardStopCode)
  if (trip && vehicle.tripLeg === 1) {
    return stopByCode(transferTrace, trip.transferBoardStopCode)
      ?? stopByCode(transferTrace, trip.transferStopCode)
  }
  return selectedStop
}

function legHasArrival(vehicles: TrackedVehicle[], leg: 0 | 1): boolean {
  const state = useTransitStore.getState()
  const trip = state.tripOptions.find((option) => option.id === state.tripSelectedId) ?? null
  return vehicles.some((vehicle) => {
    if (vehicle.tripLeg !== leg || vehicle.missingSince !== null) return false
    const target = targetStop(vehicle, trip, state.trace, state.transferTrace, state.selectedStop)
    const trace = leg === 1 ? state.transferTrace : state.trace
    return arrivalAtStop(vehicle, trace, target) !== null
  })
}

function stopWaitLabel(
  clientId: number | null,
  routeId: string | null,
  vehicles: TrackedVehicle[],
  leg: 0 | 1,
): string | null {
  if (legHasArrival(vehicles, leg)) return null
  const status = useTransitStore.getState().vehicleStatus
  if ((status === 'idle' || status === 'loading') && vehicles.length === 0) return null
  const seconds = estimateWaitSeconds(clientId, routeId)
  return seconds === null ? 'Sin unidades' : formatFrequencyWait(seconds)
}

function vehicleButton(vehicle: TrackedVehicle, selected: boolean): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'bus-marker'
  button.dataset.id = vehicle.id
  button.innerHTML = `<span class="marker-scale"><span class="bus-marker__plate">${BUS_ICON}<span></span></span><span class="bus-marker__eta" hidden></span></span>`
  paintVehicle(button, vehicle, selected)
  return button
}

function paintVehicle(button: HTMLButtonElement, vehicle: TrackedVehicle, selected: boolean) {
  button.classList.toggle('is-selected', selected)
  button.classList.toggle('is-stale', vehicle.missingSince !== null)
  button.style.zIndex = selected ? '4' : '1'
  const wait = waitChip(vehicle)
  button.setAttribute('aria-label', `Línea ${vehicle.lineName}, coche ${vehicle.vehicleNumber}${wait ? `, ${wait}` : ''}`)
  button.setAttribute('aria-pressed', selected ? 'true' : 'false')
  const plate = button.querySelector<HTMLElement>('.bus-marker__plate')
  plate?.style.setProperty('--bus', vehicle.color)
  plate?.style.setProperty('--ink', readableInk(vehicle.color))
  const label = plate?.querySelector('span')
  if (label) label.textContent = vehicle.lineName
  const eta = button.querySelector<HTMLElement>('.bus-marker__eta')
  if (eta) {
    eta.textContent = wait ?? ''
    eta.hidden = !wait
  }
}

function clusterButton(count: number, lng: number, lat: number): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'cluster-marker'
  button.innerHTML = `<span class="marker-scale">${count}</span>`
  button.setAttribute('aria-label', `${count} colectivos en esta zona`)
  button.dataset.lng = String(lng)
  button.dataset.lat = String(lat)
  return button
}

function readableInk(color: string): string {
  const raw = color.replace('#', '')
  const full = raw.length === 3 ? raw.split('').map((char) => char + char).join('') : raw.slice(0, 6)
  const value = Number.parseInt(full, 16)
  if (!Number.isFinite(value)) return '#ffffff'
  const luminance = (((value >> 16) & 255) * 299 + ((value >> 8) & 255) * 587 + (value & 255) * 114) / 1000
  return luminance > 170 ? '#10203a' : '#ffffff'
}

function ensureSource(map: MapLibreMap, id: string) {
  if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY })
}

function ensureLayer(map: MapLibreMap, layer: maplibregl.LayerSpecification) {
  if (!map.getLayer(layer.id)) map.addLayer(layer)
}

function installLayers(map: MapLibreMap) {
  if (!map.hasImage('route-arrow')) {
    map.addImage('route-arrow', createArrow(), { pixelRatio: 2 })
  }

  ensureSource(map, 'route')
  ensureSource(map, 'route-transfer')
  ensureSource(map, 'deviations')
  ensureSource(map, 'stops')
  ensureSource(map, 'stop-highlight')

  ensureLayer(map, {
    id: 'route-casing',
    type: 'line',
    source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#10203a', 'line-width': 10, 'line-opacity': 0.18 },
  })
  ensureLayer(map, {
    id: 'route-line',
    type: 'line',
    source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['coalesce', ['get', 'color'], '#2f6bff'], 'line-width': 6 },
  })
  ensureLayer(map, {
    id: 'route-transfer-casing',
    type: 'line',
    source: 'route-transfer',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#10203a', 'line-width': 10, 'line-opacity': 0.18 },
  })
  ensureLayer(map, {
    id: 'route-transfer-line',
    type: 'line',
    source: 'route-transfer',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['coalesce', ['get', 'color'], '#f59e0b'],
      'line-width': 6,
      'line-dasharray': [2.2, 1.4],
    },
  })
  ensureLayer(map, {
    id: 'route-arrows',
    type: 'symbol',
    source: 'route',
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 90,
      'icon-image': 'route-arrow',
      'icon-size': 0.7,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-rotation-alignment': 'map',
    },
  })
  ensureLayer(map, {
    id: 'route-transfer-arrows',
    type: 'symbol',
    source: 'route-transfer',
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 90,
      'icon-image': 'route-arrow',
      'icon-size': 0.7,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-rotation-alignment': 'map',
    },
  })
  ensureLayer(map, {
    id: 'deviations',
    type: 'line',
    source: 'deviations',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#e07a14', 'line-width': 4, 'line-dasharray': [1.2, 1] },
  })
  ensureLayer(map, {
    id: 'stops',
    type: 'circle',
    source: 'stops',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3.2, 15, 6],
      'circle-color': '#ffffff',
      'circle-stroke-color': ['coalesce', ['get', 'color'], '#2f6bff'],
      'circle-stroke-width': 2,
    },
  })
  ensureLayer(map, {
    id: 'stop-labels',
    type: 'symbol',
    source: 'stops',
    minzoom: 14,
    layout: {
      'text-field': ['get', 'shortLabel'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 11,
      'text-offset': [0, 0.9],
      'text-anchor': 'top',
      'text-optional': true,
    },
    paint: {
      'text-color': '#10203a',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.1,
    },
  })
  ensureLayer(map, {
    id: 'stop-highlight',
    type: 'circle',
    source: 'stop-highlight',
    paint: {
      'circle-radius': 10,
      'circle-color': 'rgba(47,107,255,0.16)',
      'circle-stroke-color': '#2f6bff',
      'circle-stroke-width': 2,
    },
  })
}

type LngLat = { lon: number; lat: number }

type TripMarkerBag = {
  origin: maplibregl.Marker | null
  destination: maplibregl.Marker | null
  board: maplibregl.Marker | null
  transfer: maplibregl.Marker | null
  alight: maplibregl.Marker | null
}

type TripStopMarker = {
  lngLat: [number, number]
  badge: string
  label: string
  color: string
  /** Espera estimada cuando no hay un colectivo de esa pierna en el mapa. */
  wait?: string | null
}

function stopByCode(trace: TraceResponse | null, code: string | null): Stop | null {
  if (!trace || !code) return null
  return trace.stops.find((item) => item.code === code) ?? null
}

function findStop(traces: Array<TraceResponse | null>, code: string | null): Stop | null {
  for (const trace of traces) {
    const stop = stopByCode(trace, code)
    if (stop) return stop
  }
  return null
}

function asPoint(stop: Stop | null): LngLat | null {
  return stop ? { lon: stop.lon, lat: stop.lat } : null
}

function tripFitCoordinates(
  trip: TripOption,
  first: TraceResponse | null,
  second: TraceResponse | null,
  origin: LngLat | null,
  destination: LngLat | null,
): Array<[number, number]> {
  const coords: Array<[number, number]> = []
  if (origin) coords.push([origin.lon, origin.lat])
  if (destination) coords.push([destination.lon, destination.lat])
  if (trip.transfer) coords.push([trip.transfer.lon, trip.transfer.lat])
  for (const segment of tripSegments(trip, first, second, origin, destination)) {
    coords.push(...segment.coordinates)
  }
  return coords
}

/** Geometría de la pierna ya cargada, aunque el id del viaje no sea el del catálogo y no haya unidades. */
function legGeometry(trace: TraceResponse | null, leg: TripOption['legs'][number] | null | undefined): TraceResponse | null {
  if (!trace || !leg || trace.coordinates.length < 2) return null
  if (trace.clientId !== leg.clientId) return null
  return trace
}

function tripSegments(
  trip: TripOption | null,
  first: TraceResponse | null,
  second: TraceResponse | null,
  origin: LngLat | null = null,
  destination: LngLat | null = null,
): Array<{ color: string; role: 'primary' | 'transfer'; coordinates: Array<[number, number]> }> {
  if (!trip) {
    if (!first || first.coordinates.length < 2) return []
    return [{ color: first.color, role: 'primary', coordinates: first.coordinates }]
  }

  const leg1 = trip.legs[0]
  const leg2 = trip.legs[1]
  const primary = legGeometry(first, leg1)
  const onward = legGeometry(second, leg2)
  const leg1Color = leg1?.color ?? primary?.color ?? '#2f6bff'
  const leg2Color = leg2?.color ?? onward?.color ?? '#f59e0b'
  const board = findStop([primary], trip.boardStopCode)
  const alightFirst = findStop([primary], trip.transferStopCode)
  const boardSecond = findStop([onward], trip.transferBoardStopCode)
    ?? findStop([onward], trip.transferStopCode)
  const alight = findStop([onward, primary], trip.alightStopCode)
  const transferPoint = trip.transfer
    ?? asPoint(alightFirst)
    ?? asPoint(boardSecond)

  const segments: Array<{ color: string; role: 'primary' | 'transfer'; coordinates: Array<[number, number]> }> = []

  if (primary && primary.coordinates.length >= 2) {
    const from = asPoint(board) ?? origin
    const to = trip.kind === 'transfer'
      ? (asPoint(alightFirst) ?? transferPoint)
      : (asPoint(alight) ?? destination)
    const sliced = trip.kind === 'direct' && !trip.boardStopCode && !trip.alightStopCode
      ? primary.coordinates
      : sliceTraceSegment(primary.coordinates, from, to)
    const coordinates = sliced.length >= 2 ? sliced : primary.coordinates
    if (coordinates.length >= 2) {
      segments.push({ color: leg1Color, role: 'primary', coordinates })
    }
  }

  if (trip.kind === 'transfer' && onward && onward.coordinates.length >= 2) {
    const from = asPoint(boardSecond) ?? transferPoint
    const to = asPoint(alight) ?? destination
    const sliced = sliceTraceSegment(onward.coordinates, from, to)
    const coordinates = sliced.length >= 2 ? sliced : onward.coordinates
    if (coordinates.length >= 2) {
      segments.push({ color: leg2Color, role: 'transfer', coordinates })
    }
  }

  return segments
}

function tripStopMarkers(
  trip: TripOption | null,
  first: TraceResponse | null,
  second: TraceResponse | null,
): {
  board: TripStopMarker | null
  transfer: TripStopMarker | null
  alight: TripStopMarker | null
} {
  if (!trip) return { board: null, transfer: null, alight: null }

  const primary = legGeometry(first, trip.legs[0])
  const onward = legGeometry(second, trip.legs[1])
  const leg1Color = trip.legs[0]?.color ?? primary?.color ?? '#2f6bff'
  const leg2Color = trip.legs[1]?.color ?? onward?.color ?? '#f59e0b'
  const board = findStop([primary], trip.boardStopCode)
  const transferStop = findStop([primary, onward], trip.transferStopCode)
    ?? findStop([onward, primary], trip.transferBoardStopCode)
  const alight = findStop([onward, primary], trip.alightStopCode)
  const transferPoint = trip.transfer

  const transferLngLat: [number, number] | null = transferStop
    ? [transferStop.lon, transferStop.lat]
    : transferPoint
      ? [transferPoint.lon, transferPoint.lat]
      : null

  const transferLabel = trip.transferBoardStopCode
    && trip.transferStopCode
    && trip.transferBoardStopCode !== trip.transferStopCode
    ? `Bajá ${trip.transferStopCode} · subí ${trip.transferBoardStopCode}`
    : trip.transferStopCode
      ? `Trasbordo ${trip.transferStopCode}`
      : 'Trasbordo'

  return {
    board: board
      ? {
          lngLat: [board.lon, board.lat],
          badge: '1',
          label: `Subí ${trip.boardStopCode ?? board.code}`,
          color: leg1Color,
        }
      : null,
    transfer: trip.kind === 'transfer' && transferLngLat
      ? {
          lngLat: transferLngLat,
          badge: '↔',
          label: transferLabel,
          color: '#10203a',
        }
      : null,
    alight: alight
      ? {
          lngLat: [alight.lon, alight.lat],
          badge: trip.kind === 'transfer' ? '2' : '↓',
          label: `Bajá ${trip.alightStopCode ?? alight.code}`,
          color: trip.kind === 'transfer' ? leg2Color : leg1Color,
        }
      : null,
  }
}

function paint(
  map: MapLibreMap,
  trace: TraceResponse | null,
  transferTrace: TraceResponse | null,
  trip: TripOption | null,
  stop: Stop | null,
  origin: LngLat | null = null,
  destination: LngLat | null = null,
) {
  installLayers(map)
  const route = geoSource(map, 'route')
  const routeTransfer = geoSource(map, 'route-transfer')
  const deviations = geoSource(map, 'deviations')
  const stops = geoSource(map, 'stops')
  const highlight = geoSource(map, 'stop-highlight')
  if (!route || !routeTransfer || !deviations || !stops || !highlight) return

  const segments = tripSegments(trip, trace, transferTrace, origin, destination)
  const toCollection = (role: 'primary' | 'transfer') => ({
    type: 'FeatureCollection' as const,
    features: segments
      .filter((segment) => segment.role === role)
      .map((segment) => ({
        type: 'Feature' as const,
        properties: { color: segment.color, role: segment.role },
        geometry: { type: 'LineString' as const, coordinates: segment.coordinates },
      })),
  })
  route.setData(toCollection('primary'))
  routeTransfer.setData(toCollection('transfer'))

  // En modo viaje los desvíos confunden con la 2ª pierna.
  if (trip) {
    deviations.setData(EMPTY)
  } else {
    deviations.setData({
      type: 'FeatureCollection',
      features: (trace?.notices ?? []).flatMap((notice) => (
        notice.deviation.length >= 2
          ? [{
              type: 'Feature' as const,
              properties: { title: notice.title },
              geometry: { type: 'LineString' as const, coordinates: notice.deviation },
            }]
          : []
      )),
    })
  }

  // Las paradas del viaje van como markers HTML; acá solo el resto del recorrido.
  if (trip) {
    stops.setData(EMPTY)
  } else {
    stops.setData({
      type: 'FeatureCollection',
      features: (trace?.stops ?? []).map((item) => ({
        type: 'Feature' as const,
        properties: {
          code: item.code,
          name: item.name,
          shortLabel: item.shortLabel ?? String(item.order),
          order: item.order,
          direction: item.direction,
          directionLabel: item.directionLabel,
          color: trace?.color ?? '#2f6bff',
        },
        geometry: { type: 'Point' as const, coordinates: [item.lon, item.lat] },
      })),
    })
  }

  highlight.setData(stop ? {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] },
  } : EMPTY)
}

function geoSource(map: MapLibreMap, id: string): GeoJSONSource | null {
  const source = map.getSource(id)
  if (!source || source.type !== 'geojson') return null
  return source as GeoJSONSource
}

function syncTripMarker(
  map: MapLibreMap,
  bag: TripMarkerBag,
  key: 'origin' | 'destination',
  lngLat: [number, number] | null,
  label: string,
  className: string,
) {
  if (!lngLat) {
    bag[key]?.remove()
    bag[key] = null
    return
  }
  if (!bag[key]) {
    const element = document.createElement('div')
    element.className = className
    element.textContent = label
    bag[key] = new maplibregl.Marker({ element, anchor: 'bottom' })
  } else {
    bag[key]!.getElement().className = className
    bag[key]!.getElement().textContent = label
  }
  bag[key]!.setLngLat(lngLat).addTo(map)
}

function activeStopKey(
  trip: TripOption | null,
  stepIndex: number,
  first: TraceResponse | null,
  second: TraceResponse | null,
  origin: { lon: number; lat: number } | null,
  destination: { lon: number; lat: number } | null,
): 'board' | 'transfer' | 'alight' | null {
  if (!trip) return null
  const guide = buildTripGuide({
    trip,
    origin: origin ? { ...origin, label: '' } : null,
    destination: destination ? { ...destination, label: '' } : null,
    firstTrace: first,
    secondTrace: second,
    vehicles: [],
  })
  const id = guide.steps[stepIndex]?.id
  if (id === 'walk-origin' || id === 'board-1') return 'board'
  if (id === 'ride-1' || id === 'walk-transfer' || id === 'board-2') return 'transfer'
  if (id === 'ride-2' || id === 'walk-dest') return 'alight'
  return null
}

function syncTripStopMarker(
  map: MapLibreMap,
  bag: TripMarkerBag,
  key: 'board' | 'transfer' | 'alight',
  marker: TripStopMarker | null,
  active = false,
) {
  if (!marker || !marker.lngLat || !Number.isFinite(marker.lngLat[0]) || !Number.isFinite(marker.lngLat[1])) {
    bag[key]?.remove()
    bag[key] = null
    return
  }
  if (!bag[key]) {
    const element = document.createElement('div')
    element.className = 'trip-stop'
    element.innerHTML = '<div class="trip-stop__badge"></div><div class="trip-stop__label"></div><div class="trip-stop__eta" hidden></div>'
    bag[key] = new maplibregl.Marker({ element, anchor: 'bottom' })
  }
  const root = bag[key]!.getElement()
  root.classList.toggle('trip-stop--active', active)
  const badge = root.querySelector<HTMLElement>('.trip-stop__badge')
  const label = root.querySelector<HTMLElement>('.trip-stop__label')
  if (badge) {
    badge.textContent = marker.badge
    badge.style.background = marker.color
  }
  if (label) label.textContent = marker.label
  let eta = root.querySelector<HTMLElement>('.trip-stop__eta')
  if (!eta) {
    eta = document.createElement('div')
    eta.className = 'trip-stop__eta'
    root.appendChild(eta)
  }
  eta.textContent = marker.wait ?? ''
  eta.hidden = !marker.wait
  bag[key]!.setLngLat(marker.lngLat).addTo(map)
}

function createArrow(): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = 24
  canvas.height = 24
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No se pudo preparar el ícono del recorrido.')
  context.clearRect(0, 0, 24, 24)
  context.fillStyle = '#ffffff'
  context.beginPath()
  context.moveTo(4, 5)
  context.lineTo(18, 12)
  context.lineTo(4, 19)
  context.closePath()
  context.fill()
  return context.getImageData(0, 0, 24, 24)
}
