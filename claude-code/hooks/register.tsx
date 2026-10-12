import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Band, BandKind, Bar, Family, RarebitItem, RarebitView, Segment, Side, SideTurn } from '../types'

// Preview only. Rarebit semantics live in the Node helper (bin/), which calls
// the unchanged Rarebit core; this module binds commands, drawing and model
// transport. No /rarebit command leaves a row in the visible transcript:
// feedback goes to the band, the status line, or a pane. Two ways to put the
// Rarebits to work: recall (a bundle and a message into the main session) and
// the side ask (a temporary session over a Rarebit snapshot, in its own pane).

const PANE = 'rarebit-view'
const SIDE_PANE = 'rarebit-side'
const isLens = atom({ plugin: 'rarebit', key: 'isLens' } as const, false)
const view = atom({ plugin: 'rarebit', key: 'conversation' } as const, null)
const hideContinues = atom({ plugin: 'rarebit', key: 'hideContinues' } as const, false)
const notes = atom({ plugin: 'rarebit', key: 'notes' } as const, [])
const side = atom({ plugin: 'rarebit', key: 'side' } as const, null)
const isCompacting = atom({ plugin: 'rarebit', key: 'isCompacting' } as const, false)
// Model choices come from userConfig (/config); a reload applies a change.
const models = { recap: 'haiku', ask: 'sonnet' }
const BAND_ORDER: readonly BandKind[] = ['recap', 'diagnosis', 'error']

// Marks and tones from the Rarebit visual language (src/rarebit-visual-language.mjs).
const MARK = {
  user: { mark: '□', label: 'You', color: 'success' },
  continuation: { mark: '•', label: 'Agent continues', color: 'suggestion' },
  stop: { mark: '●', label: 'Agent stops', color: 'text' },
} as const

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
const kTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const isRarebitEcho = (text: string) => /^\s*\/rarebit\b/.test(text) || text.includes('<command-name>/rarebit')

const isRecallMessage = (text: string) => text.startsWith('# Rarebit Recall')
const recallRequest = (text: string) => {
  const m = /## Current request\s+([`~]{3,})text\n([\s\S]*?)\n\1\s*$/.exec(text)
  return m?.[2] ?? ''
}

async function helper($: EngineInterface, cmd: 'select' | 'diagnosis' | 'recall', ...args: string[]) {
  const id = await $.session.id()
  const r = await $.process.run(['node', `${$.plugin.root}/bin/rarebit-cc.mjs`, cmd, id, ...args], { timeoutMs: 60_000 })
  if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `helper exited ${r.exitCode}`)
  return r.stdout.trim()
}

// A new line replaces only its own kind; the others stay until dismissed.
async function showBand($: EngineInterface, note: Band) {
  await update($, notes, list => [...(list ?? []).filter(n => n.kind !== note.kind), note])
}

async function dismissBand($: EngineInterface, kind: BandKind) {
  await update($, notes, list => (list ?? []).filter(n => n.kind !== kind))
}

async function refreshView($: EngineInterface): Promise<RarebitView> {
  const v: RarebitView = JSON.parse(await helper($, 'select'))
  await update($, view, () => v)
  return v
}

async function makeRecap($: EngineInterface) {
  await showBand($, { kind: 'recap', text: '', isLoading: true })
  const v = await refreshView($)
  // Newest evidence matters most for re-entry; keep the tail within budget.
  let body = ''
  for (const it of [...v.items].reverse()) {
    if (it.kind === 'compaction') continue
    const line = `[${it.kind === 'user' ? 'USER' : it.kind === 'stop' ? 'AGENT-FINAL' : 'AGENT-NOTE'}] ${it.text}\n\n`
    if (body.length + line.length > 120_000) break
    body = line + body
  }
  const r = await $.model.complete({
    model: models.recap,
    maxTokens: 120,
    system: 'You write one-line re-entry recaps of agent work sessions for the session owner.',
    prompt: `Conversation excerpts (user prompts and agent prose only), oldest first:\n\n${body}\nWrite ONE sentence (max 25 words): where the work stands now and what is waiting on the owner, if anything. No preamble.`,
  })
  await showBand($, r.isAnswered
    ? { kind: 'recap', text: r.text.trim(), isLoading: false }
    : { kind: 'error', text: `Recap unavailable (${r.reason})`, isLoading: false })
}

