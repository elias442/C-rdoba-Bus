import type { PlaceSuggestion, TripLeg, TripOption, TripSearchResult } from '../../types/trip.js'
import { directionLabel, isPlausibleCoordinate, safeColor } from './normalize.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'))
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function cleanLabel(value: unknown): string | null {
  const raw = text(value)
  return raw || null
}

function routeIdsFrom(value: unknown, fallback: string): string[] {
  if (Array.isArray(value)) {
    const ids = value.map((item) => text(item)).filter(Boolean)
    if (ids.length) return [...new Set(ids)]
  }
  return fallback ? [fallback] : []
}

function parseLeg(raw: unknown, operatorName?: string | null): TripLeg | null {
  if (!isRecord(raw)) return null
  const lineId = text(raw.id)
  const lineName = text(raw.nombre) || lineId
  const clientId = finiteNumber(raw.cliente_id)
  const routeId = text(raw.ruta)
  if (!lineId || clientId === null || !routeId) return null
  const direction = text(raw.sentido)
  return {
    lineId,
    lineName,
    clientId,
    operatorName: operatorName ?? cleanLabel(raw.cliente_nombre),
    color: safeColor(raw.color),
    direction,
    directionLabel: directionLabel(direction),
    routeId,
    routeIds: routeIdsFrom(raw.rutas, routeId),
  }
}

function parseDistanceKm(value: unknown): number | null {
  const label = text(value)
  if (!label) return null
  const match = label.replace(',', '.').match(/(\d+(?:\.\d+)?)\s*k/i)
  if (!match) return finiteNumber(value)
  const km = Number(match[1])
  return Number.isFinite(km) ? km : null
}

function parseDirect(raw: unknown): TripOption | null {
  if (!isRecord(raw)) return null
  const leg = parseLeg(raw, cleanLabel(raw.cliente_nombre))
  if (!leg) return null
  const walkMeters = finiteNumber(raw.d)
  const distanceLabel = cleanLabel(raw.distancia)
  return {
    id: `direct:${leg.clientId}:${leg.lineId}:${leg.routeId}:${text(raw.origen)}:${text(raw.destino)}`,
    kind: 'direct',
    etaLabel: cleanLabel(raw.duracion),
    distanceLabel,
    distanceKm: parseDistanceKm(distanceLabel ?? raw.distancia),
    ordenDiff: finiteNumber(raw.ordenDiff),
    walkMeters: walkMeters !== null && walkMeters >= 0 ? Math.round(walkMeters) : null,
    boardStopCode: cleanLabel(raw.origen),
    alightStopCode: cleanLabel(raw.destino),
    transferStopCode: null,
    transferBoardStopCode: null,
    transfer: null,
    legs: [leg],
  }
}

function parseTransfer(raw: unknown): TripOption | null {
  if (!isRecord(raw)) return null
  const first = parseLeg(raw.linea_origen)
  const second = parseLeg(raw.linea_destino)
  if (!first || !second) return null

  let transfer: { lat: number; lon: number } | null = null
  if (isRecord(raw.trasb_coord)) {
    const lat = finiteNumber(raw.trasb_coord.lat)
    const lon = finiteNumber(raw.trasb_coord.lon)
    if (lat !== null && lon !== null && isPlausibleCoordinate(lat, lon)) {
      transfer = { lat, lon }
    }
  }

  const walkMeters = finiteNumber(raw.d)
  const distanceLabel = cleanLabel(raw.distancia)
  return {
    id: `transfer:${first.clientId}:${first.lineId}:${second.clientId}:${second.lineId}:${text(raw.parada_origen)}:${text(raw.parada_destinoB)}`,
    kind: 'transfer',
    etaLabel: cleanLabel(raw.duracion),
    distanceLabel,
    distanceKm: parseDistanceKm(distanceLabel ?? raw.distancia),
    ordenDiff: finiteNumber(raw.ordenDiff),
    walkMeters: walkMeters !== null && walkMeters >= 0 ? Math.round(walkMeters) : null,
    boardStopCode: cleanLabel(raw.parada_origen),
    alightStopCode: cleanLabel(raw.parada_destinoB),
    // Bajada 1ª línea: parada_destino. Subida 2ª: parada_origenA (suelen estar a metros).
    transferStopCode: cleanLabel(raw.parada_destino) ?? cleanLabel(raw.parada_origenA),
    transferBoardStopCode: cleanLabel(raw.parada_origenA) ?? cleanLabel(raw.parada_destino),
    transfer,
    legs: [first, second],
  }
}

export function normalizeTripPage(payload: unknown): {
  directs: TripOption[]
  transfers: TripOption[]
  continua: number
} {
  if (!isRecord(payload)) {
    return { directs: [], transfers: [], continua: 0 }
  }
  const directs = Array.isArray(payload.lineas)
    ? payload.lineas.flatMap((item) => {
        const option = parseDirect(item)
        return option ? [option] : []
      })
    : []
  const transfers = Array.isArray(payload.combinaciones)
    ? payload.combinaciones.flatMap((item) => {
        const option = parseTransfer(item)
        return option ? [option] : []
      })
    : []
  return {
    directs,
    transfers,
    continua: finiteNumber(payload.continua) ?? 0,
  }
}

