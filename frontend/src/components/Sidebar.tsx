import { Bus, PanelLeftClose, PanelLeftOpen, Route } from 'lucide-react'
import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { LineBrowser, OperatorFilters, SearchField } from './LineBrowser'
import { Logo } from './Logo'
import { TripNavigation } from './TripNavigation'
import { TripPlanner } from './TripPlanner'
import { cx } from '../lib/format'
import { useTransitStore } from '../stores/useTransitStore'

export function Sidebar() {
  const collapsed = useTransitStore((state) => state.sidebarCollapsed)
  const toggleSidebar = useTransitStore((state) => state.toggleSidebar)
  const lines = useTransitStore((state) => state.lines)
  const linesStatus = useTransitStore((state) => state.linesStatus)
  const selectedLineKey = useTransitStore((state) => state.selectedLineKey)
  const panelMode = useTransitStore((state) => state.panelMode)
  const tripNavigating = useTransitStore((state) => state.tripNavigating)
  const setPanelMode = useTransitStore((state) => state.setPanelMode)

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 88 : 392 }}
      transition={{ type: 'spring', stiffness: 380, damping: 38 }}
      className="absolute bottom-4 left-4 top-4 z-20 overflow-hidden rounded-[28px] border border-white/80 bg-white/95 shadow-panel backdrop-blur-xl"
    >
      {collapsed ? (
        <div className="flex h-full flex-col items-center">
          <div className="flex shrink-0 flex-col items-center gap-2 px-2 py-3">
            <Logo />
            <button
              type="button"
              onClick={() => { setPanelMode('lines'); toggleSidebar() }}
              className="grid h-10 w-10 place-items-center rounded-2xl text-ink-800 hover:bg-slate-100"
              aria-label="Abrir líneas"
            >
              <Bus size={18} />
            </button>
            <button
              type="button"
              onClick={() => { setPanelMode('trip'); }}
              className={cx(
                'grid h-10 w-10 place-items-center rounded-2xl hover:bg-slate-100',
                panelMode === 'trip' ? 'bg-ink-900 text-white' : 'text-ink-800',
              )}
              aria-label="Abrir viaje"
            >
              <Route size={18} />
            </button>
            <button
              type="button"
              onClick={toggleSidebar}
              className="grid h-10 w-10 place-items-center rounded-2xl text-ink-800 hover:bg-slate-100"
              aria-label="Abrir panel"
            >
              <PanelLeftOpen size={18} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 thin-scroll">
            {panelMode === 'lines' ? <LineBrowser variant="accordion" layout="rail" /> : null}
          </div>
        </div>
      ) : (
        <div className="flex h-full flex-col">
          <div className="shrink-0 space-y-3 px-4 pb-3 pt-4">
            <div className="flex items-center gap-3">
              <Logo />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold tracking-tight">Córdoba Bus</p>
                <p className="text-xs text-slate-500">Colectivos en tiempo real</p>
              </div>
              <button
                type="button"
                onClick={toggleSidebar}
                className="grid h-10 w-10 place-items-center rounded-2xl text-slate-500 hover:bg-slate-100"
                aria-label="Contraer panel"
              >
                <PanelLeftClose size={18} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
              <ModeTab active={panelMode === 'lines'} onClick={() => setPanelMode('lines')} icon={<Bus size={14} />} label="Líneas" />
              <ModeTab active={panelMode === 'trip'} onClick={() => setPanelMode('trip')} icon={<Route size={14} />} label="Viaje" />
            </div>

            {panelMode === 'lines' ? (
              <>
                <SearchField />
                <OperatorFilters />
                <p className="px-1 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
                  {linesStatus === 'ready' ? `${lines.length} líneas` : 'Líneas'}
                  {selectedLineKey ? ' · recorrido' : ''}
                </p>
              </>
            ) : (
              <p className="px-1 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
                {tripNavigating ? 'Indicaciones' : 'Origen y destino'}
              </p>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 thin-scroll">
            {panelMode === 'lines' ? <LineBrowser variant="accordion" /> : tripNavigating ? <TripNavigation mode="live" /> : <TripPlanner />}
          </div>
          <p className="shrink-0 border-t border-slate-100 px-4 py-3 text-[11px] leading-4 text-slate-400">
            Recorridos y posiciones provistos por Tu Bondi. Esta app no opera el servicio.
          </p>
        </div>
      )}
    </motion.aside>
  )
}

function ModeTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition',
        active ? 'bg-white text-ink-900 shadow-sm' : 'text-slate-500 hover:text-ink-900',
      )}
    >
      {icon}
      {label}
    </button>
  )
}
