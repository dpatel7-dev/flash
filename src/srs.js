'use strict';
// When each card comes back. Cards you know come back later and later (a day,
// four days, ten, a month…); ones you forget come back in a minute and start
// climbing again. Four answers: 1 Again (forgot), 2 Hard, 3 Good, 4 Easy.
//
// With a test date, nothing is scheduled past the day before the test, and
// new cards are spread out so every card is learned in time. The day before
// the test, every card comes up once more.

const DAY = 86400000;
const MIN = 60000;
const LEARN = [1, 10]; // minutes: the first steps for a new card (and 10 min after forgetting)
const GRADES = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };

const fresh = () => ({ state: 'new', due: 0, ivl: 0, ease: 2.5, step: 0, reps: 0, lapses: 0, last: 0 });
const dayOf = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** A little wobble (±5%), so cards made together don't all come back on the same day. */
const wobble = (ivl, seed) => (ivl < 3 ? ivl : ivl * (0.95 + ((Math.sin(seed * 9301 + 49297) + 1) / 2) * 0.1));

/**
 * What happens to a card for each answer. Returns the new schedule; doesn't
 * change the card. `exam` (a time) keeps it from being scheduled past the
 * day before the test.
 */
function next(s0, g, now = Date.now(), { exam = 0, seed = 0 } = {}) {
  const s = { ...fresh(), ...s0, reps: (s0.reps || 0) + 1, last: now };
  const learning = s.state === 'new' || s.state === 'learning' || s.state === 'relearn';
  if (learning) {
    if (g === 1) { s.state = s.state === 'relearn' ? 'relearn' : 'learning'; s.step = 0; s.due = now + LEARN[0] * MIN; }
    else if (g === 2) { s.state = s.state === 'relearn' ? 'relearn' : 'learning'; const a = LEARN[s.step] || 10; s.due = now + Math.round((a + (LEARN[s.step + 1] || a * 1.5)) / 2) * MIN; }
    else if (g === 3 && s.step + 1 < LEARN.length) { s.state = s.state === 'relearn' ? 'relearn' : 'learning'; s.step += 1; s.due = now + LEARN[s.step] * MIN; }
    else {
      // graduates: to a day (Good), or four (Easy). After forgetting, back to what's left of its old gap.
      const base = s.state === 'relearn' ? Math.max(1, s.ivl) : g === 4 ? 4 : 1;
      s.ivl = s.state === 'relearn' && g === 4 ? base * 1.5 : base;
      if (g === 4 && s.state !== 'relearn') s.ease = Math.min(3.2, s.ease + 0.15);
      s.state = 'review'; s.step = 0;
      s.due = dayOf(now) + Math.round(s.ivl) * DAY + 4 * 3600000; // 4 a.m. that day: due all of that day
    }
  } else {
    const late = Math.max(0, (now - s.due) / DAY); // reviewed late and still knew it: that counts for more
    if (g === 1) {
      s.lapses += 1; s.ease = Math.max(1.3, s.ease - 0.2); s.ivl = Math.max(1, s.ivl * 0.4);
      s.state = 'relearn'; s.step = 1; s.due = now + LEARN[1] * MIN;
      return capped(s, now, exam);
    }
    const good = Math.max(s.ivl + 1, (s.ivl + late / 2) * s.ease);
    if (g === 2) { s.ease = Math.max(1.3, s.ease - 0.15); s.ivl = Math.min(good, Math.max(s.ivl + 1, s.ivl * 1.2)); }
    else if (g === 3) s.ivl = good;
    else { s.ease = Math.min(3.2, s.ease + 0.15); s.ivl = Math.max(good + 1.5, (s.ivl + late) * s.ease * 1.3); }
    s.ivl = Math.min(365 * 3, wobble(s.ivl, seed));
    s.due = dayOf(now) + Math.round(s.ivl) * DAY + 4 * 3600000;
  }
  return capped(s, now, exam);
}

/** With a test coming: never later than the day before it. */
function capped(s, now, exam) {
  if (!exam || exam <= now) return s;
  const eve = dayOf(exam) - DAY + 4 * 3600000;
  if (eve > now && s.due > eve) s.due = eve;
  return s;
}

/** "1 min", "10 min", "1 day", "4 days", "2 mo" */
function span(ms) {
  const m = Math.round(ms / MIN);
  if (m < 60) return `${Math.max(1, m)} min`;
  const h = Math.round(m / 60);
  if (h < 20) return `${h} h`;
  const d = Math.round(ms / DAY);
  if (d < 31) return `${d} day${d === 1 ? '' : 's'}`;
  const mo = Math.round(d / 30.4);
  return mo < 12 ? `${mo} mo` : `${Math.round((d / 365) * 10) / 10} yr`;
}

