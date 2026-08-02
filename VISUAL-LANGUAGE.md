# Rarebit visual language

Status: first-version implementation; awaiting cross-surface real-trace ratification

This file is the canonical visual guidance shipped with the Rarebit extension. A fork may deliberately replace it. The typed roles, statuses, and reasons in [`src/types.d.ts`](src/types.d.ts) remain the semantic machine contract; [`src/rarebit-visual-language.mjs`](src/rarebit-visual-language.mjs) owns the executable marks, labels, tones, and source-pending attention gate. This document owns perceptual intent and the human-review projection of that mapping. It does not claim every consumer already conforms.

## Marker grammar and preview

This single table is the human-review projection and preview of the executable marker grammar. It uses inline HTML, so there is no second authored preview document. Renderers that preserve raw HTML and `style` attributes show the color column; restrictive renderers retain the monochrome-safe column.

The scopes are deliberately different: Session-history events are repeatable, time- or sequence-anchored evidence; a Summary status snapshot is one as-of assessment and never becomes an event on that axis.

<table aria-label="Official Rarebit marker grammar and preview">
  <thead>
    <tr>
      <th>Scope</th>
      <th>Meaning</th>
      <th>Color</th>
      <th>Monochrome</th>
      <th>Salience</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td rowspan="4">Session-history event</td>
      <td>User message</td>
      <td><span style="color: #15803d; font-size: 1.35em">□</span> user message</td>
      <td>□ user message</td>
      <td>standard</td>
    </tr>
    <tr>
      <td>Agent continuation</td>
      <td><span style="color: #2563eb; font-size: 1.1em">•</span> agent continues</td>
      <td>• agent continues</td>
      <td>smaller</td>
    </tr>
    <tr>
      <td>Agent stop</td>
      <td><span style="color: #334155; font-size: 1.35em">●</span> agent stops</td>
      <td>● agent stops</td>
      <td>larger</td>
    </tr>
    <tr>
      <td>Exceptional terminal</td>
      <td><span style="color: #b91c1c; font-size: 1.25em">×</span> terminal error</td>
      <td>× terminal error</td>
      <td>diagnostic</td>
    </tr>
    <tr>
      <td rowspan="5">Summary status snapshot</td>
      <td><code>user_requested</code></td>
      <td><span style="color: #334155">request recorded</span></td>
      <td>request recorded</td>
      <td>ordinary</td>
    </tr>
    <tr>
      <td><code>finished</code></td>
      <td><span style="color: #334155">appears finished</span></td>
      <td>appears finished</td>
      <td>ordinary</td>
    </tr>
    <tr>
      <td><code>needs_attention</code></td>
      <td><span style="color: #9a3412; background: #fff7ed">◆!</span> needs you</td>
      <td>◆! needs you</td>
      <td>attention</td>
    </tr>
    <tr>
      <td><code>ineligible</code></td>
      <td><span style="color: #71717a; font-weight: 300">ineligible</span></td>
      <td><span style="font-weight: 300">ineligible</span></td>
      <td>muted</td>
    </tr>
    <tr>
      <td><code>error</code></td>
      <td><span style="color: #b91c1c">×</span> error</td>
      <td>× error</td>
      <td>diagnostic</td>
    </tr>
  </tbody>
</table>

There is one user-message category, and every selected user message uses the same visual role. The smaller solid continuation dot means work continues. The larger solid stop circle marks a reported response boundary, not verified completion. Supporting intervals paint first, then continuations, stops and errors, and user messages last. Selection adds a halo without replacing the canonical mark.

Summary reasons such as `decision`, `blocker`, or `unfinished` are secondary text, never new colors or shapes. Summary prose uses normal body styling. Attention is the only Summary result with a high-salience mark or optional sound. Finished has no green, checkmark, or success treatment because it is an appearance-level Session assessment, not proof that a Task, Project, tool run, or delivery succeeded. Error is diagnostic and never produces the attention sound.

Synchronization and applicability qualify a result; they are not additional statuses. Append `· source pending` when applicable, expose detailed sync/applicability in an inspector, and withhold the attention mark and sound until readable native evidence confirms a current result. Never publish `syncing` as a Summary status. Consumers support only the current package projection and don't translate unsupported receipt shapes into visual meaning.

Every mark has an accessible text label. Do not rely on color, hover, or sound. A muted monochrome snapshot may use lighter weight or terminal `dim`, but its text must remain readable and meet WCAG 2.2 AA where applicable. Terminal renderers preserve the monochrome mark and label with the closest theme-safe ANSI treatment. Consumers import the package mapping rather than inventing another one, cite this file for perceptual intent, and keep application layout local.
