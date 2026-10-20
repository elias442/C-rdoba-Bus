import { ChevronLeft, Footprints, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { formatDuration, readableText } from '../lib/format'
import { haversineMeters } from '../lib/geo'
import { BUS_KMH, buildTripGuide, liveConnectionSeconds, stepIndexById, type GuideStep, type TripGuide } from '../lib/tripGuide'
import { useMediaQuery } from '../hooks/useViewport'
import { useTransitStore } from '../stores/useTransitStore'

export function TripNavigation({ mode }: { mode: 'preview' | 'live' }) {
  const guide = useGuide()
  const stepIndex = useTransitStore((state) => state.tripNavStep)
  const setTripNavStep = useTransitStore((state) => state.setTripNavStep)
  const startTripNavigation = useTransitStore((state) => state.startTripNavigation)
  const stopTripNavigation = useTransitStore((state) => state.stopTripNavigation)
  const user = useTransitStore((state) => state.userLocation)
  const destination = useTransitStore((state) => state.tripDestination)
  const mobile = useMediaQuery('(max-width: 860px)')
  const [stepsOpen, setStepsOpen] = useState(false)

  const step = guide?.steps[stepIndex]
  const arrived = Boolean(guide && stepIndex >= guide.steps.length)

  useEffect(() => {
    if (mode !== 'live' || !guide || !user || !step?.target || step.kind === 'board') return
    if (user.accuracy > 85) return
    const distance = haversineMeters(user.lon, user.lat, step.target.lon, step.target.lat)
    const limit = step.kind === 'walk' ? 55 : 90
    if (distance <= limit) setTripNavStep(stepIndex + 1)
  }, [mode, guide, step, stepIndex, user, setTripNavStep])

  if (!guide) return null

  const connection = liveConnectionSeconds(guide, step, user)
  const showConnection = guide.secondLineName !== null && (mode === 'preview' || (connection !== null && !arrived))

  if (mode === 'live' && arrived) {
    return (
      <div className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Recorrido</p>
        <h2 className="text-2xl font-semibold tracking-tight">Llegaste</h2>
        <p className="text-sm leading-5 text-slate-600">
          {destination?.label ? `Estás en ${destination.label}.` : 'Terminó la combinación.'}
        </p>
        <button type="button" onClick={stopTripNavigation} className="h-12 w-full rounded-2xl bg-ink-900 text-sm font-semibold text-white">
          Cerrar indicaciones
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {mode === 'live' ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Paso {Math.min(stepIndex + 1, guide.steps.length)} de {guide.steps.length}
          </p>
          <button type="button" onClick={stopTripNavigation} className="inline-flex items-center gap-1 rounded-xl px-2 py-1 text-xs font-medium text-slate-500">
            <X size={14} />
            Salir
          </button>
        </div>
      ) : null}

      {showConnection ? (
        <ConnectionBanner
          guide={guide}
          seconds={mode === 'live' ? connection : guide.connectionSeconds}
          compact={mode === 'live'}
        />
      ) : null}

      {mode === 'live' && step ? <CurrentStep step={step} /> : null}

      {mode === 'live' ? (
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <button
            type="button"
            onClick={() => setTripNavStep(Math.max(0, stepIndex - 1))}
            disabled={stepIndex <= 0}
            className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-ink-900 disabled:opacity-40"
            aria-label="Paso anterior"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            onClick={() => setTripNavStep(stepIndex + 1)}
            className="h-12 rounded-2xl bg-ink-900 text-sm font-semibold text-white"
          >
            {advanceLabel(step, stepIndex >= guide.steps.length - 1)}
          </button>
        </div>
      ) : null}

      {mode === 'live' && step ? <NextLine step={guide.steps[stepIndex + 1]} /> : null}

      {mode === 'preview' || stepsOpen || !mobile ? (
        <ol className="space-y-0">
          {guide.steps.map((item, index) => (
            <li key={item.id}>
              {item.id === 'board-2' && guide.connectionSeconds !== null ? (
                <p className="mb-2 ml-11 rounded-2xl bg-electric-50 px-3 py-2 text-xs leading-4 text-electric-600">
                  ~{formatDuration(guide.connectionSeconds)} desde el {guide.firstLineName} hasta el {guide.secondLineName}
                </p>
              ) : null}
              <StepRow
                step={item}
                active={mode === 'live' && index === stepIndex}
                onSelect={mode === 'live' ? () => setTripNavStep(index) : undefined}
              />
            </li>
          ))}
        </ol>
      ) : null}

      {mode === 'live' && mobile ? (
        <button type="button" onClick={() => setStepsOpen((open) => !open)} className="text-sm font-medium text-slate-500">
          {stepsOpen ? 'Ocultar pasos' : 'Ver todos los pasos'}
        </button>
      ) : null}

      {mode === 'preview' ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => startTripNavigation(stepIndexById(guide, 'ride-1'))}
            className="h-12 w-full rounded-2xl bg-ink-900 text-sm font-semibold text-white"
          >
            Iniciar recorrido
          </button>
          {guide.steps[0]?.id === 'walk-origin' ? (
            <button
              type="button"
              onClick={() => startTripNavigation(0)}
              className="h-11 w-full rounded-2xl bg-slate-100 text-sm font-medium text-ink-900"
            >
              Empezar caminando a la parada
            </button>
          ) : null}
          <p className="px-1 text-[11px] leading-4 text-slate-400">
            El plazo a bordo estima el recorrido a {BUS_KMH} km/h. La caminata es en línea recta. No es el horario de la empresa.
          </p>
        </div>
      ) : null}
    </div>
  )
}

