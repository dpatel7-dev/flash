'use strict';
// The other ways to study: picking the answer out of four, typing it (small
// typos forgiven), and the match game.

/** Lowercase, no accents, no punctuation, no "the/a/an" in front. */
function plain(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/<[^>]+>/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(the|a|an|to|el|la|le|les|los|las|un|une|der|die|das)\s+/, '');
}
function distance(a, b) {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
/** The answers that count: "colour / color", "Paris (France)", "car; automobile". */
function accepted(answer) {
  const a = String(answer || '');
  const parts = a.split(/\s*(?:\/|;|\bor\b|,\s*or\s|\n)\s*/i).filter((x) => x.trim());
  const noBrackets = a.replace(/\s*\([^)]*\)/g, '');
  return [...new Set([a, noBrackets, ...(parts.length > 1 && parts.length <= 6 ? parts : [])].map(plain).filter(Boolean))];
}

/**
 * Was the typed answer right?  → { verdict: 'right' | 'close' | 'wrong', want }
 * close: right apart from a typo or two (or, for a long answer, most of the key words).
 */
function check(typed, answer) {
  const t = plain(typed);
  const want = accepted(answer);
  if (!t) return { verdict: 'wrong', want: answer };
  if (want.includes(t)) return { verdict: 'right', want: answer };
  for (const w of want) {
    const allow = w.length <= 4 ? 0 : w.length <= 8 ? 1 : Math.min(3, Math.floor(w.length / 6));
    if (allow && distance(t, w) <= allow) return { verdict: 'close', want: answer, note: 'a small typo' };
    if (/^\d/.test(w) && t.replace(/\s/g, '') === w.replace(/\s/g, '')) return { verdict: 'right', want: answer };
  }
  // a long answer: most of the words that matter
  const words = (s) => s.split(' ').filter((x) => x.length > 3);
  const key = words(want[0]);
  if (key.length >= 4) {
    const got = new Set(words(t));
    const hit = key.filter((k) => got.has(k) || [...got].some((g) => g.length > 4 && distance(g, k) <= 1)).length;
    if (hit / key.length >= 0.6) return { verdict: 'close', want: answer, note: 'most of it' };
  }
  return { verdict: 'wrong', want: answer };
}

const shape = (s) => (/^\s*-?[\d.,]+\s*%?\s*$/.test(s) ? 'number' : /\b(1[0-9]{3}|20[0-9]{2})\b/.test(s) ? 'year' : s.split(/\s+/).length <= 3 ? 'short' : 'long');

/**
 * Four answers to pick from: the right one and three that look like it
 * (numbers with numbers, years with years, similar length). `side` is what's
 * asked for: 'back' (the usual) or 'front' (backwards).
 */
function choices(deck, card, { side = 'back', n = 4, rnd = Math.random } = {}) {
  const right = card[side];
  const kind = shape(right);
  const len = right.length;
  const seen = new Set([plain(right)]);
  const pool = deck.cards.filter((c) => c.id !== card.id).map((c) => c[side]).filter((x) => {
    const p = plain(x);
    if (!p || seen.has(p)) return false;
    seen.add(p);
    return true;
  });
  const score = (x) => (shape(x) === kind ? 0 : 2) + Math.abs(Math.log((x.length + 5) / (len + 5))) + rnd() * 0.8;
  const others = pool.map((x) => [x, score(x)]).sort((a, b) => a[1] - b[1]).slice(0, n - 1).map((x) => x[0]);
  const list = [right, ...others];
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return { options: list, answer: list.indexOf(right) };
}

/** A round of the match game: `n` cards, their fronts and backs mixed up as tiles. */
function matchRound(deck, { n = 6, rnd = Math.random, prefer = [] } = {}) {
  const usable = deck.cards.filter((c) => c.front.length <= 120 && c.back.length <= 160);
  const pick = [...prefer.map((id) => usable.find((c) => c.id === id)).filter(Boolean)];
  const rest = usable.filter((c) => !pick.includes(c));
  while (pick.length < Math.min(n, usable.length)) pick.push(rest.splice(Math.floor(rnd() * rest.length), 1)[0]);
  const tiles = [];
  for (const c of pick) { tiles.push({ card: c.id, side: 'front', text: c.front }); tiles.push({ card: c.id, side: 'back', text: c.back }); }
  for (let i = tiles.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [tiles[i], tiles[j]] = [tiles[j], tiles[i]]; }
  return tiles;
}

function shuffle(a, rnd = Math.random) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/**
 * A practice test, like a real one: a mix of multiple choice, written,
 * true/false and a matching section. `types`: which kinds to use; `answerWith`:
 * 'back' (answer with the definition), 'front' (with the term) or 'both'.
 * The answers stay here: the test sent to the window has none.
 */
