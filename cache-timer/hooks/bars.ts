// what the band draws: pure helpers, kept apart so the tests reach them without the hooks

export const SEGMENTS = 24
export const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

export const clock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
// m:ss under ten minutes, whole minutes above (a 1h TTL reads as "44m")
export const short = (ms: number) => (ms < 600_000 ? clock(ms) : `${Math.ceil(ms / 60_000)}m`)

export type Run = { text: string; ink: 'color' | 'fg' | 'dim' }

// the countdown bar as runs of one ink: `color` the time left, `dim` the time gone,
// `fg` (the theme's own text colour) the segment where the auto action fires
export function bar(fraction: number, markAt: number | null, n = SEGMENTS): Run[] {
  const filled = Math.round(fraction * n)
  const cells: Run[] = Array.from({ length: n }, (_, i) => ({ text: '■', ink: i < filled ? 'color' : 'dim' }))
  if (markAt !== null) cells[Math.min(n - 1, Math.round(markAt * n))] = { text: '■', ink: 'fg' }
  return runsOf(cells)
}

// the sweep shown while Claude works: a three-segment comet running left to right, then off the end and around
export function sweep(step: number, n = SEGMENTS): Run[] {
  const head = step % (n + 3)
  return runsOf(Array.from({ length: n }, (_, i) => ({ text: '■', ink: i <= head && i > head - 3 ? 'color' : 'dim' })))
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

export const label = (shown: number) => (shown >= 60_000 ? `${shown / 60_000}m` : `${shown / 1000}s`)

// the bar takes what the row leaves after `used` cells of other items, from 8 to 24 segments
export function segmentsFor(columns: number, used: number): number {
  return Math.max(8, Math.min(SEGMENTS, columns - used))
}
