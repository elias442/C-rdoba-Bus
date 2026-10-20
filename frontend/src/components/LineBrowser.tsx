import { Search, X } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { cx, readableText } from '../lib/format'
import { filterLines } from '../lib/lines'
import { useTransitStore } from '../stores/useTransitStore'
import type { Line } from '../types'
import { RouteDetail } from './RouteDetail'

export function SearchField({ plain = false }: { plain?: boolean }) {
  const query = useTransitStore((state) => state.query)
  const setQuery = useTransitStore((state) => state.setQuery)

  return (
    <label className={cx('flex h-11 items-center gap-2 rounded-2xl px-3 text-slate-400', !plain && 'bg-slate-100')}>
      <Search size={16} />
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Línea, recorrido o empresa"
        className="w-full bg-transparent text-sm text-ink-900 outline-none placeholder:text-slate-400"
        aria-label="Buscar líneas"
      />
      {query ? (
        <button type="button" className="text-slate-400" onClick={() => setQuery('')} aria-label="Borrar búsqueda">
          <X size={15} />
        </button>
      ) : null}
    </label>
  )
}

export function OperatorFilters() {
  const operators = useTransitStore((state) => state.operators)
  const operatorId = useTransitStore((state) => state.operatorId)
  const setOperatorId = useTransitStore((state) => state.setOperatorId)

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 thin-scroll">
      <FilterChip active={operatorId === null} onClick={() => setOperatorId(null)}>Todas</FilterChip>
      {operators.map((operator) => (
        <FilterChip
          key={operator.id}
          active={operatorId === operator.id}
          onClick={() => setOperatorId(operatorId === operator.id ? null : operator.id)}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: operator.color }} />
          {operator.name}
        </FilterChip>
      ))}
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition',
        active
          ? 'border-transparent bg-ink-900 text-white'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
      )}
    >
      {children}
    </button>
  )
}

export function LineBadge({
  line,
  selected,
  size = 'md',
  onClick,
}: {
  line: Line
  selected: boolean
  size?: 'sm' | 'md'
  onClick: () => void
}) {
  const dim = size === 'sm' ? 'h-11 w-11' : 'h-[52px] w-[52px]'
  const type = line.name.length > 4
    ? 'text-[9px] leading-none'
    : line.name.length > 2
      ? 'text-[11px] leading-none'
      : 'text-sm leading-none'

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`Línea ${line.name}, ${line.operatorName}`}
      title={`${line.name} · ${line.operatorName}`}
      className={cx(
        'grid shrink-0 place-items-center rounded-full font-semibold tracking-tight shadow-sm transition',
        dim,
        type,
        selected
          ? 'ring-[3px] ring-electric-500 ring-offset-2 ring-offset-white scale-[1.04]'
          : 'hover:scale-[1.05] hover:shadow-md',
      )}
      style={{ background: line.color, color: readableText(line.color) }}
    >
      {line.name}
    </button>
  )
}

export function LineBrowser({
  variant,
  layout = 'grid',
}: {
  variant: 'accordion' | 'navigate'
  layout?: 'grid' | 'rail'
}) {
  const lines = useTransitStore((state) => state.lines)
  const linesStatus = useTransitStore((state) => state.linesStatus)
  const linesError = useTransitStore((state) => state.linesError)
  const query = useTransitStore((state) => state.query)
  const operatorId = useTransitStore((state) => state.operatorId)
  const selectedLineKey = useTransitStore((state) => state.selectedLineKey)
  const selectLine = useTransitStore((state) => state.selectLine)
  const retryCatalog = useTransitStore((state) => state.retryCatalog)
  const filtered = useMemo(() => filterLines(lines, query, operatorId), [lines, query, operatorId])

  if (linesStatus === 'loading' || linesStatus === 'idle') {
    if (layout === 'rail') {
      return (
        <div className="flex flex-col items-center gap-2">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="h-11 w-11 animate-pulse rounded-full bg-slate-100" />
          ))}
        </div>
      )
    }
    return (
      <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-5">
        {Array.from({ length: 20 }, (_, index) => (
          <div key={index} className="aspect-square animate-pulse rounded-full bg-slate-100" />
        ))}
      </div>
    )
  }

  if (linesStatus === 'error') {
    return (
      <div className={cx('rounded-3xl bg-rose-50 px-4 py-4 text-sm text-rose-950', layout === 'rail' && 'mx-1')}>
        <p className="font-medium">No se pudieron cargar las líneas</p>
        {layout !== 'rail' ? <p className="mt-1 text-rose-900/80">{linesError}</p> : null}
        <button type="button" onClick={retryCatalog} className="mt-3 rounded-full bg-ink-900 px-3 py-1.5 text-xs font-medium text-white">
          Reintentar
        </button>
      </div>
    )
  }

  if (filtered.length === 0) {
    return (
      <div className="rounded-3xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
        Ninguna línea coincide con la búsqueda.
      </div>
    )
  }

  if (layout === 'rail') {
    return (
      <div className="flex flex-col items-center gap-2.5 py-1">
        {filtered.map((line) => (
          <LineBadge
            key={line.key}
            line={line}
            size="sm"
            selected={line.key === selectedLineKey}
            onClick={() => selectLine(line)}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-5">
        {filtered.map((line) => (
          <LineBadge
            key={line.key}
            line={line}
            selected={line.key === selectedLineKey}
            onClick={() => selectLine(line)}
          />
        ))}
      </div>
      {variant === 'accordion' && selectedLineKey ? (
        <div className="rounded-[24px] bg-slate-50/90 px-2.5 py-3">
          <RouteDetail />
        </div>
      ) : null}
    </div>
  )
}