function makeTest(deck, { count = 20, types = ['mc', 'written', 'tf', 'match'], answerWith = 'back', only = null, rnd = Math.random } = {}) {
  let pool = deck.cards.filter((c) => c.front && c.back);
  if (only && only.length) pool = pool.filter((c) => only.includes(c.id));
  if (!pool.length) throw new Error('This deck has no cards to test you on.');
  types = types.filter((t) => ['mc', 'written', 'tf', 'match'].includes(t));
  if (!types.length) types = ['mc'];
  if (deck.cards.length < 4) types = types.filter((t) => t !== 'mc' && t !== 'match').concat(types.length ? [] : ['written']);
  if (!types.length) types = ['written'];
  const picked = shuffle(pool, rnd).slice(0, Math.max(1, Math.min(Number(count) || 20, pool.length)));
  // a matching section takes up to 5 cards with short sides; the rest are spread over the other kinds
  const qs = [];
  let rest = picked;
  if (types.includes('match') && picked.length >= 4) {
    const fit = picked.filter((c) => c.front.length <= 90 && c.back.length <= 140).slice(0, Math.min(5, Math.max(3, Math.round(picked.length / 4))));
    if (fit.length >= 3) {
      rest = picked.filter((c) => !fit.includes(c));
      const side = answerWith === 'front' ? 'front' : 'back';
      const ask = side === 'back' ? 'front' : 'back';
      const options = shuffle(fit.map((c) => ({ card: c.id, text: c[side] })), rnd);
      qs.push({ type: 'match', items: fit.map((c) => ({ card: c.id, prompt: c[ask] })), options: options.map((o, i) => ({ letter: String.fromCharCode(65 + i), text: o.text })), key: Object.fromEntries(fit.map((c) => [c.id, String.fromCharCode(65 + options.findIndex((o) => o.card === c.id))])) });
    }
  }
  const others = types.filter((t) => t !== 'match');
  const kinds = others.length ? others : ['mc'];
  rest.forEach((c, i) => {
    const type = kinds[i % kinds.length];
    const side = answerWith === 'both' ? (rnd() < 0.5 ? 'back' : 'front') : answerWith === 'front' ? 'front' : 'back';
    const ask = side === 'back' ? 'front' : 'back';
    if (type === 'mc') { const ch = choices(deck, c, { side, rnd }); qs.push({ type, card: c.id, prompt: c[ask], options: ch.options, key: ch.answer, side }); }
    else if (type === 'tf') {
      const truth = rnd() < 0.5;
      let shown = c[side];
      if (!truth) { const other = choices(deck, c, { side, n: 2, rnd }).options.find((o) => plain(o) !== plain(c[side])); if (other) shown = other; }
      qs.push({ type, card: c.id, prompt: c[ask], shown, key: plain(shown) === plain(c[side]), side });
    } else qs.push({ type: 'written', card: c.id, prompt: c[ask], key: c[side], side });
  });
  // the same kinds together, like a paper test: multiple choice, true/false, written, then matching
  const order = { mc: 0, tf: 1, written: 2, match: 3 };
  qs.sort((a, b) => order[a.type] - order[b.type]);
  qs.forEach((q, i) => { q.n = i + 1; });
  return qs;
}
/** The test without its answers, for the window. */
function blank(test) { return test.map(({ key, ...q }) => q); }

/** Mark a test. answers: { [n]: value }. → { score, total, percent, results: [{ n, right, want, got, ... }] } */
function gradeTest(test, answers = {}) {
  let score = 0, total = 0;
  const results = [];
  for (const q of test) {
    const got = answers[q.n];
    if (q.type === 'match') {
      const marks = q.items.map((it) => { const g = got && got[it.card]; const right = g === q.key[it.card]; return { card: it.card, got: g || '', want: q.key[it.card], right }; });
      const r = marks.filter((m) => m.right).length;
      score += r; total += q.items.length;
      results.push({ n: q.n, type: q.type, marks, right: r === q.items.length, points: r, of: q.items.length });
      continue;
    }
    total += 1;
    let right = false, close = false, want = q.key;
    if (q.type === 'mc') { right = Number(got) === q.key; want = q.options[q.key]; }
    else if (q.type === 'tf') { right = got === true || got === 'true' ? q.key === true : got === false || got === 'false' ? q.key === false : false; want = q.key ? 'True' : 'False'; }
    else { const v = check(got || '', q.key); right = v.verdict !== 'wrong'; close = v.verdict === 'close'; }
    if (right) score += 1;
    results.push({ n: q.n, type: q.type, card: q.card, right, close, got: got == null ? '' : got, want, points: right ? 1 : 0, of: 1 });
  }
  return { score, total, percent: total ? Math.round((score / total) * 100) : 0, results };
}

/**
 * Learn mode: rounds of a few cards. Each card climbs: not seen → picked out
 * of four → typed from memory → learned. A miss sends it back down a step
 * and it comes up again later in the round. `levels`: { [cardId]: 0..3 }.
 */
function learnRound(deck, levels = {}, { size = 7, answerWith = 'back', formats = 'both', rnd = Math.random } = {}) {
  const lv = (c) => levels[c.id] || 0;
  const todo = deck.cards.filter((c) => c.front && c.back && lv(c) < 3);
  if (!todo.length) return [];
  // the ones you've started first (so they finish), then new ones
  const started = shuffle(todo.filter((c) => lv(c) > 0), rnd).sort((a, b) => lv(b) - lv(a));
  const fresh = shuffle(todo.filter((c) => lv(c) === 0), rnd);
  const pick = started.concat(fresh).slice(0, size);
  return shuffle(pick, rnd).map((c) => {
    const side = answerWith === 'both' ? (rnd() < 0.5 ? 'back' : 'front') : answerWith === 'front' ? 'front' : 'back';
    const ask = side === 'back' ? 'front' : 'back';
    const written = formats === 'written' || (formats !== 'mc' && lv(c) >= 1) || deck.cards.length < 4;
    const q = { card: c.id, prompt: c[ask], side, level: lv(c), type: written ? 'written' : 'mc', answer: c[side], hint: c.hint || '' };
    if (!written) { const ch = choices(deck, c, { side, rnd }); q.options = ch.options; q.key = ch.answer; }
    return q;
  });
}
/** A card's level after an answer in Learn mode. */
const learnStep = (level, right, type) => (right ? Math.min(3, (level || 0) + (type === 'written' || level >= 1 ? 1 + (level === 0 ? 1 : 0) : 1)) : Math.max(0, (level || 0) - 1));

module.exports = { plain, distance, accepted, check, choices, matchRound, shape, makeTest, blank, gradeTest, learnRound, learnStep, shuffle };