/** What each answer would do, for the buttons: { 1: '1 min', 2: '15 min', 3: '1 day', 4: '4 days' } */
function preview(s, now = Date.now(), opts = {}) {
  const out = {};
  for (const g of [1, 2, 3, 4]) {
    const n = next(s || fresh(), g, now, opts);
    const days = Math.round((dayOf(n.due) - dayOf(now)) / DAY);
    const eve = opts.exam && opts.exam > now ? dayOf(opts.exam) - DAY + 4 * 3600000 : 0;
    out[g] = g > 1 && eve && n.due === eve && days >= 1 ? 'before the test' : n.state === 'review' && days >= 1 ? span(days * DAY) : span(Math.max(MIN, n.due - now));
  }
  return out;
}

const isNew = (c) => !c.s || c.s.state === 'new';
const isDue = (c, now = Date.now()) => !isNew(c) && c.s.due <= now;
/** A card you keep forgetting. */
const isLeech = (c) => !!c.s && c.s.lapses >= 4;

/** How many new cards a day: normally `perDay`; with a test, enough to learn them all two days before it. */
function newPerDay(deck, now = Date.now(), perDay = 20) {
  const fresh = deck.cards.filter(isNew).length;
  if (!deck.exam || deck.exam <= now) return perDay;
  const days = Math.max(1, Math.floor((dayOf(deck.exam) - dayOf(now)) / DAY) - 1);
  return Math.max(perDay, Math.ceil(fresh / days));
}

/**
 * Today's cards for a deck: the ones that are due (learning steps first), then
 * new ones up to today's allowance. The day before a test: every card.
 */
function queue(deck, now = Date.now(), { perDay = 20, all = false } = {}) {
  const today = dayOf(now);
  const introduced = deck.today && deck.today.day === today ? deck.today.new : 0;
  const eve = deck.exam && dayOf(deck.exam) - DAY === today;
  const learning = deck.cards.filter((c) => !isNew(c) && c.s.state !== 'review' && c.s.due <= now + 20 * MIN).sort((a, b) => a.s.due - b.s.due);
  const reviews = deck.cards.filter((c) => !isNew(c) && c.s.state === 'review' && (all || c.s.due <= now || (eve && c.s.last < today))).sort((a, b) => a.s.due - b.s.due);
  const room = all ? Infinity : Math.max(0, newPerDay(deck, now, perDay) - introduced);
  const news = deck.cards.filter(isNew).slice(0, room);
  return [...learning, ...reviews, ...news];
}

/** Counts for a deck: due now, new to learn today, learning, total, known. */
function counts(deck, now = Date.now(), perDay = 20) {
  const today = dayOf(now);
  const introduced = deck.today && deck.today.day === today ? deck.today.new : 0;
  const nNew = deck.cards.filter(isNew).length;
  return {
    total: deck.cards.length,
    due: deck.cards.filter((c) => isDue(c, now)).length,
    fresh: nNew,
    newToday: Math.min(nNew, Math.max(0, newPerDay(deck, now, perDay) - introduced)),
    learning: deck.cards.filter((c) => !isNew(c) && c.s.state !== 'review').length,
    known: deck.cards.filter((c) => !isNew(c) && c.s.state === 'review' && c.s.ivl >= 21).length,
    leeches: deck.cards.filter(isLeech).length,
  };
}

/** A plan for the days until a test: how many cards each day, and whether it all fits. */
function plan(deck, now = Date.now(), perDay = 20) {
  if (!deck.exam || dayOf(deck.exam) < dayOf(now)) return null;
  const days = Math.round((dayOf(deck.exam) - dayOf(now)) / DAY);
  const c = counts(deck, now, perDay);
  const daily = newPerDay(deck, now, perDay);
  return {
    days, daily, fresh: c.fresh,
    say: days === 0 ? 'The test is today. Good luck!'
      : days === 1 ? 'The test is tomorrow: today, every card comes up once more.'
      : c.fresh && c.fresh <= daily ? `${days} days to go. Learn the ${c.fresh} new card${c.fresh === 1 ? '' : 's'} today, then keep up with what's due each day. The day before, they all come up once more.`
      : c.fresh ? `${days} days to go. Learn about ${daily} new cards a day and you'll have seen them all by ${days > 2 ? 'the day before' : 'tomorrow'}, with time to go over them again.`
      : `${days} days to go, and you've seen every card. Keep up with what's due each day; the day before, they all come up once more.`,
  };
}

module.exports = { next, preview, span, queue, counts, plan, newPerDay, fresh, isNew, isDue, isLeech, dayOf, GRADES, DAY, MIN };
