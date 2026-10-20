import { Layers, LocateFixed, Minus, Plus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { cx } from '../lib/format'
import { useTransitStore } from '../stores/useTransitStore'

interface MapControlsProps {
  bottom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onLocate: () => void
  locateMessage: string | null
}

export function MapControls({ bottom, onZoomIn, onZoomOut, onLocate, locateMessage }: MapControlsProps) {
  const mapStyle = useTransitStore((state) => state.mapStyle)
  const toggleMapStyle = useTransitStore((state) => state.toggleMapStyle)
  const [layersOpen, setLayersOpen] = useState(false)

  return (
    <div className="absolute right-3 z-10 flex flex-col items-end gap-2" style={{ bottom }}>
      {locateMessage ? (
        <p className="max-w-44 rounded-2xl bg-white/95 px-3 py-2 text-xs text-slate-600 shadow-panel">{locateMessage}</p>
      ) : null}
      {layersOpen ? (
        <div className="w-36 rounded-2xl border border-white/80 bg-white/95 p-1.5 shadow-panel">
          <LayerOption active={mapStyle === 'light'} label="Claro" onClick={() => { if (mapStyle !== 'light') toggleMapStyle(); setLayersOpen(false) }} />
          <LayerOption active={mapStyle === 'dark'} label="Oscuro" onClick={() => { if (mapStyle !== 'dark') toggleMapStyle(); setLayersOpen(false) }} />
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <ControlButton label="Acercar" onClick={onZoomIn}><Plus size={18} /></ControlButton>
        <ControlButton label="Alejar" onClick={onZoomOut}><Minus size={18} /></ControlButton>
        <ControlButton label="Mi ubicación" onClick={onLocate}><LocateFixed size={18} /></ControlButton>
        <ControlButton label="Estilo del mapa" onClick={() => setLayersOpen((open) => !open)}><Layers size={18} /></ControlButton>
      </div>
    </div>
  )
}

function ControlButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid h-11 w-11 place-items-center rounded-2xl border border-white/80 bg-white/95 text-ink-900 shadow-panel backdrop-blur transition active:scale-95"
    >
      {children}
    </button>
  )
}

function LayerOption({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx('block w-full rounded-xl px-3 py-2 text-left text-sm', active ? 'bg-ink-900 text-white' : 'text-ink-900 hover:bg-slate-100')}
    >
      {label}
    </button>
  )
}