// The helper's token estimates by kind; Rarebit kinds first, in the visual language.
// Palette: Rarebit hues from the package's visual language (green #15803d,
// blue #2563eb, slate ink), the rest by family. Each hex sits at OKLCH
// lightness 0.58-0.63, which keeps at least 3:1 against white, the desktop
// ground, #1e1e1e and black, so one palette serves light and dark themes.
// Stops take the theme's own ink. Setup and space take the theme's neutrals.
type Kinds = Record<'user' | 'continuation' | 'stop' | 'toolCalls' | 'toolResults' | 'thinking' | 'summary' | 'other', number>
const KINDS: readonly [keyof Kinds, string, string, Family][] = [
  ['user', '□ You', '#25984d', 'rarebit'],
  ['continuation', '• Continues', '#3e73e3', 'rarebit'],
  ['stop', '● Stops', 'text', 'rarebit'],
  ['toolCalls', 'Tool calls', '#ba7917', 'work'],
  ['toolResults', 'Tool results', '#8c765d', 'work'],
  ['thinking', 'Thinking', '#0f9293', 'work'],
  ['summary', 'Compaction summary', '#8e62bc', 'work'],
  ['other', 'Other prose', 'inactive', 'work'],
]
const GLYPH: Record<Family, string> = { rarebit: '█', work: '█', setup: '▓', space: '░' }
const FAMILY_LABEL: Record<Family, string> = { rarebit: 'Rarebit', work: 'Work', setup: 'Setup', space: 'Space' }
const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0)
const kindSegments = (k: Kinds, scale = 1): Segment[] =>
  KINDS.map(([key, label, color, family]) => ({ label, color, family, glyph: GLYPH[family], tokens: Math.round((k[key] ?? 0) * scale) }))
// Engine /context rows: setup alternates two theme neutrals so neighbours
// differ; free space is lighter texture than the autocompact buffer.
const engineSegment = (c: { name: string; tokens: number; kind: string }, i: number): Segment =>
  c.kind === 'used'
    ? { label: c.name, tokens: c.tokens, family: 'setup', glyph: GLYPH.setup, color: i % 2 ? 'subtle' : 'inactive' }
    : /free/i.test(c.name)
      ? { label: c.name, tokens: c.tokens, family: 'space', glyph: '░', color: 'subtle' }
      : { label: c.name, tokens: c.tokens, family: 'space', glyph: '▒', color: 'inactive' }

// Two scopes, two bars. Live: what the next request carries, the engine's
// /context rows with its Messages row split by the Rarebit estimate of the
// messages since the last compaction. Session: every message across compactions.
async function diagnose($: EngineInterface) {
  await showBand($, { kind: 'diagnosis', text: '', isLoading: true })
  const d = JSON.parse(await helper($, 'diagnosis'))
  const bars: Bar[] = []
  const usage = await $.session.usage({ breakdown: 'summary' }).catch(() => null)
  const b = usage?.context.breakdown
  if (b) {
    const liveTotal = sum(Object.values(d.live as Kinds))
    const segments = b.categories
      .filter(c => c.kind !== 'deferred')
      .flatMap((c, i): Segment[] =>
        c.kind === 'used' && /message/i.test(c.name) && liveTotal
          ? kindSegments(d.live, c.tokens / liveTotal)
          : [engineSegment(c, i)])
    bars.push({ title: 'Live context', caption: `${kTokens(b.totalTokens)} of ${kTokens(b.rawMaxTokens)} (${Math.round(b.percentage)}%) · Messages split by estimate`, segments })
  }
  const session = kindSegments(d.session)
  const total = sum(session.map(s => s.tokens))
  const rarebit = sum(session.filter(s => s.family === 'rarebit').map(s => s.tokens))
  bars.push({ title: 'Whole session', caption: `${kTokens(total)} est. · ${plural(d.compactions, 'compaction')} · ${d.branch} entries in ${d.ms} ms`, segments: session })
  const text =
    `${d.user + d.continuation + d.stop} Rarebits (□ ${d.user} · • ${d.continuation} · ● ${d.stop})` +
    ` · ${total ? Math.round((rarebit / total) * 100) : 0}% of the session · ${kTokens(rarebit)} of ${kTokens(total)} tokens`
  await showBand($, { kind: 'diagnosis', text, isLoading: false, bars })
}

