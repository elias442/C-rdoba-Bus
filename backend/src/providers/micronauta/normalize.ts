import type { Catalog, Line, Operator, ServiceNotice, Stop, Trace, Vehicle, VehicleSnapshot } from '../../types.js'
import { ProviderError } from './errors.js'

const FALLBACK_COLOR = '#2F6BFF'
const UNKNOWN_DELAY_MINUTES = 99999

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

export function safeColor(value: unknown, fallback = FALLBACK_COLOR): string {
  const raw = text(value)
  const withHash = raw.startsWith('#') ? raw : raw ? `#${raw}` : ''
  return /^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash : fallback
}

export function directionLabel(direction: string): string {
  if (direction === 'I') return 'Ida'
  if (direction === 'V') return 'Vuelta'
  return direction || 'Recorrido'
}

export function isPlausibleCoordinate(lat: number, lon: number): boolean {
  return lat >= -56 && lat <= -20 && lon >= -74 && lon <= -50
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'))
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

export function decodeHtml(input: string): string {
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, digits: string) => {
      const code = Number(digits)
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
    })
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanText(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  const decoded = decodeHtml(raw)
  return decoded || null
}

function parseLengthKm(value: unknown): number | null {
  const parsed = finiteNumber(value)
  if (parsed === null || parsed <= 0 || parsed > 200) return null
  return parsed
}

/**
 * `curso` se interpreta como radianes porque el cliente original lo compara
 * contra Math.PI y lo tenía cableado (comentado) como rotación de OpenLayers.
 * Si el valor no entra en ±2π, no se usa.
 */
export function parseHeadingRadians(value: unknown): number | null {
  const parsed = finiteNumber(value)
  if (parsed === null) return null
  if (parsed < -Math.PI * 2 || parsed > Math.PI * 2) return null
  return parsed
}

function parseDelayLabel(raw: Record<string, unknown>): string | null {
  const minutes = finiteNumber(raw.demora_minutos)
  if (minutes === UNKNOWN_DELAY_MINUTES) return null
  return cleanText(raw.demora)
}

/** `tiempo` del tipo +00:01:49, en segundos. Negativo si ya pasó. */
export function parseArrivalSeconds(value: unknown): number | null {
  const raw = text(value)
  if (!raw) return null
  const match = raw.match(/^([+-])?(\d{1,2}):(\d{2}):(\d{2})$/)
  if (!match) return null
  const sign = match[1] === '-' ? -1 : 1
  const total = sign * (Number(match[2]) * 3600 + Number(match[3]) * 60 + Number(match[4]))
  return Number.isFinite(total) ? total : null
}

/** Formatea `tiempo` del tipo +00:01:49 como texto legible. */
export function formatArrivalLabel(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  const match = raw.match(/^([+-])?(\d{1,2}):(\d{2}):(\d{2})$/)
  if (!match) return cleanText(value)
  const sign = match[1] === '-' ? '−' : ''
  const hours = Number(match[2])
  const minutes = Number(match[3])
  const seconds = Number(match[4])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return cleanText(value)
  if (hours === 0 && minutes === 0 && seconds === 0) return 'ahora'
  if (hours === 0 && minutes === 0) return `${sign}${seconds} s`
  if (hours === 0) return seconds > 0 ? `${sign}${minutes} min ${seconds} s` : `${sign}${minutes} min`
  return seconds > 0 || minutes > 0
    ? `${sign}${hours} h ${minutes} min`
    : `${sign}${hours} h`
}

/**
 * En Tu Bondi el ícono de rampa se pide con el valor crudo.
 * rampa=0 produce un ícono más chico; valores distintos de 0 agregan la rampa.
 */
export function parseHasRamp(value: unknown): boolean | null {
  if (value === null || value === undefined || value === '') return null
  const numeric = finiteNumber(value)
  if (numeric !== null) return numeric !== 0
  const raw = text(value)
  if (!raw) return null
  return raw !== '0'
}

export function normalizeCatalog(payload: unknown): Catalog {
  if (!isRecord(payload) || !Array.isArray(payload.lineas)) {
    throw new ProviderError('provider_unavailable', 'El catálogo de líneas no tiene el formato esperado.')
  }

  const operators = new Map<number, Operator>()
  if (Array.isArray(payload.clientes)) {
    for (const item of payload.clientes) {
      if (!isRecord(item)) continue
      const id = finiteNumber(item.id)
      const name = text(item.nombre)
      if (id === null || !name) continue
      operators.set(id, { id, name, color: safeColor(item.color) })
    }
  }

  const groups = new Map<string, string>()
  if (Array.isArray(payload.grupos)) {
    for (const item of payload.grupos) {
      if (!isRecord(item)) continue
      const clientId = text(item.cliente_id)
      const groupId = text(item.grupo_id)
      const name = text(item.nombre)
      if (clientId && groupId && name) groups.set(`${clientId}:${groupId}`, name)
    }
  }

  const lines: Line[] = []
  const seen = new Set<string>()

  payload.lineas.forEach((item, index) => {
    if (!isRecord(item)) return
    const id = text(item.linea_id)
    const name = text(item.linea_nombre)
    const clientId = finiteNumber(item.cliente)
    if (!id || !name || clientId === null) return

    const operator = operators.get(clientId)
    const groupId = text(item.grupo)
    let key = `${clientId}:${id}`
    if (seen.has(key)) key = `${key}:${index}`
    seen.add(key)

    const routes = Array.isArray(item.rutas)
      ? item.rutas.flatMap((route) => {
          if (!isRecord(route)) return []
          const routeId = text(route.ruta_id)
          const routeName = text(route.ruta_nombre)
          if (!routeId || !routeName) return []
          const direction = text(route.sentido)
          return [{
            id: routeId,
            direction,
            directionLabel: directionLabel(direction),
            name: routeName,
            lengthKm: parseLengthKm(route.longitud),
          }]
        })
      : []

    lines.push({
      key,
      id,
      name,
      color: safeColor(item.color, operator?.color),
      clientId,
      operatorName: operator?.name ?? `Cliente ${clientId}`,
      groupId,
      groupName: groups.get(`${clientId}:${groupId}`) ?? null,
      order: finiteNumber(item.orden) ?? index,
      routes,
    })
  })

  lines.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'es'))

  return {
    operators: [...operators.values()],
    lines,
  }
}

