import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import fs from 'node:fs'
import { config } from './config.js'
import { MemoryCache } from './cache/memoryCache.js'
import { MicronautaClient } from './providers/micronauta/client.js'
import { apiRoutes } from './routes/api.js'
import { TransitService } from './services/transitService.js'
import { TripService } from './services/tripService.js'

const app = Fastify({ logger: { level: 'info' } })
const cache = new MemoryCache()
const client = new MicronautaClient()
const transit = new TransitService(client, cache)
const trip = new TripService(client, cache)

await app.register(cors, {
  origin: [/^http:\/\/localhost(?::\d+)?$/, /^http:\/\/127\.0\.0\.1(?::\d+)?$/],
})

await app.register(apiRoutes({ transit, trip, client, cache }), { prefix: '/api' })

if (fs.existsSync(config.frontendDist)) {
  await app.register(fastifyStatic, { root: config.frontendDist })
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api')) {
      return reply.code(404).send({ error: 'not_found', message: 'Recurso no encontrado.' })
    }
    return reply.sendFile('index.html')
  })
}

app.setErrorHandler((error, request, reply) => {
  request.log.error(error)
  const status = typeof error === 'object' && error && 'statusCode' in error && typeof error.statusCode === 'number'
    ? error.statusCode
    : 500
  return reply.code(status >= 400 && status < 600 ? status : 500).send({
    error: 'internal_error',
    message: 'Error interno del servidor.',
  })
})

try {
  await app.listen({ port: config.port, host: config.host })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
