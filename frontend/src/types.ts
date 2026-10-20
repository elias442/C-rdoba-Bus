export interface Operator {
  id: number
  name: string
  color: string
}

export interface RouteSummary {
  id: string
  direction: string
  directionLabel: string
  name: string
  lengthKm: number | null
}

export interface Line {
  key: string
  id: string
  name: string
  color: string
  clientId: number
  operatorName: string
  groupId: string
  groupName: string | null
  order: number
  routes: RouteSummary[]
}

export interface CatalogResponse {
  source: 'micronauta'
  fetchedAt: string
  cached: boolean
  operators: Operator[]
  lines: Line[]
}

export interface Stop {
  code: string
  name: string
  shortLabel: string | null
  order: number
  lat: number
  lon: number
  direction: string
  directionLabel: string
}

export interface ServiceNotice {
  title: string
  text: string
  deviation: Array<[number, number]>
}

export interface TraceResponse {
  source: 'micronauta'
  fetchedAt: string
  cached: boolean
  clientId: number
  routeId: string
  color: string
  direction: string
  directionLabel: string
  coordinates: Array<[number, number]>
  stops: Stop[]
  notices: ServiceNotice[]
}

export type VehicleAvailability = 'live' | 'empty' | 'unusable'

export interface Vehicle {
  id: string
  vehicleNumber: string
  serie: string | null
  lineName: string
  direction: string
  directionLabel: string
  lat: number
  lon: number
  headingRadians: number | null
  color: string
  clientId: number
  arrivalLabel: string | null
  arrivalSeconds?: number | null
  /** 0 = primer colectivo del viaje elegido, 1 = el de la combinación. */
  tripLeg?: number
  delayLabel: string | null
  hasRamp: boolean | null
  note: string | null
}

export interface VehiclesResponse {
  source: 'micronauta'
  fetchedAt: string
  cached: boolean
  clientId: number
  routeId: string
  availability: VehicleAvailability
  notice: string | null
  vehicles: Vehicle[]
}

export interface TrackedVehicle extends Vehicle {
  fetchedAt: string
  missingSince: number | null
}

export type LinesStatus = 'idle' | 'loading' | 'ready' | 'error'
export type TraceStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'
export type VehicleStatus = 'idle' | 'loading' | VehicleAvailability | 'error'
export type MapStyleName = 'light' | 'dark'
export type SheetSnap = 'peek' | 'half' | 'full'
export type PanelMode = 'lines' | 'trip'
export type TripPinTarget = 'origin' | 'destination' | null
export type TripStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

export interface TripPoint {
  lat: number
  lon: number
  label: string
}

export interface PlaceSuggestion {
  id: string
  label: string
  lat: number | null
  lon: number | null
  source: 'micronauta' | 'nominatim' | 'photon'
}

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
  kind: 'direct' | 'transfer'
  etaLabel: string | null
  distanceLabel: string | null
  distanceKm: number | null
  ordenDiff: number | null
  walkMeters: number | null
  boardStopCode: string | null
  alightStopCode: string | null
  transferStopCode: string | null
  transferBoardStopCode: string | null
  transfer: { lat: number; lon: number } | null
  legs: TripLeg[]
}

export interface TripSearchResponse {
  source: 'micronauta'
  fetchedAt: string
  cached: boolean
  options: TripOption[]
  steps: number
  truncated: boolean
  complete: boolean
  maxWalkMeters: number | null
  includeDirect: boolean
  includeTransfer: boolean
}
