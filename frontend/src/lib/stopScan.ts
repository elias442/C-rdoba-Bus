import type { Line } from '../types'
import { ApiError, fetchTrace, isAbort } from '../services/api'
import { loadTrace } from './traceCache'
import { hasStopListeners, indexCovers, noteTraceStops, notifyStopIndex, unseenRoutes } from './stopIndex'

const CONCURRENCY = 2

let controller: AbortController | null = null
let generation = 0
let scanning = false
let note: string | null = null
let retryTimer = 0

export function stopScanStatus(lines: Line[]): { complete: boolean; scanning: boolean; note: string | null } {
  const complete = indexCovers(lines)
  return {
    complete,
    scanning: scanning && !complete,
    note: complete ? null : note,
  }
}

/** Completa el índice de paradas una sola vez. Si cambia la parada, se corta y se retoma lo que falte. */
export function ensureStopIndex(lines: Line[]): void {
  if (lines.length === 0 || indexCovers(lines)) return
  if (controller && !controller.signal.aborted) return
  controller = new AbortController()
  const signal = controller.signal
  const token = ++generation
  scanning = true
  note = null
  notifyStopIndex()
  void scan(lines, signal).finally(() => {
    if (token !== generation) return
    scanning = false
    controller = null
    notifyStopIndex()
  })
}

export function pauseStopIndex(): void {
  controller?.abort()
  controller = null
}

async function scan(lines: Line[], signal: AbortSignal): Promise<void> {
  const queue = unseenRoutes(lines)
  const skipped: Array<{ clientId: number; routeId: string }> = []
  let blocked = false

  const worker = async () => {
    while (!signal.aborted && !blocked) {
      const next = queue.shift()
      if (!next) return
      try {
        await indexRoute(next)
        if (signal.aborted) return
        await gap(60)
      } catch (error) {
        if (signal.aborted || isAbort(error)) return
        if (isBlocked(error)) {
          blocked = true
          note = 'No se pudieron revisar todas las líneas.'
          queue.length = 0
          const retryAfter = error instanceof ApiError ? error.retryAfterMs : null
          armRetry(lines, Math.max(8_000, retryAfter ?? 12_000))
          return
        }
        skipped.push(next)
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  if (signal.aborted || blocked || skipped.length === 0) return

  let stillFailed = 0
  for (const next of skipped) {
    if (signal.aborted) return
    try {
      await indexRoute(next)
      await gap(60)
    } catch (error) {
      if (signal.aborted || isAbort(error)) return
      if (isBlocked(error)) {
        note = 'No se pudieron revisar todas las líneas.'
        const retryAfter = error instanceof ApiError ? error.retryAfterMs : null
        armRetry(lines, Math.max(8_000, retryAfter ?? 12_000))
        return
      }
      stillFailed += 1
    }
  }
  if (stillFailed > 0) note = 'No se pudieron revisar todas las líneas.'
}

async function indexRoute(next: { clientId: number; routeId: string }) {
  const trace = await loadTrace(next.clientId, next.routeId, () => fetchTrace(next.clientId, next.routeId))
  noteTraceStops(next.clientId, next.routeId, trace.stops.map((stop) => stop.code))
}

function armRetry(lines: Line[], delay: number) {
  if (retryTimer) window.clearTimeout(retryTimer)
  retryTimer = window.setTimeout(() => {
    retryTimer = 0
    if (!hasStopListeners()) return
    ensureStopIndex(lines)
  }, delay)
}

function isBlocked(error: unknown): boolean {
  return error instanceof ApiError && (
    error.status === 503
    || error.code === 'provider_blocked'
    || error.code === 'provider_rate_limited'
  )
}

function gap(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
