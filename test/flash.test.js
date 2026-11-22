'use strict';
// flash's tests: the scheduler, reading cards out of text, checking typed
// answers, the window's server and the command line. No AI, no network.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'flash-test-'));
process.env.FLASH_HOME = path.join(TMP, 'flash');
process.env.HOME = path.join(TMP, 'home');
process.env.TOT_HOME = path.join(TMP, 'tot');
fs.mkdirSync(process.env.HOME, { recursive: true });

const Srs = require('../src/srs');
const Deck = require('../src/deck');
const Quiz = require('../src/quiz');
const Study = require('../src/study');
const Server = require('../src/server');
const Local = require('../src/local');
const { DAY, MIN } = Srs;

test('the scheduler: steps, then growing gaps; forgetting starts it climbing again', () => {
  const t = new Date(2026, 10, 2, 15, 0).getTime();
  let s = Srs.fresh();
  s = Srs.next(s, 3, t); assert.equal(s.state, 'learning'); assert.equal(s.due - t, 10 * MIN);
  s = Srs.next(s, 3, s.due); assert.equal(s.state, 'review'); assert.equal(s.ivl, 1);
  const gaps = [];
  for (let i = 0; i < 4; i++) { const now = s.due; s = Srs.next(s, 3, now, { seed: 1 }); gaps.push(Math.round((s.due - now) / DAY)); }
  for (let i = 1; i < gaps.length; i++) assert.ok(gaps[i] > gaps[i - 1], `gaps grow: ${gaps}`);
  const before = s.ivl;
  s = Srs.next(s, 1, s.due);
  assert.equal(s.state, 'relearn'); assert.equal(s.lapses, 1); assert.ok(s.ivl < before); assert.ok(s.ease < 2.5);
  s = Srs.next(s, 3, s.due); assert.equal(s.state, 'review');
  // easy goes further than good, hard less far
  const r = { ...Srs.fresh(), state: 'review', ivl: 10, ease: 2.5, due: t };
  const [h, g, e] = [2, 3, 4].map((x) => Srs.next(r, x, t, { seed: 3 }).due);
  assert.ok(h < g && g < e);
  assert.deepEqual(Srs.preview(Srs.fresh(), t), { 1: '1 min', 2: '6 min', 3: '10 min', 4: '4 days' });
});

test('a test date: nothing scheduled past the day before; new cards spread out; the eve brings them all back', () => {
  const now = new Date(2026, 10, 2, 15, 0).getTime();
  const exam = new Date(2026, 10, 9, 8, 0).getTime();
  const s = Srs.next({ ...Srs.fresh(), state: 'review', ivl: 30, ease: 2.5, due: now }, 3, now, { exam });
  assert.equal(new Date(s.due).getDate(), 8);
  const d = { exam, cards: Array.from({ length: 100 }, (_, i) => ({ id: String(i), s: Srs.fresh() })) };
  assert.equal(Srs.newPerDay(d, now, 20), 20);
  d.cards.push(...Array.from({ length: 100 }, (_, i) => ({ id: 'b' + i, s: Srs.fresh() })));
  assert.equal(Srs.newPerDay(d, now, 20), 34); // 200 cards in the 6 days before the eve
  assert.match(Srs.plan(d, now).say, /7 days to go/);
  // the day before: every card, once
  const eve = new Date(2026, 10, 8, 9, 0).getTime();
  const seen = { exam, cards: [1, 2, 3].map((i) => ({ id: String(i), s: { ...Srs.fresh(), state: 'review', ivl: 9, due: eve + 9 * DAY, last: eve - 3 * DAY } })) };
  assert.equal(Srs.queue(seen, eve).length, 3);
  seen.cards[0].s.last = eve; // already gone over today
  assert.equal(Srs.queue(seen, eve).length, 2);
});

