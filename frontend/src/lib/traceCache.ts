import type { TraceResponse } from '../types'
import { noteTraceStops } from './stopIndex'

const traces = new Map<string, TraceResponse>()
const pending = new Map<string, Promise<TraceResponse>>()

function key(clientId: number, routeId: string): string {
  return `${clientId}:${routeId}`
}

export function peekTrace(clientId: number, routeId: string): TraceResponse | null {
  const trace = traces.get(key(clientId, routeId))
  return trace && trace.coordinates.length >= 2 ? trace : null
}

export function rememberTrace(trace: TraceResponse): TraceResponse {
  if (trace.coordinates.length >= 2) {
    traces.set(key(trace.clientId, trace.routeId), trace)
    noteTraceStops(trace.clientId, trace.routeId, trace.stops.map((stop) => stop.code))
  }
  return trace
}

/** Una sola descarga por recorrido, aunque el mapa y el anticipo la pidan juntos. */
export function loadTrace(
  clientId: number,
  routeId: string,
  fetcher: () => Promise<TraceResponse>,
): Promise<TraceResponse> {
  const cached = peekTrace(clientId, routeId)
  if (cached) return Promise.resolve(cached)
  const id = key(clientId, routeId)
  const existing = pending.get(id)
  if (existing) return existing
  const promise = fetcher().then((trace) => {
    pending.delete(id)
    return rememberTrace(trace)
  }, (error: unknown) => {
    pending.delete(id)
    throw error
  })
  pending.set(id, promise)
  return promise
}