function useGuide(): TripGuide | null {
  const options = useTransitStore((state) => state.tripOptions)
  const selectedId = useTransitStore((state) => state.tripSelectedId)
  const origin = useTransitStore((state) => state.tripOrigin)
  const destination = useTransitStore((state) => state.tripDestination)
  const trace = useTransitStore((state) => state.trace)
  const transferTrace = useTransitStore((state) => state.transferTrace)
  const vehicles = useTransitStore((state) => state.vehicles)
  const trip = options.find((option) => option.id === selectedId) ?? null

  return useMemo(() => {
    if (!trip) return null
    return buildTripGuide({
      trip,
      origin,
      destination,
      firstTrace: trace,
      secondTrace: transferTrace,
      vehicles,
    })
  }, [trip, origin, destination, trace, transferTrace, vehicles])
}

function ConnectionBanner({
  guide,
  seconds,
  compact,
}: {
  guide: TripGuide
  seconds: number | null
  compact: boolean
}) {
  if (compact) {
    return (
      <div className="rounded-2xl bg-ink-900 px-3 py-2.5 text-white">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">Hasta el {guide.secondLineName}</p>
          <p className="text-xl font-semibold leading-none tracking-tight">{seconds === null ? '…' : `~${formatDuration(seconds)}`}</p>
        </div>
        <p className="mt-1 text-xs leading-4 text-white/70">
          {guide.connectionSeconds !== null && seconds !== null && seconds + 90 < guide.connectionSeconds
            ? 'Te falta para tomarlo'
            : `Desde que tomás el ${guide.firstLineName}`}
        </p>
      </div>
    )
  }
  return (
    <div className="rounded-3xl bg-ink-900 px-4 py-3 text-white">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">
        Hasta el {guide.secondLineName}
      </p>
      <p className="mt-1 text-[1.7rem] font-semibold leading-none tracking-tight">
        {seconds === null ? '…' : `~${formatDuration(seconds)}`}
      </p>
      <p className="mt-2 text-sm leading-5 text-white/80">
        Desde que tomás el {guide.firstLineName} hasta que tomás el {guide.secondLineName}.
      </p>
      {guide.connectionDetail ? <p className="mt-1 text-xs leading-4 text-white/55">{guide.connectionDetail}</p> : null}
    </div>
  )
}

function CurrentStep({ step }: { step: GuideStep }) {
  return (
    <div className="rounded-3xl bg-white px-1 py-1" aria-live="polite">
      <div className="flex items-start gap-3">
        <StepMark step={step} large />
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 className="text-[1.35rem] font-semibold leading-6 tracking-tight text-ink-900">{step.title}</h2>
          <p className="mt-1 text-sm leading-5 text-slate-600">{step.subtitle}</p>
        </div>
      </div>
    </div>
  )
}

function NextLine({ step }: { step: GuideStep | undefined }) {
  if (!step) return null
  return <p className="text-sm text-slate-500">Después: {step.title}</p>
}

function StepRow({ step, active, onSelect }: { step: GuideStep; active: boolean; onSelect?: () => void }) {
  const body = (
    <>
      <StepMark step={step} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink-900">{step.title}</span>
        <span className="mt-0.5 block text-xs leading-4 text-slate-500">{step.subtitle}</span>
      </span>
      {step.minutes !== null ? <span className="shrink-0 text-xs font-medium text-slate-500">{step.minutes} min</span> : null}
    </>
  )
  const className = `flex w-full items-start gap-3 border-l-2 py-2 pl-3 text-left ${active ? 'border-electric-500' : 'border-slate-200'}`
  if (!onSelect) return <div className={className}>{body}</div>
  return <button type="button" onClick={onSelect} className={className}>{body}</button>
}

function StepMark({ step, large = false }: { step: GuideStep; large?: boolean }) {
  const size = large ? 'h-12 min-w-12 rounded-2xl text-base' : 'h-9 min-w-9 rounded-xl text-xs'
  if (step.kind === 'walk') {
    return (
      <span className={`grid ${size} place-items-center bg-slate-100 text-ink-900`}>
        <Footprints size={large ? 18 : 14} />
      </span>
    )
  }
  return (
    <span
      className={`grid ${size} place-items-center px-2 font-semibold`}
      style={{ background: step.color ?? '#10203a', color: readableText(step.color ?? '#10203a') }}
    >
      {step.lineName}
    </span>
  )
}

function advanceLabel(step: GuideStep | undefined, isLast: boolean): string {
  if (isLast) return 'Llegué'
  if (step?.kind === 'board') return 'Ya subí'
  if (step?.kind === 'ride') return 'Ya bajé'
  return 'Siguiente'
}
