# Rarebit simulation lane

Stage: consolidation of verification for a sharing-stage package.
Rarebit owns action scenarios, semantic monitors and mutant fixtures.
The private `@hypercarrier/pi-sim` owns Pi construction, isolated storage,
entropy, clocks, filesystem settlement and scripted HTTP transport.
No real provider calls run. Native Session evidence remains authoritative.
Architecture impact: changed for development verification ownership only.
Production contracts and artifact dependencies remain unchanged.

## Property catalog

| ID | Independent observation and failure detected |
| --- | --- |
| R1 selection | Selected source IDs and prose match user text and assistant stop/toolUse text. Tool results, reasoning and exceptional outcomes are excluded. |
| R2 recall | Two real Recall files match the active branch in order. One envelope enters Pi; no Recall custom entry appears. |
| R3 summary identity | An unchanged branch reuses its receipt without another HTTP request. Changed evidence causes a new request. |
| R4 prefix | Consecutive linear Summary cuts retain the exact evidence-stream prefix in raw outgoing HTTP bodies. Lifecycle instructions follow evidence. |
| R5 history | Existing native entries retain their serialized values after Summary, Recall, compaction and navigation. |
| R6 compaction | Selection retains pre-compaction prose while real Pi model context uses its compaction record. |
| R7 branch | Selection and Recall omit abandoned siblings after native tree navigation. |
| R8 old Sessions | Linear v1 and tree-format Sessions retain ordered selection without source migration. |
| R9 replay | Fresh processes with the same seed and actions produce exact HTTP and Session histories after temporary-root replacement only. |

R4 remains Rarebit's independent byte-prefix monitor. The shared cache checker
does not replace it. Neither monitor establishes billed provider cache hits.

## Install and run

Standalone public CI needs no HC dependency:

```sh
npm ci
npm test                       # non-simulator tests, including pure R1/R8
```

The private `sim/package.json` pins the simulator exactly. HC includes this
subproject explicitly in its workspace and lock. The root Rarebit manifest
has no simulator dependency. The npm artifact excludes `sim/`.

Inside the HC workspace, or with a local simulator package:

```sh
npm run test:sim
npm run test:sim:campaign       # 100 generated HTTP scenarios
HC_PI_SIM_PATH=/path/to/pi-sim npm run test:sim
HC_PI_SIM_PI_ROOT=/path/to/node_modules/@earendil-works npm run test:sim
node sim/replay.mjs sim/fixtures/prefix-hash.json /tmp/rarebit-trace.json
```

`HC_PI_SIM_PATH` selects the simulator package root. An invalid explicit path
or version fails without fallback. Without it, normal package resolution uses
the HC workspace. An unavailable simulator produces the error
`simulator tests need the HC workspace or HC_PI_SIM_PATH`.
`HC_PI_SIM_PI_ROOT` selects the separate `@earendil-works` directory containing
`pi-coding-agent` and `pi-ai`. The removed `RAREBIT_SIM_PI_ROOT` fails with a
rename message. Node 22.19+ is required by the shared simulator.
Pi 1.1.0 and 1.2.0 are exercised. Former Pi 0.84 simulator coverage is an
accepted loss. Rarebit's production and non-simulator compatibility are unchanged.

`RAREBIT_SIM_RUNS` changes the generated HTTP count. `RAREBIT_SIM_SCENARIO`
accepts `{seed, actions, mutant, lstatDelayMs}` JSON for direct replay.
Actions are `turn`, `summary`, `error`, `recall`, `compact` and `branch`.
`include-error` must fail R1; `prefix-hash` must fail R4. Both controls must pass.
Mutants alter a temporary copy of real source and never ship.

## Boundary and replay

Each scenario runs in a fresh Node child. Shared SimWorld creates a durable
native Session and a stable seed-scoped isolated root. Same-seed collisions
fail before modifying an existing root. Run same-seed worlds serially, or use
separate OS temp parents. Inspect ownership before removing crash remnants.
The shared world removes its owned root and restores host globals on close.

The real extension, Summary service, selected Pi model adapter, Recall command,
compaction and tree navigation run unchanged. Recall reads actual private files.
Pi's Anthropic request builder serializes requests before the shared transport
records them and returns scripted responses. Rarebit classifies requests and
supplies reply data through the public shared API.

One shared entropy source supplies input delays, reply choices and native IDs.
Inputs use absolute seeded ten-second deadlines. Host completion cannot shift
the next input deadline. Shared settlement drains pending filesystem and tracked
FileHandle work before virtual timer choices. Rarebit has no clock, filesystem
patch, HTTP encoder or fetch stub.

Replay replaces only the temporary world root. It retains IDs, timestamps,
hashes, entropy choices and raw request bodies. Wall-time metrics are excluded.
Simulator version, source revision and selected Pi version accompany evidence.
A revision requires tracked simulator source in its own Git root or the HC
workspace. Packed installs report `sourceRevision: "unknown (packed)"` beside
the package version. The enclosing consumer's Git HEAD is never simulator
provenance.

## Verification

`results.json` records the current acceptance evidence. The scenario inventory
retains the original eight semantic test names across `test/simulator-selection`
and `sim/scenarios`. The loader adds a separate resolution test. Generic host
filesystem conformance now belongs to the shared simulator.

Coverage retains 5,184 exhaustive selection pairs, 100 generated evidence cases,
eight default HTTP scenarios, a 100-case campaign, seeds 12/7/29/1 and
fast-check seed 20261015. Both mutants must fail their named property and their
controls must pass. The same-seed pairs run in fresh processes.

The delayed-lstat regression uses public `delayHostIO` with 30 ms real latency.
It compares the entire replay projection with an undelayed run. This replaces
the former private patch's 200 host checkpoints. A sabotage copy that keeps
latency but omits lstat pending-work tracking must fail R9. The shared core owns
the generic lstat/realpath and restoration regressions.

The loaded check runs the two-seed replay, mutant gates and delayed-lstat case
30 times per Pi with eight CPU workers per version. Pi 1.1 and 1.2 each
passed all 30 runs with zero failures:

```sh
node --test --test-name-pattern='R9 exact|R9 host|mutant gate' sim/scenarios.test.mjs
```

Virtual/wall ratios measure wait compression under the measured host load.
They do not measure CPU throughput. Old backend timing results remain in Git.
Old and new backend traces need not match; replay within the new backend must.

## Limits

- HTTP coverage is Anthropic Messages. R4 does not model TTL, minimum cache
  size, block boundaries or billed hits.
- Generated HTTP replies stop normally. Pure evidence tests cover toolUse,
  tool results, reasoning and exceptional outcomes. Provider faults,
  abort/retry and concurrent busy-Recall schedules remain unverified here.
- R8 checks old native formats, not a real-Pi upgrade campaign.
- Host crashes, instruction-level filesystem races and timer fairness are
  unclaimed. Real filesystem work completes on the host.
- Long-running model work, interactive TUI rendering and Herdr calls do not run.
