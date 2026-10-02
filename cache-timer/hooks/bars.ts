// what the band draws: pure helpers, kept apart so the tests reach them without the hooks

import type { AutoMode } from '../types'

const SEGMENTS = 24

type Run = { text: string; ink: 'color' | 'fg' | 'dim' }

// the countdown bar as runs of one ink: `color` the time left, `dim` the time gone,
// `fg` (the theme's own text colour) the segment where the auto action fires
export function bar(fraction: number, markAt: number | null, n = SEGMENTS): Run[] {
  const filled = Math.round(fraction * n)
  const cells: Run[] = Array.from({ length: n }, (_, i) => ({ text: '■', ink: i < filled ? 'color' : 'dim' }))
  if (markAt !== null) cells[Math.min(n - 1, Math.round(markAt * n))] = { text: '■', ink: 'fg' }
  return runsOf(cells)
}

// consecutive cells of one ink share a Text
function runsOf(cells: Run[]): Run[] {
  const runs: Run[] = []
  for (const c of cells) {
    const last = runs[runs.length - 1]
    if (last && last.ink === c.ink) last.text += c.text
    else runs.push({ ...c })
  }
  return runs
}

// the time as the band shows it: whole minutes, then seconds in the last minute, so it changes (and the band
// redraws) once a minute for most of the cache's life; null when nothing is cached, 0 once it has expired
export function shownLeft(ms: number | null): number | null {
  if (ms === null) return null
  if (ms <= 0) return 0
  return ms > 60_000 ? Math.ceil(ms / 60_000) * 60_000 : Math.ceil(ms / 1000) * 1000
}

export const label = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)}m` : `${Math.round(ms / 1000)}s`)

// the bar takes what the row leaves after `used` cells of other items, from 8 to 24 segments
export function segmentsFor(columns: number, used: number): number {
  return Math.max(8, Math.min(SEGMENTS, columns - used))
}

type CacheAction = 'compact' | 'keep warm' | 'warn' | 'none'

// what to do once the cache is close to expiring: the auto action, or a reminder when there is none to take.
// Compacting waits while a background agent runs (its report back expects the full conversation); keeping warm
// does not, since that report would otherwise land on an expired cache
export function nextAction(s: {
  mode: AutoMode
  isBackground: boolean
  hasCompacted: boolean
  pings: number
  maxPings: number
  hasWarned: boolean
}): CacheAction {
  if (s.mode === 'keep warm' && (s.isBackground || s.pings < s.maxPings)) return 'keep warm'
  if (s.mode === 'compact' && !s.isBackground && !s.hasCompacted) return 'compact'
  if (s.mode === 'keep warm' || s.hasCompacted) return 'none'
  return s.hasWarned ? 'none' : 'warn'
}
