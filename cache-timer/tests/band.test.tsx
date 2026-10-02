import { expect, test } from 'claude-code/testing'

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
