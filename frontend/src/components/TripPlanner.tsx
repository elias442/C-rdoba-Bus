import { ArrowRightLeft, Footprints, LoaderCircle, MapPin, Navigation, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ApiError, fetchPlaces, isAbort } from '../services/api'
import { useConnectionEstimates } from '../hooks/useConnectionEstimates'
import { cx, formatDuration, readableText } from '../lib/format'
import { TripNavigation } from './TripNavigation'
import { useTransitStore } from '../stores/useTransitStore'
import type { PlaceSuggestion, TripOption, TripPoint } from '../types'

const WALK_OPTIONS = [200, 300, 400, 500, 700, 1000]

export function TripPlanner() {
  const origin = useTransitStore((state) => state.tripOrigin)
  const destination = useTransitStore((state) => state.tripDestination)
  const pinTarget = useTransitStore((state) => state.tripPinTarget)
  const maxWalk = useTransitStore((state) => state.tripMaxWalk)
  const includeDirect = useTransitStore((state) => state.tripIncludeDirect)
  const includeTransfer = useTransitStore((state) => state.tripIncludeTransfer)
  const tripStatus = useTransitStore((state) => state.tripStatus)
  const tripRefreshing = useTransitStore((state) => state.tripRefreshing)
  const tripError = useTransitStore((state) => state.tripError)
  const options = useTransitStore((state) => state.tripOptions)
  const selectedId = useTransitStore((state) => state.tripSelectedId)
  const setTripOrigin = useTransitStore((state) => state.setTripOrigin)
  const setTripDestination = useTransitStore((state) => state.setTripDestination)
  const setTripPinTarget = useTransitStore((state) => state.setTripPinTarget)
  const setTripMaxWalk = useTransitStore((state) => state.setTripMaxWalk)
  const setTripIncludeDirect = useTransitStore((state) => state.setTripIncludeDirect)
  const setTripIncludeTransfer = useTransitStore((state) => state.setTripIncludeTransfer)
  const requestTripSearch = useTransitStore((state) => state.requestTripSearch)
  const selectTripOption = useTransitStore((state) => state.selectTripOption)
  const clearTripSelection = useTransitStore((state) => state.clearTripSelection)
  const estimates = useConnectionEstimates(tripRefreshing ? [] : options)
  const selected = options.find((option) => option.id === selectedId) ?? null
  const cappedIds = new Set(options.filter((option) => option.kind === 'transfer').slice(0, 6).map((option) => option.id))

  const canSearch = Boolean(origin && destination && (includeDirect || includeTransfer))

  if (selected) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-3xl bg-slate-50 px-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink-900">{origin?.label ?? 'Origen'}</p>
            <p className="truncate text-sm text-slate-500">{destination?.label ?? 'Destino'}</p>
          </div>
          <button type="button" onClick={clearTripSelection} className="shrink-0 rounded-xl px-2 py-1 text-xs font-medium text-slate-500">
            Cambiar
          </button>
        </div>
        <TripNavigation mode="preview" />
        {options.length > 1 ? (
          <details className="rounded-3xl bg-slate-50 px-3 py-2">
            <summary className="cursor-pointer py-1 text-sm font-medium text-ink-900">Otras opciones</summary>
            <div className="space-y-2 pb-1 pt-2">
              {options.filter((option) => option.id !== selected.id).map((option) => (
                <TripOptionCard
                  key={option.id}
                  option={option}
                  selected={false}
                  connection={connectionText(option, estimates, cappedIds)}
                  onSelect={() => selectTripOption(option)}
                />
              ))}
            </div>
          </details>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <PlaceField
        label="Origen"
        tone="A"
        point={origin}
        active={pinTarget === 'origin'}
        onPickMap={() => setTripPinTarget(pinTarget === 'origin' ? null : 'origin')}
        onClear={() => setTripOrigin(null)}
        onSelect={(point) => setTripOrigin(point)}
        onLocate={(point) => setTripOrigin(point)}
      />
      <PlaceField
        label="Destino"
        tone="B"
        point={destination}
        active={pinTarget === 'destination'}
        onPickMap={() => setTripPinTarget(pinTarget === 'destination' ? null : 'destination')}
        onClear={() => setTripDestination(null)}
        onSelect={(point) => setTripDestination(point)}
        onLocate={(point) => setTripDestination(point)}
      />

      {pinTarget ? (
        <p className="rounded-2xl bg-electric-50 px-3 py-2 text-xs text-electric-600">
          Tocá el mapa para marcar el {pinTarget === 'origin' ? 'origen' : 'destino'}.
        </p>
      ) : null}

      <div className="rounded-3xl bg-slate-50 px-3 py-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-500">
          <Footprints size={14} />
          Caminata máxima
        </div>
        <div className="flex flex-wrap gap-1.5">
          {WALK_OPTIONS.map((meters) => (
            <button
              key={meters}
              type="button"
              onClick={() => setTripMaxWalk(meters)}
              className={cx(
                'rounded-full px-2.5 py-1 text-xs font-medium transition',
                maxWalk === meters ? 'bg-ink-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100',
              )}
            >
              {meters} m
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <FilterToggle active={includeDirect} onClick={() => setTripIncludeDirect(!includeDirect)} label="Directos" />
        <FilterToggle active={includeTransfer} onClick={() => setTripIncludeTransfer(!includeTransfer)} label="Combinaciones" />
      </div>

      <button
        type="button"
        disabled={!canSearch || tripStatus === 'loading'}
        onClick={() => requestTripSearch()}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-ink-900 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
      >
        {tripStatus === 'loading' ? <LoaderCircle size={16} className="animate-spin" /> : <Search size={16} />}
        {tripStatus === 'loading' ? 'Buscando…' : 'Buscar viaje'}
      </button>

      {tripStatus === 'error' ? (
        <div className="rounded-2xl bg-rose-50 px-3 py-3 text-sm text-rose-950">
          <p className="font-medium">No se pudo buscar</p>
          <p className="mt-1 text-rose-900/80">{tripError}</p>
        </div>
      ) : null}

      {tripStatus === 'empty' ? (
        <div className="rounded-2xl bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
          No hay opciones con esos filtros. Probá subir los metros a pie o incluir combinaciones.
        </div>
      ) : null}

      {options.length > 0 ? (
        <div className="space-y-2">
          <p className="px-1 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
            {options.length} opciones · hasta {maxWalk} m a pie
            {tripRefreshing ? ' · sumando más' : ''}
          </p>
          {options.map((option) => (
            <TripOptionCard
              key={option.id}
              option={option}
              selected={option.id === selectedId}
              connection={connectionText(option, estimates, cappedIds)}
              onSelect={() => selectTripOption(option)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function FilterToggle({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'flex-1 rounded-2xl border px-3 py-2.5 text-sm font-medium transition',
        active ? 'border-electric-500 bg-white text-ink-900 shadow-sm' : 'border-transparent bg-slate-50 text-slate-500',
      )}
    >
      {label}
    </button>
  )
}

function PlaceField({
  label,
  tone,
  point,
  active,
  onPickMap,
  onClear,
  onSelect,
  onLocate,
}: {
  label: string
  tone: 'A' | 'B'
  point: TripPoint | null
  active: boolean
  onPickMap: () => void
  onClear: () => void
  onSelect: (point: TripPoint) => void
  onLocate: (point: TripPoint) => void
}) {
  const [query, setQuery] = useState(point?.label ?? '')
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setQuery(point?.label ?? '')
  }, [point?.label])

  useEffect(() => {
    if (query.trim().length < 3) {
      setSuggestions([])
      return
    }
    if (point && query.trim() === point.label) {
      setSuggestions([])
      return
    }
    const abort = new AbortController()
    const timer = window.setTimeout(() => {
      setSearching(true)
      fetchPlaces(query.trim(), abort.signal)
        .then((places) => {
          if (!abort.signal.aborted) {
            setSuggestions(places)
            setOpen(true)
          }
        })
        .catch((error: unknown) => {
          if (isAbort(error) || (error instanceof ApiError && error.code === 'network')) return
          setSuggestions([])
        })
        .finally(() => {
          if (!abort.signal.aborted) setSearching(false)
        })
    }, 160)
    return () => {
      window.clearTimeout(timer)
      abort.abort()
    }
  }, [query, point])

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div ref={boxRef} className="relative">
      <div className={cx('rounded-3xl border bg-white px-3 py-2.5 transition', active ? 'border-electric-500 shadow-sm' : 'border-slate-200')}>
        <div className="mb-1.5 flex items-center gap-2">
          <span className={cx(
            'grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold text-white',
            tone === 'A' ? 'bg-emerald-500' : 'bg-rose-500',
          )}
          >
            {tone}
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</span>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                if (!navigator.geolocation) return
                navigator.geolocation.getCurrentPosition((position) => {
                  onLocate({
                    lat: position.coords.latitude,
                    lon: position.coords.longitude,
                    label: 'Mi ubicación',
                  })
                })
              }}
              className="grid h-8 w-8 place-items-center rounded-xl text-slate-400 hover:bg-slate-50 hover:text-ink-900"
              title="Usar mi ubicación"
              aria-label={`Usar mi ubicación como ${label.toLowerCase()}`}
            >
              <Navigation size={14} />
            </button>
            <button
              type="button"
              onClick={onPickMap}
              className={cx(
                'grid h-8 w-8 place-items-center rounded-xl hover:bg-slate-50',
                active ? 'text-electric-600' : 'text-slate-400 hover:text-ink-900',
              )}
              title="Elegir en el mapa"
              aria-label={`Elegir ${label.toLowerCase()} en el mapa`}
              aria-pressed={active}
            >
              <MapPin size={14} />
            </button>
            {point ? (
              <button
                type="button"
                onClick={onClear}
                className="grid h-8 w-8 place-items-center rounded-xl text-slate-400 hover:bg-slate-50"
                aria-label={`Borrar ${label.toLowerCase()}`}
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder={tone === 'A' ? 'Dirección o punto de partida' : 'Dirección o destino'}
          className="w-full bg-transparent text-sm text-ink-900 outline-none placeholder:text-slate-400"
        />
        {searching ? <p className="mt-1 text-[11px] text-slate-400">Buscando…</p> : null}
      </div>
      {open && suggestions.length > 0 ? (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-panel">
          {suggestions.map((place) => (
            <button
              key={place.id}
              type="button"
              disabled={place.lat === null || place.lon === null}
              onClick={() => {
                if (place.lat === null || place.lon === null) return
                onSelect({ lat: place.lat, lon: place.lon, label: place.label })
                setOpen(false)
                setSuggestions([])
              }}
              className="block w-full border-b border-slate-100 px-3 py-2.5 text-left text-sm last:border-0 hover:bg-slate-50 disabled:opacity-40"
            >
              {place.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function connectionText(
  option: TripOption,
  estimates: Record<string, number | null>,
  cappedIds: Set<string>,
): string | null {
  if (option.kind !== 'transfer' || !cappedIds.has(option.id)) return null
  if (!(option.id in estimates)) return 'Calculando el plazo hasta el segundo colectivo…'
  const seconds = estimates[option.id]
  const first = option.legs[0]?.lineName
  const second = option.legs[1]?.lineName
  if (seconds === null || seconds === undefined || !first || !second) return 'Sin plazo estimado para esta combinación'
  return `~${formatDuration(seconds)} desde el ${first} hasta el ${second}`
}

function TripOptionCard({
  option,
  selected,
  connection,
  onSelect,
}: {
  option: TripOption
  selected: boolean
  connection: string | null
  onSelect: () => void
}) {
  const first = option.legs[0]
  const second = option.legs[1]
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cx(
        'w-full rounded-3xl border px-3 py-3 text-left transition',
        selected ? 'border-electric-500 bg-white shadow-sm' : 'border-transparent bg-slate-50 hover:bg-white',
      )}
    >
      <div className="flex items-center gap-2">
        {option.legs.map((leg, index) => (
          <span key={`${leg.clientId}:${leg.lineId}:${index}`} className="contents">
            {index > 0 ? <ArrowRightLeft size={14} className="text-slate-400" /> : null}
            <span
              className="grid h-9 min-w-9 place-items-center rounded-full px-2 text-xs font-semibold"
              style={{ background: leg.color, color: readableText(leg.color) }}
            >
              {leg.lineName}
            </span>
          </span>
        ))}
        <span className="ml-auto text-right">
          <span className="block text-sm font-semibold text-ink-900">
            {option.distanceLabel ?? (option.kind === 'direct' ? 'Directo' : 'Combinación')}
          </span>
          <span className="block text-[11px] text-slate-500">
            {option.etaLabel ? `Próximo ${option.etaLabel}` : option.kind === 'direct' ? 'Directo' : 'Con trasbordo'}
          </span>
        </span>
      </div>
      {connection ? (
        <p className="mt-2 text-xs font-semibold leading-4 text-ink-900">{connection}</p>
      ) : null}
      {option.kind === 'transfer' && first && second ? (
        <ol className="mt-2 space-y-1 text-[11px] leading-4 text-slate-600">
          <li>
            <span className="font-medium text-ink-900">{first.lineName}</span>
            {' · subí '}
            {option.boardStopCode ?? 'cerca del origen'}
            {' → bajá '}
            {option.transferStopCode ?? 'en el trasbordo'}
          </li>
          <li>
            <span className="font-medium text-ink-900">{second.lineName}</span>
            {' · subí '}
            {option.transferBoardStopCode ?? option.transferStopCode ?? 'trasbordo'}
            {' → bajá '}
            {option.alightStopCode ?? 'cerca del destino'}
          </li>
        </ol>
      ) : (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
          <span>Directo</span>
          {option.boardStopCode ? <span>Subí {option.boardStopCode}</span> : null}
          {option.alightStopCode ? <span>Bajá {option.alightStopCode}</span> : null}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
        {option.walkMeters !== null ? <span>{option.walkMeters} m a pie</span> : null}
        {first?.directionLabel ? (
          <span>
            {option.legs.map((leg) => leg.directionLabel).filter(Boolean).join(' → ')}
          </span>
        ) : null}
      </div>
    </button>
  )
}
