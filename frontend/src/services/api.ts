import type {
  CatalogResponse,
  PlaceSuggestion,
  TraceResponse,
  TripSearchResponse,
  VehiclesResponse,
} from '../types'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly retryAfterMs: number | null

  constructor(status: number, code: string, message: string, retryAfterMs: number | null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.retryAfterMs = retryAfterMs
  }
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      signal,
      headers: { Accept: 'application/json' },
    })
  } catch (error) {
    if (isAbort(error)) throw error
    throw new ApiError(0, 'network', 'No hay conexión con el servidor de Córdoba Bus.', null)
  }
  if (!response.ok) throw await readError(response)
  return response.json() as Promise<T>
}

async function readError(response: Response): Promise<ApiError> {
  try {
    const body = await response.json() as { error?: string; message?: string; retryAfterMs?: number | null }
    return new ApiError(
      response.status,
      body.error ?? 'request_failed',
      body.message ?? 'No se pudo completar la consulta.',
      body.retryAfterMs ?? null,
    )
  } catch {
    return new ApiError(response.status, 'request_failed', 'No se pudo completar la consulta.', null)
  }
}

export function fetchCatalog(signal?: AbortSignal): Promise<CatalogResponse> {
  return getJson('/lines', signal)
}

export async function fetchPlaces(query: string, signal?: AbortSignal): Promise<PlaceSuggestion[]> {
  const response = await getJson<{ places: PlaceSuggestion[] }>(`/places?q=${encodeURIComponent(query)}`, signal)
  return response.places
}

export async function searchTrip(input: {
  from: { lat: number; lon: number; label?: string }
  to: { lat: number; lon: number; label?: string }
  maxWalkMeters: number | null
  includeDirect: boolean
  includeTransfer: boolean
  preferComplete?: boolean
}, signal?: AbortSignal): Promise<TripSearchResponse> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}/trip/search`, {
      method: 'POST',
      signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    })
  } catch (error) {
    if (isAbort(error)) throw error
    throw new ApiError(0, 'network', 'No hay conexión con el servidor de Córdoba Bus.', null)
  }
  if (!response.ok) throw await readError(response)
  return response.json() as Promise<TripSearchResponse>
}

export function fetchTrace(clientId: number, routeId: string, signal?: AbortSignal): Promise<TraceResponse> {
  return getJson(`/routes/${clientId}/${routeId}/trace`, signal)
}

export function fetchVehicles(
  clientId: number,
  routeId: string,
  stopCode?: string | null,
  signal?: AbortSignal,
): Promise<VehiclesResponse> {
  const params = new URLSearchParams({ client: String(clientId), route: routeId })
  if (stopCode) params.set('stop', stopCode)
  return getJson(`/vehicles?${params}`, signal)
}
