import type { SheetSnap } from '../types'

export function sheetHeight(snap: SheetSnap, viewport: number): number {
  if (snap === 'peek') return 128
  if (snap === 'half') return Math.round(Math.min(Math.max(viewport * 0.46, 280), 520))
  return Math.round(Math.max(viewport - 76, 320))
}

/** Alto del panel de indicaciones en el celular: deja el mapa visible arriba. */
export function tripNavSheetHeight(viewport: number): number {
  return Math.round(Math.min(Math.max(viewport * 0.46, 300), 420))
}

export function mobileSheetHeight(snap: SheetSnap, viewport: number, navigating: boolean): number {
  if (!navigating) return sheetHeight(snap, viewport)
  if (snap === 'full') return sheetHeight('full', viewport)
  return tripNavSheetHeight(viewport)
}

const parsedPoll = Number(import.meta.env.VITE_VEHICLE_POLL_MS)
export const VEHICLE_POLL_MS = Number.isFinite(parsedPoll) && parsedPoll >= 8000 ? parsedPoll : 15000

export const MAP_STYLES = {
  light: import.meta.env.VITE_MAP_STYLE_LIGHT || 'https://tiles.openfreemap.org/styles/positron',
  dark: import.meta.env.VITE_MAP_STYLE_DARK || 'https://tiles.openfreemap.org/styles/dark',
} as const
