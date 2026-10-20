const STORAGE_KEY = 'cordobabus.address.v1'
const memory = new Map<string, string>()
const failed = new Set<string>()
let stored: Record<string, string> | null = null

export function coordKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`
}

export function peekAddress(lat: number, lon: number): string | null | undefined {
  const key = coordKey(lat, lon)
  if (memory.has(key)) return memory.get(key) ?? null
  const saved = readStore()[key]
  if (saved) {
    memory.set(key, saved)
    return saved
  }
  if (failed.has(key)) return null
  return undefined
}

/** Dirección aproximada. `null` si el geocodificador no responde. */
export async function reverseAddress(lat: number, lon: number, signal: AbortSignal): Promise<string | null> {
  const key = coordKey(lat, lon)
  const known = peekAddress(lat, lon)
  if (known !== undefined) return known

  const timeout = new AbortController()
  const timer = window.setTimeout(() => timeout.abort(), 3500)
  const onAbort = () => timeout.abort()
  signal.addEventListener('abort', onAbort)
  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse')
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('lat', String(lat))
    url.searchParams.set('lon', String(lon))
    url.searchParams.set('zoom', '18')
    url.searchParams.set('addressdetails', '1')
    url.searchParams.set('accept-language', 'es')
    const response = await fetch(url, {
      signal: timeout.signal,
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) {
      failed.add(key)
      return null
    }
    const label = formatAddress(await response.json())
    if (!label) {
      failed.add(key)
      return null
    }
    memory.set(key, label)
    remember(key, label)
    return label
  } catch {
    if (!signal.aborted) failed.add(key)
    return null
  } finally {
    window.clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

function formatAddress(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const address = (payload as { address?: unknown }).address
  if (!address || typeof address !== 'object') {
    return clipDisplay((payload as { display_name?: unknown }).display_name)
  }
  const record = address as Record<string, unknown>
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : '')
  const road = text(record.road) || text(record.pedestrian) || text(record.footway) || text(record.residential)
  const number = text(record.house_number)
  const street = [road, number].filter(Boolean).join(' ')
  const area = text(record.suburb) || text(record.neighbourhood) || text(record.quarter) || text(record.city_district)
  const city = text(record.city) || text(record.town) || text(record.village)
  const parts = [street, area, city].filter(Boolean)
  if (parts.length > 0) return parts.join(', ')
  return clipDisplay((payload as { display_name?: unknown }).display_name)
}

function clipDisplay(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parts = value.split(',').map((part) => part.trim()).filter(Boolean)
  return parts.slice(0, 3).join(', ') || null
}

function readStore(): Record<string, string> {
  if (stored) return stored
  stored = {}
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return stored
    const parsed = JSON.parse(raw) as Record<string, unknown>
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.trim()) stored[key] = value
    }
  } catch {
    stored = {}
  }
  return stored
}

function remember(key: string, label: string) {
  const saved = readStore()
  saved[key] = label
  const keys = Object.keys(saved)
  if (keys.length > 200) {
    const oldest = keys[0]
    if (oldest) delete saved[oldest]
  }
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
  } catch {
    // La dirección queda en memoria.
  }
}
