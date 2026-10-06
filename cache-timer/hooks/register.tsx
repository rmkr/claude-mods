import { atom, read, update } from 'claude-code'
import type { EngineInterface as $, ModelUsage, Register, Timer } from 'claude-code'

import type { AutoMode, CacheTtl } from '../types'
import { bar, label, nextAction, segmentsFor, shownLeft } from './bars'

const lastAt = atom({ plugin: 'cache-timer', key: 'lastAt' } as const, null as number | null)
const cachedTokens = atom({ plugin: 'cache-timer', key: 'cachedTokens' } as const, 0)
const hitPct = atom({ plugin: 'cache-timer', key: 'hitPct' } as const, null as number | null)
const ttl = atom({ plugin: 'cache-timer', key: 'ttl' } as const, '1h' as CacheTtl)
const isRunning = atom({ plugin: 'cache-timer', key: 'isRunning' } as const, false)
const hasCompacted = atom({ plugin: 'cache-timer', key: 'hasCompacted' } as const, false)
const hasWarned = atom({ plugin: 'cache-timer', key: 'hasWarned' } as const, false)
const pings = atom({ plugin: 'cache-timer', key: 'pings' } as const, 0)
const isCollapsed = atom({ plugin: 'cache-timer', key: 'isCollapsed' } as const, false)
const isHidden = atom({ plugin: 'cache-timer', key: 'isHidden' } as const, false)
const shown = atom({ plugin: 'cache-timer', key: 'shown' } as const, null as number | null)
const widthCheck = atom({ plugin: 'cache-timer', key: 'widthCheck' } as const, 0)
const autoMode = atom({ plugin: 'cache-timer', key: 'autoMode' } as const, 'off' as AutoMode)
// the mode last clicked, until a reload brings it back in the settings: a reload cancels the old module's pending
// save, and its settings may hold an earlier click
const pickedMode = atom({ plugin: 'cache-timer', key: 'pickedMode' } as const, null as AutoMode | null)

const ttlMs = (t: CacheTtl) => (t === '1h' ? 3_600_000 : 300_000)
// ponytail: auto keep-warm stops after 3 pings with nobody typing, so a session left overnight lets its cache go;
// make it a setting if longer absences matter
const MAX_PINGS = 3
// one cache action at a time; a reload starts it over
let isBusy = false
// the band last drew its forced small view: the desktop app reports a new width only when the band redraws, so
// while it is narrow the tick redraws it every few seconds to notice room to grow (no buttons there to miss clicks)
let isNarrowShown = false
// keep-warm pings that failed in a row: capped even while a background agent runs, so a failing API is not
// retried every second
let failedPings = 0
// the auto button's save, waiting for the clicks to stop
let saveTimer: Timer | undefined
// the last lastAt saved to the store; undefined after a reload, so the first tick saves it
let savedAt: number | null | undefined

// ms left before the cache lapses; null when there is nothing cached to lose
async function left($: $, t: number) {
  const last = await read($, lastAt)
  return last === null || (await read($, isRunning)) ? null : last + ttlMs(await read($, ttl)) - t
}

// compact and keep warm both need the conversation at rest
async function refuseMidTurn($: $, what: string) {
  const busy = await read($, isRunning)
  if (busy) $.ui.toast(`Cannot ${what} while a turn is running`)
  return busy
}

