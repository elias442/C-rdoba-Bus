import { haversineMeters, nearestCoordIndex, pathLengthMeters, projectOnTrace, sliceTraceSegment } from './geo'
import type { Line, Stop, TraceResponse, TrackedVehicle, TripLeg, TripOption, TripPoint } from '../types'

/** Velocidad media urbana, paradas incluidas. No es un horario de la empresa. */
export const BUS_KMH = 16
const WALK_KMH = 4.8
const BUS_MPS = (BUS_KMH * 1000) / 3600
const WALK_MPS = (WALK_KMH * 1000) / 3600
const MIN_WALK_METERS = 45
const MAX_ARRIVAL_SECONDS = 3 * 3600

export type GuideStepKind = 'walk' | 'board' | 'ride'

export interface GuideStep {
  id: string
  kind: GuideStepKind
  title: string
  subtitle: string
  minutes: number | null
  meters: number | null
  color: string | null
  lineName: string | null
  target: { lon: number; lat: number } | null
  path: Array<[number, number]> | null
}

export interface TripGuide {
  steps: GuideStep[]
  /** Desde que se toma el primero hasta que se toma el segundo. */
  connectionSeconds: number | null
  connectionMeters: number | null
  connectionDetail: string | null
  transferWalkSeconds: number
  secondArrivalSeconds: number | null
  firstLineName: string | null
  secondLineName: string | null
  pendingTrace: boolean
}

export interface GuideInput {
  trip: TripOption
  origin: TripPoint | null
  destination: TripPoint | null
  firstTrace: TraceResponse | null
  secondTrace: TraceResponse | null
  vehicles: TrackedVehicle[]
}

export function resolveLegRoute(lines: Line[], leg: TripLeg): string {
  const line = lines.find((item) => (
    item.clientId === leg.clientId && (item.id === leg.lineId || item.name === leg.lineName)
  ))
  if (line?.routes.some((route) => route.id === leg.routeId)) return leg.routeId
  return leg.routeIds.find((id) => line?.routes.some((route) => route.id === id)) ?? leg.routeId
}

/**
 * Traza que corresponde a la pierna. La búsqueda a veces cita un id de recorrido
 * que el catálogo reemplaza por otro de la misma línea; esa geometría igual se dibuja.
 * No depende de que haya colectivos en circulación.
 */
export function traceMatchesLeg(trace: TraceResponse | null, leg: TripLeg | null | undefined): trace is TraceResponse {
  if (!trace || !leg || trace.coordinates.length < 2) return false
  if (trace.clientId !== leg.clientId) return false
  if (trace.routeId === leg.routeId) return true
  return Array.isArray(leg.routeIds) && leg.routeIds.includes(trace.routeId)
}

export function arrivalSecondsOf(vehicle: { arrivalSeconds?: number | null; arrivalLabel: string | null }): number | null {
  const raw = vehicle.arrivalSeconds
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw < 0 || raw > MAX_ARRIVAL_SECONDS) return null
    return raw
  }
  return parseArrivalLabel(vehicle.arrivalLabel)
}

const AT_STOP_METERS = 90
const OFF_ROUTE_METERS = 400

export interface ArrivalEstimate {
  seconds: number
  /** El dato de la empresa no coincide con la posición sobre el recorrido. */
  approximate: boolean
}

/**
 * Minutos hasta la parada que importa, medidos sobre el recorrido.
 * Si el colectivo ya está en la parada, es ahora. Si ya la pasó, no hay llegada.
 * El tiempo de la empresa se usa solo cuando coincide con esa distancia.
 */
