import type { Line } from '../types'
import { fold } from './format'

export function filterLines(lines: Line[], query: string, operatorId: number | null): Line[] {
  const needle = fold(query)
  return lines.filter((line) => {
    if (operatorId !== null && line.clientId !== operatorId) return false
    if (!needle) return true
    const haystack = [
      line.name,
      line.operatorName,
      line.groupName ?? '',
      ...line.routes.flatMap((route) => [route.name, route.directionLabel]),
    ].join(' ')
    return fold(haystack).includes(needle)
  })
}
