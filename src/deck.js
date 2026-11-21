'use strict';
// Decks: where they're kept (~/.flash/decks, one file each), how cards get in
// (typed, pasted from anywhere, imported from a file, from Tree of Thought's
// cram) and out again (a .flash file for friends, or text that Quizlet and
// Anki can import). Also the study log, for streaks and stats.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Srs = require('./srs');

const home = () => process.env.FLASH_HOME || path.join(os.homedir(), '.flash');
const dir = () => path.join(home(), 'decks');
const logFile = () => path.join(home(), 'log.jsonl');
const settingsFile = () => path.join(home(), 'settings.json');
const DEFAULTS = { perDay: 20, remind: null, typo: true };

const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'deck';
const cardId = () => crypto.randomBytes(5).toString('hex');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(v, null, 1));
  fs.renameSync(tmp, f); // all or nothing: a deck is never left half-written
}

const settings = {
  load: () => ({ ...DEFAULTS, ...readJson(settingsFile(), {}) }),
  save: (s) => writeJson(settingsFile(), { ...settings.load(), ...s }),
};

function card(front, back, extra = {}) {
  return { id: cardId(), front: clean(front), back: clean(back), made: Date.now(), s: Srs.fresh(), ...extra };
}
const clean = (s) => String(s == null ? '' : s).replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim().slice(0, 4000);

// ── keeping decks ──
function all() {
  let names = [];
  try { names = fs.readdirSync(dir()).filter((n) => n.endsWith('.json')); } catch { return []; }
  return names.map((n) => readJson(path.join(dir(), n), null)).filter((d) => d && Array.isArray(d.cards))
    .sort((a, b) => (b.studied || b.made || 0) - (a.studied || a.made || 0));
}
function load(id) {
  const d = readJson(path.join(dir(), `${path.basename(String(id))}.json`), null);
  if (!d) throw new Error(`There's no deck called "${id}". See your decks with: flash`);
  return d;
}
function save(d) { d.changed = Date.now(); writeJson(path.join(dir(), `${d.id}.json`), d); return d; }

/** Find a deck by its id, its title, a part of its title, or its number in the list. */
function find(q) {
  const decks = all();
  if (q == null || q === '') return null;
  const s = String(q).trim().toLowerCase();
  if (/^\d+$/.test(s) && decks[Number(s) - 1]) return decks[Number(s) - 1];
  return decks.find((d) => d.id === s) || decks.find((d) => d.title.toLowerCase() === s) || decks.find((d) => d.title.toLowerCase().includes(s) || d.id.includes(slug(s))) || null;
}

function create(title, cards = [], extra = {}) {
  title = String(title || 'New deck').trim().slice(0, 80) || 'New deck';
  let id = slug(title);
  const base = id;
  for (let n = 2; fs.existsSync(path.join(dir(), `${id}.json`)); n++) id = `${base}-${n}`;
  return save({ id, title, made: Date.now(), studied: 0, exam: 0, cards: cards.map((c) => (c.id && c.s ? c : card(c.front, c.back, c.hint ? { hint: c.hint } : {}))), ...extra });
}
function remove(id) {
  const f = path.join(dir(), `${path.basename(String(id))}.json`);
  if (!fs.existsSync(f)) throw new Error("That deck isn't there any more.");
  const bin = path.join(home(), 'deleted');
  fs.mkdirSync(bin, { recursive: true });
  fs.renameSync(f, path.join(bin, `${id}-${Date.now()}.json`)); // kept aside, in case
}
/** Add cards, skipping ones the deck already has. Returns how many were added. */
function addCards(d, list) {
  const have = new Set(d.cards.map((c) => norm(c.front) + '\u0000' + norm(c.back)));
  let n = 0;
  for (const c of list) {
    if (!clean(c.front) || !clean(c.back)) continue;
    const k = norm(c.front) + '\u0000' + norm(c.back);
    if (have.has(k)) continue;
    have.add(k);
    d.cards.push(card(c.front, c.back, c.hint ? { hint: c.hint } : {}));
    n++;
  }
  return n;
}
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

// ── reading cards out of text: whatever people paste ──
const SEPS = [/\t/, /\s+[–—]\s+/, /\s+-{1,2}\s+/, /\s*[:=]\s+/, /\s+->\s+/, /\s*=>\s*/];
const BULLET = /^\s*(?:[-*•·]|\d+[.)])\s+/;

/**
 * Cards from pasted text. Understands (one per line):
 *   term<Tab>definition                (what Quizlet and Anki export)
 *   term - definition   term — definition   term: definition   term = definition
 *   Q: question / A: answer            (on lines of their own)
 *   The {{mitochondria}} is the powerhouse of the cell.   (a fill-in-the-blank card)
 *   front, then back, on two lines, with a blank line between cards
 * and .csv files. Returns { cards, skipped }.
 */