export function arrivalAtStop(
  vehicle: { lon: number; lat: number; arrivalSeconds?: number | null; arrivalLabel: string | null },
  trace: TraceResponse | null,
  stop: { lon: number; lat: number } | null,
): ArrivalEstimate | null {
  const live = arrivalSecondsOf(vehicle)
  if (!trace || !stop || trace.coordinates.length < 2) {
    return live === null ? null : { seconds: live, approximate: false }
  }
  const bus = projectOnTrace(trace.coordinates, vehicle.lon, vehicle.lat)
  const gate = projectOnTrace(trace.coordinates, stop.lon, stop.lat)
  if (!bus || !gate || bus.offset > OFF_ROUTE_METERS) {
    return live === null ? null : { seconds: live, approximate: false }
  }
  const ahead = gate.along - bus.along
  if (ahead < -AT_STOP_METERS) return null
  if (ahead <= AT_STOP_METERS) return { seconds: 0, approximate: false }
  const along = ahead / BUS_MPS
  if (live === null) return { seconds: along, approximate: true }
  const slack = Math.max(120, Math.max(live, along) * 0.35)
  if (Math.abs(live - along) <= slack) return { seconds: live, approximate: false }
  return { seconds: along, approximate: true }
}

export function soonestArrivalSeconds(
  vehicles: TrackedVehicle[],
  leg: number,
  trace: TraceResponse | null,
  stop: { lon: number; lat: number } | null,
): number | null {
  let best: number | null = null
  for (const vehicle of vehicles) {
    if (vehicle.tripLeg !== leg || vehicle.missingSince) continue
    const estimate = arrivalAtStop(vehicle, trace, stop)
    if (!estimate) continue
    if (best === null || estimate.seconds < best) best = estimate.seconds
  }
  return best
}

