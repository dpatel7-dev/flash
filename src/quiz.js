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

module.exports = { plain, distance, accepted, check, choices, matchRound, shape };
