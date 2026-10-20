import { create } from 'zustand'
import type {
  CatalogResponse,
  Line,
  LinesStatus,
  MapStyleName,
  PanelMode,
  SheetSnap,
  Stop,
  TraceResponse,
  TraceStatus,
  TrackedVehicle,
  TripOption,
  TripPinTarget,
  TripPoint,
  TripStatus,
  VehicleStatus,
  VehiclesResponse,
} from '../types'
import { resolveLegRoute } from '../lib/tripGuide'
import { peekTrace, rememberTrace } from '../lib/traceCache'
import { combineVehicleAvailability, mergeVehicleSnapshots } from '../lib/vehicles'

interface SelectionPatch {
  selectedLineKey: string
  selectedClientId: number
  selectedRouteId: string | null
  selectedVehicleId: null
  selectedStop: null
  trace: null
  traceStatus: TraceStatus
  traceError: null
  vehicles: TrackedVehicle[]
  vehicleStatus: VehicleStatus
  vehicleError: null
  vehicleNotice: null
  vehicleFetchedAt: null
  vehicleCached: false
  vehicleRefreshing: false
}

function selectionFor(line: Line, routeId: string | null): SelectionPatch {
  const route = line.routes.find((item) => item.id === routeId)
    ?? line.routes.find((item) => item.direction === 'I')
    ?? line.routes[0]
    ?? null
  return {
    selectedLineKey: line.key,
    selectedClientId: line.clientId,
    selectedRouteId: route?.id ?? null,
    selectedVehicleId: null,
    selectedStop: null,
    trace: null,
    traceStatus: route ? 'loading' : 'empty',
    traceError: null,
    vehicles: [],
    vehicleStatus: route ? 'loading' : 'idle',
    vehicleError: null,
    vehicleNotice: null,
    vehicleFetchedAt: null,
    vehicleCached: false,
    vehicleRefreshing: false,
  }
}

interface TransitState {
  lines: Line[]
  operators: CatalogResponse['operators']
  linesStatus: LinesStatus
  linesError: string | null
  catalogNonce: number
  query: string
  operatorId: number | null
  selectedLineKey: string | null
  selectedClientId: number | null
  selectedRouteId: string | null
  trace: TraceResponse | null
  traceStatus: TraceStatus
  traceError: string | null
  traceNonce: number
  vehicles: TrackedVehicle[]
  vehicleStatus: VehicleStatus
  vehicleError: string | null
  vehicleNotice: string | null
  vehicleFetchedAt: string | null
  vehicleCached: boolean
  vehicleRefreshing: boolean
  vehicleNonce: number
  selectedVehicleId: string | null
  vehicleFocusNonce: number
  selectedStop: Stop | null
  stopFocusNonce: number
  sidebarCollapsed: boolean
  mapStyle: MapStyleName
  sheetSnap: SheetSnap
  sheetView: 'list' | 'detail'
  panelMode: PanelMode
  tripOrigin: TripPoint | null
  tripDestination: TripPoint | null
  tripPinTarget: TripPinTarget
  tripMaxWalk: number
  tripIncludeDirect: boolean
  tripIncludeTransfer: boolean
  tripStatus: TripStatus
  tripError: string | null
  tripCatalog: TripOption[]
  tripOptions: TripOption[]
  tripRefreshing: boolean
  tripSelectedId: string | null
  tripNonce: number
  tripNavigating: boolean
  tripNavStep: number
  userLocation: { lat: number; lon: number; accuracy: number } | null
  /** Segunda pierna de una combinación (trazado aparte del recorrido seleccionado). */
  transferClientId: number | null
  transferRouteId: string | null
  transferTrace: TraceResponse | null
  transferTraceStatus: TraceStatus
  setQuery: (query: string) => void
  setOperatorId: (operatorId: number | null) => void
  selectLine: (line: Line) => void
  selectRoute: (routeId: string) => void
  clearSelection: () => void
  focusVehicle: (id: string) => void
  clearVehicle: () => void
  focusStop: (stop: Stop) => void
  selectStopFromMap: (stop: Stop) => void
  focusLineAtStop: (line: Line, routeId: string) => void
  clearMapSelection: () => void
  toggleSidebar: () => void
  toggleMapStyle: () => void
  setSheetSnap: (snap: SheetSnap) => void
  setSheetView: (view: 'list' | 'detail') => void
  retryCatalog: () => void
  retryTrace: () => void
  retryVehicles: () => void
  hydrateCatalog: (catalog: CatalogResponse) => void
  setLinesError: (message: string) => void
  setLinesLoading: () => void
  setTrace: (trace: TraceResponse) => void
  setTraceError: (message: string) => void
  setTraceLoading: () => void
  applyVehicleSnapshot: (snapshot: VehiclesResponse | VehiclesResponse[]) => void
  setVehicleError: (message: string) => void
  setVehicleRefreshing: (refreshing: boolean) => void
  setPanelMode: (mode: PanelMode) => void
  setTripOrigin: (point: TripPoint | null) => void
  setTripDestination: (point: TripPoint | null) => void
  setTripPinTarget: (target: TripPinTarget) => void
  setTripMaxWalk: (meters: number) => void
  setTripIncludeDirect: (value: boolean) => void
  setTripIncludeTransfer: (value: boolean) => void
  setTripLoading: () => void
  setTripResults: (options: TripOption[], refreshing?: boolean) => void
  setTripError: (message: string) => void
  selectTripOption: (option: TripOption) => void
  clearTripSelection: () => void
  requestTripSearch: () => void
  placeTripPin: (point: TripPoint) => void
  startTripNavigation: (step?: number) => void
  stopTripNavigation: () => void
  setTripNavStep: (step: number) => void
  setUserLocation: (point: { lat: number; lon: number; accuracy: number } | null) => void
  setTransferTrace: (trace: TraceResponse | null) => void
  setTransferTraceLoading: () => void
  clearTransferLeg: () => void
}

