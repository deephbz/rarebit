// Rarebit promo timing source (Paperback Chic cut, pb2).
// Picture, captions, reading holds, and sound cues read this file.
// Chapter I is one continuous page; later chapters arrive by a page turn.
// The session content follows a real demo Pi session (a fictional repo) run
// through Rarebit: 51 entries, 28 tool calls and results, 6 selected rare bits.
(() => {
  const scenes = [
    ['cold', 0.0, 6.0],      // the Pi transcript scrolls: a long session
    ['zoom', 6.0, 8.0],      // pull back until the whole session is one page
    ['sift', 8.0, 20.6],     // hero: the Rarebit sieve; traffic falls through, rare bits stay
    ['value', 20.6, 27.4],   // what the rare bits carry
    ['recall', 27.4, 37.4],  // II: remind the agent
    ['summary', 37.4, 45.4], // III: Recap for yourself
    ['fork', 45.4, 54.4],    // IV: fresh session, tool calls stripped
    ['end', 54.4, 62.4],     // cover
  ];
  const start = name => scenes.find(([key]) => key === name)[1];

  // The six rare bits of the demo session, trimmed for the frame ("…" marks a cut).
  // [event kind, frame text, highlighted phrase or null]
  const bits = [
    ['user_message', 'GET /users?page=2 returns page 1 users. … Keep the public API unchanged.', 'Keep the public API unchanged.'],
    ['agent_continuation', 'npm test reproduces the bug: … page 2 starts at user 1 instead of 11.', null],
    ['agent_continuation', 'The cache key is only method:path, so both pages use GET:/users.', null],
    ['agent_stop', 'Fixed in src/cache.js … Keys now include sorted query parameters.', 'Keys now include sorted query parameters.'],
    ['user_message', 'Good. Check whether anything else builds cache keys the same way …', null],
    ['agent_stop', 'Checked: src/cache.js is the only cache-key builder. Left for review …', 'Left for review …'],
  ];

  const recall = {
    command: '/rarebit recall What did I ask for, and what is left for review?',
    reply: ['You asked me to fix /users?page=2 without', 'changing the public API.', 'Left for review: src/cache.js and its tests.'],
  };
  const summary = ['The page 2 cache bug is fixed, and the public', 'API is unchanged. The fix and tests await review.'];

  const chrome = {
    cold: ['I · Catch up', null],
    zoom: ['I · Catch up', null],
    sift: ['I · Catch up', 1],
    value: ['I · Catch up', 1],
    recall: ['II · Recall', 2],
    summary: ['III · Summary', 3],
    fork: ['IV · Fork', 4],
    end: [null, null],
  };

  // Page turns: [scene that arrives, start, end]. The previous page leaves left.
  const turns = [['recall', 27.4, 28.2], ['summary', 37.4, 38.2], ['fork', 45.4, 46.2], ['end', 54.4, 55.2]];

  // [text, start, end]. Captions sit on the page above the focal group.
  const captions = [
    ['Back from lunch. Where were we?', 0.6, 5.4],
    ['Rarebit sifts the whole session.', 6.2, 9.8],
    ['Tool traffic falls through.', 10.0, 13.2],
    ['Your messages and the agent’s prose stay.', 13.6, 17.2],
    ['The source is kept, not deleted.', 17.4, 20.6],
    ['Intent, progress, and where it stopped.', 21.0, 24.8],
    ['Recall reminds the agent what matters.', 28.3, 32.0],
    ['Catch up yourself at a glance.', 38.3, 41.8],
    ['Fork a fresh session, tool calls stripped.', 46.3, 50.2],
  ];

  // [text, start, next focal event, kind]. budget.mjs checks these holds.
  const reads = [
    ...bits.map(([, text], i) => [text, 13.6, 27.4, i ? 'repeat' : 'new']),
    ['tool traffic, still in the source', 17.4, 27.4, 'new'],
    ['This demo session: 51 entries in, 6 rare bits out.', 22.6, 27.4, 'new'],
    [recall.command, 28.4, 32.0, 'new'],
    ['Rarebit Recall', 30.2, 32.0, 'new'],
    ['read rarebit-conversation.json', 31.0, 32.6, 'new'],
    [recall.reply.join(' '), 31.8, 37.4, 'new'],
    ['Recap · appears finished', 39.2, 45.4, 'new'],
    [summary.join(' '), 39.8, 45.4, 'new'],
    ['* Summary is optional and written by your model. Illustrative text.', 41.8, 45.4, 'new'],
    ['/rarebit fork', 46.4, 47.8, 'new'],
    ['Resumed session', 48.2, 54.4, 'new'],
    ['context 6.3% of 272k', 50.4, 54.4, 'new'],
    ['context 0.3% of 272k', 50.6, 54.4, 'repeat'],
    ['Catch up on long Pi sessions.', 55.8, 62.4, 'new'],
    ['pi install npm:@hypercarrier/rarebit@0.2.0', 57.0, 62.4, 'new'],
  ];

  // Typed text: [start, end, text]. Sound derives one key click per character.
  const typing = [
    [28.4, 29.6, recall.command],
    [46.4, 47.0, '/rarebit fork'],
  ];

  // Contacts. Sound is derived from this list, not a second schedule.
  const contacts = [
    [0.2, 'hold'],
    [6.0, 'chapter'],
    [8.2, 'sift'],
    [11.0, 'mark'], [11.3, 'mark'], [11.6, 'mark'], [11.9, 'mark'], [12.2, 'mark'], [12.5, 'mark'],
    [17.4, 'file'],
    [21.0, 'contact'], [21.8, 'contact'], [22.6, 'contact'],
    [27.4, 'chapter'],
    [29.8, 'request'],
    [31.0, 'read'],
    [37.4, 'chapter'],
    [39.2, 'contact'],
    [45.4, 'chapter'],
    [47.4, 'boundary'],
    [54.4, 'chapter'],
    [57.0, 'install'],
    [61.6, 'outro'],
  ];

  globalThis.TL = {
    DUR: 62.4,
    FPS: 30,
    scenes,
    start,
    bits,
    recall,
    summary,
    chrome,
    turns,
    captions,
    reads,
    typing,
    contacts,
    cues: contacts,
    starts: { TITLE: start('zoom') },
  };
})();
