# Rarebit for Claude Code (preview)

A Claude Code mod that brings the Rarebit lens, view, recap, side-ask, Recall
and diagnosis to Claude Code. It reuses `src/rarebit-core.mjs` and
`src/rarebit-recall.mjs` through `bin/rarebit-cc.mjs`. The npm package does
not ship this folder.

Load it for development:

```bash
claude --plugin-dir claude-code
```

Check it:

```bash
claude plugin validate claude-code && claude plugin test claude-code
```
