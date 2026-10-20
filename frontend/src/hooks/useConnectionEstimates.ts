import { useEffect, useState } from 'react'
import { fetchTrace, isAbort } from '../services/api'
import { loadTrace } from '../lib/traceCache'
import { buildTripGuide, resolveLegRoute } from '../lib/tripGuide'
import { useTransitStore } from '../stores/useTransitStore'
import type { TripOption } from '../types'

/** Plazo a bordo de las combinaciones visibles, sin la espera en vivo. */
export function useConnectionEstimates(options: TripOption[]): Record<string, number | null> {
  const lines = useTransitStore((state) => state.lines)
  const [estimates, setEstimates] = useState<Record<string, number | null>>({})
  const key = options
    .filter((option) => option.kind === 'transfer')
    .map((option) => option.id)
    .join('|')

  useEffect(() => {
    const pending = options.filter((option) => option.kind === 'transfer')
    if (pending.length === 0) return
    let stopped = false
    const queue = [...pending]

    const worker = async () => {
      while (queue.length > 0 && !stopped) {
        const option = queue.shift()
        const first = option?.legs[0]
        const second = option?.legs[1]
        if (!option || !first || !second) continue
        try {
          const [firstTrace, secondTrace] = await Promise.all([
            loadTrace(first.clientId, resolveLegRoute(lines, first), () => fetchTrace(first.clientId, resolveLegRoute(lines, first))),
            loadTrace(second.clientId, resolveLegRoute(lines, second), () => fetchTrace(second.clientId, resolveLegRoute(lines, second))),
          ])
          if (stopped) return
          const guide = buildTripGuide({
            trip: option,
            origin: null,
            destination: null,
            firstTrace,
            secondTrace,
            vehicles: [],
          })
          setEstimates((current) => ({ ...current, [option.id]: guide.connectionSeconds }))
        } catch (error) {
          if (isAbort(error) || stopped) return
          setEstimates((current) => ({ ...current, [option.id]: null }))
        }
      }
    }

    void Promise.all([worker(), worker(), worker()])
    return () => {
      stopped = true
    }
  }, [key, lines, options])

  return estimates
}
