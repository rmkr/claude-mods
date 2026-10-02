import { atom, read, update } from 'claude-code'
import type { EngineInterface as $, ModelUsage, Register } from 'claude-code'

import type { CacheTtl } from '../types'

const lastAt = atom({ plugin: 'cache-timer', key: 'lastAt' } as const, null as number | null)
const cachedTokens = atom({ plugin: 'cache-timer', key: 'cachedTokens' } as const, 0)
const hitPct = atom({ plugin: 'cache-timer', key: 'hitPct' } as const, null as number | null)
const ttl = atom({ plugin: 'cache-timer', key: 'ttl' } as const, '1h' as CacheTtl)
const isRunning = atom({ plugin: 'cache-timer', key: 'isRunning' } as const, false)
const hasCompacted = atom({ plugin: 'cache-timer', key: 'hasCompacted' } as const, false)
const isHidden = atom({ plugin: 'cache-timer', key: 'isHidden' } as const, false)
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

// whether a request kept the main conversation's cache warm: every main-thread request does; a subagent's
// does only when it re-read that prefix (a fork of the conversation), not when it ran its own prompt
export function refreshesMain(agentId: string | undefined, usage: ModelUsage, cached: number): boolean {
  return agentId === undefined || (cached > 0 && usage.cache_read_input_tokens >= cached * 0.9)
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

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'cache', description: 'Show the prompt cache band again' })
    await update($, ttl, () => configTtl)
    $.clock.every(1000, () => void tick($, isAuto, lead))
    return next(e)
  })

  // /cache toggles the band; /cache help explains the controls; the rest change settings
  on('command.run', { command: 'cache' }, async ($, e) => {
    const [what = '', value = ''] = e.args.trim().toLowerCase().split(/\s+/)
    const total = ttlMs(await read($, ttl))
    const auto = isAuto && lead < total ? `on, compacts at ${short(total - lead)}` : 'off'
    if (what === '') {
      const isNowHidden = !(await read($, isHidden))
      await update($, isHidden, () => isNowHidden)
      return { text: isNowHidden ? 'Cache band hidden. /cache shows it.' : 'Cache band shown. /cache help lists the controls.' }
    }
    if (what === 'auto' && (value === 'on' || value === 'off')) {
      await setOption($, 'autoCompact', value === 'on')
      return { text: `Auto-compact ${value}.` }
    }
    const minutes = /^(\d+(?:\.\d+)?)m?$/.exec(value)
    if (what === 'auto' && minutes) {
      await setOption($, 'minutesBeforeExpiry', Number(minutes[1]))
      await setOption($, 'autoCompact', true)
      return { text: `Auto-compact on, ${minutes[1]} minutes before the cache expires.` }
    }
    if (what === 'ttl' && (value === '5m' || value === '1h')) {
      await setOption($, 'ttl', value)
      return { text: `Cache TTL set to ${value}.` }
    }
    return {
      text: [
        `Cache band: TTL ${await read($, ttl)}, auto-compact ${auto}.`,
        '',
        'On the band',
        '  Compact          compact the conversation now',
        '  auto off / on    click to turn auto-compact on or off',
        '  ×                hide the band (/cache shows it again)',
        '',
        'Commands',
        '  /cache           show or hide the band',
        '  /cache auto on   turn auto-compact on (or off)',
        '  /cache auto 5m   compact 5 minutes before the cache expires',
        '  /cache ttl 1h    set the cache lifetime (1h or 5m)',
      ].join('\n'),
    }
  })

  on('turn.start', async ($, e, next) => {
    await update($, isRunning, () => true)
    return next(e)
  })

  // every model request, main or a subagent's, as it completes: the cache's clock restarts on any that read
  // the main conversation's prefix
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const u = result.usage
    if (u && refreshesMain(e.agentId, u, await read($, cachedTokens))) {
      const t = await $.clock.now()
      await update($, lastAt, () => t)
      if (e.agentId === undefined) {
        const sent = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
        await update($, cachedTokens, () => u.cache_read_input_tokens + u.cache_creation_input_tokens)
        if (sent > 0) await update($, hitPct, () => Math.round((u.cache_read_input_tokens / sent) * 100))
      }
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
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
    const auto = (
      <Button
        key="auto"
        label={isAuto && lead < total ? `auto at ${short(total - lead)}` : 'auto off'}
        plain
        dimColor
        onPress={() => setOption($, 'autoCompact', !isAuto)}
      />
    )

    const runs = bar(
      e.props.isWorking ? 1 : Math.max(0, ms ?? 0) / total,
      isAuto && lead < total ? lead / total : null,
    )
    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Text color={color}>●</Text>
        <Text dimColor>cache</Text>
        <Text bold color={color}>
          {label}
        </Text>
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
