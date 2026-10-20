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

export interface Catalog {
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

export interface Trace {
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
  /** Tiempo hasta una parada, según el campo `tiempo` del servicio. */
  arrivalLabel: string | null
  /** El mismo `tiempo`, en segundos. Negativo si el colectivo ya pasó. */
  arrivalSeconds: number | null
  /** Demora textual del servicio (`demora`), cuando viene informada. */
  delayLabel: string | null
  /** `rampa` distinto de 0: unidad con rampa accesible. */
  hasRamp: boolean | null
  note: string | null
}

export interface VehicleSnapshot {
  clientId: number
  routeId: string
  availability: VehicleAvailability
  notice: string | null
  vehicles: Vehicle[]
}
