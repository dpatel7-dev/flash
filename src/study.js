'use strict';
// Answering a card: the new schedule, today's count of new cards, the log.
// Shared by the terminal and the window.

const Srs = require('./srs');
const Deck = require('./deck');

const seedOf = (id) => [...String(id)].reduce((x, c) => (x * 31 + c.charCodeAt(0)) % 100003, 7);

/** Answer card `cardId` in deck `d` with g (1 Again … 4 Easy). Saves the deck. */
function answer(d, cardId, g, { ms = 0, mode = 'flip', now = Date.now() } = {}) {
  g = Number(g);
  if (![1, 2, 3, 4].includes(g)) throw new Error('Answer with 1 (again), 2 (hard), 3 (good) or 4 (easy).');
  const c = d.cards.find((x) => x.id === cardId);
  if (!c) throw new Error("That card isn't in the deck any more.");
  const was = (c.s && c.s.state) || 'new';
  c.s = Srs.next(c.s || Srs.fresh(), g, now, { exam: d.exam, seed: seedOf(c.id) });
  const today = Srs.dayOf(now);
  if (was === 'new') d.today = { day: today, new: (d.today && d.today.day === today ? d.today.new : 0) + 1 };
  d.studied = now;
  Deck.save(d);
  Deck.log({ deck: d.id, card: c.id, g, ms: Math.round(ms), mode, was });
  return { card: c, was, leech: Srs.isLeech(c) && g === 1 };
}

/** Put a card back to new (forget its progress). */
function reset(d, cardId) {
  const c = d.cards.find((x) => x.id === cardId);
  if (c) { c.s = Srs.fresh(); Deck.save(d); }
  return c;
}

/** "in 3 days", "tomorrow", "today", "passed" */
function until(t, now = Date.now()) {
  const days = Math.round((Srs.dayOf(t) - Srs.dayOf(now)) / Srs.DAY);
  return days < 0 ? 'passed' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
}

/** "friday", "dec 12", "12/3", "2026-12-12", "in 5 days", "tomorrow" → a time (that day, 8 a.m.), or null. */
function parseDate(s, now = Date.now()) {
  s = String(s || '').trim().toLowerCase();
  if (!s) return null;
  const at8 = (d) => { d.setHours(8, 0, 0, 0); return d.getTime(); };
  const base = new Date(now);
  if (s === 'today') return at8(base);
  if (s === 'tomorrow') { base.setDate(base.getDate() + 1); return at8(base); }
  let m = /^in\s+(\d+)\s*(d|days?|w|weeks?)$/.exec(s);
  if (m) { base.setDate(base.getDate() + Number(m[1]) * (/^w/.test(m[2]) ? 7 : 1)); return at8(base); }
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const wd = DAYS.findIndex((d) => d.startsWith(s.replace(/^next\s+/, '').slice(0, 3)) && s.replace(/^next\s+/, '').length >= 3);
  if (wd >= 0 && /^(next\s+)?[a-z]+$/.test(s)) { let add = (wd - base.getDay() + 7) % 7 || 7; if (/^next\s/.test(s) && add < 7) add += 7; base.setDate(base.getDate() + add); return at8(base); }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return at8(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s); // US style: month/day
  if (m) { const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : base.getFullYear(); const d = new Date(y, Number(m[1]) - 1, Number(m[2])); if (!m[3] && d.getTime() < now - Srs.DAY) d.setFullYear(y + 1); return at8(d); }
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  m = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/.exec(s) || /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?(?:,?\s+(\d{4}))?$/.exec(s);
  if (m) {
    const [mon, day] = /^\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]];
    const mi = MONTHS.indexOf(mon);
    if (mi >= 0) { const y = m[3] ? Number(m[3]) : base.getFullYear(); const d = new Date(y, mi, Number(day)); if (!m[3] && d.getTime() < now - Srs.DAY) d.setFullYear(y + 1); return at8(d); }
  }
  return null;
}

module.exports = { answer, reset, until, parseDate, seedOf };
