import { atom, read, update } from 'claude-code'
import type { EngineInterface as $, ModelUsage, Register } from 'claude-code'

import type { AutoMode, CacheTtl } from '../types'
import { bar, label, segmentsFor, short, shownLeft, SPINNER, sweep } from './bars'

const lastAt = atom({ plugin: 'cache-timer', key: 'lastAt' } as const, null as number | null)
const cachedTokens = atom({ plugin: 'cache-timer', key: 'cachedTokens' } as const, 0)
const hitPct = atom({ plugin: 'cache-timer', key: 'hitPct' } as const, null as number | null)
const ttl = atom({ plugin: 'cache-timer', key: 'ttl' } as const, '1h' as CacheTtl)
const isRunning = atom({ plugin: 'cache-timer', key: 'isRunning' } as const, false)
const hasCompacted = atom({ plugin: 'cache-timer', key: 'hasCompacted' } as const, false)
const pings = atom({ plugin: 'cache-timer', key: 'pings' } as const, 0)
const isCollapsed = atom({ plugin: 'cache-timer', key: 'isCollapsed' } as const, false)
const isHidden = atom({ plugin: 'cache-timer', key: 'isHidden' } as const, false)
const shown = atom({ plugin: 'cache-timer', key: 'shown' } as const, null as number | null)
const frame = atom({ plugin: 'cache-timer', key: 'frame' } as const, 0)
const autoMode = atom({ plugin: 'cache-timer', key: 'autoMode' } as const, 'off' as AutoMode)


const ttlMs = (t: CacheTtl) => (t === '1h' ? 3_600_000 : 300_000)
// ponytail: auto keep-warm stops after 3 pings with nobody typing, so a session left overnight lets its cache go;
// make it a setting if longer absences matter
const MAX_PINGS = 3
// one cache action at a time; a reload starts it over
let isBusy = false

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

// one tiny request over the conversation as the main thread last sent it: the API serves that prefix from the
// cache, which restarts its timer; the reply itself is thrown away
async function keepWarm($: $) {
  if (await read($, isRunning)) {
    $.ui.toast('Cannot keep warm while a turn is running')
    return
  }
  const r = await $.model.fork({ prompt: 'Reply with the single word OK.' })
  if (!r.isAnswered && r.reason === 'nothing-to-fork') {
    $.ui.toast('Nothing cached yet')
    return
  }
  if ('usage' in r && r.usage) {
    const t = await $.clock.now()
    await update($, lastAt, () => t)
    const wasWarm = r.usage.cache_read_input_tokens >= (await read($, cachedTokens)) * 0.9
    $.ui.toast(wasWarm ? 'Cache kept warm' : 'Cache had expired; it was written again')
    return
  }
  $.ui.toast(`Keep warm failed: ${r.isAnswered ? 'no usage reported' : r.reason}`)
}

// settings are userConfig fields; writing one saves to settings.json and reloads the module with the new value
async function setOption($: $, field: string, value: boolean | number | string) {
  const row = (await $.config.list()).find(r => r.key.replace(/@\w+/, '') === `cache-timer.${field}`)
  if (!row) {
    $.ui.toast(`cache-timer: ${field} not found; set it in /config`)
    return
  }
  const r = await $.config.set({ key: row.key, value })
  if (r.deny) $.ui.toast(`cache-timer: ${field} unchanged: ${r.deny}`)
}

async function setMode($: $, mode: AutoMode) {
  await setOption($, 'autoKeepWarm', mode === 'keep warm')
  await setOption($, 'autoCompact', mode === 'compact')
}

// whether a request kept the main conversation's cache warm: every main-thread request does; a subagent's
// does only when it re-read that prefix (a fork of the conversation), not when it ran its own prompt
export function refreshesMain(agentId: string | undefined, usage: ModelUsage, cached: number): boolean {
  return agentId === undefined || (cached > 0 && usage.cache_read_input_tokens >= cached * 0.9)
}

// advances the sweep five times a second, only while a turn runs
async function animate($: $) {
  if (await read($, isRunning)) await update($, frame, n => n + 1)
}