test('reading cards out of whatever people paste', () => {
  const p = (t) => Deck.parse(t).cards.map((c) => [c.front, c.back]);
  assert.deepEqual(p('dog\tel perro\ncat\tel gato'), [['dog', 'el perro'], ['cat', 'el gato']]);
  assert.deepEqual(p('- mitosis - cell division\n- osmosis: water through a membrane'), [['mitosis', 'cell division'], ['osmosis', 'water through a membrane']]);
  assert.deepEqual(p('Q: What is 2+2?\nA: 4\n\nQ: Capital of France?\nA: Paris'), [['What is 2+2?', '4'], ['Capital of France?', 'Paris']]);
  assert.deepEqual(p('1776 — independence\n1865 – the Civil War ends'), [['1776', 'independence'], ['1865', 'the Civil War ends']]);
  const cz = Deck.parse('The {{mitochondria}} makes {{energy}}.').cards;
  assert.equal(cz.length, 2);
  assert.equal(cz[0].front, 'The _____ makes energy.');
  assert.equal(cz[1].back, 'energy');
  assert.deepEqual(p('photosynthesis\nhow plants make food\n\nmitosis\ncell division'), [['photosynthesis', 'how plants make food'], ['mitosis', 'cell division']]);
  const csv = Deck.parse('front,back\n"hello, world","a greeting"\nsí,yes\n', { csv: true }).cards;
  assert.deepEqual(csv.map((c) => [c.front, c.back]), [['hello, world', 'a greeting'], ['sí', 'yes']]);
  assert.deepEqual(Deck.parse('one - two\njust a line').skipped, ['just a line']);
  assert.equal(p('see https://example.com/x - a link').length, 1);
});

test('checking typed answers: typos, accents and alternatives forgiven', () => {
  assert.equal(Quiz.check('mitochondria', 'Mitochondria').verdict, 'right');
  assert.equal(Quiz.check('the mitochondira', 'mitochondria').verdict, 'close');
  assert.equal(Quiz.check('el nino', 'el niño').verdict, 'right');
  assert.equal(Quiz.check('color', 'colour / color').verdict, 'right');
  assert.equal(Quiz.check('Paris', 'Paris (France)').verdict, 'right');
  assert.equal(Quiz.check('1,776', '1776').verdict, 'right');
  assert.equal(Quiz.check('cat', 'car').verdict, 'wrong'); // short words must be exact
  assert.equal(Quiz.check('plants turn light, water and carbon dioxide into sugar', 'how plants turn light, water and carbon dioxide into sugar and oxygen').verdict, 'close');
  assert.equal(Quiz.check('plants make food', 'how plants turn light, water and carbon dioxide into sugar and oxygen').verdict, 'wrong');
  assert.equal(Quiz.check('', 'anything').verdict, 'wrong');
});

test('four choices: the right one, and others that look like it', () => {
  const d = { cards: [['a', '1776'], ['b', '1865'], ['c', '1492'], ['d', 'a long sentence about something else entirely'], ['e', '1969'], ['f', 'another long answer that is not a year at all']].map(([f, b], i) => ({ id: String(i), front: f, back: b })) };
  const ch = Quiz.choices(d, d.cards[0], { rnd: () => 0.5 });
  assert.equal(ch.options.length, 4);
  assert.equal(ch.options[ch.answer], '1776');
  assert.ok(ch.options.every((o) => /^\d{4}$/.test(o)), `years with years: ${ch.options}`);
  const tiles = Quiz.matchRound(d, { n: 3 });
  assert.equal(tiles.length, 6);
});

test('decks: make, find, add (no doubles), export, a .flash file, Tree of Thought', () => {
  const d = Deck.create('Spanish food', Deck.parse('la manzana - the apple\nel pan - the bread').cards);
  assert.equal(d.id, 'spanish-food');
  assert.equal(Deck.find('spanish').id, d.id);
  assert.equal(Deck.find('1').id, d.id);
  assert.equal(Deck.addCards(d, [{ front: 'el pan', back: 'the bread' }, { front: 'la leche', back: 'the milk' }]), 1);
  Deck.save(d);
  assert.equal(Deck.exportText(d, 'tsv').split('\n')[0], 'la manzana\tthe apple');
  const f = path.join(TMP, 'food.flash');
  fs.writeFileSync(f, Deck.exportText(d, 'flash'));
  const { deck } = Deck.importFile(f);
  assert.equal(deck.cards.length, 3);
  assert.equal(deck.id, 'spanish-food-2');
  fs.mkdirSync(path.join(process.env.TOT_HOME, 'cram'), { recursive: true });
  fs.writeFileSync(path.join(process.env.TOT_HOME, 'cram', 'cells.json'), JSON.stringify({ id: 'cells', title: 'Cells', cards: [{ id: 0, q: 'What makes energy?', a: 'mitochondria', box: 3, due: Date.now() + 5 * DAY, seen: 4 }, { id: 1, q: 'What makes proteins?', a: 'ribosomes', box: 0, due: 0 }] }));
  const made = Deck.fromTot();
  assert.equal(made.length, 1);
  assert.equal(made[0].cards[0].s.state, 'review');
  assert.equal(made[0].cards[0].s.ivl, 7);
  assert.equal(Deck.fromTot().length, 0, 'not twice');
});