// Cells per segment for a bar `width` wide: every non-empty segment keeps at
// least one cell, the rest by largest remainder.
function cells(values: number[], width: number) {
  const total = sum(values)
  if (!total) return values.map(() => 0)
  const room = Math.max(0, width - values.filter(v => v > 0).length)
  const raw = values.map(v => (v > 0 ? (room * v) / total : 0))
  const out = raw.map((r, i) => (values[i]! > 0 ? 1 + Math.floor(r) : 0))
  let left = width - sum(out)
  const order = raw.map((r, i) => ({ i, frac: r % 1 })).sort((x, y) => y.frac - x.frac)
  for (const { i } of order) {
    if (left <= 0) break
    if (values[i]! > 0) { out[i]! += 1; left-- }
  }
  return out
}

const percent = (n: number, of: number) => {
  const p = (n / of) * 100
  return p >= 1 || p === 0 ? `${Math.round(p)}%` : '<1%'
}

const asText = (v: RarebitView) =>
  v.items
    .map(it => (it.kind === 'compaction' ? `── compacted ${it.time ?? ''} ──` : `${MARK[it.kind].mark} ${MARK[it.kind].label} ${it.time ?? ''}\n${it.text}`))
    .join('\n\n')

// Recall: the core's bundle on disk, then one message into the main session
// so the agent itself reads it (Pi's /rarebit recall).
async function recall($: EngineInterface, request: string) {
  const { message } = JSON.parse(await helper($, 'recall', request))
  await $.prompt.submit({ text: message })
}

// Side ask: a temporary session over a frozen Rarebit snapshot. The first
// question takes the snapshot; follow-ups reuse it. Nothing enters the main
// session; End discards it.
async function askSide($: EngineInterface, question: string) {
  const { value: current } = await $.state.get({ plugin: 'rarebit', key: 'side' } as const)
  let snapshot: Side | null = current ?? null
  if (!snapshot) {
    const v = await refreshView($)
    let context = asText(v)
    if (context.length > 400_000) context = context.slice(-400_000)
    const at = new Date(await $.clock.now()).toISOString().slice(11, 16)
    snapshot = { snapshotAt: at, messageCount: v.items.filter(it => it.kind !== 'compaction').length, context, turns: [] }
  }
  const prior = snapshot.turns.filter(t => !t.isLoading && !t.isError)
  const pending: SideTurn = { question, text: '', isLoading: true, isError: false }
  const started: Side = { ...snapshot, turns: [...snapshot.turns, pending] }
  await update($, side, () => started)
  await $.ui.open({ id: SIDE_PANE, title: 'Side ask · Rarebits only' })
  const thread = prior.map(t => `<turn>\nQuestion: ${t.question}\nAnswer: ${t.text}\n</turn>`).join('\n')
  const r = await $.model.complete({
    model: models.ask,
    maxTokens: 1500,
    system: 'You answer side questions about an agent work session for its owner. You see only the session\'s Rarebits: user prompts and agent prose, tool traffic removed, in order across compactions. Answer from that evidence; say so when it is not enough. Be brief.',
    prompt: `<rarebits>\n${started.context}\n</rarebits>\n${thread ? `\n<earlier_side_turns>\n${thread}\n</earlier_side_turns>\n` : ''}\nQuestion: ${question}`,
  })
  const done: SideTurn = r.isAnswered
    ? { question, text: r.text.trim(), isLoading: false, isError: false }
    : { question, text: `No answer (${r.reason}).`, isLoading: false, isError: true }
  await update($, side, s => (s ? { ...s, turns: s.turns.map(t => (t === pending || (t.isLoading && t.question === question) ? done : t)) } : s))
}

async function endSide($: EngineInterface) {
  await update($, side, () => null)
  await $.ui.close({ id: SIDE_PANE })
}

// Open the view at its newest end, as a chat opens at the latest message.
async function openView($: EngineInterface) {
  await $.ui.open({ id: PANE, title: 'Rarebits' })
  await refreshView($)
  await $.ui.scroll({ in: PANE, to: 'end', block: 'end' }).catch(() => undefined)
}

async function toggleLens($: EngineInterface, to?: boolean) {
  await update($, isLens, wasOn => to ?? !wasOn)
  const { value } = await $.state.get({ plugin: 'rarebit', key: 'isLens' } as const)
  $.ui.status(value ? '□ Rarebit lens' : undefined)
}