async function tick($: $, lead: number) {
  const mode = await read($, autoMode)
  const t = await $.clock.now()
  const ms = await left($, t)
  // the band reads only what it shows, written when it changes: each redraw gives its buttons new handles, and a
  // click that lands on an old one is lost
  const next = shownLeft(ms)
  if ((await read($, shown)) !== next) await update($, shown, () => next)
  // a lead as long as the TTL would act right after every turn
  const isDue = ms !== null && ms > 0 && ms <= lead && lead < ttlMs(await read($, ttl))
  if (!isDue || isBusy || mode === 'off') return
  isBusy = true
  try {
    if (mode === 'compact' && !(await read($, hasCompacted))) await compact($)
    if (mode === 'keep warm' && (await read($, pings)) < MAX_PINGS) {
      await update($, pings, n => n + 1)
      await keepWarm($)
    }
  } finally {
    isBusy = false
  }
}

// settings are the plugin's userConfig (plugin.json): rows in /config, saved in settings.json
export const register: Register = (on, options) => {
  const configMode: AutoMode = options.autoKeepWarm === true ? 'keep warm' : options.autoCompact === true ? 'compact' : 'off'
  const lead = Math.max(0.1, Number(options.minutesBeforeExpiry) || 5) * 60_000
  const configTtl: CacheTtl = options.ttl === '5m' ? '5m' : '1h'
  const NEXT_MODE: Record<AutoMode, AutoMode> = { off: 'compact', compact: 'keep warm', 'keep warm': 'off' }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cache',
      description: 'Show or hide the prompt cache band; /cache help for more',
      immediate: true,
    })
    await update($, ttl, () => configTtl)
    await update($, autoMode, () => configMode)
    $.clock.every(1000, () => void tick($, lead))
    $.clock.every(200, () => void animate($))
    return next(e)
  })

  // /cache toggles the band; /cache help explains the controls; the rest act or change settings
  on('command.run', { command: 'cache' }, async ($, e) => {
    const [what = '', value = ''] = e.args.trim().toLowerCase().split(/\s+/)
    const total = ttlMs(await read($, ttl))
    const mode = await read($, autoMode)
    const autoText = mode === 'off' || lead >= total ? 'off' : `${mode} at ${short(total - lead)}`
    if (what === '') {
      const isNowHidden = !(await read($, isHidden))
      await update($, isHidden, () => isNowHidden)
      return { text: isNowHidden ? 'Cache band hidden. /cache shows it.' : 'Cache band shown. /cache help lists the controls.' }
    }
    if (what === 'warm') {
      await keepWarm($)
      return { text: 'Keep warm sent.' }
    }
    const modes: Record<string, AutoMode> = { off: 'off', on: 'compact', compact: 'compact', warm: 'keep warm', 'keep-warm': 'keep warm' }
    const picked = modes[value]
    if (what === 'auto' && picked) {
      await update($, autoMode, () => picked)
      await setMode($, picked)
      return { text: `Auto: ${picked}.` }
    }
    const minutes = /^(\d+(?:\.\d+)?)m?$/.exec(value)
    if (what === 'auto' && minutes) {
      await setOption($, 'minutesBeforeExpiry', Number(minutes[1]))
      if (mode === 'off') {
        await update($, autoMode, () => 'compact')
        await setMode($, 'compact')
      }
      return { text: `Auto acts ${minutes[1]} minutes before the cache expires.` }
    }
    if (what === 'ttl' && (value === '5m' || value === '1h')) {
      await setOption($, 'ttl', value)
      return { text: `Cache TTL set to ${value}.` }
    }
    return {
      text: [
        `Cache band: TTL ${await read($, ttl)}, auto ${autoText}.`,
        '',
        'On the band',
        '  Compact             summarize the conversation now; later messages send less',
        '  Keep warm           restart the cache timer now with one tiny request; nothing is lost',
        '  auto ...            click to cycle: off, compact, keep warm',
        '  –                   collapse to a small pill; click the pill to open it again',
        '',
        'Commands',
        '  /cache              show or hide the band',
        '  /cache warm         keep the cache warm now',
        '  /cache auto compact compact before the cache expires (also: keep-warm, off)',
        '  /cache auto 5m      act 5 minutes before the cache expires',
        '  /cache ttl 1h       set the cache lifetime (1h or 5m)',
        '',
        `Auto keep warm stops after ${MAX_PINGS} pings in a row with no message from you.`,
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
    await update($, pings, () => 0)
    return next(e)
  })

  // the engine knows the real TTL; learn it whenever a compaction reports it
  on('classic.PreCompact', async ($, e, next) => {
    await update($, ttl, () => e.cache_ttl)
    return next(e)
  })

  // every band button, handled by its key here rather than by the closure of the drawing it came from, so a press
  // that lands just after a redraw still counts
  on('ui.press', { component: 'AbovePrompt', plugin: 'cache-timer' }, async ($, e, next) => {
    const mode = await read($, autoMode)
    switch (e.element) {
      case 'compact':
        void compact($)
        break
      case 'warm':
        void keepWarm($)
        break
      case 'auto': {
        // the band changes at once; the saved setting catches up when the module reloads
        const picked = NEXT_MODE[mode]
        await update($, autoMode, () => picked)
        void setMode($, picked)
        break
      }
      case 'collapse':
        await update($, isCollapsed, () => true)
        break
      case 'expand':
        await update($, isCollapsed, () => false)
        break
      default:
        return next(e)
    }
    return { element: e.element }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const remaining = await read($, shown)
    const total = ttlMs(await read($, ttl))
    const hit = await read($, hitPct)
    const mode = await read($, autoMode)
    const isArmed = mode !== 'off' && lead < total
    const working = e.props.isWorking
    const step = working ? await read($, frame) : 0
    // presses are handled by key in the ui.press hook above
    const press = () => {}

    let text = '—'
    let color = 'gray'
    if (working) {
      text = SPINNER[step % SPINNER.length] ?? '·'
      color = 'green'
    } else if (remaining === null && (await read($, hasCompacted))) text = 'compacted'
    else if (remaining !== null && remaining > 0) {
      text = label(remaining)
      color = remaining > lead + 60_000 ? 'green' : 'yellow'
    } else if (remaining === 0) {
      text = 'expired'
      color = 'red'
    }
    const isWarm = remaining !== null && remaining > 0

    if (await read($, isCollapsed)) {
      return (
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Text color={color}>●</Text>
          <Text bold color={color}>
            {text}
          </Text>
          {!working && <Button key="expand" label="+" plain dimColor onPress={press} />}
        </Box>
      )
    }
    const hitText = hit === null ? null : `${hit}%`
    const autoText = isArmed ? `auto ${mode === 'keep warm' ? 'warm' : mode} ${short(total - lead)}` : 'auto off'
    const used =
      2 + 6 + text.length + 1 + (hitText ? hitText.length + 1 : 0) + autoText.length + 1 + (isWarm && !working ? 14 : 0) + (working ? 0 : 12 + 4)
    const n = segmentsFor(e.props.bodyColumns, used)
    const runs = working ? sweep(step, n) : bar(Math.max(0, remaining ?? 0) / total, isArmed ? lead / total : null, n)
    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Text color={color}>●</Text>
        <Text dimColor>cache</Text>
        <Text bold color={color}>
          {text}
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
        {hitText && <Text dimColor>{hitText}</Text>}
        {/* while the sweep runs the band redraws five times a second and buttons miss clicks, so it has none */}
        {working ? <Text dimColor>{autoText}</Text> : <Button key="auto" label={autoText} plain dimColor onPress={press} />}
        <Box flexGrow={1} />
        {isWarm && !working && <Button key="warm" label="Keep warm" onPress={press} />}
        {!working && <Button key="compact" label="Compact" variant="primary" onPress={press} />}
        {!working && <Button key="collapse" label="–" plain dimColor onPress={press} />}
      </Box>
    )
  })
}