test('answering, streaks and stats', () => {
  const d = Deck.create('Streaks', [{ front: 'a', back: 'b' }, { front: 'c', back: 'd' }]);
  const r = Study.answer(d, d.cards[0].id, 3, { ms: 2000 });
  assert.equal(r.card.s.state, 'learning');
  assert.equal(Deck.load(d.id).today.new, 1);
  const st = Deck.stats();
  assert.equal(st.today, 1);
  assert.equal(st.streak, 1);
  assert.throws(() => Study.answer(d, d.cards[0].id, 7), /Answer with 1/);
});

test('test dates in plain words', () => {
  const now = new Date(2026, 10, 18, 12).getTime(); // a Wednesday
  const day = (t) => new Date(t).toDateString();
  assert.equal(day(Study.parseDate('friday', now)), 'Fri Nov 20 2026');
  assert.equal(day(Study.parseDate('wednesday', now)), 'Wed Nov 25 2026');
  assert.equal(day(Study.parseDate('in 5 days', now)), 'Mon Nov 23 2026');
  assert.equal(day(Study.parseDate('dec 12', now)), 'Sat Dec 12 2026');
  assert.equal(day(Study.parseDate('12/3', now)), 'Thu Dec 03 2026');
  assert.equal(day(Study.parseDate('2027-01-08', now)), 'Fri Jan 08 2027');
  assert.equal(day(Study.parseDate('3 jan', now)), 'Sun Jan 03 2027');
  assert.equal(Study.parseDate('someday', now), null);
});

test("the window's server: studying, the match game, editing, making decks", async () => {
  const s = await Server.start({ port: 0, idleExit: false });
  try {
    const secret = Local.secretIn(path.join(process.env.FLASH_HOME, 'secret'));
    const ask = (what, body) => Local.ask(s.port, secret, what, body, 'x-flash');
    assert.equal((await fetch(`http://127.0.0.1:${s.port}/${secret}/api/state`, { method: 'POST', body: '{}' })).status, 403);
    const made = await ask('create', { title: 'Capitals', text: 'France - Paris\nJapan - Tokyo\nKenya - Nairobi\nPeru - Lima\nnope' });
    assert.equal(made.deck.total, 4);
    assert.deepEqual(made.skipped, ['nope']);
    const id = made.deck.id;
    const q = await ask('queue', { id, mode: 'quiz' });
    assert.equal(q.cards.length, 4);
    assert.equal(q.cards[0].choices.options.length, 4);
    const g = await ask('grade', { id, card: q.cards[0].id, g: 1, mode: 'quiz' });
    assert.equal(g.again, true);
    assert.equal((await ask('check', { id, card: q.cards[0].id, typed: q.cards[0].back.toLowerCase() })).verdict, 'right');
    const m = await ask('match', { id });
    assert.equal(m.tiles.length, 8);
    assert.equal((await ask('match-done', { id, ms: 9000, n: 4 })).record, true);
    assert.equal((await ask('match-done', { id, ms: 12000, n: 4 })).record, false);
    const e = await ask('edit', { id, card: q.cards[1].id, back: 'changed', hook: 'a hook' });
    assert.equal(e.card.back, 'changed');
    assert.equal((await ask('add', { id, text: 'Chile - Santiago' })).added, 1);
    const up = await ask('update', { id, exam: 'in 10 days' });
    assert.match(up.plan.say, /10 days to go/);
    await assert.rejects(ask('update', { id, exam: '2001-01-01' }), /already been/);
    const st = await ask('state');
    assert.ok(st.decks.some((d) => d.id === id));
    assert.equal(st.stats.today >= 1, true);
    const ex = await ask('export', { id, format: 'csv' });
    assert.match(ex.text, /^front,back\n"France","Paris"/);
    const imp = await ask('import-file', { name: 'words.txt', b64: Buffer.from('uno - one\ndos - two').toString('base64') });
    assert.equal(imp.deck.total, 2);
    await ask('remove', { id: imp.deck.id });
    await assert.rejects(ask('deck', { id: imp.deck.id }), /no deck called/);
    const page = await (await fetch(s.url)).text();
    assert.doesNotMatch(page, /__CONFIG__/);
  } finally { await s.close(); }
});

