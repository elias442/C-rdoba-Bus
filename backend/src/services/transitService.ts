import { config } from '../config.js'
import { MemoryCache } from '../cache/memoryCache.js'
import { MicronautaClient } from '../providers/micronauta/client.js'
import { normalizeCatalog, normalizeTrace, normalizeVehicles } from '../providers/micronauta/normalize.js'
import type { Catalog, Trace, VehicleSnapshot } from '../types.js'

export class TransitService {
  constructor(
    private readonly client: MicronautaClient,
    private readonly cache: MemoryCache,
  ) {}

  catalog(): Promise<{ data: Catalog; cached: boolean; fetchedAt: string }> {
    return this.wrap(
      this.cache.getOrLoad('catalog', config.cacheLinesTtlMs, async () => normalizeCatalog(await this.client.lines())),
    )
  }

  trace(clientId: number, routeId: string): Promise<{ data: Trace; cached: boolean; fetchedAt: string }> {
    return this.wrap(
      this.cache.getOrLoad(`trace:${clientId}:${routeId}`, config.cacheTraceTtlMs, async () => (
        normalizeTrace(await this.client.trace(routeId, String(clientId)), clientId, routeId)
      )),
    )
  }

  vehicles(
    clientId: number,
    routeId: string,
    stopCode = '',
    timeoutMs = config.upstreamTimeoutMs,
  ): Promise<{ data: VehicleSnapshot; cached: boolean; fetchedAt: string }> {
    const stopKey = stopCode || '_'
    return this.wrap(
      this.cache.getOrLoad(`vehicles:${clientId}:${routeId}:${stopKey}`, config.cacheVehiclesTtlMs, async () => (
        normalizeVehicles(await this.client.vehicles(routeId, String(clientId), stopCode, timeoutMs), clientId, routeId)
      )),
    )
  }

  private async wrap<T>(result: Promise<{ value: T; cached: boolean; fetchedAt: string }>) {
    const resolved = await result
    return { data: resolved.value, cached: resolved.cached, fetchedAt: resolved.fetchedAt }
  }
}
