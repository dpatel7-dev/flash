'use strict';
// Cards made by AI: from your notes (a text file, Word document or PDF) or a
// topic. And for a card you keep forgetting, a memory hook: a silly sentence,
// a picture in your head, a rhyme. Uses the free AI you set up once for the
// whole family (Tree of Thought's ~/.tot), or `flash setup`.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const Ai = require('./ai');

const MAC = process.platform === 'darwin';

/** Is there an AI to ask? → { ok, model, why } */
async function ready() {
  const { model } = await Ai.current();
  if (!model) return { ok: false, why: 'Making cards with AI needs a free AI key (once, for the whole family of apps): run  flash setup' };
  return { ok: true, model };
}

/** The text of your notes: plain text, Markdown, Word, RTF, web pages; PDFs on a Mac. */
function readNotes(file) {
  const ext = path.extname(file).toLowerCase();
  if (!fs.existsSync(file)) throw new Error(`Can't find ${file}`);
  if (ext === '.pdf') {
    if (!MAC) throw new Error('Reading PDFs needs a Mac. Copy the text out of it into a .txt file instead.');
    const r = spawnSync('osascript', ['-l', 'JavaScript', '-e', 'ObjC.import("PDFKit"); function run(a){ var d = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(a[0])); return d.isNil() ? "" : ObjC.unwrap(d.string); }', file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
    const t = String(r.stdout || '').trim();
    if (!t) throw new Error("That PDF has no text flash can read (it may be scanned pictures of pages).");
    return t;
  }
  if (['.docx', '.doc', '.rtf', '.rtfd', '.odt', '.html', '.htm', '.webarchive'].includes(ext)) {
    if (!MAC) throw new Error(`Reading ${ext} files needs a Mac. Save it as a .txt file instead.`);
    const r = spawnSync('textutil', ['-convert', 'txt', '-stdout', file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
    if (r.status !== 0) throw new Error(`flash couldn't read ${path.basename(file)}.`);
    return String(r.stdout);
  }
  const buf = fs.readFileSync(file);
  if (buf.includes(0)) throw new Error(`${path.basename(file)} isn't a text file. Notes in .txt, .md, Word (.docx) or PDF work.`);
  return buf.toString('utf8');
}

function parseJson(text) {
  let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error("The AI didn't make cards this time. Try again.");
  t = t.slice(a, b + 1);
  try { return JSON.parse(t); } catch { return JSON.parse(t.replace(/,\s*([}\]])/g, '$1')); }
}

async function ask(system, content, { signal, onText } = {}) {
  const r = await ready();
  if (!r.ok) throw new Error(r.why);
  return Ai.stream({ model: r.model, system, messages: [{ role: 'user', content }], signal, onText });
}

/**
 * Cards from notes or a topic. `source` is a file path or a topic.
 * Resolves { title, cards: [{front, back}], by }; doesn't save anything.
 */
async function make(source, { count = 20, level = 'high school', signal, onText } = {}) {
  let material = String(source || '').trim();
  let fromFile = false;
  let title = material;
  if (material && fs.existsSync(material) && fs.statSync(material).isFile()) {
    title = path.basename(material, path.extname(material)).replace(/[-_]+/g, ' ');
    material = readNotes(material);
    fromFile = true;
  } else if (material.length > 300) fromFile = true; // pasted notes
  if (!material) throw new Error('What should the cards be about? Give flash a file of notes, some pasted notes, or a topic.');
  count = Math.max(4, Math.min(60, Number(count) || 20));
  const system = `You make study flashcards for a ${level} student. Make ${count} cards${fromFile ? ' from the notes given, using only what they say' : ' about the topic given'}.
Each card: a short, clear question or term on the front, and a short answer (one or two sentences, or a single word or number when that's the answer) on the back.
Cover the most important ideas, not trivia. One idea per card. Don't make two cards that ask the same thing.
Reply with JSON only: {"title": "<a short name for the deck>", "cards": [{"front": "...", "back": "..."}]}`;
  const r = await ask(system, fromFile ? `Notes:\n\n${material.slice(0, 60000)}` : `Topic: ${material}`, { signal, onText });
  const j = parseJson(r.text);
  const cards = (Array.isArray(j.cards) ? j.cards : []).map((c) => ({ front: String(c.front || c.q || c.question || '').trim(), back: String(c.back || c.a || c.answer || '').trim() }))
    .filter((c) => c.front && c.back).slice(0, 80);
  if (!cards.length) throw new Error("The AI didn't make any cards. Try again, or give it more to work with.");
  return { title: String(j.title || title).slice(0, 60), cards, by: r.model.name };
}

/** A memory hook for a card you keep forgetting. */
async function hook(card, { signal } = {}) {
  const system = 'You help a student remember one flashcard they keep forgetting. Give ONE memory hook: a vivid picture, a silly sentence, a rhyme, or an acronym that links the front to the back. Two sentences at most. No preamble.';
  const r = await ask(system, `Front: ${card.front}\nBack: ${card.back}`, { signal });
  return r.text.trim();
}

/** The card explained simply, with an example. */
async function explain(card, { signal } = {}) {
  const system = 'A student is studying this flashcard. Explain the answer simply in 2 to 4 sentences, with one concrete example. No preamble, no headings.';
  const r = await ask(system, `Front: ${card.front}\nBack: ${card.back}`, { signal });
  return r.text.trim();
}

module.exports = { ready, readNotes, make, hook, explain, parseJson };