function openStopPanel(state: { sheetSnap: SheetSnap; tripNavigating: boolean; panelMode: PanelMode }) {
  return {
    sidebarCollapsed: false,
    sheetView: 'detail' as const,
    sheetSnap: state.sheetSnap === 'peek' ? 'half' as const : state.sheetSnap,
    panelMode: state.tripNavigating ? state.panelMode : 'lines' as const,
  }
}

function heldTrace(current: TraceResponse | null, clientId: number, routeId: string): TraceResponse | null {
  if (current && current.clientId === clientId && current.routeId === routeId && current.coordinates.length >= 2) {
    return current
  }
  return peekTrace(clientId, routeId)
}

function filterTripCatalog(
  options: TripOption[],
  maxWalk: number,
  includeDirect: boolean,
  includeTransfer: boolean,
): TripOption[] {
  return options.filter((option) => {
    if (option.kind === 'direct' && !includeDirect) return false
    if (option.kind === 'transfer' && !includeTransfer) return false
    if (option.walkMeters !== null && option.walkMeters > maxWalk) return false
    return true
  })
}

function tripView(
  catalog: TripOption[],
  maxWalk: number,
  includeDirect: boolean,
  includeTransfer: boolean,
  refreshing: boolean,
  previousStatus: TripStatus,
): { tripOptions: TripOption[]; tripStatus: TripStatus } {
  const tripOptions = filterTripCatalog(catalog, maxWalk, includeDirect, includeTransfer)
  if (tripOptions.length > 0) return { tripOptions, tripStatus: 'ready' }
  if (catalog.length === 0 && (previousStatus === 'idle' || previousStatus === 'loading' || previousStatus === 'error')) {
    return { tripOptions, tripStatus: previousStatus }
  }
  if (refreshing) return { tripOptions, tripStatus: 'loading' }
  return { tripOptions, tripStatus: 'empty' }
}

function clearTransferPatch() {
  return {
    transferClientId: null as number | null,
    transferRouteId: null as string | null,
    transferTrace: null as TraceResponse | null,
    transferTraceStatus: 'idle' as TraceStatus,
    tripNavigating: false,
    tripNavStep: 0,
  }
}