test('the command line', () => {
  const run = (args, input) => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'flash.js'), ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }, input: input || '' });
  assert.match(run(['--version']).stdout, /^flash \d+\.\d+\.\d+/);
  assert.match(run(['help']).stdout, /flash exam <deck> friday/);
  const n = run(['new', 'Planets'], 'Mars - the red planet\nJupiter - the biggest planet\n');
  assert.match(n.stdout, /Planets: 2 cards/);
  const f = path.join(TMP, 'moons.txt');
  fs.writeFileSync(f, 'Moon\tEarth\nPhobos\tMars\n');
  assert.match(run(['import', f]).stdout, /moons: 2 cards/);
  assert.match(run(['add', 'planets', 'Saturn', 'the one with rings']).stdout, /3 cards/);
  assert.match(run(['cards', 'planets']).stdout, /Saturn/);
  assert.match(run(['exam', 'planets', 'in 3 days']).stdout, /3 days to go/);
  const out = path.join(TMP, 'planets.txt');
  run(['export', 'planets', '-o', out]);
  assert.match(fs.readFileSync(out, 'utf8'), /^Mars\tthe red planet/);
  assert.match(run([]).stdout, /Planets/);
  assert.match(run(['stats']).stdout, /Streak/);
  const bad = run(['study', 'nothing-like-this']);
  assert.match(bad.stderr, /no deck called/);
});

test('practice tests: every kind of question, marked fairly, answers kept back', () => {
  const d = { cards: Array.from({ length: 12 }, (_, i) => ({ id: 'c' + i, front: 'term ' + i, back: 'the meaning of number ' + i })) };
  const t = Quiz.makeTest(d, { count: 12, types: ['mc', 'tf', 'written', 'match'] });
  const kinds = new Set(t.map((q) => q.type));
  for (const k of ['mc', 'tf', 'written', 'match']) assert.ok(kinds.has(k), k);
  assert.ok(Quiz.blank(t).every((q) => q.key === undefined), 'no answers sent to the window');
  const right = {};
  for (const q of t) right[q.n] = q.type === 'written' ? q.key.toUpperCase() : q.key;
  assert.equal(Quiz.gradeTest(t, right).percent, 100);
  const none = Quiz.gradeTest(t, {});
  assert.equal(none.score, 0);
  assert.equal(none.total, 12);
  const m = t.find((q) => q.type === 'match');
  const half = { [m.n]: { [m.items[0].card]: m.key[m.items[0].card] } };
  assert.equal(Quiz.gradeTest(t, half).score, 1);
});

test('Learn mode: pick one of four first, then type it; a miss steps back', () => {
  const d = { cards: Array.from({ length: 6 }, (_, i) => ({ id: 'c' + i, front: 'f' + i, back: 'b' + i })) };
  const r1 = Quiz.learnRound(d, {}, { size: 4 });
  assert.equal(r1.length, 4);
  assert.ok(r1.every((q) => q.type === 'mc' && q.options.length === 4));
  const r2 = Quiz.learnRound(d, { c0: 1, c1: 2, c2: 3, c3: 3, c4: 3, c5: 3 }, { size: 7 });
  assert.deepEqual(r2.map((q) => q.card).sort(), ['c0', 'c1']);
  assert.ok(r2.every((q) => q.type === 'written'));
  assert.equal(Quiz.learnStep(0, true, 'mc'), 1);
  assert.equal(Quiz.learnStep(1, true, 'written'), 2);
  assert.equal(Quiz.learnStep(2, true, 'written'), 3);
  assert.equal(Quiz.learnStep(2, false, 'written'), 1);
  assert.deepEqual(Quiz.learnRound(d, { c0: 3, c1: 3, c2: 3, c3: 3, c4: 3, c5: 3 }), []);
});