export function buildTripGuide(input: GuideInput): TripGuide {
  const firstLeg = input.trip.legs[0] ?? null
  const secondLeg = input.trip.legs[1] ?? null
  const firstTrace = matchingTrace(input.firstTrace, firstLeg)
  const secondTrace = matchingTrace(input.secondTrace, secondLeg)
  const board = findStop(firstTrace, input.trip.boardStopCode)
  const alightFirst = input.trip.kind === 'transfer'
    ? findStop(firstTrace, input.trip.transferStopCode)
    : findStop(firstTrace, input.trip.alightStopCode)
  const boardSecond = findStop(secondTrace, input.trip.transferBoardStopCode)
    ?? findStop(secondTrace, input.trip.transferStopCode)
  const alight = findStop(secondTrace ?? firstTrace, input.trip.alightStopCode)
  const pendingTrace = Boolean(firstLeg) && !firstTrace

  const steps: GuideStep[] = []
  const boardPoint = pointOf(board)
  const alightFirstPoint = pointOf(alightFirst) ?? input.trip.transfer
  const boardSecondPoint = pointOf(boardSecond) ?? input.trip.transfer ?? alightFirstPoint
  const alightPoint = pointOf(alight)

  pushWalk(steps, 'walk-origin', 'Caminá a la parada', board, input.origin, boardPoint, null)

  const firstRide = rideBetween(firstTrace, boardPoint, alightFirstPoint)
  const firstStops = stopsAlong(firstTrace, boardPoint, alightFirstPoint)
  const firstEta = soonestArrivalSeconds(input.vehicles, 0, firstTrace, board)

  if (firstLeg) {
    steps.push({
      id: 'board-1',
      kind: 'board',
      title: `Subí al ${firstLeg.lineName}`,
      subtitle: boardSubtitle(board, input.trip.boardStopCode, firstLeg.directionLabel, firstEta),
      minutes: firstEta === null ? null : Math.max(1, Math.round(firstEta / 60)),
      meters: null,
      color: firstLeg.color,
      lineName: firstLeg.lineName,
      target: boardPoint,
      path: null,
    })
    steps.push({
      id: 'ride-1',
      kind: 'ride',
      title: `Seguí en el ${firstLeg.lineName}`,
      subtitle: rideSubtitle(
        firstStops,
        firstRide?.meters ?? null,
        input.trip.kind === 'transfer' ? alightFirst : alight,
        input.trip.kind === 'transfer' ? input.trip.transferStopCode : input.trip.alightStopCode,
      ),
      minutes: firstRide ? secondsToMinutes(firstRide.seconds) : null,
      meters: firstRide?.meters ?? null,
      color: firstLeg.color,
      lineName: firstLeg.lineName,
      target: input.trip.kind === 'transfer' ? alightFirstPoint : alightPoint,
      path: firstRide?.path ?? null,
    })
  }

  let transferWalkSeconds = 0
  if (input.trip.kind === 'transfer' && alightFirstPoint && boardSecondPoint) {
    const walked = walkMeters(alightFirstPoint, boardSecondPoint)
    if (walked >= MIN_WALK_METERS) {
      transferWalkSeconds = walked / WALK_MPS
      steps.push({
        id: 'walk-transfer',
        kind: 'walk',
        title: secondLeg ? `Caminá al ${secondLeg.lineName}` : 'Caminá al trasbordo',
        subtitle: `${labelMeters(walked)} a pie hasta ${placeName(boardSecond, input.trip.transferBoardStopCode, 'la otra parada')}`,
        minutes: secondsToMinutes(transferWalkSeconds),
        meters: Math.round(walked),
        color: null,
        lineName: secondLeg?.lineName ?? null,
        target: boardSecondPoint,
        path: null,
      })
    }
  }

  const secondEta = secondLeg ? soonestArrivalSeconds(input.vehicles, 1, secondTrace, boardSecond) : null
  const travelSeconds = (firstRide?.seconds ?? 0) + transferWalkSeconds
  const firstWait = firstEta ?? 0
  const waitForSecond = secondEta === null ? null : Math.max(0, secondEta - firstWait - travelSeconds)

  if (secondLeg) {
    const samePlace = transferWalkSeconds === 0
    steps.push({
      id: 'board-2',
      kind: 'board',
      title: `Subí al ${secondLeg.lineName}`,
      subtitle: secondBoardSubtitle(boardSecond, input.trip.transferBoardStopCode ?? input.trip.transferStopCode, secondLeg.directionLabel, waitForSecond, secondEta, samePlace),
      minutes: waitForSecond !== null && waitForSecond >= 45 ? secondsToMinutes(waitForSecond) : null,
      meters: null,
      color: secondLeg.color,
      lineName: secondLeg.lineName,
      target: boardSecondPoint,
      path: null,
    })
    const secondRide = rideBetween(secondTrace, boardSecondPoint, alightPoint)
    const secondStops = stopsAlong(secondTrace, boardSecondPoint, alightPoint)
    steps.push({
      id: 'ride-2',
      kind: 'ride',
      title: `Seguí en el ${secondLeg.lineName}`,
      subtitle: rideSubtitle(secondStops, secondRide?.meters ?? null, alight, input.trip.alightStopCode),
      minutes: secondRide ? secondsToMinutes(secondRide.seconds) : null,
      meters: secondRide?.meters ?? null,
      color: secondLeg.color,
      lineName: secondLeg.lineName,
      target: alightPoint,
      path: secondRide?.path ?? null,
    })
  }

  pushWalk(steps, 'walk-dest', 'Caminá al destino', null, alightPoint ?? boardSecondPoint ?? alightFirstPoint, input.destination, input.destination?.label ?? 'tu destino')

  const connection = connectionOf(
    input.trip,
    firstLeg,
    secondLeg,
    firstRide,
    transferWalkSeconds,
    waitForSecond,
    secondEta,
    pendingTrace,
  )

  return {
    steps,
    connectionSeconds: connection.seconds,
    connectionMeters: firstRide?.meters ?? null,
    connectionDetail: connection.detail,
    transferWalkSeconds,
    secondArrivalSeconds: secondEta,
    firstLineName: firstLeg?.lineName ?? null,
    secondLineName: secondLeg?.lineName ?? null,
    pendingTrace,
  }
}

