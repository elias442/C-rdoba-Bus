import { MapPin } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useStopBoard } from '../hooks/useStopBoard'
import { cx, readableText, reduceMotion } from '../lib/format'
import { useTransitStore } from '../stores/useTransitStore'

export function StopBoard() {
  const stop = useTransitStore((state) => state.selectedStop)
  const model = useStopBoard(stop)
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!stop) return
    ref.current?.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' })
  }, [stop])

  if (!stop || !model) return null

  const addressText = model.addressStatus === 'loading'
    ? 'Buscando dirección…'
    : model.addressStatus === 'ready' && model.address
      ? model.address
      : 'Dirección aproximada no disponible'

  return (
    <section
      ref={ref}
      data-stop-board
      data-stop-code={stop.code}
      data-stop-name={stop.name}
      data-address-status={model.addressStatus}
      data-line-count={model.count}
      className="rounded-3xl bg-ink-900 px-4 py-3 text-white"
      aria-label={`Parada ${stop.name}`}
    >
      <p className="text-[11px] uppercase tracking-[0.14em] text-white/55">
        Parada {stop.shortLabel ?? stop.order}
      </p>
      <h3 className="mt-1 text-sm font-medium">{stop.name}</h3>
      <p className="mt-1 text-xs text-white/55">{stop.code} · {stop.directionLabel}</p>
      <p className="mt-2 flex items-start gap-1.5 text-xs leading-4 text-white/75" data-address-text={addressText}>
        <MapPin size={13} className="mt-0.5 shrink-0 text-white/50" aria-hidden />
        <span>{addressText}</span>
      </p>

      <div className="mt-3 flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold" aria-live="polite">{model.countLabel}</p>
        {model.searchNote ? <p className="text-[11px] text-white/50">{model.searchNote}</p> : null}
      </div>

      {model.lines.length > 0 ? (
        <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto overscroll-contain thin-scroll">
          {model.lines.map((line) => (
            <li key={line.key}>
              <button
                type="button"
                onClick={() => model.openLine(line.lineKey, line.routeId)}
                data-line-row={line.lineName}
                data-eta={line.eta.text}
                className={cx(
                  'flex w-full items-center gap-2.5 rounded-2xl px-2 py-2 text-left',
                  line.selected ? 'bg-white/20' : 'bg-white/10 hover:bg-white/20',
                )}
                aria-label={`Línea ${line.lineName}, ${line.directionLabel}, ${line.eta.text}`}
              >
                <span
                  className="grid h-9 min-w-9 shrink-0 place-items-center rounded-xl px-2 text-xs font-semibold"
                  style={{ background: line.color, color: readableText(line.color) }}
                >
                  {line.lineName}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium leading-4">{line.directionLabel}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-white/55">{line.routeName}</span>
                </span>
                <span className={cx(
                  'shrink-0 text-right text-[12px] leading-4',
                  line.eta.live ? 'font-semibold text-white' : 'text-white/70',
                )}
                >
                  {line.eta.text}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
