import type { TrackedVehicle, Vehicle, VehicleAvailability, VehiclesResponse } from '../types'

const EXPIRE_MS = 30_000

export function mergeVehicles(
  previous: TrackedVehicle[],
  incoming: Vehicle[],
  fetchedAt: string,
  now = Date.now(),
): TrackedVehicle[] {
  return mergeVehicleSnapshots(previous, [{ vehicles: incoming, fetchedAt }], now)
}

/** Une GPS de uno o más recorridos (p. ej. las dos piernas de una combinación). */
export function mergeVehicleSnapshots(
  previous: TrackedVehicle[],
  snapshots: Array<{ vehicles: Vehicle[]; fetchedAt: string }>,
  now = Date.now(),
): TrackedVehicle[] {
  const next = new Map<string, TrackedVehicle>()
  for (const snapshot of snapshots) {
    for (const vehicle of snapshot.vehicles) {
      next.set(vehicle.id, { ...vehicle, fetchedAt: snapshot.fetchedAt, missingSince: null })
    }
  }
  for (const vehicle of previous) {
    if (next.has(vehicle.id)) continue
    const missingSince = vehicle.missingSince ?? now
    if (now - missingSince > EXPIRE_MS) continue
    next.set(vehicle.id, { ...vehicle, missingSince })
  }
  return [...next.values()].sort((a, b) => a.vehicleNumber.localeCompare(b.vehicleNumber, 'es', { numeric: true }))
}

export function combineVehicleAvailability(snapshots: VehiclesResponse[]): VehicleAvailability {
  if (snapshots.some((item) => item.availability === 'live')) return 'live'
  if (snapshots.some((item) => item.availability === 'unusable')) return 'unusable'
  if (snapshots.some((item) => item.availability === 'empty')) return 'empty'
  return 'empty'
}