/** Plazo que falta para tomar el segundo, si todavía no llegaste a esa subida. */
export function liveConnectionSeconds(
  guide: TripGuide,
  step: GuideStep | undefined,
  user: { lon: number; lat: number; accuracy?: number } | null,
): number | null {
  if (guide.connectionSeconds === null || !step) return null
  if (step.id === 'ride-2' || step.id === 'walk-dest') return null
  if (step.id === 'board-2') return guide.connectionSeconds
  if (!user || (user.accuracy ?? 999) > 120) return guide.connectionSeconds

  if (step.id === 'ride-1' && step.path && step.path.length >= 2) {
    const index = nearestCoordIndex(step.path, user.lon, user.lat)
    const vertex = step.path[index]
    if (!vertex || haversineMeters(vertex[0], vertex[1], user.lon, user.lat) > 350) {
      return guide.connectionSeconds
    }
    const leftMeters = pathLengthMeters(step.path.slice(index))
    const leftRide = leftMeters / BUS_MPS
    const wait = guide.secondArrivalSeconds === null
      ? 0
      : Math.max(0, guide.secondArrivalSeconds - leftRide - guide.transferWalkSeconds)
    return Math.round(leftRide + guide.transferWalkSeconds + wait)
  }

  if (step.id === 'walk-transfer' && step.target) {
    const distance = haversineMeters(user.lon, user.lat, step.target.lon, step.target.lat)
    if (distance > 500) return guide.connectionSeconds
    const leftWalk = walkMeters(user, step.target) / WALK_MPS
    const wait = guide.secondArrivalSeconds === null
      ? 0
      : Math.max(0, guide.secondArrivalSeconds - leftWalk)
    return Math.round(leftWalk + wait)
  }

  return guide.connectionSeconds
}

export function stepIndexById(guide: TripGuide, id: string): number {
  const index = guide.steps.findIndex((step) => step.id === id)
  return index >= 0 ? index : 0
}

function connectionOf(
  trip: TripOption,
  firstLeg: TripLeg | null,
  secondLeg: TripLeg | null,
  firstRide: { seconds: number; meters: number } | null,
  transferWalkSeconds: number,
  waitForSecond: number | null,
  secondEta: number | null,
  pending: boolean,
): { seconds: number | null; detail: string | null } {
  if (trip.kind !== 'transfer' || !firstLeg || !secondLeg) return { seconds: null, detail: null }
  if (pending) {
    return { seconds: null, detail: 'Cuando cargue el recorrido vas a ver el plazo hasta el segundo colectivo.' }
  }
  if (!firstRide) {
    return { seconds: null, detail: 'No se pudo medir el tramo del primer colectivo hasta el trasbordo.' }
  }
  const travel = firstRide.seconds + transferWalkSeconds
  if (waitForSecond !== null && waitForSecond >= 45 && secondEta !== null) {
    return {
      seconds: Math.round(travel + waitForSecond),
      detail: `Incluye la espera hasta el ${secondLeg.lineName} que está en camino.`,
    }
  }
  if (secondEta !== null && waitForSecond !== null && waitForSecond < 45) {
    return {
      seconds: Math.round(travel),
      detail: `Es el viaje en el ${firstLeg.lineName} hasta la parada del ${secondLeg.lineName}. El que figura ahora llega antes de que bajes.`,
    }
  }
  return {
    seconds: Math.round(travel),
    detail: `Estimado por el recorrido del ${firstLeg.lineName} hasta donde tomás el ${secondLeg.lineName}.`,
  }
}

function pushWalk(
  steps: GuideStep[],
  id: string,
  title: string,
  stop: Stop | null,
  from: { lon: number; lat: number } | null,
  to: { lon: number; lat: number } | null,
  destinationLabel: string | null,
) {
  if (!from || !to) return
  const meters = walkMeters(from, to)
  if (meters < MIN_WALK_METERS) return
  const place = destinationLabel ?? placeName(stop, stop?.code ?? null, 'la parada')
  steps.push({
    id,
    kind: 'walk',
    title,
    subtitle: `${labelMeters(meters)} a pie hasta ${place}`,
    minutes: secondsToMinutes(meters / WALK_MPS),
    meters: Math.round(meters),
    color: null,
    lineName: null,
    target: to,
    path: null,
  })
}

function rideBetween(
  trace: TraceResponse | null,
  from: { lon: number; lat: number } | null,
  to: { lon: number; lat: number } | null,
): { path: Array<[number, number]>; meters: number; seconds: number } | null {
  if (!trace || trace.coordinates.length < 2 || !from || !to) return null
  const path = sliceTraceSegment(trace.coordinates, from, to)
  const meters = path.length >= 2 ? pathLengthMeters(path) : haversineMeters(from.lon, from.lat, to.lon, to.lat)
  if (meters < 30) return null
  return { path, meters, seconds: meters / BUS_MPS }
}

