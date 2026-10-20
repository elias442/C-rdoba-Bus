export type TripOptionKind = 'direct' | 'transfer'

export interface TripLeg {
  lineId: string
  lineName: string
  clientId: number
  operatorName: string | null
  color: string
  direction: string
  directionLabel: string
  routeId: string
  routeIds: string[]
}

export interface TripOption {
  id: string
  kind: TripOptionKind
  /** ETA al primer colectivo / próximo, no duración total del viaje. */
  etaLabel: string | null
  distanceLabel: string | null
  distanceKm: number | null
  /** Señal de Micronauta para ranking interno de combinaciones. */
  ordenDiff: number | null
  walkMeters: number | null
  boardStopCode: string | null
  alightStopCode: string | null
  /** Parada de bajada de la 1ª línea / zona de trasbordo. */
  transferStopCode: string | null
  /** Parada de subida de la 2ª línea (puede diferir unos metros de transferStopCode). */
  transferBoardStopCode: string | null
  transfer: { lat: number; lon: number } | null
  legs: TripLeg[]
}

export interface TripSearchResult {
  options: TripOption[]
  steps: number
  truncated: boolean
  /** False mientras siguen llegando páginas de combinaciones. */
  complete: boolean
  cached: boolean
}

export interface PlaceSuggestion {
  id: string
  label: string
  lat: number | null
  lon: number | null
  source: 'micronauta' | 'nominatim' | 'photon'
}
