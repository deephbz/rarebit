import { expect, test } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const
const GROUP = {
  plugin: 'rarebit',
  component: 'ToolGroup',
  props: { calls: [{}, {}, {}] as any, isActive: false, isExpanded: false },
} as const

test('the lens folds a tool group to one line and back', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine row')
  })
  for (const surface of SURFACES) {
    const before = await $.ui.mount({ ...GROUP, surface } as any)
    expect((await before.find({ text: /engine row/ }))?.text).toBe('engine row')
  }
  await $.command.run({ command: 'rarebit', args: '' } as any)
  for (const surface of SURFACES) {
    const after = await $.ui.mount({ ...GROUP, surface } as any)
    expect((await after.find({ text: /tool steps/ }))?.text).toContain('3 tool steps')
  }
  await $.command.run({ command: 'rarebit', args: '' } as any)
  const back = await $.ui.mount({ ...GROUP, surface: 'terminal' } as any)
  expect(await back.find({ text: /tool steps/ })).toBeUndefined()
})