function stopsAlong(
  trace: TraceResponse | null,
  from: { lon: number; lat: number } | null,
  to: { lon: number; lat: number } | null,
): Stop[] {
  if (!trace || trace.coordinates.length < 2 || !from || !to) return []
  const start = nearestCoordIndex(trace.coordinates, from.lon, from.lat)
  const end = nearestCoordIndex(trace.coordinates, to.lon, to.lat)
  const lo = Math.min(start, end)
  const hi = Math.max(start, end)
  return trace.stops.filter((stop) => {
    const index = nearestCoordIndex(trace.coordinates, stop.lon, stop.lat)
    if (index <= lo || index > hi) return false
    const vertex = trace.coordinates[index]
    if (!vertex) return false
    return haversineMeters(vertex[0], vertex[1], stop.lon, stop.lat) < 90
  })
}

function matchingTrace(trace: TraceResponse | null, leg: TripLeg | null): TraceResponse | null {
  return traceMatchesLeg(trace, leg) ? trace : null
}

function findStop(trace: TraceResponse | null, code: string | null): Stop | null {
  if (!trace || !code) return null
  return trace.stops.find((stop) => stop.code === code) ?? null
}

function pointOf(stop: Stop | null): { lon: number; lat: number } | null {
  return stop ? { lon: stop.lon, lat: stop.lat } : null
}

function walkMeters(from: { lon: number; lat: number }, to: { lon: number; lat: number }): number {
  return haversineMeters(from.lon, from.lat, to.lon, to.lat) * 1.25
}

function placeName(stop: Stop | null, code: string | null, fallback: string): string {
  if (stop?.name) return stop.name
  if (code) return `parada ${code}`
  return fallback
}

function labelMeters(meters: number): string {
  if (meters < 950) return `${Math.max(10, Math.round(meters / 10) * 10)} m`
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`
}

function secondsToMinutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60))
}

function boardSubtitle(stop: Stop | null, code: string | null, direction: string, eta: number | null): string {
  const place = placeName(stop, code, 'la parada de subida')
  const when = eta === null ? 'sin arribo informado' : eta < 30 ? 'está por llegar' : `llega en ${secondsToMinutes(eta)} min`
  return `${place}${direction ? ` · ${direction}` : ''} · ${when}`
}

function secondBoardSubtitle(
  stop: Stop | null,
  code: string | null,
  direction: string,
  wait: number | null,
  eta: number | null,
  samePlace: boolean,
): string {
  const place = placeName(stop, code, 'la parada del trasbordo')
  const where = samePlace ? `${place} · mismo lugar` : place
  const when = wait === null || eta === null
    ? 'sin arribo informado'
    : wait < 45
      ? 'el que figura ahora llega antes de que bajes'
      : `esperá ${secondsToMinutes(wait)} min`
  return `${where}${direction ? ` · ${direction}` : ''} · ${when}`
}

function rideSubtitle(stops: Stop[], meters: number | null, alight: Stop | null, code: string | null): string {
  const parts: string[] = []
  if (stops.length > 0) parts.push(stops.length === 1 ? '1 parada' : `${stops.length} paradas`)
  if (meters !== null) parts.push(labelMeters(meters))
  parts.push(`bajá en ${placeName(alight, code, 'la parada')}`)
  return parts.join(' · ')
}

function parseArrivalLabel(label: string | null): number | null {
  if (!label) return null
  const text = label.trim().toLowerCase()
  if (text === 'ahora') return 0
  const signed = text.replace('−', '-')
  if (signed.startsWith('-')) return null
  const hours = signed.match(/(\d+)\s*h/)
  const minutes = signed.match(/(\d+)\s*min/)
  const seconds = signed.match(/(\d+)\s*s\b/)
  if (!hours && !minutes && !seconds) return null
  const total = (hours ? Number(hours[1]) * 3600 : 0)
    + (minutes ? Number(minutes[1]) * 60 : 0)
    + (seconds ? Number(seconds[1]) : 0)
  if (!Number.isFinite(total) || total > MAX_ARRIVAL_SECONDS) return null
  return total
}
