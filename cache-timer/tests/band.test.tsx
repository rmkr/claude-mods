import { expect, test } from 'claude-code/testing'

import { bar, segmentsFor, shownLeft, sweep } from '../hooks/bars'
import { refreshesMain } from '../hooks/register'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } } as const

// one test per surface: the session's state (hidden) outlives a mount
for (const surface of ['terminal', 'desktop'] as const) {
  test(`the band draws, collapses to a pill and back, and /cache hides and shows it on ${surface}`, async ($, on) => {
    // stands for the engine, which draws nothing in the band once the plugin passes
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box />
    })
    const ui = await $.ui.mount({ plugin: 'cache-timer', surface, ...BAND })
    expect(await ui.find({ key: 'compact' })).toBeDefined()
    expect(await ui.find({ key: 'auto' })).toBeDefined()
    expect(await ui.find({ key: 'close' })).toBeUndefined()
    await ui.press({ key: 'collapse' })
    expect(await ui.find({ key: 'compact' })).toBeUndefined()
    await ui.press({ key: 'expand' })
    expect(await ui.find({ key: 'compact' })).toBeDefined()
    await $.command.run({ command: 'cache', args: '' })
    expect(await ui.find({ key: 'compact' })).toBeUndefined()
    await $.command.run({ command: 'cache', args: '' })
    expect(await ui.find({ key: 'compact' })).toBeDefined()
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

test('the sweep is a three-segment comet that runs off the end and starts over', async () => {
  const lit = (step: number) => sweep(step).filter(r => r.ink === 'color').map(r => r.text).join('').length
  expect(lit(0)).toBe(1)
  expect(lit(5)).toBe(3)
  expect(lit(24 + 2)).toBe(0)
  expect(lit(24 + 3)).toBe(1)
  expect(sweep(10).map(r => r.text).join('')).toHaveLength(24)
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
})
