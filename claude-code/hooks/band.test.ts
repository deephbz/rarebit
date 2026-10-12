import { expect, test } from 'claude-code/testing'

const SELECT = { items: [{ kind: 'user', time: '13:03', text: 'hi' }], ratio: 0.1, rarebitTokens: 10, totalTokens: 100 }
const DIAG = { ms: 9, branch: 20, user: 1, continuation: 0, stop: 0, compactions: 0, ratio: 0.1, rarebitTokens: 10, totalTokens: 100,
  session: { user: 10, continuation: 0, stop: 0, toolCalls: 0, toolResults: 90, thinking: 0, summary: 0, other: 0 },
  live: { user: 10, continuation: 0, stop: 0, toolCalls: 0, toolResults: 90, thinking: 0, summary: 0, other: 0 } }
const settle = () => new Promise(r => setTimeout(r, 50))

test('recap and diagnosis lines coexist and dismiss separately', async ($, on) => {
  on('session.id', () => ({ value: 's' }) as any)
  on('process.run', (_, e: any) => ({
    value: { exitCode: 0, stdout: JSON.stringify(e.argv.includes('diagnosis') ? DIAG : SELECT), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }) as any)
  on('model.complete', () => ({ value: { isAnswered: true, text: 'Band work is done.', usage: {} } }) as any)
  on('ui.render', ($, e) => h($.ui.resolve(e).Text, {}, 'engine band'))

  await $.command.run({ command: 'rarebit', args: 'diagnosis' } as any)
  await $.command.run({ command: 'rarebit', args: 'recap' } as any)
  await settle()
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'rarebit', surface, component: 'AbovePrompt', props: {} } as any)
    expect((await band.find({ text: /Since you left/ }))?.text).toContain('Band work is done.')
    expect((await band.find({ text: /Diagnosis:/ }))?.text).toContain('1 Rarebits')
  }
  const band = await $.ui.mount({ plugin: 'rarebit', surface: 'desktop', component: 'AbovePrompt', props: {} } as any)
  await band.press({ key: 'dismiss-diagnosis' } as any)
  const after = await $.ui.mount({ plugin: 'rarebit', surface: 'desktop', component: 'AbovePrompt', props: {} } as any)
  expect(await after.find({ text: /Diagnosis:/ })).toBeUndefined()
  expect(await after.find({ text: /Since you left/ })).toBeDefined()
})

test('recap and side ask use the configured models', { options: { recapModel: 'claude-haiku-5-5', askModel: 'haiku' } }, async ($, on) => {
  const used: string[] = []
  on('session.id', () => ({ value: 's' }) as any)
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(SELECT), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as any)
  on('model.complete', (_, e: any) => { used.push(e.model); return { value: { isAnswered: true, text: 'ok', usage: {} } } as any })
  on('ui.open', () => ({ value: { isPlaced: true } }) as any)
  on('clock.now', () => ({ value: 0 }) as any)
  await $.command.run({ command: 'rarebit', args: 'recap' } as any)
  await $.command.run({ command: 'rarebit', args: 'ask what is left?' } as any)
  await settle()
  expect(used).toEqual(['claude-haiku-5-5', 'haiku'])
})

test('models default to haiku for recap and sonnet for side ask', async ($, on) => {
  const used: string[] = []
  on('session.id', () => ({ value: 's' }) as any)
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(SELECT), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as any)
  on('model.complete', (_, e: any) => { used.push(e.model); return { value: { isAnswered: true, text: 'ok', usage: {} } } as any })
  on('ui.open', () => ({ value: { isPlaced: true } }) as any)
  on('clock.now', () => ({ value: 0 }) as any)
  await $.command.run({ command: 'rarebit', args: 'recap' } as any)
  await $.command.run({ command: 'rarebit', args: 'ask what is left?' } as any)
  await settle()
  expect(used).toEqual(['haiku', 'sonnet'])
})

test('the band offers Rarebit actions while a compaction runs, and drops them after', async ($, on) => {
  const seen: (string | undefined)[] = []
  on('session.id', () => ({ value: 's' }) as any)
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(SELECT), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as any)
  on('ui.open', () => ({ value: { isPlaced: true } }) as any)
  on('ui.render', ($, e) => h($.ui.resolve(e).Text, {}, 'engine band'))
  on('session.compact', async (_, e: any) => {
    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await $.ui.mount({ plugin: 'rarebit', surface, component: 'AbovePrompt', props: {} } as any)
      seen.push((await band.find({ text: /Compacting/ }))?.text)
      if (surface === 'desktop') for (const key of ['c-view', 'c-diagnosis', 'c-recap', 'c-lens']) expect(await band.find({ key } as any)).toBeDefined()
      else expect(JSON.stringify(await band.drawn())).toContain('Diagnosis')
    }
    return { messages: e.messages }
  })
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'x', toolUses: [] }] } as any)
  expect(seen.every(t => t?.includes('Rarebit stays live'))).toBe(true)
  const after = await $.ui.mount({ plugin: 'rarebit', surface: 'terminal', component: 'AbovePrompt', props: {} } as any)
  expect(await after.find({ text: /Compacting/ })).toBeUndefined()
})

test('diagnosis draws a live-context bar and a whole-session bar', async ($, on) => {
  const live = { user: 10, continuation: 10, stop: 0, toolCalls: 30, toolResults: 50, thinking: 0, summary: 0, other: 0 }
  const session = { user: 20, continuation: 10, stop: 10, toolCalls: 20, toolResults: 40, thinking: 0, summary: 0, other: 0 }
  on('session.id', () => ({ value: 's' }) as any)
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify({ ...DIAG, live, session }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as any)
  on('session.usage', () => ({
    value: { startedAt: 0, rateLimits: [], context: { window: 1000, breakdown: {
      totalTokens: 300, rawMaxTokens: 1000, percentage: 30,
      categories: [
        { name: 'System prompt', tokens: 100, color: 'promptBorder', isDeferred: false, kind: 'used' },
        { name: 'Messages', tokens: 200, color: 'permission', isDeferred: false, kind: 'used' },
        { name: 'Free space', tokens: 700, color: 'inactive', isDeferred: false, kind: 'free' },
      ] } } },
  }) as any)
  on('ui.render', ($, e) => h($.ui.resolve(e).Text, {}, 'engine band'))
  await $.command.run({ command: 'rarebit', args: 'diagnosis' } as any)
  await settle()
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'rarebit', surface, component: 'AbovePrompt', props: { bodyColumns: 52 } } as any)
    expect((await band.find({ text: /Diagnosis:/ }))?.text).toContain('40% of the session')
    expect((await band.find({ text: /Live context/ }))?.text).toContain('300 of 1.0k (30%)')
    expect((await band.find({ text: /Whole session/ }))?.text).toContain('100 est.')
    // The Messages row splits by the live shares: 10% of 200 is □ 20 of 1000.
    expect((await band.find({ text: /System prompt 10%/ }))?.text).toContain('□ You 2%')
    expect((await band.find({ text: /Tool results 40%/ }))?.text).toContain('● Stops 10%')
  }
})