async function guarded($: EngineInterface, work: Promise<unknown>) {
  try {
    await work
  } catch (err) {
    await showBand($, { kind: 'error', text: `Rarebit: ${(err as Error).message}`, isLoading: false })
  }
}

export const register: Register = (on, options) => {
  if (typeof options.recapModel === 'string' && options.recapModel.trim()) models.recap = options.recapModel.trim()
  if (typeof options.askModel === 'string' && options.askModel.trim()) models.ask = options.askModel.trim()
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'rarebit',
      description: 'Toggle the Rarebit lens · view · recall <prompt> · ask <question> · recap · diagnosis',
      argumentHint: '[view | recall <prompt> | ask <question> | recap | diagnosis]',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: 'rarebit' }, async ($, e) => {
    const [sub = ''] = e.args.trim().split(/\s+/)
    const rest = e.args.trim().slice(sub.length).trim()
    if (sub === '' || sub === 'lens') await toggleLens($)
    else if (sub === 'view') void guarded($, openView($))
    else if (sub === 'recap') void guarded($, makeRecap($))
    else if (sub === 'diagnosis') void guarded($, diagnose($))
    else if (sub === 'recall' && rest) void guarded($, recall($, rest))
    else if (sub === 'ask' && rest) void guarded($, askSide($, rest))
    else if (sub === 'ask') void guarded($, $.ui.open({ id: SIDE_PANE, title: 'Side ask · Rarebits only' }))
    else await showBand($, { kind: 'error', text: 'Usage: /rarebit [view | recall <prompt> | ask <question> | recap | diagnosis]', isLoading: false })
    return {}
  })

  // The engine holds every slash command, immediate ones too, while it
  // compacts. Rarebit reads the transcript file, so the band offers its
  // actions as Buttons for that time: a press is a UI event, never queued.
  on('session.compact', async ($, e, next) => {
    if (e.agentId || e.trigger === 'precompute') return next(e)
    await update($, isCompacting, () => true)
    try {
      return await next(e)
    } finally {
      await update($, isCompacting, () => false)
    }
  }).catch(($, e, next) => next(e))

  // Keep /rarebit out of the visible scrollback. The stored rows stay as
  // evidence; the Rarebit adapter already drops command wrappers.
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (e.props.command !== 'rarebit') return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (isRarebitEcho(e.props.text)) {
      const { Box } = $.ui.resolve(e)
      return <Box />
    }
    // A recall message is long machine text; draw it as one line until expanded.
    if (isRecallMessage(e.props.text) && !e.props.isExpanded) {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box>
          <Text color="success">□ Rarebit recall </Text>
          <Text>{recallRequest(e.props.text)}</Text>
          <Text dimColor>  · bundle attached</Text>
        </Box>
      )
    }
    return next(e)
  })

  // The lens: tool traffic folds to one dim line; prose stays as drawn.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (!(await read($, isLens))) return next(e)
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>  · {plural(e.props.calls.length, 'tool step')}</Text>
  })
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!(await read($, isLens))) return next(e)
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>  · {e.props.tool}{e.props.isErrored ? ' (error)' : ''}</Text>
  })
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!(await read($, isLens))) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  // The band: transient notes (recap, diagnosis, error), the lens reminder, and
  // the Rarebit actions while a compaction holds the command queue.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const lens = await read($, isLens)
    const compacting = await read($, isCompacting)
    const list: Band[] = [...(await read($, notes))].sort((a, b) => BAND_ORDER.indexOf(a.kind) - BAND_ORDER.indexOf(b.kind))
    if (!lens && !compacting && list.length === 0) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const width = Math.max(20, (e.props.bodyColumns ?? 80) - 2)
    const LEAD = { recap: 'Since you left: ', diagnosis: 'Diagnosis: ', error: '' } as const
    const bar = (b: Bar) => {
      const n = cells(b.segments.map(s => s.tokens), width)
      const all = sum(b.segments.map(s => s.tokens))
      return (
        <Box key={`bar-${b.title}`} flexDirection="column" marginTop={1}>
          <Text>
            <Text bold>{b.title}</Text>
            <Text dimColor>  {b.caption}</Text>
          </Text>
          <Text>
            {b.segments.map((s, j) => (n[j] ? <Text key={`s${j}`} color={s.color}>{s.glyph.repeat(n[j])}</Text> : null))}
          </Text>
          {(['rarebit', 'work', 'setup', 'space'] as const).map(f => {
            const group = b.segments.filter(s => s.family === f && s.tokens > 0)
            if (!group.length) return null
            const strong = f === 'rarebit'
            return (
              <Text key={`g-${f}`} wrap="wrap">
                <Text bold={strong} dimColor={!strong}>{FAMILY_LABEL[f].padEnd(8)}{percent(sum(group.map(s => s.tokens)), all).padStart(4)}  </Text>
                {group.map((s, j) => (
                  <Text key={`l${j}`}>
                    <Text color={s.color}>{s.glyph}</Text>
                    <Text bold={strong} dimColor={!strong}> {s.label} {percent(s.tokens, all)}   </Text>
                  </Text>
                ))}
              </Text>
            )
          })}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        {compacting && (
          <Box key="compacting" gap={1}>
            <Text dimColor>Compacting · Rarebit stays live:</Text>
            <Button key="c-view" plain hotkey="1" label="View" onPress={() => guarded($, openView($))} />
            <Button key="c-diagnosis" plain hotkey="2" label="Diagnosis" onPress={() => guarded($, diagnose($))} />
            <Button key="c-recap" plain hotkey="3" label="Recap" onPress={() => guarded($, makeRecap($))} />
            <Button key="c-lens" plain hotkey="4" label="Lens" onPress={() => toggleLens($)} />
          </Box>
        )}
        {list.map(b => (
          <Box key={`n-${b.kind}`} flexDirection="column">
            <Box>
              <Text color={b.kind === 'error' ? 'error' : undefined} dimColor={b.kind === 'diagnosis'} wrap="wrap">
                {b.isLoading ? (b.kind === 'recap' ? 'Writing recap…' : 'Reading the session…') : `${LEAD[b.kind]}${b.text}`}{' '}
              </Text>
              <Button key={`dismiss-${b.kind}`} label="Dismiss" role="dismiss" onPress={() => dismissBand($, b.kind)} />
            </Box>
            {!b.isLoading && (b.bars ?? []).map(bar)}
          </Box>
        ))}
        {lens && (
          <Box>
            <Text dimColor>□ Conversation only · tool steps folded </Text>
            <Button key="all" label="Show all" onPress={() => toggleLens($, false)} />
          </Box>
        )}
      </Box>
    )
  })

  // The view: every Rarebit of the session, across compactions, as a chat.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = els
    const Input = 'Input' in els ? els.Input : undefined
    const v: RarebitView | null = await read($, view)
    const copy = (text: string) => $.ui.copy({ text, surface: e.surface })
    if (!v) return <Text dimColor>Reading the session…</Text>
    const cols = e.props.bodyColumns ?? e.viewport?.columns ?? 80
    const bubble = Math.max(24, Math.floor(cols * 0.82))
    const count = v.items.filter(it => it.kind !== 'compaction').length
    const row = (it: RarebitItem, i: number) => {
      if (it.kind === 'compaction') {
        return (
          <Box key={`c${i}`} marginTop={1} justifyContent="center">
            <Text dimColor>── compacted {it.time ?? ''} · context restarts here ──</Text>
          </Box>
        )
      }
      const p = MARK[it.kind]
      if (it.kind === 'user') {
        return (
          <Box key={`m${i}`} flexDirection="column" alignItems="flex-end" marginTop={1}>
            <Text color={p.color} bold>
              {it.time ?? ''}  {p.label} {p.mark}
            </Text>
            <Box width={bubble} borderStyle="round" borderColor={p.color} paddingX={1}>
              <Markdown text={it.text} />
            </Box>
            <Button key={`copy${i}`} plain label="Copy" onPress={() => copy(it.text)} />
          </Box>
        )
      }
      const isStop = it.kind === 'stop'
      return (
        <Box key={`m${i}`} flexDirection="column" marginTop={1}>
          <Text color={p.color} bold={isStop} dimColor={!isStop}>
            {p.mark} {p.label}  <Text dimColor>{it.time ?? ''}</Text>
          </Text>
          <Box paddingLeft={2} width={bubble}>
            <Markdown text={it.text} />
          </Box>
          <Box paddingLeft={2}>
            <Button key={`copy${i}`} plain label="Copy" onPress={() => copy(it.text)} />
          </Box>
        </Box>
      )
    }
    // Hiding agent-continues is a reading choice; the selection and its stats stay whole.
    const isHiding = await read($, hideContinues)
    const continues = v.items.filter(it => it.kind === 'continuation').length
    const shown = isHiding ? v.items.filter(it => it.kind !== 'continuation') : v.items
    const stats = `${plural(count, 'message')} · ${Math.round(v.ratio * 100)}% of prose · ${kTokens(v.rarebitTokens)} of ${kTokens(v.totalTokens)} tokens${isHiding && continues ? ` · ${continues} hidden` : ''}`
    const go = (to: 'start' | 'end') => $.ui.scroll({ in: PANE, to, block: to })
    // The same bar heads and ends the view; only the jump button differs.
    const bar = (at: 'head' | 'foot') => (
      <Box key={at} marginTop={at === 'foot' ? 1 : 0} justifyContent="space-between">
        <Text dimColor>{stats}</Text>
        <Box gap={1}>
          <Button key={`${at}-toggle-continues`} label={`${isHiding ? 'Show' : 'Hide'} ${MARK.continuation.mark} ${continues}`} onPress={() => update($, hideContinues, was => !was)} />
          <Button key={`${at}-refresh`} label="Refresh" onPress={() => guarded($, refreshView($))} />
          <Button key={`${at}-copy-all`} label="Copy all" onPress={() => copy(asText({ ...v, items: shown }))} />
          {at === 'head'
            ? <Button key="to-bottom" label="↓ Bottom" onPress={() => go('end')} />
            : <Button key="to-top" label="↑ Top" onPress={() => go('start')} />}
        </Box>
      </Box>
    )
    return (
      <Box flexDirection="column">
        {bar('head')}
        {shown.map(row)}
        {bar('foot')}
        {Input && (
          <Box key="ask-row" marginTop={1}>
            <Input key="ask" placeholder="Ask on the side (Rarebits only)…" submitLabel="Ask" onSubmit={(q: string) => { if (q.trim()) void guarded($, askSide($, q.trim())) }} />
          </Box>
        )}
      </Box>
    )
  })

  // The side session: its own thread over a frozen snapshot.
  on('ui.render', { component: 'Pane', requestId: SIDE_PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = els
    const Input = 'Input' in els ? els.Input : undefined
    const s: Side | null = await read($, side)
    const copy = (text: string) => $.ui.copy({ text, surface: e.surface })
    const cols = e.props.bodyColumns ?? e.viewport?.columns ?? 80
    const bubble = Math.max(24, Math.floor(cols * 0.82))
    return (
      <Box flexDirection="column">
        <Box justifyContent="space-between">
          <Text dimColor>
            {s ? `Snapshot of ${plural(s.messageCount, 'Rarebit')} at ${s.snapshotAt} · ` : ''}nothing here enters the main session
          </Text>
          {s && <Button key="end" label="End" onPress={() => endSide($)} />}
        </Box>
        {(s?.turns ?? []).map((t, i) => (
          <Box key={`t${i}`} flexDirection="column" marginTop={1}>
            <Box flexDirection="column" alignItems="flex-end">
              <Box width={bubble} borderStyle="round" borderColor="success" paddingX={1}>
                <Text>{t.question}</Text>
              </Box>
            </Box>
            <Box paddingLeft={2} width={bubble} flexDirection="column" marginTop={1}>
              {t.isLoading ? <Text dimColor>Reading the Rarebits…</Text> : t.isError ? <Text color="error">{t.text}</Text> : <Markdown text={t.text} />}
            </Box>
            {!t.isLoading && !t.isError && (
              <Box paddingLeft={2}>
                <Button key={`copy-t${i}`} plain label="Copy" onPress={() => copy(t.text)} />
              </Box>
            )}
          </Box>
        ))}
        {Input && (
          <Box marginTop={1}>
            <Input key="side-ask" placeholder={s ? 'Follow up…' : 'Ask about this session (Rarebits only)…'} submitLabel="Ask" autoFocus onSubmit={(q: string) => { if (q.trim()) void guarded($, askSide($, q.trim())) }} />
          </Box>
        )}
      </Box>
    )
  })
}