async function compact($: $) {
  if (await refuseMidTurn($, 'compact')) return
  await update($, hasCompacted, () => true)
  try {
    const r = await $.session.compact()
    if (r.skip) {
      $.ui.toast(`Compact skipped: ${r.skip}`)
      return
    }
    // the plugin's own session.compact hook skips a compaction it started
    await update($, lastAt, () => null)
    $.ui.toast('Compacted')
  } catch {
    // the desktop app and other SDK hosts compact only inside a turn: run /compact as if typed (a submitted
    // prompt would reach the model as text, not run the command); not when a turn began meanwhile, as it would
    // compact right after that turn, on a fresh cache
    if (await refuseMidTurn($, 'compact')) return
    $.ui.toast('Compacting')
    try {
      await $.command.run({ command: 'compact', args: '' })
      await update($, lastAt, () => null)
    } catch (err) {
      $.ui.toast(`Compact failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

// one tiny request over the conversation as the main thread last sent it: the API serves that prefix from the
// cache, which restarts its timer; the reply itself is thrown away
// says how it went rather than toasting, so /cache warm can reply with it
async function keepWarm($: $): Promise<{ ok: boolean; text: string }> {
  if (await read($, isRunning)) return { ok: false, text: 'Cannot keep warm while a turn is running' }
  const r = await $.model.fork({ prompt: 'Reply with the single word OK.' })
  // an empty reply still made the request; an API error or an abort carries zero usage and touched nothing
  if (r.isAnswered || r.reason === 'empty-reply') {
    const t = await $.clock.now()
    await update($, lastAt, () => t)
    await update($, hasWarned, () => false)
    const wasWarm = r.usage.cache_read_input_tokens >= (await read($, cachedTokens)) * 0.9
    failedPings = 0
    return { ok: true, text: wasWarm ? 'Cache kept warm' : 'Cache had expired; it was written again' }
  }
  if (r.reason === 'nothing-to-fork') {
    await update($, lastAt, () => null)
    return { ok: false, text: 'Nothing cached yet' }
  }
  return { ok: false, text: `Keep warm failed: ${r.reason}` }
}

// settings are userConfig fields; writing one saves to settings.json and reloads the module with the new value
// the toast already names the plugin. A save made while the module reloads finds no row, so look once more after a
// second; in the old module the reload cancels that wait, and session.start saves the click again
async function setOption($: $, field: string, value: boolean | number | string) {
  const find = async () => (await $.config.list()).find(r => r.key.replace(/@[^.]+/, '') === `cache-timer.${field}`)
  const row = (await find()) ?? (await $.clock.sleep(1000), await find())
  if (!row) {
    $.ui.toast(`${field} not found; set it in /config`)
    return
  }
  const r = await $.config.set({ key: row.key, value })
  if (r.deny) $.ui.toast(`${field} unchanged: ${r.deny}`)
}

// the band changes at once; the saved setting catches up when the module reloads
async function pickMode($: $, picked: AutoMode) {
  await update($, autoMode, () => picked)
  await update($, pickedMode, () => picked)
}

// whether a request kept the main conversation's cache warm: every main-thread request does; a subagent's
// does only when it re-read that prefix (a fork of the conversation), not when it ran its own prompt
export function refreshesMain(agentId: string | undefined, usage: ModelUsage, cached: number): boolean {
  return agentId === undefined || (cached > 0 && usage.cache_read_input_tokens >= cached * 0.9)
}

// the countdown outlives a restart: the last request's time, saved per session (the transcript's id), so a
// resumed conversation picks it up; in this one place, since lastAt changes in many
async function save($: $) {
  const last = await read($, lastAt)
  if (last === savedAt) return
  savedAt = last
  const key = `last:${await $.session.id()}`
  await (last === null ? $.store.delete(key) : $.store.set(key, { at: last, tokens: await read($, cachedTokens) }))
}

async function restore($: $, ttl: CacheTtl) {
  const t = await $.clock.now()
  const saved = (await $.store.get(`last:${await $.session.id()}`)) as { at: number; tokens: number } | undefined
  if (saved && saved.at + ttlMs(ttl) > t) {
    await update($, lastAt, () => saved.at)
    await update($, cachedTokens, () => saved.tokens)
  }
  // other sessions' entries whose cache has run out: nothing would read them
  for (const key of await $.store.keys()) {
    const v = (await $.store.get(key)) as { at?: number } | undefined
    if (key.startsWith('last:') && (v?.at ?? 0) + ttlMs('1h') < t) await $.store.delete(key)
  }
}

async function tick($: $, lead: number) {
  await save($)
  const mode = await read($, autoMode)
  const t = await $.clock.now()
  const ms = await left($, t)
  // the band reads only what it shows, written when it changes: each redraw gives its buttons new handles, and a
  // click that lands on an old one is lost
  const next = shownLeft(ms)
  if ((await read($, shown)) !== next) await update($, shown, () => next)
  if (isNarrowShown && Math.floor(t / 1000) % 3 === 0) await update($, widthCheck, n => n + 1)
  const isDue = ms !== null && ms > 0 && ms <= lead
  if (!isDue || isBusy) return
  isBusy = true
  try {
    // a subagent still running in the background: its report back will land on this conversation
    const isBackground = (await $.agent.list()).some(a => a.status === 'running')
    let action = nextAction({
      mode,
      isBackground,
      hasCompacted: await read($, hasCompacted),
      pings: await read($, pings),
      maxPings: MAX_PINGS,
      hasWarned: await read($, hasWarned),
    })
    // auto keep warm gave up on a failing API: remind once instead
    if (action === 'keep warm' && failedPings >= MAX_PINGS) action = (await read($, hasWarned)) ? 'none' : 'warn'
    if (action === 'compact') await compact($)
    if (action === 'keep warm') {
      const r = await keepWarm($)
      $.ui.toast(r.text)
      if (!r.ok) failedPings++
      // pings count only an idle stretch; a background agent at work is not one
      if (!isBackground) await update($, pings, n => n + 1)
    }
    if (action === 'warn') {
      await update($, hasWarned, () => true)
      const why = mode === 'compact' ? ' Auto-compact is waiting for background work.' : ''
      $.ui.toast(`Cache expires in ${label(next ?? 0)}.${why} Keep warm or Compact on the band.`, { timeoutMs: 15_000 })
    }
  } finally {
    isBusy = false
  }
}

// settings are the plugin's userConfig (plugin.json): rows in /config, saved in settings.json
export const register: Register = (on, options) => {
  // one setting, so a change is one write: each write reloads the module, which could drop a second
  const configMode: AutoMode = options.autoMode === 'compact' || options.autoMode === 'keep warm' ? options.autoMode : 'off'
  const configTtl: CacheTtl = options.ttl === '5m' ? '5m' : '1h'
  const minutes = Number(options.minutesBeforeExpiry ?? 5)
  // a lead as long as the TTL would never come due: act a minute into the cache at the earliest
  const lead = Math.min(Math.max(0.1, Number.isFinite(minutes) ? minutes : 5) * 60_000, ttlMs(configTtl) - 60_000)
  const NEXT_MODE: Record<AutoMode, AutoMode> = { off: 'compact', compact: 'keep warm', 'keep warm': 'off' }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cache',
      description: 'Show or hide the prompt cache band; /cache help for more',
      immediate: true,
    })
    await update($, ttl, () => configTtl)
    const picked = await read($, pickedMode)
    if (picked !== null && picked !== configMode) void setOption($, 'autoMode', picked)
    else {
      await update($, pickedMode, () => null)
      await update($, autoMode, () => configMode)
    }
    await restore($, configTtl)
    $.clock.every(1000, () => void tick($, lead))
    return next(e)
  })

  // /cache toggles the band; /cache help explains the controls; the rest act or change settings
  on('command.run', { command: 'cache' }, async ($, e) => {
    const [what = '', value = ''] = e.args.trim().toLowerCase().split(/\s+/)
    const total = ttlMs(await read($, ttl))
    const mode = await read($, autoMode)
    const autoText = mode === 'off' ? 'off' : `${mode} at ${label(total - lead)}`
    if (what === '') {
      const isNowHidden = !(await read($, isHidden))
      await update($, isHidden, () => isNowHidden)
      return { text: isNowHidden ? 'Cache band hidden. /cache shows it.' : 'Cache band shown. /cache help lists the controls.' }
    }
    if (what === 'warm') return { text: (await keepWarm($)).text }
    const modes: Record<string, AutoMode> = { off: 'off', compact: 'compact', 'keep-warm': 'keep warm' }
    const picked = modes[value]
    if (what === 'auto' && picked) {
      await pickMode($, picked)
      await setOption($, 'autoMode', picked)
      return { text: `Auto: ${picked}.` }
    }
    const minutes = /^(\d+(?:\.\d+)?)m?$/.exec(value)
    if (what === 'auto' && minutes) {
      await setOption($, 'minutesBeforeExpiry', Number(minutes[1]))
      const off = mode === 'off' ? ' Auto is off: /cache auto compact or keep-warm turns it on.' : ''
      return { text: `Auto acts ${label(Math.min(Number(minutes[1]) * 60_000, total - 60_000))} before the cache expires.${off}` }
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
        '  the time            click to shrink the band to the dot and the time; click it again to open it',
        '  ×                   hide the band (/cache shows it again)',
        '',
        'Commands',
        '  /cache              show or hide the band',
        '  /cache warm         keep the cache warm now',
        '  /cache auto compact compact before the cache expires (also: keep-warm, off)',
        '  /cache auto 5m      act 5 minutes before the cache expires',
        '  /cache ttl 1h       set the cache lifetime (1h or 5m)',
        '',
        'With auto off you get a reminder before the cache expires. Auto-compact waits while a background agent',
        'runs, so its report back finds the full conversation; keep warm still fires.',
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
      await update($, hasWarned, () => false)
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
    // a turn that made no request (a /compact the desktop app runs as one) leaves the band saying compacted
    if ((await read($, lastAt)) !== null) await update($, hasCompacted, () => false)
    await update($, pings, () => 0)
    failedPings = 0
    return next(e)
  })

  // any compaction of the main conversation, the band's, a typed /compact or the engine's own: the cache it
  // counted down is gone
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && !r.skip) {
      await update($, lastAt, () => null)
      await update($, hasCompacted, () => true)
    }
    return r
  })

  // /clear and /resume go on to another conversation under the same plugin state, with nothing cached for it yet
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      await update($, lastAt, () => null)
      await update($, cachedTokens, () => 0)
      await update($, hitPct, () => null)
      await update($, hasWarned, () => false)
      await update($, hasCompacted, () => false)
      await update($, pings, () => 0)
    }
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
        void keepWarm($).then(r => $.ui.toast(r.text))
        break
      case 'auto': {
        // saved once the clicks stop: each save reloads the module, slowly in the desktop app, and a click during
        // a reload waits for it and finds no settings row
        const picked = NEXT_MODE[mode]
        await pickMode($, picked)
        saveTimer?.cancel()
        saveTimer = $.clock.after(1500, () => void setOption($, 'autoMode', picked))
        break
      }
      case 'time':
        await update($, isCollapsed, () => true)
        break
      case 'expand':
        await update($, isCollapsed, () => false)
        break
      case 'close':
        await update($, isHidden, () => true)
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
    const isArmed = mode !== 'off'
    const working = e.props.isWorking
    // presses are handled by key in the ui.press hook above
    const press = () => {}

    let text = '—'
    let color = 'gray'
    // while Claude works every step refreshes the cache: there is nothing to count down
    if (working) {
      text = 'live'
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
    // compact needs a conversation at rest: nothing cached yet (—) or just compacted leaves nothing to compact
    const canCompact = remaining !== null && !working

    const hitText = hit === null ? null : `${hit}%`
    const autoText = isArmed ? `auto ${mode === 'keep warm' ? 'warm' : mode} ${label(total - lead)}` : 'auto off'
    const used =
      2 + 6 + text.length + 1 + (hitText ? hitText.length + 1 : 0) + autoText.length + 1 + (isWarm && !working ? 14 : 0) + (canCompact ? 12 : 0) + 4 + 6 // ponytail: 6 cells of slack, as the desktop draws buttons wider than cells; measure if it still clips
    // the compact view: chosen by clicking the time, or forced when the band is too narrow for the full row and
    // a bar of at least 8 segments; a forced one has nothing to open, so its time is plain text
    const isCollapsedByUser = await read($, isCollapsed)
    await read($, widthCheck)
    isNarrowShown = !isCollapsedByUser && e.props.bodyColumns < used + 8
    if (isCollapsedByUser || isNarrowShown) {
      return (
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Text color={color}>●</Text>
          {isCollapsedByUser ? <Button key="expand" label={text} plain onPress={press} /> : <Text bold color={color}>{text}</Text>}
        </Box>
      )
    }
    const n = segmentsFor(e.props.bodyColumns, used)
    const runs = bar(working ? 1 : Math.max(0, remaining ?? 0) / total, isArmed ? lead / total : null, n)
    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Text color={color}>●</Text>
        <Text dimColor>cache</Text>
        {/* clicking the time shrinks the band to the dot and the time */}
        <Button key="time" label={text} plain onPress={press} />
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
        <Button key="auto" label={autoText} plain dimColor onPress={press} />
        <Box flexGrow={1} />
        {isWarm && !working && <Button key="warm" label="Keep warm" onPress={press} />}
        {canCompact && <Button key="compact" label="Compact" variant="primary" onPress={press} />}
        <Button key="close" label="×" plain role="dismiss" onPress={press} />
      </Box>
    )
  })
}
