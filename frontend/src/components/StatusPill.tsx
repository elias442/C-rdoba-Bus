import { formatAgo } from '../lib/format'
import { useNow } from '../hooks/useViewport'
import { useTransitStore } from '../stores/useTransitStore'

export function StatusPill() {
  const selectedRouteId = useTransitStore((state) => state.selectedRouteId)
  const traceStatus = useTransitStore((state) => state.traceStatus)
  const vehicleStatus = useTransitStore((state) => state.vehicleStatus)
  const vehicleFetchedAt = useTransitStore((state) => state.vehicleFetchedAt)
  const vehicleRefreshing = useTransitStore((state) => state.vehicleRefreshing)
  const now = useNow()

  let label = 'Elegí una línea'
  let live = false
  if (!selectedRouteId) label = 'Elegí una línea'
  else if (traceStatus === 'loading') label = 'Cargando recorrido'
  else if (vehicleStatus === 'loading') label = 'Buscando colectivos'
  else if (vehicleStatus === 'error') label = 'GPS no disponible'
  else if (vehicleStatus === 'unusable') label = 'GPS sin coordenadas'
  else if (vehicleStatus === 'empty') label = 'Sin unidades en este recorrido'
  else if (vehicleStatus === 'live') {
    live = true
    label = vehicleFetchedAt ? `En vivo · ${formatAgo(vehicleFetchedAt, now)}` : 'En vivo'
  }
  if (vehicleRefreshing && vehicleStatus === 'live') label = `Actualizando · ${vehicleFetchedAt ? formatAgo(vehicleFetchedAt, now) : 'en vivo'}`

  return (
    <div>
      <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/95 px-3 py-1.5 text-xs font-medium text-ink-900 shadow-panel backdrop-blur">
        {live ? <span className="live-dot" /> : <span className="h-2 w-2 rounded-full bg-slate-300" />}
        {label}
      </div>
    </div>
  )
}