export function mergeTripOptions(pages: TripOption[]): TripOption[] {
  const seen = new Set<string>()
  const merged: TripOption[] = []
  for (const option of pages) {
    if (seen.has(option.id)) continue
    seen.add(option.id)
    merged.push(option)
  }
  return merged
}

export function filterTripOptions(
  options: TripOption[],
  input: { maxWalkMeters: number | null; includeDirect: boolean; includeTransfer: boolean },
): TripOption[] {
  return options.filter((option) => {
    if (option.kind === 'direct' && !input.includeDirect) return false
    if (option.kind === 'transfer' && !input.includeTransfer) return false
    if (input.maxWalkMeters !== null && option.walkMeters !== null && option.walkMeters > input.maxWalkMeters) {
      return false
    }
    return true
  })
}

export function sortTripOptions(options: TripOption[]): TripOption[] {
  return [...options].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'direct' ? -1 : 1
    const distA = a.distanceKm ?? 99999
    const distB = b.distanceKm ?? 99999
    if (distA !== distB) return distA - distB
    const walkA = a.walkMeters ?? 99999
    const walkB = b.walkMeters ?? 99999
    if (walkA !== walkB) return walkA - walkB
    const ordA = a.ordenDiff ?? 99999
    const ordB = b.ordenDiff ?? 99999
    if (ordA !== ordB) return ordA - ordB
    return (a.etaLabel ?? '').localeCompare(b.etaLabel ?? '', 'es')
  })
}

export function toResultadosToken(options: TripOption[]): unknown[] {
  return options.map((option) => {
    if (option.kind === 'direct') {
      const leg = option.legs[0]!
      return { linea1: leg.lineId, cliente1: String(leg.clientId) }
    }
    const first = option.legs[0]!
    const second = option.legs[1]!
    return {
      linea1: first.lineId,
      cliente1: String(first.clientId),
      linea2: second.lineId,
      cliente2: String(second.clientId),
    }
  })
}

export function buildTripSearchResult(
  options: TripOption[],
  steps: number,
  truncated: boolean,
  complete = true,
  cached = false,
): TripSearchResult {
  return { options, steps, truncated, complete, cached }
}

function tidyPlaceLabel(label: string, source: PlaceSuggestion['source']): string {
  if (source !== 'nominatim') return label
  const clipped = label
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && !/argentina|municipio|pedan[ií]a|departamento capital|c[oó]rdoba$/i.test(part))
    .slice(0, 3)
    .join(', ')
  return clipped || label
}

export function normalizePlaces(payload: unknown, source: PlaceSuggestion['source']): PlaceSuggestion[] {
  if (!Array.isArray(payload)) return []
  return payload.flatMap((item, index) => {
    if (!isRecord(item)) return []
    const label = text(item.display_name) || text(item.nombre) || text(item.name)
    if (!label) return []
    const lat = finiteNumber(item.lat)
    const lon = finiteNumber(item.lon)
    const valid = lat !== null && lon !== null && isPlausibleCoordinate(lat, lon)
    return [{
      id: text(item.id) || `${source}-${index}`,
      label: tidyPlaceLabel(label, source),
      lat: valid ? lat : null,
      lon: valid ? lon : null,
      source,
    }]
  })
}

const CITY_BBOX = { minLon: -64.4, minLat: -31.58, maxLon: -64.02, maxLat: -31.25 }

/** Direcciones de Photon (OpenStreetMap), ya recortadas a Córdoba Capital. */
export function normalizePhoton(payload: unknown): PlaceSuggestion[] {
  if (!isRecord(payload) || !Array.isArray(payload.features)) return []
  const seen = new Set<string>()
  const places: PlaceSuggestion[] = []
  payload.features.forEach((feature, index) => {
    if (!isRecord(feature) || !isRecord(feature.geometry) || !isRecord(feature.properties)) return
    const coordinates = feature.geometry.coordinates
    if (!Array.isArray(coordinates) || coordinates.length < 2) return
    const lon = finiteNumber(coordinates[0])
    const lat = finiteNumber(coordinates[1])
    if (lat === null || lon === null || !isPlausibleCoordinate(lat, lon)) return
    if (lon < CITY_BBOX.minLon || lon > CITY_BBOX.maxLon || lat < CITY_BBOX.minLat || lat > CITY_BBOX.maxLat) return
    const label = photonLabel(feature.properties)
    if (!label) return
    const key = label.toLocaleLowerCase('es')
    if (seen.has(key)) return
    seen.add(key)
    const osmId = text(feature.properties.osm_id)
    places.push({
      id: osmId ? `photon-${osmId}` : `photon-${index}`,
      label,
      lat,
      lon,
      source: 'photon',
    })
  })
  return places
}

function photonLabel(properties: Record<string, unknown>): string {
  const name = text(properties.name)
  const street = text(properties.street)
  const number = text(properties.housenumber)
  const city = text(properties.city) || text(properties.district) || text(properties.locality)
  const streetLine = [street, number].filter(Boolean).join(' ')
  const headline = name || streetLine
  const detail = streetLine && name && !name.includes(number || street) ? streetLine : ''
  const locality = city && !/c[oó]rdoba/i.test(city) ? city : ''
  return [headline, detail && detail !== headline ? detail : '', locality].filter(Boolean).join(', ')
}
