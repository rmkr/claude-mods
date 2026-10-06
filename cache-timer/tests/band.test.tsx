import { expect, mock, test } from 'claude-code/testing'

import { bar, label, nextAction, segmentsFor, shownLeft } from '../hooks/bars'
import { refreshesMain } from '../hooks/register'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } } as const

// one test per surface: the session's state (hidden) outlives a mount
for (const surface of ['terminal', 'desktop'] as const) {
  test(`the band shrinks from the time and back, and × and /cache hide and show it on ${surface}`, async ($, on) => {
    // stands for the engine, which draws nothing in the band once the plugin passes
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box />
    })
    const ui = await $.ui.mount({ plugin: 'cache-timer', surface, ...BAND })
    // nothing cached yet: nothing to compact or keep warm
    expect(await ui.find({ key: 'compact' })).toBeUndefined()
    expect(await ui.find({ key: 'warm' })).toBeUndefined()
    expect(await ui.find({ key: 'auto' })).toBeDefined()
    await ui.press({ key: 'time' })
    expect(await ui.find({ key: 'auto' })).toBeUndefined()
    await ui.press({ key: 'expand' })
    expect(await ui.find({ key: 'auto' })).toBeDefined()
    await ui.press({ key: 'close' })
    expect(await ui.find({ key: 'auto' })).toBeUndefined()
    await $.command.run({ command: 'cache', args: '' })
    expect(await ui.find({ key: 'auto' })).toBeDefined()
    await $.command.run({ command: 'cache', args: '' })
    expect(await ui.find({ key: 'auto' })).toBeUndefined()
    await $.command.run({ command: 'cache', args: '' })
    expect(await ui.find({ key: 'auto' })).toBeDefined()
    await ui.unmount()
  })
}

test('the bar marks the auto-compact segment and drains with time', async () => {
  const runs = bar(0.5, 5 / 60)
  expect(runs.map(r => r.text).join('')).toHaveLength(24)
  expect(runs.filter(r => r.ink === 'color').map(r => r.text).join('')).toHaveLength(11)
  expect(runs.filter(r => r.ink === 'fg')).toHaveLength(1)
  expect(bar(1, null).every(r => r.ink === 'color')).toBe(true)
})

test('main requests and forks keep the cache warm; a subagent on its own prompt does not', async () => {
  const usage = (read: number) => ({ input_tokens: 10, output_tokens: 10, cache_read_input_tokens: read, cache_creation_input_tokens: 0 })
  expect(refreshesMain(undefined, usage(0), 50_000)).toBe(true)
  expect(refreshesMain('fork', usage(49_000), 50_000)).toBe(true)
  expect(refreshesMain('explorer', usage(3_000), 50_000)).toBe(false)
  expect(refreshesMain('explorer', usage(3_000), 0)).toBe(false)
})

test('the bar takes the room its region leaves, 8 to 24 segments', async () => {
  expect(segmentsFor(60, 10)).toBe(24)
  expect(segmentsFor(30, 10)).toBe(20)
  expect(segmentsFor(12, 10)).toBe(8)
  expect(bar(0.5, null, 10).map(r => r.text).join('')).toHaveLength(10)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`while Claude works there is nothing to compact or keep warm on ${surface}`, async $ => {
    const ui = await $.ui.mount({ plugin: 'cache-timer', surface, ...BAND, props: { ...BAND.props, isWorking: true } })
    expect(await ui.find({ key: 'compact' })).toBeUndefined()
    expect(await ui.find({ key: 'warm' })).toBeUndefined()
    expect(await ui.find({ key: 'auto' })).toBeDefined()
    expect(await ui.find({ key: 'close' })).toBeDefined()
    await ui.unmount()
  })
}

test('the shown time moves in whole minutes until the last minute, so the band redraws rarely', async () => {
  expect(shownLeft(null)).toBe(null)
  expect(shownLeft(-5)).toBe(0)
  expect(shownLeft(44 * 60_000 + 1)).toBe(45 * 60_000)
  expect(shownLeft(44 * 60_000)).toBe(44 * 60_000)
  expect(shownLeft(59_500)).toBe(60_000)
  expect(shownLeft(12_300)).toBe(13_000)
  expect(label(57.5 * 60_000)).toBe('58m')
  expect(label(13_000)).toBe('13s')
})

