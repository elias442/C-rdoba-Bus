import type { FastifyPluginAsync } from 'fastify'
import { ProviderError } from '../providers/micronauta/errors.js'
import type { TransitService } from '../services/transitService.js'
import type { TripService } from '../services/tripService.js'
import type { MicronautaClient } from '../providers/micronauta/client.js'
import type { MemoryCache } from '../cache/memoryCache.js'
import { isPlausibleCoordinate } from '../providers/micronauta/normalize.js'

interface ApiDeps {
  transit: TransitService
  trip: TripService
  client: MicronautaClient
  cache: MemoryCache
}

function isId(value: string): boolean {
  return /^[0-9]{1,12}$/.test(value)
}

function isStopCode(value: string): boolean {
  return value === '' || /^[A-Za-z0-9_-]{1,32}$/.test(value)
}

function envelope<T extends object>(fetchedAt: string, cached: boolean, data: T) {
  return {
    source: 'micronauta' as const,
    fetchedAt,
    cached,
    ...data,
  }
}

export function apiRoutes(deps: ApiDeps): FastifyPluginAsync {
  return async (app) => {
    app.get('/health', async () => ({
      ok: true,
      service: 'cordoba-bus',
      time: new Date().toISOString(),
      provider: deps.client.status(),
      cache: { entries: deps.cache.size() },
    }))

    app.get('/lines', async (_request, reply) => {
      try {
        const result = await deps.transit.catalog()
        return envelope(result.fetchedAt, result.cached, result.data)
      } catch (error) {
        return sendFailure(reply, error)
      }
    })

    app.get<{ Querystring: { q?: string } }>('/places', async (request, reply) => {
      const query = (request.query.q ?? '').trim()
      if (query.length < 3) {
        return { source: 'micronauta' as const, fetchedAt: new Date().toISOString(), cached: false, places: [] }
      }
      try {
        const result = await deps.trip.places(query)
        return {
          source: 'micronauta' as const,
          fetchedAt: new Date().toISOString(),
          cached: result.cached,
          places: result.places,
        }
      } catch (error) {
        return sendFailure(reply, error)
      }
    })

    app.post<{
      Body: {
        from?: { lat?: number; lon?: number; label?: string }
        to?: { lat?: number; lon?: number; label?: string }
        maxWalkMeters?: number | null
        includeDirect?: boolean
        includeTransfer?: boolean
        preferComplete?: boolean
      }
    }>('/trip/search', async (request, reply) => {
      const fromLat = Number(request.body?.from?.lat)
      const fromLon = Number(request.body?.from?.lon)
      const toLat = Number(request.body?.to?.lat)
      const toLon = Number(request.body?.to?.lon)
      if (!isPlausibleCoordinate(fromLat, fromLon) || !isPlausibleCoordinate(toLat, toLon)) {
        return reply.code(400).send({ error: 'bad_request', message: 'Indicá origen y destino válidos en Córdoba.' })
      }
      const maxWalkRaw = request.body?.maxWalkMeters
      const maxWalkMeters = maxWalkRaw === null || maxWalkRaw === undefined
        ? null
        : Number(maxWalkRaw)
      if (maxWalkMeters !== null && (!Number.isFinite(maxWalkMeters) || maxWalkMeters < 50 || maxWalkMeters > 3000)) {
        return reply.code(400).send({ error: 'bad_request', message: 'Los metros a pie deben estar entre 50 y 3000.' })
      }
      const includeDirect = request.body?.includeDirect !== false
      const includeTransfer = request.body?.includeTransfer !== false
      if (!includeDirect && !includeTransfer) {
        return reply.code(400).send({ error: 'bad_request', message: 'Elegí al menos directos o combinaciones.' })
      }
      try {
        const result = await deps.trip.search({
          fromLat,
          fromLon,
          toLat,
          toLon,
          maxWalkMeters,
          includeDirect,
          includeTransfer,
          preferComplete: request.body?.preferComplete === true,
        })
        return {
          source: 'micronauta' as const,
          fetchedAt: new Date().toISOString(),
          cached: result.cached,
          complete: result.complete,
          from: { lat: fromLat, lon: fromLon, label: request.body?.from?.label ?? null },
          to: { lat: toLat, lon: toLon, label: request.body?.to?.label ?? null },
          maxWalkMeters,
          includeDirect,
          includeTransfer,
          options: result.options,
          steps: result.steps,
          truncated: result.truncated,
        }
      } catch (error) {
        return sendFailure(reply, error)
      }
    })

    app.get<{ Params: { clientId: string; routeId: string } }>(
      '/routes/:clientId/:routeId/trace',
      async (request, reply) => {
        const { clientId, routeId } = request.params
        if (!isId(clientId) || !isId(routeId)) {
          return reply.code(400).send({ error: 'bad_request', message: 'Cliente o recorrido inválido.' })
        }
        try {
          const result = await deps.transit.trace(Number(clientId), routeId)
          return envelope(result.fetchedAt, result.cached, result.data)
        } catch (error) {
          return sendFailure(reply, error)
        }
      },
    )

    app.get<{ Querystring: { client?: string; route?: string; stop?: string } }>('/vehicles', async (request, reply) => {
      const clientId = request.query.client ?? ''
      const routeId = request.query.route ?? ''
      const stopCode = request.query.stop ?? ''
      if (!isId(clientId) || !isId(routeId)) {
        return reply.code(400).send({ error: 'bad_request', message: 'Indicá cliente y recorrido numéricos.' })
      }
      if (!isStopCode(stopCode)) {
        return reply.code(400).send({ error: 'bad_request', message: 'Código de parada inválido.' })
      }
      try {
        const result = await deps.transit.vehicles(Number(clientId), routeId, stopCode)
        return envelope(result.fetchedAt, result.cached, result.data)
      } catch (error) {
        return sendFailure(reply, error)
      }
    })
  }
}

function sendFailure(reply: { code: (status: number) => { send: (body: unknown) => unknown } }, error: unknown) {
  if (error instanceof ProviderError) {
    const status = error.code === 'provider_blocked' || error.code === 'provider_rate_limited' ? 503 : 502
    return reply.code(status).send({
      error: error.code,
      message: error.message,
      retryAfterMs: error.retryAfterMs,
    })
  }
  return reply.code(500).send({
    error: 'internal_error',
    message: 'Error interno al consultar el transporte.',
    retryAfterMs: null,
  })
}
