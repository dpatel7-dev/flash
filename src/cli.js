'use strict';
// The `flash` command.

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');
const A = require('./ansi');
const Sprite = require('./sprite');
const Blink = require('./firefly');
const Deck = require('./deck');
const Srs = require('./srs');
const Study = require('./study');
const Quiz = require('./quiz');
const pkg = require('../package.json');

const out = (s = '') => process.stdout.write(s + '\n');
const glow = (s) => A.paint(s, { fg: '#d7f07a', bold: true });
const lake = (s) => A.paint(s, { fg: '#6fb7d6' });
const dim = (s) => A.paint(s, { fg: '#8a909c' });
const ok = (s) => A.paint(s, { fg: '#8fd4a0' });
const amber = (s) => A.paint(s, { fg: '#f2c14e' });
const red = (s) => A.paint(s, { fg: '#ff8a80' });
const bold = (s) => A.paint(s, { bold: true });
const SCRIPT = path.join(__dirname, '..', 'bin', 'flash.js');
const MAC = process.platform === 'darwin';
const GRADE_INK = { 1: red, 2: amber, 3: ok, 4: lake };

const HELP = `
  flash: study cards that come back just before you'd forget them.

  flash                          your decks, and what to study today
  flash study [deck]             study (Space flips, then 1 again · 2 hard · 3 good · 4 easy)
  flash quiz [deck]              pick the answer out of four
  flash type [deck]              type the answer (small typos are forgiven)
  flash app                      the window: study, the match game, edit decks, stats

  flash new "Biology"            a new deck: type or paste cards (term - definition, one a line)
  flash import notes.txt         a deck from a file (Quizlet/Anki exports, .csv, .flash, any text)
  flash make notes.pdf           cards made by AI from your notes (or a topic: flash make "the water cycle")
  flash add <deck> "front" "back"   one more card
  flash cards <deck>             every card in a deck
  flash exam <deck> friday       a test date: flash plans your days so you're ready  (off to remove)

  flash share <deck>             a link for a friend (with pigeon)    flash get <link>   open one
  flash export <deck>            as text Quizlet and Anki can import (--csv, --flash)
  flash tot                      bring in your decks from Tree of Thought's cram
  flash remind 4pm               a reminder each day there's something to study (off to stop)
  flash stats                    your streak, and how much you remember
  flash setup                    the free AI (only for making cards and memory hooks)
  flash rename <deck> "name" · rm <deck> · update · uninstall · help · --version

  Instead of <deck> you can use its number in the list, or part of its name.
`;

