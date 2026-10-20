const STORAGE_KEY = 'cordobabus.headways.v1'
const MAX_SAMPLES = 24
const MIN_GAP_SECONDS = 3 * 60
const MAX_GAP_SECONDS = 90 * 60

interface FrequencyRecord {
  samples: number[]
  lastSeenAt: number | null
  lastSoonest: number | null
  lastSoonestId: string | null
}

const records = new Map<string, FrequencyRecord>()
let loaded = false

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function load() {
  if (loaded) return
  loaded = true
  const raw = storage()?.getItem(STORAGE_KEY)
  if (!raw) return
  try {
    const parsed = JSON.parse(raw) as Record<string, FrequencyRecord>
    for (const [key, record] of Object.entries(parsed)) {
      if (!record || !Array.isArray(record.samples)) continue
      records.set(key, {
        samples: record.samples.filter((sample) => typeof sample === 'number' && sample >= MIN_GAP_SECONDS && sample <= MAX_GAP_SECONDS).slice(-MAX_SAMPLES),
        lastSeenAt: typeof record.lastSeenAt === 'number' ? record.lastSeenAt : null,
        lastSoonest: typeof record.lastSoonest === 'number' ? record.lastSoonest : null,
        lastSoonestId: typeof record.lastSoonestId === 'string' ? record.lastSoonestId : null,
      })
    }
  } catch {
    records.clear()
  }
}

function save() {
  const payload: Record<string, FrequencyRecord> = {}
  for (const [key, record] of records) payload[key] = record
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // El registro vive igual en memoria durante esta visita.
  }
}

function pushSample(record: FrequencyRecord, seconds: number) {
  const previous = record.samples[record.samples.length - 1]
  if (previous !== undefined && Math.abs(previous - seconds) < 20) return
  record.samples.push(Math.round(seconds))
  if (record.samples.length > MAX_SAMPLES) record.samples.shift()
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const left = sorted[mid - 1]
  const right = sorted[mid]
  if (sorted.length % 2 === 0 && left !== undefined && right !== undefined) return (left + right) / 2
  return right ?? null
}

/**
 * Anota la separación entre colectivos que informan llegada a la misma parada.
 * Esa separación es la frecuencia observada del recorrido.
 */
export function observeFrequency(
  clientId: number,
  routeId: string,
  arrivals: Array<{ id: string; seconds: number }>,
  now = Date.now(),
) {
  if (!routeId) return
  load()
  const key = `${clientId}:${routeId}`
  const record = records.get(key) ?? { samples: [], lastSeenAt: null, lastSoonest: null, lastSoonestId: null }
  const sorted = arrivals
    .filter((item) => item.seconds >= 0 && item.seconds <= MAX_GAP_SECONDS)
    .sort((a, b) => a.seconds - b.seconds)
  if (sorted.length >= 2) {
    const limit = Math.min(sorted.length, 4)
    for (let index = 1; index < limit; index += 1) {
      const gap = sorted[index]!.seconds - sorted[index - 1]!.seconds
      if (gap >= MIN_GAP_SECONDS && gap <= MAX_GAP_SECONDS) pushSample(record, gap)
    }
  }
  const soonest = sorted[0]
  if (
    soonest
    && record.lastSoonestId
    && record.lastSoonestId !== soonest.id
    && record.lastSoonest !== null
    && record.lastSoonest < 120
    && soonest.seconds >= MIN_GAP_SECONDS
  ) {
    pushSample(record, soonest.seconds)
  }
  if (soonest) {
    record.lastSeenAt = now
    record.lastSoonest = soonest.seconds
    record.lastSoonestId = soonest.id
  }
  records.set(key, record)
  save()
}

/** Segundos hasta que debería aparecer otra unidad, según las frecuencias ya vistas. */
export function estimateWaitSeconds(clientId: number | null, routeId: string | null, now = Date.now()): number | null {
  if (clientId === null || !routeId) return null
  load()
  const record = records.get(`${clientId}:${routeId}`)
  if (!record) return null
  const typical = median(record.samples)
  if (typical === null) return null
  if (record.lastSeenAt === null || record.lastSoonest === null) return Math.round(typical)
  const dueAt = record.lastSeenAt + record.lastSoonest * 1000
  if (now < dueAt) return Math.max(0, Math.round((dueAt - now) / 1000))
  const elapsed = now - dueAt
  const cycle = typical * 1000
  const intoCycle = elapsed % cycle
  return Math.max(0, Math.round((cycle - intoCycle) / 1000))
}
