import { atom, read, update } from 'claude-code'
import type { EngineInterface as $, Register } from 'claude-code'

import type { CacheTtl } from '../types'

const lastAt = atom({ plugin: 'cache-timer', key: 'lastAt' } as const, null as number | null)
const hitPct = atom({ plugin: 'cache-timer', key: 'hitPct' } as const, null as number | null)
const ttl = atom({ plugin: 'cache-timer', key: 'ttl' } as const, '1h' as CacheTtl)
const isRunning = atom({ plugin: 'cache-timer', key: 'isRunning' } as const, false)
const hasCompacted = atom({ plugin: 'cache-timer', key: 'hasCompacted' } as const, false)
const isHidden = atom({ plugin: 'cache-timer', key: 'isHidden' } as const, false)
const isCollapsed = atom({ plugin: 'cache-timer', key: 'isCollapsed' } as const, false)
const now = atom({ plugin: 'cache-timer', key: 'now' } as const, 0)

const ttlMs = (t: CacheTtl) => (t === '1h' ? 3_600_000 : 300_000)
const clock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
// m:ss under ten minutes, whole minutes above (a 1h TTL reads as "44m")
const short = (ms: number) => (ms < 600_000 ? clock(ms) : `${Math.ceil(ms / 60_000)}m`)
const SEGMENTS = 24

// ms left before the cache lapses; null when there is nothing cached to lose
async function left($: $, t: number) {
  const last = await read($, lastAt)
  return last === null || (await read($, isRunning)) ? null : last + ttlMs(await read($, ttl)) - t
}

