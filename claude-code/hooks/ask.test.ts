import { expect, test } from 'claude-code/testing'

const SELECT = { items: [{ kind: 'user', time: '13:03', text: 'ship the lens' }], ratio: 0.1, rarebitTokens: 10, totalTokens: 100 }
const RECALL = { count: 1, message: '# Rarebit Recall\n\nfiles…\n\n## Current request\n\n```text\nwhat did we decide?\n```' }
const settle = () => new Promise(r => setTimeout(r, 50))
const ok = (stdout: unknown) => ({ value: { exitCode: 0, stdout: JSON.stringify(stdout), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as any

test('side ask: own pane, follow-ups keep the thread, nothing enters the main session', async ($, on) => {
  let submitted = 0
  let appended = 0
  const prompts: string[] = []
  const copied: string[] = []
  on('session.id', () => ({ value: 's' }) as any)
  on('process.run', () => ok(SELECT))
  on('ui.open', () => ({ value: { isPlaced: true } }) as any)
  on('ui.close', () => ({ value: undefined }) as any)
  on('clock.now', () => ({ value: Date.UTC(2026, 9, 10, 14, 5) }) as any)
  on('model.complete', (_, e: any) => { prompts.push(String(e.prompt)); return { value: { isAnswered: true, text: `answer ${prompts.length}`, usage: {} } } as any })
  on('prompt.submit', () => { submitted += 1; return { drop: 'test' } as any })
  on('session.append', () => { appended += 1; return { deny: 'test' } as any })
  on('ui.copy', (_, e: any) => { copied.push(e.text); return { value: { isCopied: true } } as any })
  on('ui.render', ($, e) => h($.ui.resolve(e).Text, {}, 'engine row'))

  await $.command.run({ command: 'rarebit', args: 'ask what did I ask for?' } as any)
  await settle()
  await $.command.run({ command: 'rarebit', args: 'ask and why?' } as any)
  await settle()
  const band = await $.ui.mount({ plugin: 'rarebit', surface: 'terminal', component: 'AbovePrompt', props: {} } as any)
  expect(await band.find({ text: /Rarebit:/ })).toBeUndefined()
  expect(prompts[0]).toContain('ship the lens')
  expect(prompts[1]).toContain('Question: what did I ask for?\nAnswer: answer 1')
  const term = await $.ui.mount({ plugin: 'rarebit', surface: 'terminal', component: 'Pane', props: {}, requestId: 'rarebit-side' } as any)
  expect((await term.find({ text: /answer 2/ }))?.text).toContain('and why?')
  const pane = await $.ui.mount({ plugin: 'rarebit', surface: 'desktop', component: 'Pane', props: {}, requestId: 'rarebit-side' } as any)
  expect((await pane.find({ text: /Snapshot of 1 Rarebit/ }))).toBeDefined()
  await pane.press({ key: 'copy-t0' } as any)
  expect(copied).toEqual(['answer 1'])
  expect(submitted).toBe(0)
  expect(appended).toBe(0)
  await pane.press({ key: 'end' } as any)
  expect(await pane.find({ text: /answer 1/ })).toBeUndefined()
})

test('recall: one message into the main session, drawn as one line', async ($, on) => {
  const submitted: string[] = []
  on('session.id', () => ({ value: 's' }) as any)
  on('process.run', (_, e: any) => ok(e.argv.includes('recall') ? RECALL : SELECT))
  on('prompt.submit', (_, e: any) => { submitted.push(e.text); return { text: e.text } as any })
  on('ui.render', ($, e) => h($.ui.resolve(e).Text, {}, 'engine row'))

  await $.command.run({ command: 'rarebit', args: 'recall what did we decide?' } as any)
  await settle()
  expect(submitted).toEqual([RECALL.message])
  for (const surface of ['terminal', 'desktop'] as const) {
    const row = await $.ui.mount({ plugin: 'rarebit', surface, component: 'UserMessage', props: { text: RECALL.message, origin: { kind: 'plugin', name: 'rarebit' }, isExpanded: false } } as any)
    expect((await row.find({ text: /Rarebit recall/ }))?.text).toContain('what did we decide?')
    expect(await row.find({ text: /engine row/ })).toBeUndefined()
  }
})
