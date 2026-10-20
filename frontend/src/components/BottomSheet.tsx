import { Bus, ChevronLeft, Route } from 'lucide-react'
import { motion } from 'framer-motion'
import { useRef } from 'react'
import { mobileSheetHeight } from '../lib/layout'
import { useViewportHeight } from '../hooks/useViewport'
import { cx, readableText } from '../lib/format'
import { useSelectedLine, useTransitStore } from '../stores/useTransitStore'
import { LineBrowser, OperatorFilters, SearchField } from './LineBrowser'
import { Logo } from './Logo'
import { RouteDetail } from './RouteDetail'
import { TripNavigation } from './TripNavigation'
import { TripPlanner } from './TripPlanner'
import type { SheetSnap } from '../types'

const ORDER: SheetSnap[] = ['full', 'half', 'peek']

export function MobileChrome() {
  const snap = useTransitStore((state) => state.sheetSnap)
  const setSheetSnap = useTransitStore((state) => state.setSheetSnap)
  const view = useTransitStore((state) => state.sheetView)
  const setSheetView = useTransitStore((state) => state.setSheetView)
  const panelMode = useTransitStore((state) => state.panelMode)
  const tripNavigating = useTransitStore((state) => state.tripNavigating)
  const setPanelMode = useTransitStore((state) => state.setPanelMode)
  const line = useSelectedLine()
  const viewport = useViewportHeight()
  const height = mobileSheetHeight(snap, viewport, tripNavigating)
  const startY = useRef(0)

  const step = (direction: -1 | 1) => {
    const index = ORDER.indexOf(snap)
    const next = ORDER[Math.min(ORDER.length - 1, Math.max(0, index + direction))]
    if (next) setSheetSnap(next)
  }

  return (
    <>
      <div className="absolute left-3 right-3 top-3 z-20 flex items-center gap-2 pt-[env(safe-area-inset-top)]">
        <Logo className="shadow-panel" />
        <div className="min-w-0 flex-1 rounded-2xl border border-white/80 bg-white/95 shadow-panel backdrop-blur">
          {panelMode === 'lines' ? <SearchField plain /> : (
            <div className="flex h-11 items-center px-3 text-sm font-medium text-ink-900">Viaje A → B</div>
          )}
        </div>
      </div>

      <motion.section
        className="absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-[28px] border border-white/80 bg-white/95 shadow-panel backdrop-blur-xl"
        animate={{ height }}
        transition={{ type: 'spring', stiffness: 420, damping: 42 }}
        aria-label="Líneas y recorrido"
      >
        <div
          className="flex shrink-0 cursor-grab touch-none items-center justify-center py-3"
          onPointerDown={(event) => {
            startY.current = event.clientY
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerUp={(event) => {
            const delta = event.clientY - startY.current
            if (delta > 36) step(1)
            else if (delta < -36) step(-1)
          }}
        >
          <span className="h-1.5 w-11 rounded-full bg-slate-300" />
        </div>

        {tripNavigating ? null : <div className="shrink-0 px-4 pb-2">
          <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setPanelMode('lines')}
              className={cx(
                'inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium',
                panelMode === 'lines' ? 'bg-white text-ink-900 shadow-sm' : 'text-slate-500',
              )}
            >
              <Bus size={14} />
              Líneas
            </button>
            <button
              type="button"
              onClick={() => setPanelMode('trip')}
              className={cx(
                'inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium',
                panelMode === 'trip' ? 'bg-white text-ink-900 shadow-sm' : 'text-slate-500',
              )}
            >
              <Route size={14} />
              Viaje
            </button>
          </div>
        </div>}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(16px,env(safe-area-inset-bottom))] thin-scroll">
          {tripNavigating ? (
            <TripNavigation mode="live" />
          ) : panelMode === 'trip' ? (
            <TripPlanner />
          ) : view === 'detail' && line ? (
            <div>
              <button
                type="button"
                onClick={() => setSheetView('list')}
                className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500"
              >
                <ChevronLeft size={16} />
                Líneas
              </button>
              <div className="mb-3 flex items-center gap-3">
                <span
                  className="grid h-12 w-12 place-items-center rounded-full text-base font-semibold shadow-sm"
                  style={{ background: line.color, color: readableText(line.color) }}
                >
                  {line.name}
                </span>
                <div>
                  <p className="text-base font-semibold">{line.operatorName}</p>
                  <p className="text-xs text-slate-500">{line.groupName ?? 'Recorrido urbano'}</p>
                </div>
              </div>
              <RouteDetail />
            </div>
          ) : (
            <div className="space-y-3">
              <OperatorFilters />
              <LineBrowser variant="navigate" />
            </div>
          )}
        </div>
      </motion.section>
    </>
  )
}