function parse(text, { csv = false } = {}) {
  text = String(text || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  if (csv) return parseCsv(text);
  const cards = [];
  const skipped = [];
  // Q: … A: …
  if (/^\s*Q\s*[:.)]/im.test(text) && /^\s*A\s*[:.)]/im.test(text)) {
    const re = /^\s*Q\s*[:.)]\s*([\s\S]*?)\n\s*A\s*[:.)]\s*([\s\S]*?)(?=\n\s*Q\s*[:.)]|\s*$)/gim;
    for (const m of text.matchAll(re)) cards.push({ front: m[1].trim(), back: m[2].trim() });
    if (cards.length) return { cards, skipped };
  }
  const lines = text.split('\n');
  const tabbed = lines.filter((l) => l.includes('\t')).length;
  const useful = lines.filter((l) => l.trim() && !/^\s*#/.test(l));
  // which separator do most lines use?
  let sep = null;
  if (tabbed && tabbed >= useful.length * 0.5) sep = SEPS[0];
  else {
    let best = 0;
    for (const re of SEPS.slice(1)) {
      const n = useful.filter((l) => re.test(l.replace(BULLET, ''))).length;
      if (n > best) { best = n; sep = re; }
    }
    if (best < Math.max(1, useful.length * 0.4)) sep = null;
  }
  const cloze = (l) => /\{\{.+?\}\}/.test(l);
  if (sep) {
    for (const raw of lines) {
      const l = raw.replace(BULLET, '').trim();
      if (!l || /^#/.test(l)) continue;
      if (cloze(l)) { cards.push(...clozeCards(l)); continue; }
      // the separator most lines use; failing that, any other one
      let m = sep.exec(l);
      if (!m || m.index === 0) for (const re of SEPS) { const x = re.exec(l); if (x && x.index > 0) { m = x; break; } }
      if (!m || m.index === 0) { skipped.push(raw.trim()); continue; }
      const front = l.slice(0, m.index).replace(/^\*\*(.+)\*\*$/, '$1').trim();
      const back = l.slice(m.index + m[0].length).trim();
      if (front && back) cards.push({ front, back }); else skipped.push(raw.trim());
    }
    return { cards, skipped };
  }
  // fill-in-the-blank lines
  if (useful.some(cloze)) {
    for (const l of useful) if (cloze(l)) cards.push(...clozeCards(l.replace(BULLET, '').trim())); else skipped.push(l.trim());
    return { cards, skipped };
  }
  // pairs of lines, a blank line between cards
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  for (const b of blocks) {
    const ls = b.split('\n').map((x) => x.replace(BULLET, '').trim()).filter(Boolean);
    if (ls.length >= 2) cards.push({ front: ls[0], back: ls.slice(1).join('\n') });
    else skipped.push(b);
  }
  return { cards, skipped };
}
/** "The {{mitochondria}} makes {{energy}}" → one card per blank. */
function clozeCards(line) {
  const blanks = [...line.matchAll(/\{\{(.+?)\}\}/g)];
  return blanks.map((b, i) => ({
    front: line.replace(/\{\{(.+?)\}\}/g, (m, w, off) => (off === b.index ? '_____' : w)),
    back: b[1],
    hint: blanks.length > 1 ? `blank ${i + 1} of ${blanks.length}` : undefined,
  }));
}
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',' || ch === ';') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const cards = [], skipped = [];
  rows.forEach((r, i) => {
    if (i === 0 && /^(front|term|question|word|q)$/i.test((r[0] || '').trim())) return; // a header row
    if (r[0] && r[0].trim() && r[1] && r[1].trim()) cards.push({ front: r[0].trim(), back: r[1].trim() });
    else if (r.join('').trim()) skipped.push(r.join(','));
  });
  return { cards, skipped };
}

// ── out again ──
const tsvCell = (s) => String(s).replace(/\t/g, ' ').replace(/\n/g, '<br>');
const csvCell = (s) => `"${String(s).replace(/"/g, '""')}"`;
function exportText(d, format = 'tsv') {
  if (format === 'csv') return 'front,back\n' + d.cards.map((c) => `${csvCell(c.front)},${csvCell(c.back)}`).join('\n') + '\n';
  if (format === 'flash') return JSON.stringify({ flash: 1, title: d.title, cards: d.cards.map((c) => ({ front: c.front, back: c.back, ...(c.hint ? { hint: c.hint } : {}) })) }, null, 1) + '\n';
  return d.cards.map((c) => `${tsvCell(c.front)}\t${tsvCell(c.back)}`).join('\n') + '\n';
}

