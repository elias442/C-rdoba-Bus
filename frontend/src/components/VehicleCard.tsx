import { Accessibility, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { formatAgo, readableText } from '../lib/format'
import { useNow } from '../hooks/useViewport'
import { useSelectedLine, useTransitStore } from '../stores/useTransitStore'

export function VehicleCard({ left }: { left: number }) {
  const vehicle = useTransitStore((state) => state.vehicles.find((item) => item.id === state.selectedVehicleId) ?? null)
  const line = useSelectedLine()
  const selectedStop = useTransitStore((state) => state.selectedStop)
  const clearVehicle = useTransitStore((state) => state.clearVehicle)
  const now = useNow()
  const operator = line && vehicle && line.clientId === vehicle.clientId ? line.operatorName : null

  return (
    <AnimatePresence>
      {vehicle ? (
        <motion.article
          key={vehicle.id}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.22 }}
          style={{ left }}
          className="absolute bottom-6 z-30 w-[336px] rounded-[28px] border border-white/80 bg-white/95 p-4 shadow-panel backdrop-blur-xl"
        >
          <div className="flex items-start gap-3">
            <span
              className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-lg font-semibold"
              style={{ background: vehicle.color, color: readableText(vehicle.color) }}
            >
              {vehicle.lineName}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Coche</p>
              <p className="text-xl font-semibold tracking-tight">{vehicle.vehicleNumber}</p>
              {vehicle.serie ? <p className="mt-0.5 text-xs text-slate-500">Serie {vehicle.serie}</p> : null}
            </div>
            <button type="button" onClick={clearVehicle} className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 hover:bg-slate-100" aria-label="Cerrar">
              <X size={16} />
            </button>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-2">
            <Fact label="Empresa" value={operator ?? 'No identificada'} />
            <Fact label="Sentido" value={vehicle.directionLabel} />
            <Fact label="Posición recibida" value={formatAgo(vehicle.fetchedAt, now)} />
            {vehicle.hasRamp !== null ? (
              <Fact
                label="Rampa"
                value={vehicle.hasRamp ? 'Con rampa accesible' : 'Sin rampa informada'}
              />
            ) : null}
            {vehicle.arrivalLabel ? (
              <Fact
                label={selectedStop ? `A ${selectedStop.name}` : 'Tiempo a parada'}
                value={vehicle.arrivalLabel}
              />
            ) : null}
            {vehicle.delayLabel ? <Fact label="Demora informada" value={vehicle.delayLabel} /> : null}
          </dl>
          {vehicle.hasRamp ? (
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-electric-600">
              <Accessibility size={14} />
              Unidad con rampa
            </p>
          ) : null}
          {vehicle.note ? <p className="mt-3 text-sm text-slate-600">{vehicle.note}</p> : null}
          {vehicle.missingSince ? (
            <p className="mt-3 text-xs text-slate-500">No apareció en la última respuesta. Se oculta si no vuelve en 30 segundos.</p>
          ) : null}
          {!selectedStop && vehicle.arrivalLabel ? (
            <p className="mt-3 text-[11px] leading-4 text-slate-400">
              Tocá una parada del recorrido para pedir el tiempo de arribo a ese punto.
            </p>
          ) : null}
        </motion.article>
      ) : null}
    </AnimatePresence>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-3 py-2">
      <dt className="line-clamp-2 text-[11px] text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-ink-900">{value}</dd>
    </div>
  )
}