function intro(lines) {
  const art = Sprite.picture(Blink.BIG, Blink.MINI, Blink.INK);
  const w = A.vwidth(art[0] || '');
  out('');
  for (let i = 0; i < Math.max(art.length, lines.length); i++) out('  ' + (art[i] || ' '.repeat(w)) + '   ' + (lines[i] || ''));
  out('');
}
function ask(q) {
  if (!process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); resolve(a); }); });
}
function readStdin() { return new Promise((resolve) => { let s = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (d) => { s += d; }); process.stdin.on('end', () => resolve(s)); }); }
/** One key press: resolves with its name ('space', 'return', '1', 'q', …). */
function key() {
  return new Promise((resolve) => {
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    const on = (str, k) => {
      process.stdin.removeListener('keypress', on);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      if (k && k.ctrl && k.name === 'c') { out(''); process.exit(130); }
      resolve((k && k.name) || str || '');
    };
    process.stdin.on('keypress', on);
  });
}
const cols = () => Math.max(40, Math.min(process.stdout.columns || 80, 96));
function wrap(text, w) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (line && A.vwidth(line + ' ' + word) > w) { lines.push(line); line = word; } else line = line ? line + ' ' + word : word;
    }
    lines.push(line);
  }
  return lines;
}
function box(text, { color = (s) => s, label = '' } = {}) {
  const w = Math.min(64, cols() - 8);
  const body = wrap(text, w - 4);
  const top = '╭' + (label ? '─ ' + label + ' ' : '') + '─'.repeat(Math.max(0, w - 2 - (label ? A.vwidth(label) + 3 : 0))) + '╮';
  const lines = [dim(top), dim('│') + ' '.repeat(w - 2) + dim('│')];
  for (const l of body) lines.push(dim('│') + '  ' + color(l) + ' '.repeat(Math.max(0, w - 4 - A.vwidth(l))) + dim('│'));
  lines.push(dim('│') + ' '.repeat(w - 2) + dim('│'), dim('╰' + '─'.repeat(w - 2) + '╯'));
  return lines.map((l) => '  ' + l).join('\n');
}
const clear = () => { if (process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[H'); };

function pickDeck(q, { need = true } = {}) {
  const d = Deck.find(q);
  if (!d && need) throw new Error(q ? `There's no deck called "${q}". See your decks with: flash` : 'Which deck? See your decks with: flash');
  return d;
}
function line(d, i, now = Date.now()) {
  const c = Srs.counts(d, now, Deck.settings.load().perDay);
  const todo = c.due + c.newToday + c.learning;
  const what = todo ? [c.due && `${c.due} due`, c.newToday && `${c.newToday} new`, c.learning && `${c.learning} learning`].filter(Boolean).join(', ') : c.total ? ok('all done today') : dim('no cards yet');
  const exam = d.exam && d.exam >= Srs.dayOf(now) ? amber(`  test ${Study.until(d.exam, now)}`) : '';
  return `  ${lake(String(i + 1).padStart(3))}  ${bold(d.title.slice(0, 30).padEnd(31))}${dim(String(c.total).padStart(4) + ' cards')}   ${what}${exam}`;
}
/** The deck that most needs studying: a test soonest, then the most due. */
function mostUrgent(decks, now = Date.now()) {
  const perDay = Deck.settings.load().perDay;
  const ranked = decks.map((d) => { const c = Srs.counts(d, now, perDay); return { d, todo: c.due + c.newToday + c.learning, exam: d.exam && d.exam >= Srs.dayOf(now) ? d.exam : Infinity }; })
    .filter((x) => x.todo).sort((a, b) => a.exam - b.exam || b.todo - a.todo);
  return ranked[0] ? ranked[0].d : null;
}

// ── studying in the terminal ──
async function session(d, { mode = 'flip', all = false, reverse = false } = {}) {
  if (!process.stdin.isTTY) throw new Error('Studying needs a terminal you can type in.');
  const perDay = Deck.settings.load().perDay;
  let queue = Srs.queue(d, Date.now(), { perDay, all });
  if (!queue.length) {
    const next = d.cards.filter((c) => !Srs.isNew(c)).map((c) => c.s.due).sort((a, b) => a - b)[0];
    out(`\n  ${ok('Nothing to study in ' + d.title + ' right now.')} ${next ? dim('The next card comes back in ' + Srs.span(next - Date.now()) + '.') : ''}`);
    out(dim(`  To go through every card anyway: flash ${mode === 'flip' ? 'study' : mode} ${d.id} --all\n`));
    return;
  }
  const t0 = Date.now();
  const tally = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let done = 0;
  const q = (c) => (reverse ? c.back : c.front);
  const a = (c) => (reverse ? c.front : c.back);
  while (queue.length) {
    const c = queue.shift();
    const shown = Date.now();
    clear();
    const exam = d.exam && d.exam >= Srs.dayOf(Date.now()) ? amber(`   test ${Study.until(d.exam)}`) : '';
    out(`\n  ${glow('flash')}  ${bold(d.title)}   ${dim(queue.length + 1 + ' to go')}${exam}\n`);
    out(box(q(c), { label: Srs.isNew(c) ? 'new' : '' }));
    if (c.hint) out(dim(`  (${c.hint})`));
    let g;
    if (mode === 'quiz') {
      const ch = Quiz.choices(d, c, { side: reverse ? 'front' : 'back' });
      out('');
      ch.options.forEach((o, i) => out(`  ${lake(String(i + 1))}  ${wrap(o, cols() - 10).join('\n     ')}`));
      out(dim('\n  Press 1-4 (q stops)'));
      let k;
      do { k = await key(); } while (!['1', '2', '3', '4', 'q', 'escape'].includes(k) || (/\d/.test(k) && Number(k) > ch.options.length));
      if (k === 'q' || k === 'escape') break;
      const right = Number(k) - 1 === ch.answer;
      g = right ? 3 : 1;
      out(right ? ok('\n  ✓ Right.') : red(`\n  ✗ It's: `) + bold(a(c)));
      out(dim('  (any key)'));
      if ((await key()) === 'q') { Study.answer(d, c.id, g, { ms: Date.now() - shown, mode }); tally[g]++; done++; break; }
    } else if (mode === 'type') {
      out(dim('\n  Type the answer, then Enter (q stops)'));
      const typed = await ask(`  ${lake('›')} `);
      if (typed.trim().toLowerCase() === 'q' && Quiz.plain(a(c)) !== 'q') break;
      const r = Quiz.check(typed, a(c));
      if (r.verdict === 'right') { out(ok('  ✓ Right.')); g = 3; }
      else if (r.verdict === 'close') { out(ok(`  ✓ Right (${r.note}): `) + bold(a(c))); g = 3; }
      else {
        out(red('  ✗ ') + 'It\'s: ' + bold(a(c)));
        out(dim('  Enter: carry on · y: I was right, count it'));
        const k = await key();
        if (k === 'q') break;
        g = k === 'y' ? 3 : 1;
      }
      if (g === 3) { out(dim('  Enter: carry on · e: that was easy · q: stop')); const k = await key(); if (k === 'e') g = 4; if (k === 'q') { Study.answer(d, c.id, g, { ms: Date.now() - shown, mode }); tally[g]++; done++; break; } }
    } else {
      out(dim('\n  Space shows the answer (q stops)'));
      let k;
      do { k = await key(); } while (!['space', 'return', 'enter', 'q', 'escape'].includes(k));
      if (k === 'q' || k === 'escape') break;
      out('');
      out(box(a(c), { color: (s) => A.paint(s, { fg: '#d7f07a' }) }));
      const p = Srs.preview(c.s, Date.now(), { exam: d.exam });
      out('\n  ' + [1, 2, 3, 4].map((n) => GRADE_INK[n](`${n} ${Srs.GRADES[n]}`) + dim(` ${p[n]}`)).join('   '));
      do { k = await key(); } while (!['1', '2', '3', '4', 'q', 'escape', 'space', 'return'].includes(k));
      if (k === 'q' || k === 'escape') break;
      g = k === 'space' || k === 'return' ? 3 : Number(k);
    }
    const r = Study.answer(d, c.id, g, { ms: Date.now() - shown, mode });
    tally[g]++; done++;
    if (r.leech) { out(amber('\n  You keep forgetting this one.') + dim(' A memory hook helps: open flash app and press "Make a memory hook" on it. (any key)')); await key(); }
    // forgotten or still learning: back in a few cards
    if (r.card.s.due <= Date.now() + 20 * Srs.MIN) queue.splice(Math.min(queue.length, 3 + Math.floor(Math.random() * 3)), 0, r.card);
  }
  clear();
  const mins = Math.max(1, Math.round((Date.now() - t0) / 60000));
  const st = Deck.stats();
  out(`\n  ${glow('flash')}  ${bold(d.title)}\n`);
  if (!done) { out('  Stopped before the first card.\n'); return; }
  out(`  ${done} card${done === 1 ? '' : 's'} in ${mins} min. ${tally[3] + tally[4] ? ' ' + ok(tally[3] + tally[4] + ' knew') : ''}${tally[2] ? '  ' + amber(tally[2] + ' hard') : ''}${tally[1] ? '  ' + red(tally[1] + ' forgot') : ''}`);
  if (st.streak > 1) out(`  ${glow('✦')} ${st.streak} days in a row.`);
  const left = Srs.queue(Deck.load(d.id), Date.now(), { perDay: Deck.settings.load().perDay }).length;
  out(left ? dim(`  ${left} more waiting: flash ${mode === 'flip' ? 'study' : mode} ${d.id}\n`) : ok('  That\'s everything for today.\n'));
}

// ── typing cards in ──
async function typeCards() {
  if (!process.stdin.isTTY) return Deck.parse(await readStdin()).cards;
  out(dim('  Type or paste cards, one a line:  term - definition   (an empty line when you\'re done)\n'));
  const lines = [];
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: lake('  › ') });
  await new Promise((resolve) => {
    rl.prompt();
    rl.on('line', (l) => { if (!l.trim() && lines.length) { rl.close(); return; } if (l.trim()) lines.push(l); rl.prompt(); });
    rl.on('close', resolve);
  });
  const { cards, skipped } = Deck.parse(lines.join('\n'));
  if (skipped.length) out(amber(`  ${skipped.length} line${skipped.length === 1 ? '' : 's'} didn't look like a card (they need a dash, a colon or a Tab between the two sides):`) + '\n' + skipped.slice(0, 5).map((s) => dim('    ' + s)).join('\n'));
  return cards;
}

function opts(args, valued = [], flags = []) {
  const o = { rest: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const m = /^--?([a-z]+)(?:=(.*))?$/i.exec(a);
    if (m && valued.includes(m[1])) o[m[1]] = m[2] != null ? m[2] : args[++i];
    else if (m && flags.includes(m[1])) o[m[1]] = true;
    else o.rest.push(a);
  }
  return o;
}
function pigeon() {
  const js = path.join(process.env.PIGEON_HOME || path.join(os.homedir(), '.pigeon'), 'app', 'bin', 'pigeon.js');
  if (fs.existsSync(js)) return [process.execPath, [js]];
  const r = spawnSync('sh', ['-c', 'command -v pigeon'], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout.trim()) return [r.stdout.trim(), []];
  throw new Error('Sharing uses pigeon (from the same family). Get it with pca, sign in once, then try again. Or: flash export <deck> --flash, and send the file however you like.');
}
/** "4pm", "16:30", "7:15am" → { Hour, Minute } */
function parseTime(s) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(String(s || '').trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (m[3]) { if (/pm/i.test(m[3]) && h < 12) h += 12; if (/am/i.test(m[3]) && h === 12) h = 0; }
  if (h > 23 || min > 59) return null;
  return { Hour: h, Minute: min };
}
const clock = (t) => `${t.Hour % 12 || 12}${t.Minute ? ':' + String(t.Minute).padStart(2, '0') : ''} ${t.Hour < 12 ? 'a.m.' : 'p.m.'}`;
const Mac = () => require('./macos')({ app: 'flash', label: 'dev.dpatel7.flash.remind', home: Deck.home });

/** What the daily reminder says (null: nothing to study, or you already did). */
function nudgeText(now = Date.now()) {
  const decks = Deck.all();
  const perDay = Deck.settings.load().perDay;
  let n = 0;
  for (const d of decks) { const c = Srs.counts(d, now, perDay); n += c.due + c.newToday; }
  if (!n) return null;
  const st = Deck.stats(now);
  const top = mostUrgent(decks, now);
  const test = top && top.exam && top.exam >= Srs.dayOf(now) ? ` Your ${top.title} test is ${Study.until(top.exam, now)}.` : '';
  return { title: `${n} card${n === 1 ? '' : 's'} to study`, text: `${st.streak > 1 && !st.today ? `Keep your ${st.streak}-day streak going.` : st.today ? 'A few more for today.' : 'A few minutes is enough.'}${test}` };
}

/** flash in Spotlight and Launchpad: a little app in ~/Applications that opens the window (no administrator needed). */
function spotlightApp() {
  if (!MAC || process.env.FLASH_NO_APP) return;
  try {
    const Mac = require('./macos')({ app: 'flash', label: 'dev.dpatel7.flash', home: Deck.home });
    const plist = path.join(Mac.appsDir(), 'flash.app', 'Contents', 'Info.plist');
    let same = false;
    try { same = fs.readFileSync(plist, 'utf8').includes(`<key>CFBundleShortVersionString</key><string>${pkg.version}</string>`); } catch { /* not made yet */ }
    if (!same) Mac.makeApp({ name: 'flash', id: 'dev.dpatel7.flash.app', args: ['app'], icon: path.join(__dirname, '..', 'assets', 'flash.icns'), script: SCRIPT, version: pkg.version });
  } catch { /* only a shortcut: never stop the command for it */ }
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (!['uninstall', 'help', '--help', '-h', '--version', '-v', 'version', 'nudge', 'sample'].includes(cmd)) spotlightApp();
  switch (cmd) {
    case undefined: case 'list': case 'decks': {
      const decks = Deck.all();
      const st = Deck.stats();
      intro(['', `${glow('flash')} ${dim('v' + pkg.version)}`, '', 'Study cards that come back', 'just before you\'d forget them.', '', st.streak ? `${glow('✦')} ${st.streak} day${st.streak === 1 ? '' : 's'} in a row${st.today ? dim(`, ${st.today} cards today`) : ''}` : dim(`${Blink.NAME} is ready when you are.`)]);
      if (!decks.length) {
        out('  No decks yet. Make one:\n');
        out(`    ${lake('flash new "Spanish"')}          type or paste cards`);
        out(`    ${lake('flash import words.txt')}       from a file (a Quizlet export works)`);
        out(`    ${lake('flash make biology.pdf')}       made by AI from your notes`);
        if (fs.existsSync(path.join(process.env.TOT_HOME || path.join(os.homedir(), '.tot'), 'cram'))) out(`    ${lake('flash tot')}                    your decks from Tree of Thought's cram`);
        out('');
        return;
      }
      decks.forEach((d, i) => out(line(d, i)));
      const top = mostUrgent(decks);
      for (const d of decks) { const p = Srs.plan(d); if (p && p.days <= 7) out(amber(`\n  ${d.title}: `) + p.say); }
      out('');
      if (!top || !process.stdin.isTTY) { if (!top) out(ok('  All done for today. ') + dim('See you tomorrow.\n')); return; }
      const a = (await ask(dim(`  Enter studies ${bold(top.title)}, a number studies that deck, w opens the window: `))).trim().toLowerCase();
      if (a === 'w') return main(['app']);
      if (a === 'q') return;
      const d = a ? pickDeck(a) : top;
      return session(Deck.load(d.id));
    }
    case 'study': case 'learn': case 'flip': case 'quiz': case 'choose': case 'type': case 'write': {
      const o = opts(rest, [], ['all', 'reverse', 'r', 'a']);
      const d = o.rest.length ? pickDeck(o.rest.join(' ')) : mostUrgent(Deck.all()) || pickDeck(null);
      const mode = { quiz: 'quiz', choose: 'quiz', type: 'type', write: 'type' }[cmd] || 'flip';
      return session(Deck.load(d.id), { mode, all: o.all || o.a, reverse: o.reverse || o.r });
    }
    case 'new': case 'create': {
      const title = rest.join(' ').trim();
      if (!title) throw new Error('What should the deck be called? flash new "Spanish verbs"');
      out(`\n  ${glow('flash')}  a new deck: ${bold(title)}\n`);
      const cards = await typeCards();
      const d = Deck.create(title, cards);
      out(`\n  ${ok('✓')} ${bold(d.title)}: ${cards.length} card${cards.length === 1 ? '' : 's'}. ${cards.length ? 'Study it: ' + lake('flash study ' + d.id) : 'Add cards: ' + lake(`flash add ${d.id} "front" "back"`)}\n`);
      return;
    }
    case 'import': {
      const o = opts(rest, ['title', 'into']);
      if (!o.rest.length) throw new Error('Which file? flash import words.txt');
      for (const f of o.rest) {
        if (o.into) {
          const d = Deck.load(pickDeck(o.into).id);
          const text = fs.readFileSync(f, 'utf8');
          const { cards, skipped } = Deck.parse(text, { csv: /\.csv$/i.test(f) });
          const n = Deck.addCards(d, cards);
          Deck.save(d);
          out(`  ${ok('✓')} ${n} card${n === 1 ? '' : 's'} added to ${bold(d.title)}${skipped.length ? dim(` (${skipped.length} line${skipped.length === 1 ? '' : 's'} skipped)`) : ''}.`);
        } else {
          const { deck, skipped } = Deck.importFile(f, o.title);
          out(`  ${ok('✓')} ${bold(deck.title)}: ${deck.cards.length} cards${skipped.length ? dim(` (${skipped.length} line${skipped.length === 1 ? '' : 's'} didn't look like cards)`) : ''}. Study it: ${lake('flash study ' + deck.id)}`);
        }
      }
      return;
    }
    case 'make': case 'ai': {
      const o = opts(rest, ['n', 'count', 'into', 'title']);
      const source = o.rest.join(' ').trim();
      if (!source) throw new Error('From what? flash make notes.pdf   or   flash make "the French revolution"');
      const Make = require('./make');
      const r = await Make.ready();
      if (!r.ok) throw new Error(r.why);
      out(`\n  ${glow('flash')}  ${r.model.name} is making cards${fs.existsSync(source) ? ' from ' + path.basename(source) : ' about ' + source}…`);
      let dots = 0;
      const made = await Make.make(source, { count: o.n || o.count || 20, onText: () => { if (++dots % 40 === 0) process.stdout.write(dim('.')); } });
      out('');
      if (o.into) {
        const d = Deck.load(pickDeck(o.into).id);
        const n = Deck.addCards(d, made.cards);
        Deck.save(d);
        out(`  ${ok('✓')} ${n} cards added to ${bold(d.title)}.\n`);
        return;
      }
      const d = Deck.create(o.title || made.title, made.cards, { by: made.by });
      out(`  ${ok('✓')} ${bold(d.title)}: ${d.cards.length} cards.`);
      d.cards.slice(0, 3).forEach((c) => out(dim(`    ${c.front.slice(0, 60)}  →  ${c.back.slice(0, 50)}`)));
      out(`  Check them (AI can be wrong): ${lake('flash cards ' + d.id)}   Study: ${lake('flash study ' + d.id)}\n`);
      return;
    }
    case 'add': {
      const [q, front, back] = rest;
      const d = Deck.load(pickDeck(q).id);
      if (front && back) { Deck.addCards(d, [{ front, back }]); Deck.save(d); out(`  ${ok('✓')} Added to ${bold(d.title)} (${d.cards.length} cards).`); return; }
      out(`\n  Adding to ${bold(d.title)}\n`);
      const n = Deck.addCards(d, await typeCards());
      Deck.save(d);
      out(`\n  ${ok('✓')} ${n} card${n === 1 ? '' : 's'} added (${d.cards.length} now).\n`);
      return;
    }
    case 'cards': case 'show': case 'ls': {
      const d = Deck.load(pickDeck(rest.join(' ')).id);
      out(`\n  ${bold(d.title)}  ${dim(d.cards.length + ' cards')}\n`);
      const w = Math.floor((cols() - 12) / 2);
      d.cards.forEach((c, i) => {
        const s = Srs.isNew(c) ? dim('new') : c.s.state === 'review' ? (c.s.ivl >= 21 ? ok('known') : lake(Srs.span(Math.max(0, c.s.due - Date.now())))) : amber('learning');
        out(`  ${dim(String(i + 1).padStart(3))}  ${A.clip(c.front.replace(/\n/g, ' '), w).padEnd(w)}  ${dim(A.clip(c.back.replace(/\n/g, ' '), w))}  ${s}${Srs.isLeech(c) ? red(' ●') : ''}`);
      });
      out('');
      return;
    }
    case 'exam': case 'test': {
      const d = Deck.load(pickDeck(rest[0]).id);
      const when = rest.slice(1).join(' ');
      if (/^(off|none|no|clear)$/i.test(when)) { d.exam = 0; Deck.save(d); out(`  No test date for ${bold(d.title)} now.`); return; }
      const t = Study.parseDate(when);
      if (!t) throw new Error('When is the test? Like: flash exam biology friday   (or "dec 12", "12/12", "in 5 days")');
      if (t < Srs.dayOf(Date.now())) throw new Error('That date has already been.');
      d.exam = t;
      // cards already scheduled past the day before the test come back in time
      const eve = Srs.dayOf(t) - Srs.DAY + 4 * 3600000;
      for (const c of d.cards) if (!Srs.isNew(c) && c.s.due > eve && eve > Date.now()) c.s.due = eve;
      Deck.save(d);
      out(`\n  ${ok('✓')} ${bold(d.title)}: test on ${new Date(t).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}.`);
      out(`  ${Srs.plan(d).say}\n`);
      return;
    }
    case 'export': {
      const o = opts(rest, ['o', 'out'], ['csv', 'flash', 'tsv']);
      const d = Deck.load(pickDeck(o.rest[0]).id);
      const fmt = o.csv ? 'csv' : o.flash ? 'flash' : 'tsv';
      const file = o.o || o.out || o.rest[1] || path.join(process.cwd(), `${d.id}.${fmt === 'tsv' ? 'txt' : fmt}`);
      fs.writeFileSync(file, Deck.exportText(d, fmt));
      out(`  ${ok('✓')} ${file}`);
      if (fmt === 'tsv') out(dim('  Quizlet: Create › Import, paste it (between term and definition: Tab). Anki: File › Import.'));
      return;
    }
    case 'share': {
      const d = Deck.load(pickDeck(rest.join(' ')).id);
      const [bin, pre] = pigeon();
      const file = path.join(os.tmpdir(), `${d.title.replace(/[^\w -]+/g, '').trim() || d.id}.flash`);
      fs.writeFileSync(file, Deck.exportText(d, 'flash'));
      out(`  Sending ${bold(d.title)} with pigeon…`);
      const s = spawnSync(bin, [...pre, 'send', file, '--into', 'Flash'], { encoding: 'utf8', timeout: 120000 });
      if (s.status !== 0) throw new Error((s.stderr || s.stdout || 'pigeon said no').trim().split('\n').pop());
      const l = spawnSync(bin, [...pre, 'link', path.basename(file)], { encoding: 'utf8', timeout: 60000 });
      const url = (String(l.stdout).match(/https?:\/\/\S+/g) || []).pop();
      if (!url) throw new Error((l.stderr || l.stdout || 'pigeon didn\'t make a link').trim().split('\n').pop());
      out(`\n  ${ok('✓')} Anyone with this link can get the deck for 24 hours:\n\n  ${bold(url)}\n`);
      out(dim(`  A friend with flash and pigeon: flash get ${url}\n  Without them: open the link, download the file, then flash import it (or open it in the window).\n`));
      return;
    }
    case 'get': case 'open': {
      if (!rest[0]) throw new Error('Which link? flash get <link>');
      if (fs.existsSync(rest[0])) return main(['import', ...rest]);
      const [bin, pre] = pigeon();
      const s = spawnSync(bin, [...pre, 'open', rest[0]], { encoding: 'utf8', timeout: 120000 });
      const where = (String(s.stdout).match(/✓\s+(.+)$/m) || [])[1];
      if (s.status !== 0 || !where || !fs.existsSync(where.trim())) throw new Error((s.stderr || s.stdout || 'pigeon couldn\'t get it').trim().split('\n').pop());
      return main(['import', where.trim()]);
    }
    case 'tot': case 'cram': {
      const made = Deck.fromTot();
      if (!made.length) { out('  No new decks in Tree of Thought\'s cram (make some with: tot cram notes.md).'); return; }
      made.forEach((d) => out(`  ${ok('✓')} ${bold(d.title)}: ${d.cards.length} cards (with how well you knew them)`));
      return;
    }
    case 'remind': case 'reminder': {
      const a = rest.join(' ').trim();
      if (!a) { const s = Deck.settings.load(); out(s.remind ? `  A reminder at ${clock(s.remind)} on days there's something to study. ${dim('(flash remind off)')}` : `  No reminder. ${dim('flash remind 4pm')}`); return; }
      if (/^(off|no|stop)$/i.test(a)) { Mac().stopAgent(); Deck.settings.save({ remind: null }); out('  No more reminders.'); return; }
      const t = parseTime(a);
      if (!t) throw new Error('What time? Like: flash remind 4pm   (or 16:30)');
      const r = Mac().startAgent({ args: ['nudge'], at: t, script: SCRIPT });
      if (!r.ok) throw new Error(r.why);
      Deck.settings.save({ remind: t });
      out(`  ${ok('✓')} At ${clock(t)} each day, if there's something to study, a notification says so.`);
      return;
    }
    case 'nudge': {
      const n = nudgeText();
      if (n && MAC) Mac().notify(`flash: ${n.title}`, n.text);
      else if (n) out(`${n.title}. ${n.text}`);
      return;
    }
    case 'stats': {
      const st = Deck.stats();
      out(`\n  ${glow('flash')}  ${bold('how it\'s going')}\n`);
      out(`  Streak         ${st.streak ? glow(st.streak + ' day' + (st.streak === 1 ? '' : 's')) : dim('none yet')}${st.best > st.streak ? dim(`  (best: ${st.best})`) : ''}`);
      out(`  Today          ${st.today} cards${st.minutes ? dim(`, about ${st.minutes} min`) : ''}`);
      out(`  Remembered     ${st.remembered != null ? st.remembered + '%' + dim(' of cards you\'d seen before (last 30 days)') : dim('after a few more days of studying')}`);
      out(`  All time       ${st.total} cards studied\n`);
      const last = st.days.slice(-56);
      const shade = (n) => (!n ? dim('·') : n < 10 ? lake('▪') : n < 40 ? A.paint('■', { fg: '#6fb7d6' }) : glow('■'));
      for (let r = 0; r < 7; r++) out('  ' + last.filter((_, i) => i % 7 === r).map((x) => shade(x[1])).join(' '));
      out(dim('\n  The last 8 weeks, a column a week.\n'));
      return;
    }
    case 'rename': {
      const d = Deck.load(pickDeck(rest[0]).id);
      const name = rest.slice(1).join(' ').trim();
      if (!name) throw new Error('What should it be called? flash rename 2 "Biology unit 3"');
      d.title = name.slice(0, 80); Deck.save(d);
      out(`  ${ok('✓')} Now called ${bold(d.title)}.`);
      return;
    }
    case 'rm': case 'delete': {
      const d = pickDeck(rest.join(' '));
      const a = process.stdin.isTTY ? await ask(`  Delete ${bold(d.title)} (${d.cards.length} cards)? (y/n) `) : 'y';
      if (!/^y/i.test(a)) return;
      Deck.remove(d.id);
      out(`  Deleted. ${dim(`(A copy is kept in ${path.join(Deck.home(), 'deleted')}, just in case.)`)}`);
      return;
    }
    case 'setup': case 'key': {
      const Ai = require('./ai');
      const { model } = await Ai.current();
      if (model && rest[0] !== 'again') { out(`  ${ok('✓')} flash makes cards with ${bold(model.name)} (shared with Tree of Thought and the rest of the family). ${dim('flash setup again: another key')}`); return; }
      out(`\n  ${glow('flash')}  free AI, for making cards from your notes\n`);
      out('  Groq is free and quick. On any device:');
      out(`    1. Open ${lake(Ai.FREE.groq.url)}`);
      out(`    2. ${Ai.FREE.groq.steps}`);
      out('    3. Paste it here.\n');
      if (MAC) spawnSync('open', [Ai.FREE.groq.url]);
      const k = (await ask(`  ${lake('Key')}: `)).trim();
      if (!k) return;
      const m = await Ai.addKey('groq', k);
      out(`  ${ok('✓')} Done: ${m.name}. Try: ${lake('flash make "the water cycle"')}\n`);
      return;
    }
    case 'app': case 'window': case 'dashboard': {
      const s = await require('./server').start({});
      require('./open').openWindow(s.url, { width: 1200, height: 860 });
      out(`\n  flash's window is open. ${dim('It closes by itself a few minutes after you close the window (or press Ctrl+C).')}`);
      out(`  ${dim(s.url)}\n`);
      await new Promise(() => {});
      return;
    }
    case '--version': case '-v': case 'version': out(`flash ${pkg.version}`); return;
    case 'help': case '--help': case '-h': out(HELP); return;
    case 'update': return update();
    case 'uninstall': return uninstall();
    default: {
      // `flash biology` studies that deck
      const d = Deck.find(argv.join(' '));
      if (d) return session(Deck.load(d.id));
      throw new Error(`"${cmd}" isn't a flash command or a deck. Try: flash help`);
    }
  }
}

function installUrl(kind) {
  let hub = '';
  try { hub = fs.readFileSync(path.join(Deck.home(), 'hub'), 'utf8').trim(); } catch { /* from GitHub */ }
  if (/^https?:\/\//.test(hub)) return `${hub.replace(/\/+$/, '')}/install.${kind}`;
  return `https://raw.githubusercontent.com/dpatel7-dev/flash/main/install.${kind}`;
}
function update() {
  const url = installUrl('sh');
  out(`  Updating from ${url}`);
  const r = spawnSync('sh', ['-c', `curl -fsSL "${url}" | sh`], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('The update did not finish. Your current version still works.');
}
async function uninstall() {
  if (MAC) require('./macos')({ app: 'flash', label: 'dev.dpatel7.flash', home: Deck.home }).removeApp('flash');
  const root = Deck.home();
  if (MAC) Mac().stopAgent();
  let launcher = '';
  try { launcher = fs.readFileSync(path.join(root, 'launcher'), 'utf8').trim(); } catch { /* not from the installer */ }
  fs.rmSync(path.join(root, 'app'), { recursive: true, force: true });
  fs.rmSync(path.join(root, 'node'), { recursive: true, force: true });
  if (launcher && /flash(\.cmd)?$/.test(launcher)) fs.rmSync(launcher, { force: true });
  out(`  flash is uninstalled. ${dim(`Your decks are still in ${Deck.dir()} (delete that folder too if you don't want them).`)}`);
}

module.exports = { main, HELP, parseTime, nudgeText, mostUrgent };
