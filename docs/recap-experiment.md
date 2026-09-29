# Recap scrolling and read-checkpoint experiment

Tested against the pinned Pi 0.84.2 packages on Node 24.

Run `node scripts/experiment-recap-fullscreen.mjs` to reproduce the UI probe.
It mounts Rarebit's real recap component in Pi's native `TuiAltScreen` and
`ScrollView`, with a synthetic terminal adapter. It injects native SGR mouse
sequences and keyboard input. This is a renderer experiment, not a live
terminal or whole-Pi CLI test. `layout.js` is imported only for experiment
screen inspection; the extension uses supported Pi APIs.

Observed:

- Recap visible at the top, absent at the bottom after scrolling.
- A wheel event moved the transcript scroll position from 0 to 1.
- A keyboard event reached the extension listener.
- Primary mouse press/release events did **not** reach the extension listener.
  Pi's fullscreen viewport listener consumes them before extension listeners.

Therefore the initial read affordance uses `Ctrl+Alt+G` and `/rarebit got-it`.
A genuine mouse button needs Pi to expose component mouse actions or a
pre-viewport extension hook with supported hit testing. Do not use an OSC 8
link that launches an external program, or modify Pi's private listener set.

Run `node test/recap-read-checkpoint.test.mjs` for native Session persistence
and Summary transport coverage. It writes synthetic messages with the real
`SessionManager`, shows and acknowledges a Recap, reopens the JSONL, and
checks the captured Summary request. A message arriving after the Recap but
before acknowledgement remains after the read boundary. A sibling branch
does not inherit the marker. The Summary still receives older unresolved
requests, and the prompt explicitly separates reading from approval/completion.

The Summary provider in that test is deterministic. It verifies input placement
and instructions, not whether a particular live model follows the 300-character
target or produces better prose. Existing custom Summary prompts remain intact.

Validation: `npm ci`, all 146 tests in `npm test`, and `npm run verify:package`
passed. The legacy tmux recap script was adapted to transcript persistence but
was not run in this environment (tmux is unavailable).
