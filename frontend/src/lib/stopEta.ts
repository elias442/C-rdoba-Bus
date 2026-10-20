import { estimateWaitSeconds } from './frequency'
import { formatFrequencyWait, formatLiveWait } from './format'
import { arrivalSecondsOf } from './tripGuide'

export interface RouteEta {
  text: string
  live: boolean
}

/**
 * Arribo en vivo si alguna unidad informa tiempo a la parada.
 * Si no, la frecuencia ya observada. Nunca inventa un minuto.
 */
export function routeEta(
  vehicles: Array<{ arrivalSeconds?: number | null; arrivalLabel: string | null; missingSince?: number | null; tripLeg?: number }>,
  status: 'loading' | 'ready',
  clientId: number,
  routeId: string,
): RouteEta {
  let best: number | null = null
  for (const vehicle of vehicles) {
    if (vehicle.missingSince || vehicle.tripLeg === 1) continue
    const seconds = arrivalSecondsOf(vehicle)
    if (seconds === null) continue
    if (best === null || seconds < best) best = seconds
  }
  if (best !== null) return { text: formatLiveWait(best, false), live: true }
  if (status === 'loading') return { text: 'Calculando…', live: false }
  const estimate = estimateWaitSeconds(clientId, routeId)
  if (estimate === null) return { text: 'Sin unidades', live: false }
  return { text: formatFrequencyWait(estimate), live: false }
}
