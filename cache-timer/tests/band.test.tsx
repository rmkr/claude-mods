import { expect, test } from 'claude-code/testing'

import { bar } from '../hooks/register'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } } as const

// one test per surface: the session's state (collapsed or not) outlives a mount
for (const surface of ['terminal', 'desktop'] as const) {
  test(`the band draws and collapses on ${surface}`, async ($, on) => {
    // stands for the engine, which draws nothing in the band once the plugin passes
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box />
    })
    const ui = await $.ui.mount({ plugin: 'cache-timer', surface, ...BAND })
    expect(await ui.find({ key: 'compact' })).toBeDefined()
    expect(await ui.find({ key: 'auto' })).toBeDefined()
    await ui.press({ key: 'time' })
    expect(await ui.find({ key: 'compact' })).toBeUndefined()
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
