interface Entry<T> {
  value: T
  expires: number
  fetchedAt: string
}

export interface CacheResult<T> {
  value: T
  cached: boolean
  fetchedAt: string
}

export class MemoryCache {
  private readonly store = new Map<string, Entry<unknown>>()
  private readonly inflight = new Map<string, Promise<unknown>>()

  size(): number {
    return this.store.size
  }

  async getOrLoad<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<CacheResult<T>> {
    const now = Date.now()
    const hit = this.store.get(key)
    if (hit && hit.expires > now) {
      return { value: hit.value as T, cached: true, fetchedAt: hit.fetchedAt }
    }

    const pending = this.inflight.get(key)
    if (pending) {
      const value = (await pending) as T
      const stored = this.store.get(key)
      return {
        value,
        cached: false,
        fetchedAt: stored?.fetchedAt ?? new Date().toISOString(),
      }
    }

    const promise = loader()
      .then((value) => {
        const fetchedAt = new Date().toISOString()
        this.store.set(key, { value, expires: Date.now() + ttlMs, fetchedAt })
        return value
      })
      .finally(() => {
        this.inflight.delete(key)
      })

    this.inflight.set(key, promise)
    const value = await promise
    const stored = this.store.get(key)
    return {
      value,
      cached: false,
      fetchedAt: stored?.fetchedAt ?? new Date().toISOString(),
    }
  }
}