/** A deck from a file: a .flash file from a friend, a .csv, or any text. */
function importFile(file, title) {
  const text = fs.readFileSync(file, 'utf8');
  const ext = path.extname(file).toLowerCase();
  const name = title || path.basename(file, ext).replace(/[-_]+/g, ' ');
  if (ext === '.flash' || /^\s*\{\s*"flash"/.test(text)) {
    const j = JSON.parse(text);
    if (!Array.isArray(j.cards)) throw new Error("That .flash file doesn't have any cards in it.");
    return { deck: create(title || j.title || name, j.cards.filter((c) => c && c.front && c.back)), skipped: [] };
  }
  const { cards, skipped } = parse(text, { csv: ext === '.csv' });
  if (!cards.length) throw new Error(`flash couldn't find cards in ${path.basename(file)}. Put one card per line, like:  photosynthesis - how plants make food from light`);
  return { deck: create(name, cards), skipped };
}

/** Tree of Thought's cram decks (~/.tot/cram), with how well you knew each card. */
function fromTot() {
  const cram = path.join(process.env.TOT_HOME || path.join(os.homedir(), '.tot'), 'cram');
  let names = [];
  try { names = fs.readdirSync(cram).filter((n) => n.endsWith('.json')); } catch { return []; }
  const have = new Set(all().map((d) => d.fromTot).filter(Boolean));
  const GAPS = [0, 1, 3, 7, 16, 35];
  const made = [];
  for (const n of names) {
    const t = readJson(path.join(cram, n), null);
    if (!t || !Array.isArray(t.cards) || have.has(t.id)) continue;
    const cards = t.cards.filter((c) => c.q && c.a).map((c) => {
      const k = card(c.q, c.a);
      if (c.seen) k.s = { ...Srs.fresh(), state: c.box ? 'review' : 'learning', ivl: GAPS[c.box || 0] || 1, due: c.due || 0, reps: c.seen, last: c.due ? c.due - (GAPS[c.box || 0] || 1) * Srs.DAY : 0 };
      return k;
    });
    if (cards.length) made.push(create(t.title || t.id, cards, { fromTot: t.id }));
  }
  return made;
}

// ── the study log: streaks and stats ──
function log(entry) {
  fs.mkdirSync(home(), { recursive: true });
  fs.appendFileSync(logFile(), JSON.stringify({ t: Date.now(), ...entry }) + '\n');
}
function readLog(days = 400, now = Date.now()) {
  let text = '';
  try { text = fs.readFileSync(logFile(), 'utf8'); } catch { return []; }
  const since = now - days * Srs.DAY;
  const out = [];
  for (const line of text.split('\n')) { try { const o = JSON.parse(line); if (o && o.t >= since) out.push(o); } catch { /* skip */ } }
  return out;
}

/** Streak (days in a row, today or yesterday counting), cards a day, how often you knew a card you'd seen before. */
function stats(now = Date.now()) {
  const L = readLog(400, now);
  const byDay = new Map();
  for (const e of L) { const d = Srs.dayOf(e.t); byDay.set(d, (byDay.get(d) || 0) + 1); }
  const today = Srs.dayOf(now);
  let streak = 0;
  let d = byDay.has(today) ? today : today - Srs.DAY;
  while (byDay.has(d)) { streak++; d = Srs.dayOf(d - Srs.DAY / 2); }
  let best = 0, run = 0, prev = null;
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) { run = prev != null && Srs.dayOf(day - Srs.DAY / 2) === prev ? run + 1 : 1; best = Math.max(best, run); prev = day; }
  const month = L.filter((e) => e.t >= now - 30 * Srs.DAY && e.was === 'review');
  const kept = month.filter((e) => e.g > 1).length;
  const days = [];
  for (let i = 119; i >= 0; i--) { const day = Srs.dayOf(today - i * Srs.DAY + Srs.DAY / 2); days.push([day, byDay.get(day) || 0]); }
  return {
    streak, best: Math.max(best, streak), today: byDay.get(today) || 0, total: L.length,
    remembered: month.length >= 10 ? Math.round((kept / month.length) * 100) : null,
    minutes: Math.round(L.filter((e) => e.t >= today).reduce((x, e) => x + Math.min(60000, e.ms || 0), 0) / 60000),
    days,
  };
}

module.exports = { home, dir, settings, card, all, load, save, find, create, remove, addCards, parse, clozeCards, exportText, importFile, fromTot, log, readLog, stats, slug, writeJson, readJson };
