export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}

export function readableText(hex: string): string {
  const raw = hex.replace('#', '')
  const full = raw.length === 3 ? raw.split('').map((char) => char + char).join('') : raw.slice(0, 6)
  const value = Number.parseInt(full, 16)
  if (!Number.isFinite(value)) return '#ffffff'
  const red = (value >> 16) & 255
  const green = (value >> 8) & 255
  const blue = value & 255
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000
  return luminance > 170 ? '#10203a' : '#ffffff'
}

export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/** Tiempo hasta la parada, para el ícono del colectivo. */
export function formatLiveWait(seconds: number, approximate = false): string {
  if (seconds < 45) return approximate ? 'En ~1 min' : 'Ahora'
  const minutes = Math.max(1, Math.round(seconds / 60))
  const prefix = approximate ? 'En ~' : 'En '
  if (minutes < 60) return `${prefix}${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${prefix}${hours} h ${rest} min` : `${prefix}${hours} h`
}

/** Espera estimada en la parada cuando no hay una unidad a la vista. */
export function formatFrequencyWait(seconds: number): string {
  if (seconds < 45) return 'Est. ahora'
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `Est. en ${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `Est. en ${hours} h ${rest} min` : `Est. en ${hours} h`
}

export function formatMeters(meters: number): string {
  if (meters < 950) return `${Math.max(10, Math.round(meters / 10) * 10)} m`
  const km = meters / 1000
  return `${km >= 10 ? Math.round(km) : km.toFixed(1).replace('.', ',')} km`
}

export function formatAgo(iso: string, now: number): string {
  const time = new Date(iso).getTime()
  if (!Number.isFinite(time)) return 'sin hora'
  const seconds = Math.max(0, Math.round((now - time) / 1000))
  if (seconds < 5) return 'recién'
  if (seconds < 60) return `hace ${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `hace ${minutes} min`
  return `hace ${Math.floor(minutes / 60)} h`
}

export function reduceMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
