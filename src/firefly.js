'use strict';
// Blink, flash's firefly. Fireflies flash to find each other in the dark,
// which is roughly what remembering is. Every letter is one pixel; '.' is see-through.

const BIG = [
  '..........................',
  '............www...........',
  '...........wwWww..www.....',
  '..........wwWWWwwwWww.....',
  '..........wWWWWwWWWw......',
  '...........wwWWWWWw.....a.',
  '............oOOOOOOO...a..',
  '.....g.....oOOOOOOOORKKa..',
  '...g..YYYYOOOOOOOOOORKKKa.',
  '..g..YYGGYYOOOOOOOORRKEK..',
  '...g.YYGGYYdddddddddKKK...',
  '..g..yYYYYyddddddddd......',
  '.......yyy..l..l..l.......',
  '....g......l..l..l........',
  '..........................',
  '..........................',
  '..........................',
];

const MINI = [
  '............',
  '....ww.ww...',
  '...wWWwWw...',
  '....oOOOO.a.',
  '..YYOOOORKa.',
  'g.YGYOOORKE.',
  '..yYYdddd...',
  'g....l.l....',
  '............',
];

const INK = {"O": "#3b3426", "o": "#5a4e36", "K": "#1c1a17", "R": "#d9553b", "Y": "#e8f25c", "y": "#c9e03a", "G": "#f6ff9a", "g": "#d7f07a", "W": "#b7c9d9", "w": "#e3edf5", "E": "#ffffff", "a": "#3b3426", "l": "#3b3426", "d": "#6b5c40"};
// at night (dark terminals) the body is lighter, so it doesn't vanish into the dark
const INK_NIGHT = { ...INK, O: '#7a6646', o: '#9a8460', d: '#a8926a', K: '#4d453a', a: '#8f7c5a', l: '#8f7c5a' };

module.exports = { BIG, MINI, INK, INK_NIGHT, NAME: 'Blink' };
