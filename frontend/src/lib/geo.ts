export function pathLengthMeters(coordinates: Array<[number, number]>): number {
  let total = 0
  for (let index = 1; index < coordinates.length; index += 1) {
    const [fromLon, fromLat] = coordinates[index - 1]!
    const [toLon, toLat] = coordinates[index]!
    total += haversineMeters(fromLon, fromLat, toLon, toLat)
  }
  return total
}

export function haversineMeters(fromLng: number, fromLat: number, toLng: number, toLat: number): number {
  const earth = 6371000
  const toRad = (value: number) => (value * Math.PI) / 180
  const dLat = toRad(toLat - fromLat)
  const dLng = toRad(toLng - fromLng)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.sin(dLng / 2) ** 2
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function boundsFrom(coordinates: Array<[number, number]>): [[number, number], [number, number]] {
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  for (const [lon, lat] of coordinates) {
    minLon = Math.min(minLon, lon)
    minLat = Math.min(minLat, lat)
    maxLon = Math.max(maxLon, lon)
    maxLat = Math.max(maxLat, lat)
  }
  return [[minLon, minLat], [maxLon, maxLat]]
}

const SNAP_LAT_M = 110540

/**
 * Punto del recorrido más cercano a un GPS. El colectivo queda sobre la línea
 * en cualquier zoom; si está demasiado lejos, se deja el GPS crudo.
 */
export function snapToTrace(
  coordinates: Array<[number, number]>,
  lon: number,
  lat: number,
  maxMeters: number,
): { lon: number; lat: number } | null {
  if (coordinates.length < 2) return null
  const metersX = Math.cos((lat * Math.PI) / 180) * SNAP_LAT_M
  const px = lon * metersX
  const py = lat * SNAP_LAT_M
  let best = Infinity
  let bestLon = lon
  let bestLat = lat
  for (let index = 1; index < coordinates.length; index += 1) {
    const start = coordinates[index - 1]
    const end = coordinates[index]
    if (!start || !end) continue
    const ax = start[0] * metersX
    const ay = start[1] * SNAP_LAT_M
    const bx = end[0] * metersX
    const by = end[1] * SNAP_LAT_M
    const dx = bx - ax
    const dy = by - ay
    const length = dx * dx + dy * dy
    if (length === 0) continue
    const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / length))
    const distance = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
    if (distance >= best) continue
    best = distance
    bestLon = start[0] + t * (end[0] - start[0])
    bestLat = start[1] + t * (end[1] - start[1])
  }
  return best <= maxMeters ? { lon: bestLon, lat: bestLat } : null
}

export interface TraceProjection {
  /** Metros desde el inicio de la traza hasta el punto proyectado. */
  along: number
  /** Distancia al recorrido, en metros. */
  offset: number
  lon: number
  lat: number
}

/** Proyecta un GPS sobre la traza y mide cuánto falta recorrer desde el origen. */
export function projectOnTrace(
  coordinates: Array<[number, number]>,
  lon: number,
  lat: number,
): TraceProjection | null {
  if (coordinates.length < 2) return null
  const metersX = Math.cos((lat * Math.PI) / 180) * SNAP_LAT_M
  const px = lon * metersX
  const py = lat * SNAP_LAT_M
  let best = Infinity
  let bestAlong = 0
  let bestLon = lon
  let bestLat = lat
  let traveled = 0
  for (let index = 1; index < coordinates.length; index += 1) {
    const start = coordinates[index - 1]
    const end = coordinates[index]
    if (!start || !end) continue
    const segment = haversineMeters(start[0], start[1], end[0], end[1])
    const ax = start[0] * metersX
    const ay = start[1] * SNAP_LAT_M
    const bx = end[0] * metersX
    const by = end[1] * SNAP_LAT_M
    const dx = bx - ax
    const dy = by - ay
    const length = dx * dx + dy * dy
    const t = length === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / length))
    const distance = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
    if (distance < best) {
      best = distance
      bestAlong = traveled + segment * t
      bestLon = start[0] + t * (end[0] - start[0])
      bestLat = start[1] + t * (end[1] - start[1])
    }
    traveled += segment
  }
  return { along: bestAlong, offset: best, lon: bestLon, lat: bestLat }
}

/** Índice del punto de la traza más cercano a un lat/lon. */
export function nearestCoordIndex(
  coordinates: Array<[number, number]>,
  lon: number,
  lat: number,
): number {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < coordinates.length; i += 1) {
    const [x, y] = coordinates[i]!
    const d = haversineMeters(x, y, lon, lat)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

/**
 * Recorta la traza al tramo entre dos paradas (por código) o coordenadas.
 * Sirve para no dibujar el recorrido completo de una línea al mostrar un viaje.
 */
export function sliceTraceSegment(
  coordinates: Array<[number, number]>,
  from: { lon: number; lat: number } | null,
  to: { lon: number; lat: number } | null,
): Array<[number, number]> {
  if (coordinates.length < 2) return coordinates
  if (!from && !to) return coordinates
  const start = from ? nearestCoordIndex(coordinates, from.lon, from.lat) : 0
  const end = to ? nearestCoordIndex(coordinates, to.lon, to.lat) : coordinates.length - 1
  const a = Math.min(start, end)
  const b = Math.max(start, end)
  if (b - a < 1) return coordinates.slice(Math.max(0, a - 1), Math.min(coordinates.length, b + 2))
  return coordinates.slice(a, b + 1)
}

export const CORDOBA_CENTER: [number, number] = [-64.1888, -31.4201]