function parseCoordinatePair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const lon = finiteNumber(value[0])
  const lat = finiteNumber(value[1])
  if (lon === null || lat === null || !isPlausibleCoordinate(lat, lon)) return null
  return [lon, lat]
}

function parseNotices(payload: Record<string, unknown>): ServiceNotice[] {
  if (!Array.isArray(payload.notificaciones)) return []
  return payload.notificaciones.flatMap((item) => {
    if (!isRecord(item)) return []
    const title = cleanText(item.titulo) ?? 'Aviso del servicio'
    const body = cleanText(item.texto) ?? ''
    const deviation = Array.isArray(item.desvio)
      ? item.desvio.flatMap((point) => {
          const pair = parseCoordinatePair(point)
          return pair ? [pair] : []
        })
      : []
    if (!body && deviation.length < 2) return []
    return [{ title, text: body, deviation }]
  })
}

export function normalizeTrace(payload: unknown, clientId: number, routeId: string): Trace {
  if (!isRecord(payload) || !Array.isArray(payload.traza)) {
    throw new ProviderError('provider_unavailable', 'La traza del recorrido no tiene el formato esperado.')
  }

  const coordinates = payload.traza.flatMap((point) => {
    const pair = parseCoordinatePair(point)
    return pair ? [pair] : []
  })

  const direction = text(payload.sentido)
  const color = safeColor(payload.color)
  const stops: Stop[] = []

  if (Array.isArray(payload.paradas)) {
    payload.paradas.forEach((item, index) => {
      if (!isRecord(item)) return
      const lat = finiteNumber(item.lat)
      const lon = finiteNumber(item.lon)
      if (lat === null || lon === null || !isPlausibleCoordinate(lat, lon)) return
      const name = text(item.parada_nombre) || text(item.nombre) || 'Parada'
      const shortLabel = text(item.nombre)
      const stopDirection = text(item.sentido) || direction
      stops.push({
        code: text(item.codigo) || `${routeId}-${index + 1}`,
        name,
        shortLabel: shortLabel && shortLabel !== name ? shortLabel : null,
        order: index + 1,
        lat,
        lon,
        direction: stopDirection,
        directionLabel: directionLabel(stopDirection),
      })
    })
  }

  return {
    clientId,
    routeId,
    color,
    direction,
    directionLabel: directionLabel(direction),
    coordinates,
    stops,
    notices: parseNotices(payload),
  }
}

function parseVehicle(raw: unknown, clientId: number): Vehicle | null {
  if (!isRecord(raw)) return null
  const vehicleNumber = text(raw.coche)
  const lat = finiteNumber(raw.lat)
  const lon = finiteNumber(raw.lon)
  if (!vehicleNumber || lat === null || lon === null || !isPlausibleCoordinate(lat, lon)) return null

  const reportedClient = finiteNumber(raw.cliente) ?? clientId
  const direction = text(raw.sentido)
  const serie = text(raw.serie) || null
  return {
    id: `${reportedClient}:${serie || vehicleNumber}`,
    vehicleNumber,
    serie,
    lineName: text(raw.linea) || '—',
    direction,
    directionLabel: directionLabel(direction),
    lat,
    lon,
    headingRadians: parseHeadingRadians(raw.curso),
    color: safeColor(raw.color),
    clientId: reportedClient,
    arrivalLabel: formatArrivalLabel(raw.tiempo),
    arrivalSeconds: parseArrivalSeconds(raw.tiempo),
    delayLabel: parseDelayLabel(raw),
    hasRamp: parseHasRamp(raw.rampa),
    note: cleanText(raw.comentario),
  }
}

export function normalizeVehicles(payload: unknown, clientId: number, routeId: string): VehicleSnapshot {
  if (!isRecord(payload)) {
    throw new ProviderError('provider_unavailable', 'La respuesta GPS no tiene el formato esperado.')
  }

  const errorText = cleanText(payload.error)
  if (!Array.isArray(payload.coches)) {
    if (errorText) throw new ProviderError('provider_unavailable', errorText)
    return {
      clientId,
      routeId,
      availability: 'empty',
      notice: cleanText(payload.notificacion),
      vehicles: [],
    }
  }

  const vehicles = payload.coches.flatMap((item) => {
    const vehicle = parseVehicle(item, clientId)
    return vehicle ? [vehicle] : []
  })

  let availability: VehicleSnapshot['availability'] = 'empty'
  if (vehicles.length > 0) availability = 'live'
  else if (payload.coches.length > 0) availability = 'unusable'

  return {
    clientId,
    routeId,
    availability,
    notice: errorText ?? cleanText(payload.notificacion),
    vehicles,
  }
}
