import { Accessibility, ChevronDown, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { cx, formatAgo, readableText } from '../lib/format'
import { useNow } from '../hooks/useViewport'
import { useSelectedLine, useTransitStore } from '../stores/useTransitStore'
import { StopBoard } from './StopBoard'

export function RouteDetail() {
  const line = useSelectedLine()
  const routeId = useTransitStore((state) => state.selectedRouteId)
  const selectRoute = useTransitStore((state) => state.selectRoute)
  const trace = useTransitStore((state) => state.trace)
  const traceStatus = useTransitStore((state) => state.traceStatus)
  const traceError = useTransitStore((state) => state.traceError)
  const retryTrace = useTransitStore((state) => state.retryTrace)
  const vehicles = useTransitStore((state) => state.vehicles)
  const vehicleStatus = useTransitStore((state) => state.vehicleStatus)
  const vehicleError = useTransitStore((state) => state.vehicleError)
  const vehicleNotice = useTransitStore((state) => state.vehicleNotice)
  const vehicleFetchedAt = useTransitStore((state) => state.vehicleFetchedAt)
  const vehicleRefreshing = useTransitStore((state) => state.vehicleRefreshing)
  const retryVehicles = useTransitStore((state) => state.retryVehicles)
  const selectedVehicleId = useTransitStore((state) => state.selectedVehicleId)
  const focusVehicle = useTransitStore((state) => state.focusVehicle)
  const selectedStop = useTransitStore((state) => state.selectedStop)
  const focusStop = useTransitStore((state) => state.focusStop)
  const [stopsOpen, setStopsOpen] = useState(false)
  const now = useNow()

  if (!line) return null
  const activeTrace = trace && trace.clientId === line.clientId && trace.routeId === routeId ? trace : null

  return (
    <div className="space-y-3">
      {selectedStop ? <StopBoard /> : null}
      <div className="grid gap-2">
        {line.routes.map((route) => {
          const selected = route.id === routeId
          return (
            <button
              key={route.id}
              type="button"
              onClick={() => selectRoute(route.id)}
              className={cx(
                'rounded-2xl border px-3 py-2.5 text-left transition',
                selected ? 'border-electric-500 bg-white shadow-sm' : 'border-transparent bg-white/70 hover:bg-white',
              )}
            >
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-electric-600">{route.directionLabel}</span>
              <span className="mt-1 block text-[13px] leading-5 text-ink-900">{route.name}</span>
              {route.lengthKm ? <span className="mt-1 block text-xs text-slate-500">{route.lengthKm} km informados</span> : null}
            </button>
          )
        })}
      </div>

      {traceStatus === 'loading' ? <p className="px-1 text-xs text-slate-500">Cargando recorrido y paradas…</p> : null}
      {traceStatus === 'error' ? (
        <div className="rounded-2xl bg-rose-50 px-3 py-3 text-sm text-rose-950">
          <p>{traceError}</p>
          <button type="button" onClick={retryTrace} className="mt-2 text-xs font-semibold underline">Reintentar</button>
        </div>
      ) : null}
      {traceStatus === 'empty' ? (
        <p className="rounded-2xl bg-slate-100 px-3 py-3 text-sm text-slate-600">Este recorrido no tiene una traza publicada.</p>
      ) : null}

      {activeTrace && activeTrace.notices.length > 0 ? (
        <div className="space-y-2">
          {activeTrace.notices.slice(0, 3).map((notice, index) => (
            <div key={`${notice.title}-${index}`} className="rounded-2xl bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
              <p className="font-medium">{notice.title}</p>
              {notice.text ? <p className="mt-1 line-clamp-3 text-amber-900/80">{notice.text}</p> : null}
            </div>
          ))}
        </div>
      ) : null}

      <section className="rounded-3xl bg-white px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Colectivos</h3>
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
            {vehicleRefreshing ? <RefreshCw size={12} className="animate-spin" /> : null}
            {vehicleFetchedAt ? `Posición ${formatAgo(vehicleFetchedAt, now)}` : 'Esperando GPS'}
          </span>
        </div>
        {vehicleNotice ? <p className="mt-2 text-xs text-slate-500">{vehicleNotice}</p> : null}
        {vehicleStatus === 'loading' && vehicles.length === 0 ? (
          <div className="mt-3 space-y-2">
            <div className="h-12 animate-pulse rounded-2xl bg-slate-100" />
            <div className="h-12 animate-pulse rounded-2xl bg-slate-100" />
          </div>
        ) : null}
        {vehicleStatus === 'error' ? (
          <div className="mt-3 rounded-2xl bg-rose-50 px-3 py-3 text-sm text-rose-950">
            <p className="font-medium">GPS temporalmente no disponible</p>
            <p className="mt-1 text-rose-900/80">{vehicleError}</p>
            <button type="button" onClick={retryVehicles} className="mt-2 text-xs font-semibold underline">Reintentar</button>
          </div>
        ) : null}
        {vehicleStatus === 'empty' ? (
          <p className="mt-3 text-sm text-slate-500">No hay colectivos informados en este recorrido.</p>
        ) : null}
        {vehicleStatus === 'unusable' ? (
          <p className="mt-3 text-sm text-slate-500">El servicio respondió, pero ninguna unidad trae coordenadas válidas.</p>
        ) : null}
        {vehicles.length > 0 ? (
          <div className="mt-2 space-y-1">
            {vehicles.map((vehicle) => {
              const selected = vehicle.id === selectedVehicleId
              return (
                <button
                  key={vehicle.id}
                  type="button"
                  onClick={() => focusVehicle(vehicle.id)}
                  className={cx('flex w-full items-center gap-3 rounded-2xl px-1.5 py-2 text-left', selected && 'bg-electric-50')}
                >
                  <span
                    className="grid h-9 min-w-9 place-items-center rounded-xl px-2 text-xs font-semibold"
                    style={{ background: vehicle.color, color: readableText(vehicle.color) }}
                  >
                    {vehicle.lineName}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      Coche {vehicle.vehicleNumber}
                      {vehicle.hasRamp ? <Accessibility size={13} className="text-electric-600" aria-label="Con rampa" /> : null}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {vehicle.directionLabel}
                      {vehicle.arrivalLabel ? ` · ${vehicle.arrivalLabel}` : ''}
                      {!vehicle.arrivalLabel && vehicle.delayLabel ? ` · ${vehicle.delayLabel}` : ''}
                      {vehicle.missingSince ? ' · sin actualización reciente' : ''}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        ) : null}
        {selectedStop ? (
          <p className="mt-2 text-[11px] leading-4 text-slate-400">
            El tiempo de arribo se calcula hacia la parada {selectedStop.name}.
          </p>
        ) : vehicles.some((vehicle) => vehicle.arrivalLabel) ? (
          <p className="mt-2 text-[11px] leading-4 text-slate-400">
            Elegí una parada para pedir el tiempo de arribo a ese punto.
          </p>
        ) : null}
      </section>

      {activeTrace && activeTrace.stops.length > 0 ? (
        <div>
          <button
            type="button"
            onClick={() => setStopsOpen((open) => !open)}
            className="flex w-full items-center justify-between rounded-2xl px-1 py-2 text-sm font-medium"
          >
            {activeTrace.stops.length} paradas
            <ChevronDown size={16} className={cx('transition', stopsOpen && 'rotate-180')} />
          </button>
          {stopsOpen ? (
            <div className="max-h-64 space-y-1 overflow-y-auto thin-scroll pr-1">
              {activeTrace.stops.map((stop) => (
                <button
                  key={`${stop.code}-${stop.order}`}
                  type="button"
                  onClick={() => focusStop(stop)}
                  className={cx(
                    'flex w-full items-start gap-3 rounded-2xl px-2 py-2 text-left hover:bg-white',
                    selectedStop?.code === stop.code && 'bg-white',
                  )}
                >
                  <span className="mt-0.5 w-7 shrink-0 text-xs font-semibold text-slate-400">{stop.shortLabel ?? stop.order}</span>
                  <span className="min-w-0">
                    <span className="block text-sm">{stop.name}</span>
                    <span className="block text-[11px] text-slate-400">{stop.code}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
