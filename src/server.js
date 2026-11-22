'use strict';
// flash's window: a page served to this computer only, while the window is
// open. When nobody has looked at it for a few minutes, it stops.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Deck = require('./deck');
const Srs = require('./srs');
const Study = require('./study');
const Quiz = require('./quiz');
const Local = require('./local');
const pkg = require('../package.json');

const WEB = path.join(__dirname, '..', 'web');
const perDay = () => Deck.settings.load().perDay;

/** A card as the window sees it. */
function view(d, c, { mode, reverse } = {}) {
  const now = Date.now();
  const v = { id: c.id, front: c.front, back: c.back, hint: c.hint || '', hook: c.hook || '', isNew: Srs.isNew(c), state: (c.s && c.s.state) || 'new', leech: Srs.isLeech(c), preview: Srs.preview(c.s, now, { exam: d.exam }) };
  v.due = c.s && !v.isNew ? c.s.due : 0;
  v.ivl = c.s ? Math.round(c.s.ivl * 10) / 10 : 0;
  if (mode === 'quiz') v.choices = Quiz.choices(d, c, { side: reverse ? 'front' : 'back' });
  return v;
}
function summary(d, now = Date.now()) {
  const c = Srs.counts(d, now, perDay());
  return { id: d.id, title: d.title, made: d.made, studied: d.studied || 0, exam: d.exam || 0, examIn: d.exam ? Study.until(d.exam, now) : '', ...c, todo: c.due + c.newToday + c.learning, by: d.by || '' };
}
function hasTot() {
  const cram = path.join(process.env.TOT_HOME || path.join(os.homedir(), '.tot'), 'cram');
  try { return fs.readdirSync(cram).some((n) => n.endsWith('.json')); } catch { return false; }
}
function pigeonBin() {
  const js = path.join(process.env.PIGEON_HOME || path.join(os.homedir(), '.pigeon'), 'app', 'bin', 'pigeon.js');
  if (fs.existsSync(js)) return [process.execPath, [js]];
  const r = spawnSync('sh', ['-c', 'command -v pigeon'], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() ? [r.stdout.trim(), []] : null;
}
const tests = new Map(); // practice tests being taken: their answers stay here
function learnCounts(d) {
  const L = d.learn || {};
  const n = d.cards.length;
  const learned = d.cards.filter((c) => (L[c.id] || 0) >= 3).length;
  const learning = d.cards.filter((c) => (L[c.id] || 0) > 0 && (L[c.id] || 0) < 3).length;
  return { total: n, learned, learning, fresh: n - learned - learning };
}
const need = (x, msg) => { if (!x) throw Object.assign(new Error(msg), { status: 400 }); return x; };
const card = (d, id) => need(d.cards.find((c) => c.id === id), "That card isn't in the deck any more.");

async function api(what, b) {
  const now = Date.now();
  switch (what) {
    case 'ping': return { ok: true };
    case 'state': {
      const Ai = require('./ai');
      const { model } = await Ai.current().catch(() => ({ model: null }));
      const s = Deck.settings.load();
      return { decks: Deck.all().map((d) => summary(d, now)), stats: Deck.stats(now), ai: model ? { ok: true, name: model.name } : { ok: false }, settings: s, pigeon: !!pigeonBin(), tot: hasTot(), mac: process.platform === 'darwin' };
    }
    case 'deck': {
      const d = Deck.load(b.id);
      return { deck: summary(d, now), plan: Srs.plan(d, now, perDay()), cards: d.cards.map((c) => view(d, c)), tests: (d.tests || []).slice(0, 10).map(({ missed, ...t }) => ({ ...t, missed: missed.length })), learn: learnCounts(d) };
    }
    case 'queue': {
      const d = Deck.load(b.id);
      let list = Srs.queue(d, now, { perDay: perDay(), all: !!b.all });
      if (b.only === 'hard') list = d.cards.filter((c) => Srs.isLeech(c) || (c.s && c.s.lapses > 0) || (c.s && c.s.state !== 'review' && !Srs.isNew(c)));
      return { cards: list.map((c) => view(d, c, b)), next: d.cards.filter((c) => !Srs.isNew(c)).map((c) => c.s.due).filter((t) => t > now).sort((x, y) => x - y)[0] || 0 };
    }
    case 'grade': {
      const d = Deck.load(b.id);
      const r = Study.answer(d, b.card, b.g, { ms: b.ms, mode: b.mode });
      return { card: view(d, r.card, b), again: r.card.s.due <= Date.now() + 20 * Srs.MIN, leech: r.leech, deck: summary(d) };
    }
    case 'check': {
      const d = Deck.load(b.id);
      const c = card(d, b.card);
      return Quiz.check(b.typed, b.reverse ? c.front : c.back);
    }
    case 'test-make': {
      const d = Deck.load(b.id);
      let only = null;
      if (b.only === 'missed') { const last = (d.tests || [])[0]; only = last ? last.missed : null; if (!only || !only.length) throw new Error('There were no mistakes last time: try a whole test.'); }
      const qs = Quiz.makeTest(d, { count: b.count === 'all' ? d.cards.length : b.count, types: b.types, answerWith: b.answerWith, only });
      const testId = require('crypto').randomBytes(8).toString('hex');
      tests.set(testId, { deck: d.id, qs, at: now });
      for (const [k, v] of tests) if (now - v.at > 6 * 3600000) tests.delete(k);
      return { testId, test: Quiz.blank(qs) };
    }
    case 'test-grade': {
      const t = need(tests.get(b.testId), 'That test has expired. Start a new one.');
      const d = Deck.load(t.deck);
      const r = Quiz.gradeTest(t.qs, b.answers || {});
      const missed = [...new Set(r.results.flatMap((x) => (x.type === 'match' ? x.marks.filter((m) => !m.right).map((m) => m.card) : x.right ? [] : [x.card])))];
      d.tests = [{ at: now, percent: r.percent, score: r.score, total: r.total, missed }, ...(d.tests || [])].slice(0, 30);
      d.studied = now;
      Deck.save(d);
      Deck.log({ deck: d.id, card: null, g: 3, ms: Number(b.ms) || 0, mode: 'test', was: 'test', n: r.total });
      return { ...r, missed: missed.length };
    }
    case 'learn': {
      const d = Deck.load(b.id);
      if (b.reset) { d.learn = {}; Deck.save(d); }
      const round = Quiz.learnRound(d, d.learn || {}, { answerWith: b.answerWith, formats: b.formats, size: 7 });
      return { round, counts: learnCounts(d) };
    }
    case 'learn-answer': {
      const d = Deck.load(b.id);
      card(d, b.card);
      d.learn = d.learn || {};
      d.learn[b.card] = Quiz.learnStep(d.learn[b.card] || 0, !!b.right, b.type);
      d.studied = now;
      Deck.save(d);
      Deck.log({ deck: d.id, card: b.card, g: b.right ? 3 : 1, ms: Number(b.ms) || 0, mode: 'learn', was: 'learn' });
      return { level: d.learn[b.card], counts: learnCounts(d) };
    }
    case 'match': {
      const d = Deck.load(b.id);
      if (d.cards.length < 3) throw new Error('The match game needs at least 3 cards.');
      const due = Srs.queue(d, now, { perDay: perDay() }).map((c) => c.id);
      return { tiles: Quiz.matchRound(d, { n: Math.min(6, Number(b.n) || 6), prefer: due.slice(0, 3) }), best: (d.best || {}).match || 0 };
    }
    case 'match-done': {
      const d = Deck.load(b.id);
      const ms = Math.round(Number(b.ms) || 0);
      const best = (d.best || {}).match || 0;
      const record = ms > 0 && (!best || ms < best);
      if (record) { d.best = { ...(d.best || {}), match: ms }; Deck.save(d); }
      Deck.log({ deck: d.id, card: null, g: 3, ms, mode: 'match', was: 'game', n: Number(b.n) || 0 });
      return { record, best: record ? ms : best };
    }
    case 'parse': return Deck.parse(b.text, { csv: !!b.csv });
    case 'create': {
      const { cards, skipped } = b.cards ? { cards: b.cards, skipped: [] } : Deck.parse(b.text || '', { csv: !!b.csv });
      const d = Deck.create(need(String(b.title || '').trim(), 'Give the deck a name.'), [], b.by ? { by: b.by } : {});
      Deck.addCards(d, cards);
      Deck.save(d);
      return { deck: summary(d), skipped };
    }
    case 'add': {
      const d = Deck.load(b.id);
      const list = b.text != null ? Deck.parse(b.text, { csv: !!b.csv }) : { cards: b.cards || [{ front: b.front, back: b.back }], skipped: [] };
      const n = Deck.addCards(d, list.cards);
      Deck.save(d);
      return { added: n, skipped: list.skipped, deck: summary(d) };
    }
    case 'edit': {
      const d = Deck.load(b.id);
      const c = card(d, b.card);
      if (b.front != null) c.front = need(String(b.front).trim(), "A card can't be blank.").slice(0, 4000);
      if (b.back != null) c.back = need(String(b.back).trim(), "A card can't be blank.").slice(0, 4000);
      if (b.hook != null) c.hook = String(b.hook).trim().slice(0, 1000);
      Deck.save(d);
      return { card: view(d, c) };
    }
    case 'delete-card': {
      const d = Deck.load(b.id);
      d.cards = d.cards.filter((c) => c.id !== b.card);
      Deck.save(d);
      return { deck: summary(d) };
    }
    case 'reset-card': { const d = Deck.load(b.id); Study.reset(d, b.card); return { ok: true }; }
    case 'update': {
      const d = Deck.load(b.id);
      if (b.title != null) d.title = need(String(b.title).trim(), 'Give the deck a name.').slice(0, 80);
      if (b.exam !== undefined) {
        if (!b.exam) d.exam = 0;
        else {
          const t = need(/^\d{4}-\d{2}-\d{2}$/.test(b.exam) ? Study.parseDate(b.exam) : Study.parseDate(b.exam), 'When is the test? Pick a date.');
          if (t < Srs.dayOf(now)) throw new Error('That date has already been.');
          d.exam = t;
          const eve = Srs.dayOf(t) - Srs.DAY + 4 * 3600000;
          for (const c of d.cards) if (!Srs.isNew(c) && c.s.due > eve && eve > now) c.s.due = eve;
        }
      }
      Deck.save(d);
      return { deck: summary(d), plan: Srs.plan(d, now, perDay()) };
    }
    case 'remove': Deck.remove(b.id); return { ok: true };
    case 'export': {
      const d = Deck.load(b.id);
      const fmt = ['csv', 'flash', 'tsv'].includes(b.format) ? b.format : 'tsv';
      return { text: Deck.exportText(d, fmt), name: `${d.title.replace(/[^\w -]+/g, '').trim() || d.id}.${fmt === 'tsv' ? 'txt' : fmt}` };
    }
    case 'import-file': {
      const name = path.basename(String(b.name || 'cards.txt'));
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flash-'));
      const f = path.join(tmp, name);
      try {
        fs.writeFileSync(f, Buffer.from(String(b.b64 || ''), 'base64'));
        if (/\.(pdf|docx?|rtf|odt|pages)$/i.test(name)) return { notes: require('./make').readNotes(f).slice(0, 80000), name };
        const { deck, skipped } = Deck.importFile(f, b.title);
        return { deck: summary(deck), skipped };
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }
    case 'make': {
      const Make = require('./make');
      const made = await Make.make(need(String(b.source || '').trim(), 'Paste some notes, or type a topic.'), { count: b.count });
      if (b.into) {
        const d = Deck.load(b.into);
        const n = Deck.addCards(d, made.cards);
        Deck.save(d);
        return { deck: summary(d), added: n, by: made.by };
      }
      const d = Deck.create(String(b.title || '').trim() || made.title, made.cards, { by: made.by });
      return { deck: summary(d), added: d.cards.length, by: made.by };
    }
    case 'hook': case 'explain': {
      const d = Deck.load(b.id);
      const c = card(d, b.card);
      const text = await require('./make')[what](c);
      if (what === 'hook') { c.hook = text.slice(0, 1000); Deck.save(d); }
      return { text };
    }
    case 'setup': { const m = await require('./ai').addKey(b.provider || 'groq', b.key); return { ok: true, name: m.name }; }
    case 'settings': {
      const s = {};
      if (b.perDay != null) s.perDay = Math.max(1, Math.min(200, Number(b.perDay) || 20));
      Deck.settings.save(s);
      return { settings: Deck.settings.load() };
    }
    case 'remind': {
      const { parseTime } = require('./cli');
      const Mac = require('./macos')({ app: 'flash', label: 'dev.dpatel7.flash.remind', home: Deck.home });
      if (!b.time) { Mac.stopAgent(); Deck.settings.save({ remind: null }); return { remind: null }; }
      const t = need(parseTime(b.time), 'Pick a time, like 4pm.');
      const r = Mac.startAgent({ args: ['nudge'], at: t, script: path.join(__dirname, '..', 'bin', 'flash.js') });
      if (!r.ok) throw new Error(r.why);
      Deck.settings.save({ remind: t });
      return { remind: t };
    }
    case 'tot': return { made: Deck.fromTot().map((d) => summary(d)) };
    case 'share': {
      const d = Deck.load(b.id);
      const bin = need(pigeonBin(), 'Sharing uses pigeon (from the same family). Get it with pca and sign in once. Or use Export › .flash file and send that.');
      const file = path.join(os.tmpdir(), `${d.title.replace(/[^\w -]+/g, '').trim() || d.id}.flash`);
      fs.writeFileSync(file, Deck.exportText(d, 'flash'));
      const s = spawnSync(bin[0], [...bin[1], 'send', file, '--into', 'Flash'], { encoding: 'utf8', timeout: 120000 });
      if (s.status !== 0) throw new Error((s.stderr || s.stdout || 'pigeon said no').trim().split('\n').pop());
      const l = spawnSync(bin[0], [...bin[1], 'link', path.basename(file)], { encoding: 'utf8', timeout: 60000 });
      const url = (String(l.stdout).match(/https?:\/\/\S+/g) || []).pop();
      if (!url) throw new Error((l.stderr || l.stdout || "pigeon didn't make a link").trim().split('\n').pop());
      return { url };
    }
    default: throw Object.assign(new Error(`flash doesn't know "${what}".`), { status: 404 });
  }
}

async function start({ port = 0, idleExit = true } = {}) {
  let seen = Date.now();
  const s = await Local.serve({
    port, secret: Local.secretIn(path.join(Deck.home(), 'secret')), web: WEB, header: 'x-flash',
    config: () => ({ version: pkg.version }),
    api: async (what, b) => { seen = Date.now(); return api(what, b || {}); },
  });
  if (idleExit) {
    const t = setInterval(() => { if (Date.now() - seen > 300000) { clearInterval(t); s.close().then(() => process.exit(0)); } }, 20000);
    t.unref();
  }
  return s;
}

module.exports = { start, api, view, summary };