test('before expiry: the auto action, a reminder when there is none, and compact waits for background work', async () => {
  const at = { isBackground: false, hasCompacted: false, pings: 0, maxPings: 3, hasWarned: false }
  expect(nextAction({ ...at, mode: 'off' })).toBe('warn')
  expect(nextAction({ ...at, mode: 'off', hasWarned: true })).toBe('none')
  expect(nextAction({ ...at, mode: 'compact' })).toBe('compact')
  expect(nextAction({ ...at, mode: 'compact', isBackground: true })).toBe('warn')
  expect(nextAction({ ...at, mode: 'compact', hasCompacted: true })).toBe('none')
  expect(nextAction({ ...at, mode: 'keep warm' })).toBe('keep warm')
  expect(nextAction({ ...at, mode: 'keep warm', pings: 3 })).toBe('none')
  expect(nextAction({ ...at, mode: 'keep warm', pings: 3, isBackground: true })).toBe('keep warm')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a band too narrow for the full row draws the compact view on ${surface}`, async $ => {
    const ui = await $.ui.mount({ plugin: 'cache-timer', surface, ...BAND, props: { ...BAND.props, bodyColumns: 30 } })
    expect(await ui.find({ key: 'auto' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '●' })).toBeDefined()
    await ui.redraw({ ...BAND.props, bodyColumns: 120 })
    expect(await ui.find({ key: 'auto' })).toBeDefined()
    await ui.unmount()
  })
}

const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 1000 }

// stands for the engine under the plugin: a session, a main model step that caches the conversation, toasts
function engine(
  on: any,
  fork: () => unknown = () => ({ isAnswered: true, text: 'OK', usage: USAGE }),
  agents: unknown[] = [],
  saved: Record<string, unknown> = {},
) {
  const toasts: string[] = []
  mock.store(on, saved)
  on('session.id', () => ({ value: 'this' }) as any)
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: null }) as any)
  on('agent.list', () => ({ value: agents }) as any)
  on('model.fork', () => ({ value: fork() }) as any)
  on('ui.toast', ($: any, e: any) => {
    toasts.push(e.text)
    return { value: null } as any
  })
  on('turn.step', async function* () {
    return { turnId: 't', index: 0, answer: 'hi', toolUses: [], stopReason: 'end_turn', usage: { model: 'm', ...USAGE } }
  })
  return toasts
}

async function cacheOnce($: any) {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 3 })) {
  }
}

test('a failed keep warm leaves the countdown running out and stops after 3 tries', { options: { autoMode: 'keep warm' } }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  let forks = 0
  const toasts = engine(on, () => (forks++, { isAnswered: false, reason: 'api-error', status: 529, usage: { ...USAGE, cache_read_input_tokens: 0 } }))
  await cacheOnce($)
  for (let i = 0; i < 55 * 60 + 10; i++) await clock.advance(1000)
  expect(forks).toBe(3)
  expect(toasts.every(t => t.startsWith('Keep warm failed'))).toBe(true)
  const ui = await $.ui.mount({ plugin: 'cache-timer', surface: 'terminal', ...BAND })
  expect((await ui.find({ key: 'time' }))?.text).toBe('5m')
  await ui.unmount()
})

test('failed keep warms stop after 3 tries while a background agent runs too', { options: { autoMode: 'keep warm' } }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  let forks = 0
  const failed = () => (forks++, { isAnswered: false, reason: 'api-error', status: 529, usage: { ...USAGE, cache_read_input_tokens: 0 } })
  const toasts = engine(on, failed, [{ status: 'running' }])
  await cacheOnce($)
  for (let i = 0; i < 55 * 60 + 30; i++) await clock.advance(1000)
  expect(forks).toBe(3)
  expect(toasts.filter(t => t.startsWith('Cache expires'))).toHaveLength(1)
})

test("the band's Compact ends the countdown", async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on)
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] }) as any)
  await cacheOnce($)
  await clock.advance(1000)
  const ui = await $.ui.mount({ plugin: 'cache-timer', surface: 'terminal', ...BAND })
  await ui.press({ key: 'compact' })
  await clock.advance(1000)
  expect((await ui.find({ key: 'time' }))?.text).toBe('compacted')
  expect(await ui.find({ key: 'compact' })).toBeUndefined()
  await ui.unmount()
})

test('on a 5m cache the default lead still reminds once', { options: { ttl: '5m' } }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const toasts = engine(on)
  await cacheOnce($)
  for (let i = 0; i < 4 * 60; i++) await clock.advance(1000)
  expect(toasts.filter(t => t.startsWith('Cache expires'))).toHaveLength(1)
})

test('a compaction or a /clear ends the countdown', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on)
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] }) as any)
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }) as any)
  on('turn.complete', () => ({ text: '' }) as any)
  on('session.end', ($: any, e: any) => ({ sessionId: e.sessionId }) as any)
  await cacheOnce($)
  await clock.advance(1000)
  const ui = await $.ui.mount({ plugin: 'cache-timer', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'compact' })).toBeDefined()
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as any)
  await clock.advance(1000)
  expect((await ui.find({ key: 'time' }))?.text).toBe('compacted')
  // the desktop app runs /compact as a turn with no request of its own
  await $.turn.start({ text: '/compact', turnId: 'c' } as any)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'c', reason: 'answer' } as any)
  await clock.advance(1000)
  expect((await ui.find({ key: 'time' }))?.text).toBe('compacted')
  await cacheOnce($)
  await clock.advance(1000)
  expect(await ui.find({ key: 'compact' })).toBeDefined()
  await $.session.end({ reason: 'clear', sessionId: 's' } as any)
  await clock.advance(1000)
  expect((await ui.find({ key: 'time' }))?.text).toBe('—')
  await ui.unmount()
})

test('the auto button cycles off, compact, keep warm, off and saves once the clicks stop', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on)
  const writes: unknown[] = []
  on('config.list', () => ({ value: [{ key: 'cache-timer.autoMode', label: 'Auto action', kind: 'choice', value: 'off', provider: { plugin: 'cache-timer', tier: 'user' }, isLocked: false }] }) as any)
  on('config.set', ($: any, e: any) => {
    writes.push(e.value)
    return { value: e.value } as any
  })
  await cacheOnce($)
  const ui = await $.ui.mount({ plugin: 'cache-timer', surface: 'terminal', ...BAND })
  const labels: (string | undefined)[] = []
  for (let i = 0; i < 3; i++) {
    await ui.press({ key: 'auto' })
    labels.push((await ui.find({ key: 'auto' }))?.text)
  }
  expect(writes).toEqual([])
  await clock.advance(1500)
  expect(writes).toEqual(['off'])
  expect(labels.map(l => l?.split(' ').slice(0, 2).join(' '))).toEqual(['auto compact', 'auto warm', 'auto off'])
  await ui.unmount()
})

test('a save made while the module reloads looks for its row once more', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on)
  const writes: unknown[] = []
  let lists = 0
  on('config.list', () => ({ value: lists++ === 0 ? [] : [{ key: 'cache-timer.autoMode', label: 'Auto action', kind: 'choice', value: 'off', provider: { plugin: 'cache-timer', tier: 'user' }, isLocked: false }] }) as any)
  on('config.set', ($: any, e: any) => {
    writes.push(e.value)
    return { value: e.value } as any
  })
  await cacheOnce($)
  const ui = await $.ui.mount({ plugin: 'cache-timer', surface: 'terminal', ...BAND })
  await ui.press({ key: 'auto' })
  await clock.advance(2500)
  expect(writes).toEqual(['compact'])
  await ui.unmount()
})

test('a reload with settings from before the click keeps the click and saves it again', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on)
  const writes: unknown[] = []
  on('config.list', () => ({ value: [{ key: 'cache-timer.autoMode', label: 'Auto action', kind: 'choice', value: 'off', provider: { plugin: 'cache-timer', tier: 'user' }, isLocked: false }] }) as any)
  on('config.set', ($: any, e: any) => {
    writes.push(e.value)
    return { value: e.value } as any
  })
  await cacheOnce($)
  const ui = await $.ui.mount({ plugin: 'cache-timer', surface: 'desktop', ...BAND })
  await ui.press({ key: 'auto' })
  // stands for a reload whose options still say off, as the save the click made was cut off
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect((await ui.find({ key: 'auto' }))?.text?.startsWith('auto compact')).toBe(true)
  await clock.advance(1500)
  expect(writes).toEqual(['compact', 'compact'])
  await ui.unmount()
})

test('a reopened conversation picks up its countdown', async ($, on) => {
  const clock = mock.clock(on, { now: 10_000_000 })
  engine(on, undefined, [], { 'last:this': { at: 10_000_000 - 15 * 60_000, tokens: 50_000 } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  const ui = await $.ui.mount({ plugin: 'cache-timer', surface: 'terminal', ...BAND })
  expect((await ui.find({ key: 'time' }))?.text).toBe('45m')
  await ui.unmount()
})

test('a conversation reopened after its cache ran out starts over', async ($, on) => {
  const clock = mock.clock(on, { now: 10_000_000 })
  engine(on, undefined, [], { 'last:this': { at: 10_000_000 - 2 * 3_600_000, tokens: 50_000 } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  const ui = await $.ui.mount({ plugin: 'cache-timer', surface: 'terminal', ...BAND })
  expect((await ui.find({ key: 'time' }))?.text).toBe('—')
  await ui.unmount()
})
