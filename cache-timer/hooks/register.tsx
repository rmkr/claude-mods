import { atom, read, update } from 'claude-code'
import type { EngineInterface as $, Register } from 'claude-code'

import type { CacheTtl } from '../types'

const PANE = 'cache-timer'
const lastAt = atom({ plugin: 'cache-timer', key: 'lastAt' } as const, null as number | null)
const tokens = atom({ plugin: 'cache-timer', key: 'tokens' } as const, 0)
const ttl = atom({ plugin: 'cache-timer', key: 'ttl' } as const, '5m' as CacheTtl)
const isAuto = atom({ plugin: 'cache-timer', key: 'isAuto' } as const, false)
const leadSec = atom({ plugin: 'cache-timer', key: 'leadSec' } as const, 30)
const isRunning = atom({ plugin: 'cache-timer', key: 'isRunning' } as const, false)
const hasCompacted = atom({ plugin: 'cache-timer', key: 'hasCompacted' } as const, false)
const now = atom({ plugin: 'cache-timer', key: 'now' } as const, 0)

const ttlMs = (t: CacheTtl) => (t === '1h' ? 3_600_000 : 300_000)
const clock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const kTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

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

async function tick($: $) {
  const t = await $.clock.now()
  await update($, now, () => t)
  const ms = await left($, t)
  $.ui.status(ms === null ? undefined : ms > 0 ? `cache ${clock(ms)}` : 'cache cold')
  const isDue = ms !== null && ms > 0 && ms <= (await read($, leadSec)) * 1000
  if (isDue && (await read($, isAuto)) && !(await read($, hasCompacted))) await compact($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'cache', description: 'Show the prompt cache countdown pane' })
    $.clock.every(1000, () => void tick($))
    void $.ui.open({ id: PANE, title: 'Prompt cache' })
    return next(e)
  })

  on('command.run', { command: 'cache' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Prompt cache' })
    return { text: 'Prompt cache pane opened.' }
  })

  on('turn.start', async ($, e, next) => {
    await update($, isRunning, () => true)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const t = await $.clock.now()
    const { context } = await $.session.usage()
    await update($, lastAt, () => t)
    await update($, tokens, () => context.tokens ?? 0)
    await update($, isRunning, () => false)
    await update($, hasCompacted, () => false)
    return next(e)
  })

  // the engine knows the real TTL; learn it whenever a compaction reports it
  on('classic.PreCompact', async ($, e, next) => {
    await update($, ttl, () => e.cache_ttl)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const t = await read($, now)
    const ms = await left($, t)
    const size = kTokens(await read($, tokens))
    const currentTtl = await read($, ttl)
    const auto = await read($, isAuto)
    const lead = await read($, leadSec)

    let line = 'No request yet'
    let color = 'gray'
    if (await read($, isRunning)) line = 'Turn running, cache refreshing'
    else if (ms === null && (await read($, hasCompacted))) line = 'Compacted, cache rebuilds on next message'
    else if (ms !== null && ms > 0) {
      line = `${clock(ms)} left (${size} tokens warm)`
      color = ms > lead * 1000 + 30_000 ? 'green' : 'yellow'
    } else if (ms !== null) {
      line = `Expired ${clock(-ms)} ago, next message re-sends ${size} tokens`
      color = 'red'
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold color={color}>
          {line}
        </Text>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="compact" label="Compact now" variant="primary" onPress={() => compact($)} />
          <Button
            key="ttl"
            label={`TTL ${currentTtl}`}
            onPress={() => update($, ttl, v => (v === '5m' ? '1h' : '5m'))}
          />
        </Box>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button
            key="auto"
            label={`Auto-compact: ${auto ? 'on' : 'off'}`}
            onPress={() => update($, isAuto, v => !v)}
          />
          <Button key="less" label="-15s" onPress={() => update($, leadSec, v => Math.max(15, v - 15))} />
          <Text dimColor>{lead}s before expiry</Text>
          <Button key="more" label="+15s" onPress={() => update($, leadSec, v => Math.min(600, v + 15))} />
        </Box>
      </Box>
    )
  })
}
