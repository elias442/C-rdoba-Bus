import { useEffect } from 'react'
import { useMediaQuery } from './hooks/useViewport'
import {
  useCatalog,
  useRouteHash,
  useTrace,
  useTransferTrace,
  useTripSearch,
  useVehiclePolling,
} from './hooks/useTransitData'
import { useTransitStore } from './stores/useTransitStore'
import { MapCanvas } from './components/MapCanvas'
import { Sidebar } from './components/Sidebar'
import { MobileChrome } from './components/BottomSheet'
import { StatusPill } from './components/StatusPill'
import { VehicleCard } from './components/VehicleCard'

export function App() {
  const mobile = useMediaQuery('(max-width: 860px)')
  const collapsed = useTransitStore((state) => state.sidebarCollapsed)
  const selectedLineKey = useTransitStore((state) => state.selectedLineKey)
  const linesStatus = useTransitStore((state) => state.linesStatus)
  const panelMode = useTransitStore((state) => state.panelMode)
  useCatalog()
  useTripSearch()
  useTrace()
  useTransferTrace()
  useVehiclePolling()
  useRouteHash()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') useTransitStore.getState().clearVehicle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const mapCenter = mobile ? '50%' : collapsed ? 'calc(50% + 28px)' : 'calc(50% + 150px)'
  const panelLeft = collapsed ? 116 : 424

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[#d7dee8]">
      <MapCanvas mobile={mobile} />
      <div
        className={mobile ? 'absolute top-[4.75rem] z-10 -translate-x-1/2' : 'absolute top-5 z-10 -translate-x-1/2'}
        style={{ left: mapCenter }}
      >
        <StatusPill />
      </div>
      {mobile ? <MobileChrome /> : (
        <>
          <Sidebar />
          <VehicleCard left={panelLeft} />
          {!selectedLineKey && linesStatus === 'ready' && panelMode === 'lines' ? (
            <div
              className="pointer-events-none absolute bottom-6 z-10 flex justify-center"
              style={{ left: panelLeft, right: 84 }}
            >
              <div className="pointer-events-auto max-w-md rounded-[28px] border border-white/80 bg-white/95 px-5 py-4 shadow-panel backdrop-blur">
                <p className="text-sm font-semibold">Elegí una línea o armá un viaje</p>
                <p className="mt-1 text-sm leading-5 text-slate-500">
                  En Viaje podés buscar de A a B con directos, combinaciones y metros a pie.
                </p>
              </div>
            </div>
          ) : null}
        </>
      )}
    </main>
  )
}
