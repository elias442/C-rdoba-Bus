import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

for (const file of [path.join(root, '.env'), path.join(root, 'backend', '.env')]) {
  if (fs.existsSync(file)) dotenv.config({ path: file })
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

export const config = {
  port: intEnv('PORT', 8787, 1, 65535),
  host: process.env.HOST || '0.0.0.0',
  micronautaBaseUrl: (process.env.MICRONAUTA_BASE_URL || 'https://micronauta4.dnsalias.net').replace(/\/$/, ''),
  micronautaConf: process.env.MICRONAUTA_CONF || 'cbaciudad',
  upstreamTimeoutMs: intEnv('UPSTREAM_TIMEOUT_MS', 20000, 3000, 60000),
  sessionTtlMs: intEnv('SESSION_TTL_MS', 10 * 60 * 1000, 60_000, 60 * 60 * 1000),
  providerCooldownMs: intEnv('PROVIDER_COOLDOWN_MS', 90_000, 15_000, 15 * 60 * 1000),
  cacheLinesTtlMs: intEnv('CACHE_LINES_TTL_MS', 10 * 60 * 1000, 30_000, 60 * 60 * 1000),
  cacheTraceTtlMs: intEnv('CACHE_TRACE_TTL_MS', 30 * 60 * 1000, 30_000, 6 * 60 * 60 * 1000),
  cacheVehiclesTtlMs: intEnv('CACHE_VEHICLES_TTL_MS', 12_000, 5_000, 60_000),
  frontendDist: path.join(root, 'frontend', 'dist'),
}
