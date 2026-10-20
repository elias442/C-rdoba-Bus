import type { Line } from '../types'

const STORAGE_KEY = 'cordobabus.stopIndex.v1'
const MAX_AGE_MS = 12 * 60 * 60 * 1000

interface StoredIndex {
  v: 1
  at: number
  seen: string[]
  stops: Record<string, string[]>
}

export interface IndexedService {
  routeKey: string
  lineKey: string
  lineName: string
  color: string
  clientId: number
  routeId: string
  directionLabel: string
  routeName: string
}

const routesSeen = new Set<string>()
const byCode = new Map<string, Set<string>>()
const listeners = new Set<() => void>()
let loaded = false
let emitTimer = 0
let saveTimer = 0

export function routeKey(clientId: number, routeId: string): string {
  return `${clientId}:${routeId}`
}

export function subscribeStopIndex(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function hasStopListeners(): boolean {
  return listeners.size > 0
}

export function notifyStopIndex(): void {
  if (emitTimer) return
  emitTimer = window.setTimeout(() => {
    emitTimer = 0
    for (const listener of listeners) listener()
  }, 160)
}

/** Anota los códigos de parada de un recorrido ya descargado. El código es la coincidencia. */
export function noteTraceStops(clientId: number, routeId: string, codes: string[]): void {
  load()
  const key = routeKey(clientId, routeId)
  if (routesSeen.has(key)) return
  routesSeen.add(key)
  for (const code of codes) {
    if (!code) continue
    const bucket = byCode.get(code) ?? new Set<string>()
    bucket.add(key)
    byCode.set(code, bucket)
  }
  scheduleSave()
  notifyStopIndex()
}

export function indexCovers(lines: Line[]): boolean {
  load()
  const keys = catalogRouteKeys(lines)
  if (keys.length === 0) return false
  return keys.every((key) => routesSeen.has(key))
}

export function unseenRoutes(lines: Line[]): Array<{ clientId: number; routeId: string }> {
  load()
  const pending: Array<{ clientId: number; routeId: string }> = []
  for (const line of lines) {
    for (const route of line.routes) {
      if (routesSeen.has(routeKey(line.clientId, route.id))) continue
      pending.push({ clientId: line.clientId, routeId: route.id })
    }
  }
  return pending
}

/** Líneas cuyo recorrido incluye este código, más las rutas ya confirmadas de la línea abierta. */
export function servicesAtStop(lines: Line[], code: string, extraRouteKeys: string[]): IndexedService[] {
  load()
  const wanted = new Set(extraRouteKeys)
  if (code) {
    for (const key of byCode.get(code) ?? []) wanted.add(key)
  }
  const services: IndexedService[] = []
  const emitted = new Set<string>()
  for (const line of lines) {
    for (const route of line.routes) {
      const key = routeKey(line.clientId, route.id)
      if (!wanted.has(key) || emitted.has(key)) continue
      emitted.add(key)
      services.push({
        routeKey: key,
        lineKey: line.key,
        lineName: line.name,
        color: line.color,
        clientId: line.clientId,
        routeId: route.id,
        directionLabel: route.directionLabel,
        routeName: route.name,
      })
    }
  }
  return services
}

function catalogRouteKeys(lines: Line[]): string[] {
  return lines.flatMap((line) => line.routes.map((route) => routeKey(line.clientId, route.id)))
}

function scheduleSave() {
  if (saveTimer) return
  saveTimer = window.setTimeout(() => {
    saveTimer = 0
    const stops: Record<string, string[]> = {}
    for (const [code, keys] of byCode) stops[code] = [...keys]
    const payload: StoredIndex = { v: 1, at: Date.now(), seen: [...routesSeen], stops }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // El índice sigue en memoria para esta visita.
    }
  }, 700)
}

function load() {
  if (loaded) return
  loaded = true
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(STORAGE_KEY)
  } catch {
    raw = null
  }
  if (!raw) return
  try {
    const parsed = JSON.parse(raw) as StoredIndex
    if (parsed.v !== 1 || typeof parsed.at !== 'number' || Date.now() - parsed.at > MAX_AGE_MS) return
    if (!Array.isArray(parsed.seen) || !parsed.stops || typeof parsed.stops !== 'object') return
    for (const key of parsed.seen) {
      if (typeof key === 'string' && key.includes(':')) routesSeen.add(key)
    }
    for (const [code, keys] of Object.entries(parsed.stops)) {
      if (!code || !Array.isArray(keys)) continue
      const bucket = new Set<string>()
      for (const key of keys) {
        if (typeof key === 'string' && routesSeen.has(key)) bucket.add(key)
      }
      if (bucket.size > 0) byCode.set(code, bucket)
    }
  } catch {
    routesSeen.clear()
    byCode.clear()
  }
}
