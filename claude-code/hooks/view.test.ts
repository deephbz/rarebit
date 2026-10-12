import { expect, test } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const
const CONVERSATION = {
  items: [
    { kind: 'user', time: '13:03', text: 'evaluate mods' },
    { kind: 'continuation', time: '13:04', text: 'Reading the API.' },
    { kind: 'compaction', time: '13:10' },
    { kind: 'stop', time: '13:12', text: 'Feasible.' },
  ],
  ratio: 0.12, rarebitTokens: 4200, totalTokens: 36000,
}

test('/rarebit rows stay out of the visible transcript', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine row')
  })
  for (const surface of SURFACES) {
    const out = await $.ui.mount({ plugin: 'rarebit', surface, component: 'CommandOutput', props: { command: 'rarebit', args: 'view', text: 'x', isErrored: false } } as any)
    expect(await out.find({ text: /engine row/ })).toBeUndefined()
    const echo = await $.ui.mount({ plugin: 'rarebit', surface, component: 'UserMessage', props: { text: '/rarebit view', origin: { kind: 'composer' }, isExpanded: false } } as any)
    expect(await echo.find({ text: /engine row/ })).toBeUndefined()
    const other = await $.ui.mount({ plugin: 'rarebit', surface, component: 'CommandOutput', props: { command: 'cost', args: '', text: 'x', isErrored: false } } as any)
    expect((await other.find({ text: /engine row/ }))?.text).toBe('engine row')
  }
})

test('the view draws marks, times and compaction on both surfaces', async ($, on) => {
  on('session.id', () => ({ value: 'test-session' }) as any)
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(CONVERSATION), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as any)
  on('ui.open', () => ({ value: { isPlaced: true } }) as any)
  await $.command.run({ command: 'rarebit', args: 'view' } as any)
  await new Promise(r => setTimeout(r, 50))
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: 'rarebit', surface, component: 'Pane', props: { requestId: 'rarebit-view' }, requestId: 'rarebit-view' } as any)
    expect((await pane.find({ text: /You □/ }))?.text).toContain('13:03')
    expect(await pane.find({ text: /• Agent continues/ })).toBeDefined()
    expect(await pane.find({ text: /● Agent stops/ })).toBeDefined()
    expect(await pane.find({ text: /compacted 13:10/ })).toBeDefined()
    const tree = JSON.stringify(await pane.drawn())
    expect(tree.split('3 messages · 12% of prose').length - 1).toBe(2)
    if (surface === 'desktop') {
      expect(await pane.find({ key: 'to-bottom' })).toBeDefined()
      expect(await pane.find({ key: 'to-top' })).toBeDefined()
      for (const at of ['head', 'foot']) for (const b of ['toggle-continues', 'refresh', 'copy-all']) expect(await pane.find({ key: `${at}-${b}` })).toBeDefined()
      const drawn = JSON.stringify(await pane.drawn())
      expect(drawn.indexOf('Feasible.')).toBeLessThan(drawn.indexOf('Ask on the side'))
    }
  }

})

test('the view hides and shows agent-continues on one press', async ($, on) => {
  on('session.id', () => ({ value: 'test-session' }) as any)
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(CONVERSATION), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as any)
  on('ui.open', () => ({ value: { isPlaced: true } }) as any)
  await $.command.run({ command: 'rarebit', args: 'view' } as any)
  await new Promise(r => setTimeout(r, 50))
  const pane = await $.ui.mount({ plugin: 'rarebit', surface: 'desktop', component: 'Pane', props: {}, requestId: 'rarebit-view' } as any)
  expect(JSON.stringify(await pane.drawn())).toContain('Reading the API.')
  await pane.press({ key: 'head-toggle-continues' } as any)
  const hidden = JSON.stringify(await pane.drawn())
  expect(hidden).not.toContain('Reading the API.')
  expect(hidden).toContain('Feasible.')
  expect(hidden).toContain('· 1 hidden')
  expect(hidden).toContain('Show • 1')
  await pane.press({ key: 'foot-toggle-continues' } as any)
  expect(JSON.stringify(await pane.drawn())).toContain('Reading the API.')
})
