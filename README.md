# flash

```
  [Blink]  flash  v1.0.0

           Study cards that come back
           just before you'd forget them.
```

**flash is study cards that come back just before you'd forget them**, so a few minutes a day is
enough. Tell it when your test is and it plans your days: every card learned in time, and the day
before, every card once more.

Blink the firefly keeps you company. Fireflies flash to find each other in the dark, which is
roughly what remembering is.

## Get it

With [pca](https://github.com/dpatel7-dev/Project-CLI-Access): open pca, pick **flash**, press **I**. Or:

```sh
curl -fsSL https://djp7.pythonanywhere.com/flash/install.sh | sh
```

## Using it

| To | Do this |
| --- | --- |
| See your decks and study | `flash`, then Enter studies the deck that needs it most |
| Open the window | `flash app`: study four ways, the match game, edit cards, your stats. A lake at the bottom. |
| Make a deck | `flash new "Spanish"`, then type or paste cards: `la manzana - the apple`, one a line |
| From a file | `flash import words.txt`: Quizlet and Anki exports, .csv, .flash files, any text with one card a line |
| Let AI make the cards | `flash make biology.pdf` (or .docx, .txt, or a topic: `flash make "the water cycle"`) |
| Set a test date | `flash exam biology friday` (or `dec 12`, `12/12`, `in 5 days`) |
| Study | `flash study` (flip: Space, then 1 again, 2 hard, 3 good, 4 easy), `flash quiz` (pick one of four), `flash type` (type it) |
| Learn a deck from scratch | the window › **Learn**: rounds until you know every card |
| Practice test | the window › **Test**, or `flash test biology` in the terminal |
| Share a deck | `flash share biology` makes a link (with [pigeon](https://github.com/dpatel7-dev/pigeon)). A friend: `flash get <link>` |
| A daily reminder | `flash remind 4pm`: a notification, only on days there's something to study |
| Your streak | `flash stats` |

Instead of a deck's name you can use its number in the list, or part of its name.

### How cards come back

Each time you answer, you say how it went: **Again** (forgot), **Hard**, **Good** or **Easy**.
New cards come back after a minute, then ten minutes, then a day. After that the gap grows each
time you know it (a few days, a week, a month…), and a card you forget starts climbing again. The
buttons show how long each answer would wait.

### Test dates

With a test date, flash:
- never schedules a card past the day before the test,
- spreads out the new cards so you've seen them all in time (more a day if it has to),
- brings back every card once on the day before.

### Ways to study

- **Flip**: read it, think of the answer, flip, say how it went.
- **Choose**: pick the answer out of four. The wrong ones look like the right one (years with years).
- **Type**: type the answer. Small typos, accents, "the" in front and alternatives (`colour / color`)
  are forgiven, and for long answers getting most of the key words counts.
- **Match** (in the window): match each card to its other side against the clock. A wrong pair costs a second.
- **Learn** (in the window): rounds of seven cards until you know them all. A card starts as pick-one-of-four, then you type it from memory; miss it and it steps back and comes up again later in the round.
- **Test**: a practice test on one page, like a real one: multiple choice, true or false, written and matching. Hand it in for your mark and the right answers, then take a test on just the ones you missed.

**Backwards** asks the back and wants the front.

### Cards you keep forgetting

A card you've forgotten four times is marked. In the window, **Make a memory hook** asks the AI for
a vivid picture, a silly sentence or a rhyme to tie it together, and shows it with the answer from
then on. **Explain it** explains the card simply, with an example. You can write your own hook too.

### AI

Only making cards and memory hooks use AI; everything else works without it. flash shares the free
AI setup with the rest of the family (Tree of Thought, den, scout, hey), so if you set it up there,
it's already here. If not, `flash setup` takes a free key from Groq (sign in with Google, copy the key).
Always read AI-made cards over: AI can get things wrong.

### Bringing decks in and out

- `flash tot` brings in your decks from Tree of Thought's `tot cram`, with how well you knew each card.
- `flash export <deck>` writes text Quizlet (Create › Import) and Anki (File › Import) can read.
  `--csv` for a spreadsheet, `--flash` for a file another flash can open.

## Where things are

Decks are in `~/.flash/decks`, one file each. The study log (for streaks) is `~/.flash/log.jsonl`.
Nothing is sent anywhere, except your notes to the AI when you ask it to make cards.

## Uninstall

```sh
flash uninstall
```

Your decks stay in `~/.flash` (delete it too if you don't want them).

## How it works

Plain Node.js (18 or newer), no dependencies. The window is a small web page served to this
computer only (127.0.0.1, behind a secret). On a Mac, PDFs are read with macOS's own PDFKit and
Word files with `textutil`. `npm test` runs the tests.

MIT licence.
