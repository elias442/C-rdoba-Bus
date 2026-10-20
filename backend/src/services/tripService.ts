import { config } from '../config.js'
import { MemoryCache } from '../cache/memoryCache.js'
import { MicronautaClient } from '../providers/micronauta/client.js'
import {
  buildTripSearchResult,
  mergeTripOptions,
  normalizePhoton,
  normalizePlaces,
  normalizeTripPage,
  sortTripOptions,
  toResultadosToken,
} from '../providers/micronauta/tripNormalize.js'
import type { PlaceSuggestion, TripOption, TripSearchResult } from '../types/trip.js'

export interface TripSearchInput {
  fromLat: number
  fromLon: number
  toLat: number
  toLon: number
  maxWalkMeters: number | null
  includeDirect: boolean
  includeTransfer: boolean
  userLat?: number
  userLon?: number
  /** Espera a que terminen todas las páginas. Si no, responde con la primera. */
  preferComplete?: boolean
}

const MAX_STEPS = 8
const TRIP_CACHE_MS = 3 * 60 * 1000
const PLACE_CACHE_MS = 15 * 60 * 1000

interface SearchSlot {
  options: TripOption[]
  steps: number
  truncated: boolean
  done: boolean
  error: unknown
  expires: number
  listeners: Set<() => void>
}

export class TripService {
  private readonly slots = new Map<string, SearchSlot>()

  constructor(
    private readonly client: MicronautaClient,
    private readonly cache: MemoryCache,
  ) {}

  async search(input: TripSearchInput): Promise<TripSearchResult> {
    this.pruneSlots()
    const key = tripKey(input)
    let slot = this.slots.get(key)
    const reusable = Boolean(slot && !slot.error && !(slot.done && slot.expires <= Date.now()))
    if (!slot || !reusable) slot = this.start(key, input)
    const current = slot
    const alreadyDone = current.done && !current.error
    if (input.preferComplete) await this.wait(current, () => current.done)
    else await this.wait(current, () => current.done || current.steps >= 1)
    if (current.error) throw current.error
    return buildTripSearchResult(
      sortTripOptions(current.options),
      current.steps,
      current.truncated,
      current.done,
      alreadyDone,
    )
  }

  async places(query: string): Promise<{ places: PlaceSuggestion[]; cached: boolean }> {
    const trimmed = query.trim().replace(/\s+/g, ' ')
    if (trimmed.length < 3) return { places: [], cached: false }
    const key = `places:${trimmed.toLocaleLowerCase('es')}`
    const result = await this.cache.getOrLoad(key, PLACE_CACHE_MS, () => this.lookupPlaces(trimmed))
    return { places: result.value.slice(0, 8), cached: result.cached }
  }

  private start(key: string, input: TripSearchInput): SearchSlot {
    const slot: SearchSlot = {
      options: [],
      steps: 0,
      truncated: false,
      done: false,
      error: null,
      expires: Date.now() + TRIP_CACHE_MS,
      listeners: new Set(),
    }
    this.slots.set(key, slot)
    void this.fill(slot, input)
    return slot
  }

  private async fill(slot: SearchSlot, input: TripSearchInput): Promise<void> {
    const release = this.client.holdInteractive()
    const collected: TripOption[] = []
    let continua = 1
    try {
      while (continua > 0 && slot.steps < MAX_STEPS) {
        const page = normalizeTripPage(await this.client.searchTrip({
          fromLat: input.fromLat,
          fromLon: input.fromLon,
          toLat: input.toLat,
          toLon: input.toLon,
          continua,
          resultados: toResultadosToken(collected),
          userLat: input.userLat,
          userLon: input.userLon,
        }))
        collected.push(...page.directs, ...page.transfers)
        slot.steps += 1
        slot.options = mergeTripOptions(collected)
        continua = page.continua
        this.notify(slot)
      }
      slot.truncated = continua > 0
      slot.done = true
      slot.expires = Date.now() + TRIP_CACHE_MS
    } catch (error) {
      slot.error = error
      slot.done = true
    } finally {
      release()
      this.notify(slot)
    }
  }

  private wait(slot: SearchSlot, ready: () => boolean): Promise<void> {
    if (ready()) return Promise.resolve()
    return new Promise((resolve) => {
      const listener = () => {
        if (!ready()) return
        slot.listeners.delete(listener)
        resolve()
      }
      slot.listeners.add(listener)
    })
  }

  private notify(slot: SearchSlot): void {
    for (const listener of [...slot.listeners]) listener()
  }

  private pruneSlots(): void {
    const now = Date.now()
    for (const [key, slot] of this.slots) {
      if (slot.done && slot.expires <= now) this.slots.delete(key)
    }
  }

  /**
   * Photon responde en pocos cientos de ms. La búsqueda de Tu Bondi suele tardar
   * varios segundos y queda como respaldo cuando el mapa no conoce la dirección.
   */
  private async lookupPlaces(query: string): Promise<PlaceSuggestion[]> {
    const photon = await searchPhoton(query)
    if (photon.length > 0) return photon
    try {
      const local = normalizePlaces(await this.client.searchAddress(query), 'micronauta')
        .filter((place) => place.lat !== null && place.lon !== null)
      if (local.length > 0) return local
    } catch {
      // Si Tu Bondi no responde, sigue el geocoder de respaldo.
    }
    return searchNominatim(query)
  }
}

function tripKey(input: TripSearchInput): string {
  return [input.fromLat, input.fromLon, input.toLat, input.toLon].map(roundCoord).join(':')
}

function roundCoord(value: number): string {
  return (Math.round(value * 10000) / 10000).toFixed(4)
}

const CITY_BBOX = '-64.40,-31.58,-64.02,-31.25'

async function searchPhoton(query: string): Promise<PlaceSuggestion[]> {
  const url = new URL('https://photon.komoot.io/api/')
  url.searchParams.set('q', query)
  url.searchParams.set('lat', '-31.4201')
  url.searchParams.set('lon', '-64.1888')
  url.searchParams.set('limit', '6')
  url.searchParams.set('bbox', CITY_BBOX)
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    })
    if (!response.ok) return []
    return normalizePhoton(await response.json())
  } catch {
    return []
  }
}

async function searchNominatim(query: string): Promise<PlaceSuggestion[]> {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', `${query}, Córdoba, Argentina`)
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', '5')
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('countrycodes', 'ar')
  url.searchParams.set('viewbox', '-64.35,-31.25,-64.05,-31.55')
  url.searchParams.set('bounded', '1')
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CordobaBus/1.0 (local transit map; contact: localhost)',
      },
      signal: AbortSignal.timeout(config.upstreamTimeoutMs),
    })
    if (!response.ok) return []
    return normalizePlaces(await response.json(), 'nominatim')
      .filter((place) => place.lat !== null && place.lon !== null)
  } catch {
    return []
  }
}