async function compact($: $) {
  if (await read($, isRunning)) {
    $.ui.toast('Cannot compact while a turn is running')
    return
  }
  await update($, hasCompacted, () => true)
  try {
    const r = await $.session.compact()
    if (r.skip) {
      $.ui.toast(`Compact skipped: ${r.skip}`)
      return
    }
    await update($, lastAt, () => null)
    $.ui.toast('Compacted')
  } catch (err) {
    $.ui.toast(`Compact failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// settings are userConfig fields; writing one saves to settings.json and reloads the module with the new value
async function setOption($: $, field: string, value: boolean | string) {
  const row = (await $.config.list()).find(r => r.key.replace(/@\w+/, '') === `cache-timer.${field}`)
  if (!row) {
    $.ui.toast(`cache-timer: ${field} not found; set it in /config`)
    return
  }
  const r = await $.config.set({ key: row.key, value })
  if (r.deny) $.ui.toast(`cache-timer: ${field} unchanged: ${r.deny}`)
}

type Run = { text: string; ink: 'color' | 'fg' | 'dim' }

// the countdown bar as runs of one ink: `color` the time left, `dim` the time gone,
// `fg` (the theme's own text colour) the segment where auto-compact fires
export function bar(fraction: number, markAt: number | null): Run[] {
  const filled = Math.round(fraction * SEGMENTS)
  const cells: Run[] = Array.from({ length: SEGMENTS }, (_, i) => ({ text: '■', ink: i < filled ? 'color' : 'dim' }))
  if (markAt !== null) cells[Math.min(SEGMENTS - 1, Math.round(markAt * SEGMENTS))] = { text: '■', ink: 'fg' }
  const runs: Run[] = []
  for (const c of cells) {
    const last = runs[runs.length - 1]
    if (last && last.ink === c.ink) last.text += c.text
    else runs.push({ ...c })
  }
  return runs
}

async function tick($: $, isAuto: boolean, lead: number) {
  const t = await $.clock.now()
  await update($, now, () => t)
  const ms = await left($, t)
  // a lead as long as the TTL would compact right after every turn
  const isDue = ms !== null && ms > 0 && ms <= lead && lead < ttlMs(await read($, ttl))
  if (isDue && isAuto && !(await read($, hasCompacted))) await compact($)
}

// settings are the plugin's userConfig (plugin.json): rows in /config, saved in settings.json
export const register: Register = (on, options) => {
  const isAuto = options.autoCompact === true
  const lead = Math.max(0.1, Number(options.minutesBeforeExpiry) || 5) * 60_000
  const configTtl: CacheTtl = options.ttl === '5m' ? '5m' : '1h'
  const style = options.style === 'quiet' ? 'quiet' : 'segmented'

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'cache', description: 'Show the prompt cache band again' })
    await update($, ttl, () => configTtl)
    $.clock.every(1000, () => void tick($, isAuto, lead))
    return next(e)
  })

  on('command.run', { command: 'cache' }, async $ => {
    await update($, isHidden, () => false)
    await update($, isCollapsed, () => false)
    const total = ttlMs(await read($, ttl))
    const auto = isAuto ? `on, at ${short(total - lead)}` : 'off'
    return { text: `Cache band shown. TTL ${await read($, ttl)}, auto-compact ${auto}. Change them in /config.` }
  })

  on('turn.start', async ($, e, next) => {
    await update($, isRunning, () => true)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const t = await $.clock.now()
    const u = e.usage
    const sent = u ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : 0
    await update($, lastAt, () => t)
    await update($, hitPct, v => (u && sent > 0 ? Math.round((u.cache_read_input_tokens / sent) * 100) : v))
    await update($, isRunning, () => false)
    await update($, hasCompacted, () => false)
    return next(e)
  })

  // the engine knows the real TTL; learn it whenever a compaction reports it
  on('classic.PreCompact', async ($, e, next) => {
    await update($, ttl, () => e.cache_ttl)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const ms = await left($, await read($, now))
    const total = ttlMs(await read($, ttl))
    const hit = await read($, hitPct)

    let label = '—'
    let color = 'gray'
    if (e.props.isWorking) label = 'refreshing'
    else if (ms === null && (await read($, hasCompacted))) label = 'compacted'
    else if (ms !== null && ms > 0) {
      label = short(ms)
      color = ms > lead + 30_000 ? 'green' : 'yellow'
    } else if (ms !== null) {
      label = 'expired'
      color = 'red'
    }
    const close = <Button key="close" label="×" plain role="dismiss" onPress={() => update($, isHidden, () => true)} />
    // clicking the countdown folds the band to the dot and the time; clicking again opens it
    const time = <Button key="time" label={label} plain onPress={() => update($, isCollapsed, v => !v)} />
    if (await read($, isCollapsed)) {
      return (
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Text color={color}>●</Text>
          {time}
        </Box>
      )
    }
    const auto = (
      <Button
        key="auto"
        label={isAuto && lead < total ? `auto at ${short(total - lead)}` : 'auto off'}
        plain
        dimColor
        onPress={() => setOption($, 'autoCompact', !isAuto)}
      />
    )

    if (style === 'quiet') {
      return (
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Text color={color}>●</Text>
          <Text dimColor>cache</Text>
          {time}
          {hit !== null && <Text dimColor>· {hit}% hit ·</Text>}
          {auto}
          <Box flexGrow={1} />
          <Button key="compact" label="Compact" plain onPress={() => compact($)} />
          {close}
        </Box>
      )
    }

    const runs = bar(
      e.props.isWorking ? 1 : Math.max(0, ms ?? 0) / total,
      isAuto && lead < total ? lead / total : null,
    )
    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Text color={color}>●</Text>
        <Text dimColor>cache</Text>
        {time}
        <Text>
          {runs.map((r, i) =>
            r.ink === 'color' ? (
              <Text key={i} color={color}>
                {r.text}
              </Text>
            ) : r.ink === 'dim' ? (
              <Text key={i} dimColor>
                {r.text}
              </Text>
            ) : (
              <Text key={i}>{r.text}</Text>
            ),
          )}
        </Text>
        {hit !== null && <Text dimColor>{hit}% hit ·</Text>}
        {auto}
        <Box flexGrow={1} />
        <Button key="compact" label="Compact" variant="primary" onPress={() => compact($)} />
        {close}
      </Box>
    )
  })
}