export const useTransitStore = create<TransitState>((set) => ({
  lines: [],
  operators: [],
  linesStatus: 'idle',
  linesError: null,
  catalogNonce: 0,
  query: '',
  operatorId: null,
  selectedLineKey: null,
  selectedClientId: null,
  selectedRouteId: null,
  trace: null,
  traceStatus: 'idle',
  traceError: null,
  traceNonce: 0,
  vehicles: [],
  vehicleStatus: 'idle',
  vehicleError: null,
  vehicleNotice: null,
  vehicleFetchedAt: null,
  vehicleCached: false,
  vehicleRefreshing: false,
  vehicleNonce: 0,
  selectedVehicleId: null,
  vehicleFocusNonce: 0,
  selectedStop: null,
  stopFocusNonce: 0,
  sidebarCollapsed: false,
  mapStyle: 'light',
  sheetSnap: 'half',
  sheetView: 'list',
  panelMode: 'lines',
  tripOrigin: null,
  tripDestination: null,
  tripPinTarget: null,
  tripMaxWalk: 500,
  tripIncludeDirect: true,
  tripIncludeTransfer: true,
  tripStatus: 'idle',
  tripError: null,
  tripCatalog: [],
  tripOptions: [],
  tripRefreshing: false,
  tripSelectedId: null,
  tripNonce: 0,
  tripNavigating: false,
  tripNavStep: 0,
  userLocation: null,
  transferClientId: null,
  transferRouteId: null,
  transferTrace: null,
  transferTraceStatus: 'idle',
  setQuery: (query) => set({ query }),
  setOperatorId: (operatorId) => set({ operatorId }),
  selectLine: (line) => set((state) => {
    if (state.selectedLineKey === line.key) {
      return {
        sheetView: 'detail',
        sheetSnap: state.sheetSnap === 'peek' ? 'half' : state.sheetSnap,
        sidebarCollapsed: false,
      }
    }
    return {
      ...selectionFor(line, null),
      ...clearTransferPatch(),
      tripSelectedId: null,
      sheetView: 'detail',
      sheetSnap: 'half',
      sidebarCollapsed: false,
    }
  }),
  selectRoute: (routeId) => set((state) => {
    const line = state.lines.find((item) => item.key === state.selectedLineKey)
    if (!line || !line.routes.some((route) => route.id === routeId)) return { selectedRouteId: routeId }
    return { ...selectionFor(line, routeId), ...clearTransferPatch(), tripSelectedId: null }
  }),
  clearSelection: () => set({
    selectedLineKey: null,
    selectedClientId: null,
    selectedRouteId: null,
    selectedVehicleId: null,
    selectedStop: null,
    trace: null,
    traceStatus: 'idle',
    traceError: null,
    vehicles: [],
    vehicleStatus: 'idle',
    vehicleError: null,
    vehicleNotice: null,
    vehicleFetchedAt: null,
    sheetView: 'list',
    ...clearTransferPatch(),
    tripSelectedId: null,
  }),
  focusVehicle: (id) => set((state) => ({
    selectedVehicleId: id,
    vehicleFocusNonce: state.vehicleFocusNonce + 1,
    sheetView: 'detail',
  })),
  clearVehicle: () => set({ selectedVehicleId: null }),
  focusStop: (stop) => set((state) => ({
    selectedStop: stop,
    stopFocusNonce: state.stopFocusNonce + 1,
    ...openStopPanel(state),
  })),
  selectStopFromMap: (stop) => set((state) => ({
    selectedStop: stop,
    ...openStopPanel(state),
  })),
  focusLineAtStop: (line, routeId) => set((state) => {
    const panel = openStopPanel(state)
    if (!line.routes.some((route) => route.id === routeId)) return panel
    if (state.selectedLineKey === line.key && state.selectedRouteId === routeId) return panel
    const cached = heldTrace(state.trace, line.clientId, routeId)
    return {
      ...selectionFor(line, routeId),
      selectedStop: state.selectedStop,
      trace: cached,
      traceStatus: cached ? 'ready' : 'loading',
      traceError: null,
      ...clearTransferPatch(),
      tripSelectedId: null,
      ...panel,
    }
  }),
  clearMapSelection: () => set({ selectedVehicleId: null, selectedStop: null }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  toggleMapStyle: () => set((state) => ({ mapStyle: state.mapStyle === 'light' ? 'dark' : 'light' })),
  setSheetSnap: (sheetSnap) => set({ sheetSnap }),
  setSheetView: (sheetView) => set({ sheetView }),
  retryCatalog: () => set((state) => ({ catalogNonce: state.catalogNonce + 1, linesStatus: 'loading', linesError: null })),
  retryTrace: () => set((state) => ({ traceNonce: state.traceNonce + 1, traceStatus: 'loading', traceError: null })),
  retryVehicles: () => set((state) => ({ vehicleNonce: state.vehicleNonce + 1 })),
  hydrateCatalog: (catalog) => set((state) => {
    const next = {
      lines: catalog.lines,
      operators: catalog.operators,
      linesStatus: 'ready' as const,
      linesError: null,
    }
    if (state.selectedLineKey) return next
    const match = window.location.hash.match(/^#\/(\d+)\/(\d+)$/)
    if (!match) return next
    const clientId = Number(match[1])
    const routeId = match[2] ?? ''
    const line = catalog.lines.find((item) => item.clientId === clientId && item.routes.some((route) => route.id === routeId))
    if (!line) return next
    return { ...next, ...selectionFor(line, routeId), sheetView: 'detail' as const }
  }),
  setLinesError: (linesError) => set({ linesStatus: 'error', linesError }),
  setLinesLoading: () => set({ linesStatus: 'loading', linesError: null }),
  setTrace: (trace) => set((state) => {
    const stored = rememberTrace(trace)
    if (state.selectedClientId !== stored.clientId || state.selectedRouteId !== stored.routeId) return state
    return {
      trace: stored,
      traceStatus: stored.coordinates.length >= 2 ? 'ready' : 'empty',
      traceError: null,
    }
  }),
  setTraceError: (traceError) => set({ traceStatus: 'error', traceError, trace: null }),
  setTraceLoading: () => set({ traceStatus: 'loading', traceError: null }),
  applyVehicleSnapshot: (snapshot) => set((state) => {
    const snapshots = Array.isArray(snapshot) ? snapshot : [snapshot]
    const latest = snapshots[snapshots.length - 1]
    return {
      vehicles: mergeVehicleSnapshots(state.vehicles, snapshots),
      vehicleStatus: combineVehicleAvailability(snapshots),
      vehicleError: null,
      vehicleNotice: snapshots.map((item) => item.notice).find(Boolean) ?? null,
      vehicleFetchedAt: latest?.fetchedAt ?? null,
      vehicleCached: snapshots.every((item) => item.cached),
      vehicleRefreshing: false,
    }
  }),
  setVehicleError: (vehicleError) => set({
    vehicleStatus: 'error',
    vehicleError,
    vehicleRefreshing: false,
  }),
  setVehicleRefreshing: (vehicleRefreshing) => set({ vehicleRefreshing }),
  setPanelMode: (panelMode) => set((state) => ({
    panelMode,
    tripPinTarget: panelMode === 'trip' ? state.tripPinTarget : null,
    sidebarCollapsed: false,
    sheetView: panelMode === 'trip' ? 'list' : state.sheetView,
  })),
  setTripOrigin: (tripOrigin) => set((state) => ({
    tripOrigin,
    tripStatus: 'idle' as const,
    tripCatalog: [],
    tripOptions: [],
    tripRefreshing: false,
    tripSelectedId: null,
    tripError: null,
    ...clearTransferPatch(),
    tripNonce: tripOrigin && state.tripDestination ? state.tripNonce + 1 : state.tripNonce,
  })),
  setTripDestination: (tripDestination) => set((state) => ({
    tripDestination,
    tripStatus: 'idle' as const,
    tripCatalog: [],
    tripOptions: [],
    tripRefreshing: false,
    tripSelectedId: null,
    tripError: null,
    ...clearTransferPatch(),
    tripNonce: state.tripOrigin && tripDestination ? state.tripNonce + 1 : state.tripNonce,
  })),
  setTripPinTarget: (tripPinTarget) => set({ tripPinTarget, panelMode: 'trip', sidebarCollapsed: false }),
  setTripMaxWalk: (tripMaxWalk) => set((state) => ({
    tripMaxWalk,
    ...tripView(state.tripCatalog, tripMaxWalk, state.tripIncludeDirect, state.tripIncludeTransfer, state.tripRefreshing, state.tripStatus),
  })),
  setTripIncludeDirect: (tripIncludeDirect) => set((state) => {
    if (!tripIncludeDirect && !state.tripIncludeTransfer) {
      return {
        tripIncludeDirect,
        tripStatus: 'error' as const,
        tripError: 'Elegí directos, combinaciones o ambos.',
        tripOptions: [],
      }
    }
    return {
      tripIncludeDirect,
      tripError: null,
      ...tripView(state.tripCatalog, state.tripMaxWalk, tripIncludeDirect, state.tripIncludeTransfer, state.tripRefreshing, state.tripStatus),
    }
  }),
  setTripIncludeTransfer: (tripIncludeTransfer) => set((state) => {
    if (!tripIncludeTransfer && !state.tripIncludeDirect) {
      return {
        tripIncludeTransfer,
        tripStatus: 'error' as const,
        tripError: 'Elegí directos, combinaciones o ambos.',
        tripOptions: [],
      }
    }
    return {
      tripIncludeTransfer,
      tripError: null,
      ...tripView(state.tripCatalog, state.tripMaxWalk, state.tripIncludeDirect, tripIncludeTransfer, state.tripRefreshing, state.tripStatus),
    }
  }),
  setTripLoading: () => set({
    tripStatus: 'loading',
    tripError: null,
    tripSelectedId: null,
    tripCatalog: [],
    tripOptions: [],
    tripRefreshing: false,
    ...clearTransferPatch(),
  }),
  setTripResults: (tripCatalog, refreshing = false) => set((state) => ({
    tripCatalog,
    tripRefreshing: refreshing,
    tripError: null,
    ...tripView(tripCatalog, state.tripMaxWalk, state.tripIncludeDirect, state.tripIncludeTransfer, refreshing, refreshing ? 'loading' : 'ready'),
  })),
  setTripError: (tripError) => set({
    tripStatus: 'error',
    tripError,
    tripCatalog: [],
    tripOptions: [],
    tripRefreshing: false,
  }),
  selectTripOption: (option) => set((state) => {
    const first = option.legs[0]
    const second = option.legs[1] ?? null
    if (!first) return { tripSelectedId: option.id, ...clearTransferPatch() }

    const primaryRouteId = resolveLegRoute(state.lines, first)
    const primaryLine = state.lines.find((item) => (
      item.clientId === first.clientId && (item.id === first.lineId || item.name === first.lineName)
    ))
    const secondaryRouteId = second ? resolveLegRoute(state.lines, second) : null
    const samePrimary = state.selectedClientId === first.clientId && state.selectedRouteId === primaryRouteId
    const sameTransfer = Boolean(
      second
      && secondaryRouteId
      && state.transferClientId === second.clientId
      && state.transferRouteId === secondaryRouteId,
    )
    const primaryTrace = heldTrace(state.trace, first.clientId, primaryRouteId)
    const secondaryTrace = second && secondaryRouteId
      ? heldTrace(state.transferTrace, second.clientId, secondaryRouteId)
      : null
    const transferPatch = second && secondaryRouteId
      ? {
          transferClientId: second.clientId,
          transferRouteId: secondaryRouteId,
          transferTrace: secondaryTrace,
          transferTraceStatus: (secondaryTrace ? 'ready' : 'loading') as TraceStatus,
        }
      : clearTransferPatch()
    const vehicles = state.vehicles.filter((vehicle) => (
      (vehicle.tripLeg === 0 && samePrimary) || (vehicle.tripLeg === 1 && sameTransfer)
    ))

    const selection = primaryLine
      ? selectionFor(primaryLine, primaryRouteId)
      : {
          selectedClientId: first.clientId,
          selectedRouteId: primaryRouteId,
          selectedVehicleId: null,
          selectedStop: null,
          traceError: null,
          vehicleError: null,
          vehicleNotice: null,
          vehicleFetchedAt: null,
          vehicleCached: false,
          vehicleRefreshing: false,
        }

    return {
      ...selection,
      // El recorrido de la línea que se repite se queda: si se borra, el efecto no lo vuelve a pedir.
      selectedRouteId: primaryRouteId,
      trace: primaryTrace,
      traceStatus: (primaryTrace ? 'ready' : 'loading') as TraceStatus,
      traceNonce: samePrimary && !primaryTrace ? state.traceNonce + 1 : state.traceNonce,
      vehicles,
      vehicleStatus: vehicles.length > 0 ? state.vehicleStatus : (primaryRouteId ? 'loading' : 'idle'),
      ...transferPatch,
      tripNavigating: false,
      tripNavStep: 0,
      tripSelectedId: option.id,
      panelMode: 'trip' as const,
      sheetView: 'detail' as const,
      sheetSnap: state.sheetSnap === 'peek' ? 'half' as const : state.sheetSnap,
      sidebarCollapsed: false,
    }
  }),
  clearTripSelection: () => set({ tripSelectedId: null, ...clearTransferPatch() }),
  startTripNavigation: (step = 0) => set({
    tripNavigating: true,
    tripNavStep: Math.max(0, step),
    panelMode: 'trip',
    sidebarCollapsed: false,
    sheetSnap: 'half',
  }),
  stopTripNavigation: () => set({ tripNavigating: false, tripNavStep: 0 }),
  setTripNavStep: (tripNavStep) => set({ tripNavStep: Math.max(0, tripNavStep) }),
  setUserLocation: (userLocation) => set({ userLocation }),
  requestTripSearch: () => set((state) => ({ tripNonce: state.tripNonce + 1 })),
  placeTripPin: (point) => set((state) => {
    if (state.tripPinTarget === 'destination') {
      return {
        tripDestination: point,
        tripPinTarget: null,
        tripStatus: 'idle' as const,
        tripCatalog: [],
        tripOptions: [],
        tripRefreshing: false,
        tripSelectedId: null,
        tripError: null,
        ...clearTransferPatch(),
        tripNonce: state.tripOrigin ? state.tripNonce + 1 : state.tripNonce,
      }
    }
    const nextOrigin = point
    return {
      tripOrigin: nextOrigin,
      tripPinTarget: state.tripDestination ? null : 'destination' as const,
      tripStatus: 'idle' as const,
      tripCatalog: [],
      tripOptions: [],
      tripRefreshing: false,
      tripSelectedId: null,
      tripError: null,
      ...clearTransferPatch(),
      panelMode: 'trip' as const,
      tripNonce: state.tripDestination ? state.tripNonce + 1 : state.tripNonce,
    }
  }),
  setTransferTrace: (transferTrace) => set((state) => {
    if (!transferTrace) return { transferTrace: null, transferTraceStatus: 'empty' }
    const stored = rememberTrace(transferTrace)
    if (state.transferClientId !== stored.clientId || state.transferRouteId !== stored.routeId) return state
    return {
      transferTrace: stored,
      transferTraceStatus: stored.coordinates.length >= 2 ? 'ready' : 'empty',
    }
  }),
  setTransferTraceLoading: () => set({ transferTraceStatus: 'loading' }),
  clearTransferLeg: () => set(clearTransferPatch()),
}))

export function useSelectedLine(): Line | null {
  return useTransitStore((state) => state.lines.find((line) => line.key === state.selectedLineKey) ?? null)
}
