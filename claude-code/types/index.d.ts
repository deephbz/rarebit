export type RarebitItem =
  | { kind: 'user' | 'continuation' | 'stop'; time: string | null; text: string }
  | { kind: 'compaction'; time: string | null }
export type RarebitView = { items: RarebitItem[]; ratio: number; rarebitTokens: number; totalTokens: number }
// Transient lines above the prompt, one per kind, each dismissed on its own;
// never a transcript row.
export type BandKind = 'recap' | 'diagnosis' | 'error'
// One stacked bar of the diagnosis: token estimates by kind, drawn in order.
// Family sets glyph texture and legend group, so meaning survives without color.
export type Family = 'rarebit' | 'work' | 'setup' | 'space'
export type Segment = { label: string; tokens: number; color: string; family: Family; glyph: string }
export type Bar = { title: string; caption: string; segments: Segment[] }
export type Band = { kind: BandKind; text: string; isLoading: boolean; bars?: Bar[] }
// A temporary side session: a frozen Rarebit snapshot plus its own turns.
// It lives in its pane and never enters the main session.
export type SideTurn = { question: string; text: string; isLoading: boolean; isError: boolean }
export type Side = { snapshotAt: string; messageCount: number; context: string; turns: SideTurn[] }

declare module 'claude-code' {
  interface PluginState {
    rarebit: { isLens: boolean; conversation: RarebitView | null; hideContinues: boolean; notes: Band[]; side: Side | null; isCompacting: boolean }
  }
}
