(function () {
  'use strict';
  var C = JSON.parse(document.getElementById('config').textContent);
  var $ = function (id) { return document.getElementById(id); };
  var dark = matchMedia('(prefers-color-scheme: dark)');
  var S = { state: null, deckId: null, deck: null, cards: [], view: '', mode: 'flip', reverse: false, find: '', newFor: null };
  var ST = null; // the study session

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function api(what, body) {
    return fetch(C.base + '/api/' + what, { method: 'POST', headers: { 'content-type': 'application/json', 'x-flash': C.secret }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'flash had a problem.'); return j; }); });
  }
  var toastT = 0;
  function toast(t) { var el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { el.hidden = true; }, 3000); }
  function fail(e) { toast(e.message || 'Something went wrong.'); }

  /** A sheet: { title, html, actions: [{ label, value, main, danger, left }] } → resolves with the value pressed (or ''). */
  function sheet(o) {
    return new Promise(function (resolve) {
      var d = $('sheet');
      $('shTitle').textContent = o.title;
      $('shBody').innerHTML = o.html || '';
      var acts = o.actions || [{ label: 'Done', value: 'ok', main: true }];
      $('shActs').innerHTML = acts.map(function (a, i) { return '<button type="button" class="btn' + (a.main ? ' main' : '') + (a.danger ? ' danger quiet' : '') + (a.left ? ' left' : '') + '" data-i="' + i + '">' + esc(a.label) + '</button>'; }).join('');
      var done = false;
      function finish(v) { if (done) return; done = true; var vals = {}; d.querySelectorAll('[data-k]').forEach(function (el) { vals[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; }); d.close(); resolve({ v: v, vals: vals }); }
      $('shActs').onclick = function (e) { var b = e.target.closest('button[data-i]'); if (b) finish(acts[+b.dataset.i].value); };
      $('sheetForm').onsubmit = function (e) { e.preventDefault(); var m = acts.find(function (a) { return a.main; }); finish(m ? m.value : ''); };
      d.onclose = function () { finish(''); };
      d.showModal();
      var first = d.querySelector('[data-k]') || d.querySelector('.btn.main');
      if (first) { first.focus(); if (first.select && first.type !== 'date') first.select(); }
      if (o.onOpen) o.onOpen(d);
    });
  }

  // ── Blink, and the lake ──
  var BLINK = ['............', '....ww.ww...', '...wWWwWw...', '....oOOOO.a.', '..YYOOOORKa.', 'g.YGYOOORKE.', '..yYYdddd...', 'g....l.l....', '............'];
  var INK = { O: '#3b3426', o: '#5a4e36', K: '#1c1a17', R: '#d9553b', Y: '#e8f25c', y: '#c9e03a', G: '#f6ff9a', g: '#d7f07a', W: '#b7c9d9', w: '#e3edf5', E: '#ffffff', a: '#3b3426', l: '#3b3426', d: '#6b5c40' };
  var INK_NIGHT = Object.assign({}, INK, { O: '#7a6646', o: '#9a8460', d: '#a8926a', K: '#4d453a', a: '#8f7c5a', l: '#8f7c5a' });
  function drawBlink() {
    var g = $('blink').getContext('2d'); g.clearRect(0, 0, 12, 9);
    var ink = dark.matches ? INK_NIGHT : INK;
    BLINK.forEach(function (row, y) { row.split('').forEach(function (ch, x) { if (ink[ch]) { g.fillStyle = ink[ch]; g.fillRect(x, y, 1, 1); } }); });
  }
  drawBlink(); dark.addEventListener('change', drawBlink);
  if (window.Shore) window.Shore.start($('scene'), { night: function () { return dark.matches; }, share: 0.4 });

  // ── which part of the window ──
  function show(v) {
    S.view = v;
    ['vEmpty', 'vDeck', 'vStudy', 'vNew', 'vStats'].forEach(function (id) { $(id).hidden = id !== v; });
    renderSide();
  }

  // ── the side: streak and decks ──
  function renderSide() {
    var st = S.state;
    if (!st) return;
    var s = st.stats;
    $('streak').innerHTML = s.streak ? '<b>' + plural(s.streak, 'day') + '</b> in a row' + (s.today ? ', ' + plural(s.today, 'card') + ' today' : '. Study today to keep it going.') : s.today ? plural(s.today, 'card') + ' today. Come back tomorrow for a streak.' : 'A few minutes a day is enough.';
    $('decks').innerHTML = st.decks.map(function (d) {
      var sub = d.exam && d.examIn !== 'passed' ? '<span class="s test">Test ' + esc(d.examIn) + '</span>' : '<span class="s">' + plural(d.total, 'card') + '</span>';
      return '<button class="deck" data-id="' + esc(d.id) + '" aria-current="' + (S.deckId === d.id && (S.view === 'vDeck' || S.view === 'vStudy')) + '"><span class="t">' + esc(d.title) + '</span><span class="n' + (d.todo ? '' : ' done') + '">' + (d.todo ? d.todo : d.total ? 'done' : '') + '</span>' + sub + '</button>';
    }).join('');
  }
  $('decks').addEventListener('click', function (e) { var b = e.target.closest('.deck'); if (b) { stopStudy(); openDeck(b.dataset.id); } });

  function refresh() {
    return api('state').then(function (st) { S.state = st; renderSide(); return st; });
  }
  function start() {
    refresh().then(function (st) {
      if (!st.decks.length) return show('vEmpty');
      var top = st.decks.slice().sort(function (a, b) { return (a.exam && a.examIn !== 'passed' ? a.exam : 9e15) - (b.exam && b.examIn !== 'passed' ? b.exam : 9e15) || b.todo - a.todo; })[0];
      openDeck(top.id);
    }).catch(fail);
  }

  // ── a deck ──
  function openDeck(id) {
    S.deckId = id;
    return api('deck', { id: id }).then(function (r) { S.deck = r.deck; S.cards = r.cards; S.plan = r.plan; S.tests = r.tests || []; S.learn = r.learn; renderDeck(); show('vDeck'); }).catch(function (e) { fail(e); refresh(); });
  }
  function status(c) {
    if (c.leech) return ['leech', 'keeps slipping'];
    if (c.isNew) return ['', 'not seen yet'];
    if (c.state !== 'review') return ['learn', 'learning'];
    if (c.ivl >= 21) return ['known', 'known well'];
    var days = Math.round((c.due - Date.now()) / 86400000);
    return ['', days <= 0 ? 'due now' : days === 1 ? 'back tomorrow' : 'back in ' + days + ' days'];
  }
  function renderDeck() {
    var d = S.deck;
    $('dTitle').textContent = d.title;
    $('dWhen').textContent = d.exam && d.examIn !== 'passed' ? 'Test ' + d.examIn : '';
    var bits = [];
    if (!d.total) bits.push('No cards yet. Add some to start.');
    else {
      var todo = [];
      if (d.due) todo.push(plural(d.due, 'card') + ' to go over');
      if (d.newToday) todo.push(d.newToday + ' new');
      if (d.learning) todo.push(d.learning + ' still learning');
      bits.push(todo.length ? 'Today: ' + todo.join(', ') + '.' : 'Nothing more today. Next time they come back, they\'ll be due here.');
      if (d.known) bits.push(d.known === d.total ? 'You know every card well.' : 'You know ' + d.known + ' of ' + d.total + ' well.');
      if (d.leeches) bits.push(plural(d.leeches, 'card') + ' keep' + (d.leeches === 1 ? 's' : '') + ' slipping: a memory hook helps (click one below).');
    }
    if (S.plan) bits.push(S.plan.say);
    if (S.tests && S.tests.length) bits.push('Last practice test: ' + S.tests[0].percent + '%' + (S.tests.length > 1 ? ' (before that ' + S.tests[1].percent + '%)' : '') + '.');
    if (S.learn && S.learn.learned && S.learn.learned < S.learn.total) bits.push('Learn mode: ' + S.learn.learned + ' of ' + S.learn.total + ' learned.');
    $('dSum').textContent = bits.join(' ');
    var n = Math.max(1, d.total), review = d.total - d.fresh - d.learning - d.known;
    $('dMix').innerHTML = d.total ? '<i class="k" style="width:' + (d.known / n * 100) + '%"></i><i class="r" style="width:' + (review / n * 100) + '%"></i><i class="l" style="width:' + (d.learning / n * 100) + '%"></i><i class="w" style="width:' + (d.fresh / n * 100) + '%"></i>' : '';
    $('dMix').setAttribute('aria-label', d.known + ' known well, ' + review + ' coming back, ' + d.learning + ' learning, ' + d.fresh + ' not seen yet');
    goLabel();
    renderCards();
  }
  function goLabel() {
    var d = S.deck;
    var b = $('goBtn');
    var L = S.learn || { learned: 0, total: d.total };
    b.disabled = !d.total || (S.mode === 'match' && d.total < 3);
    b.textContent = S.mode === 'match' ? 'Play' : S.mode === 'test' ? 'Make a practice test' : S.mode === 'learn' ? (L.learned >= L.total && L.total ? 'Learn them again' : L.learned || (L.learning) ? 'Keep learning (' + L.learned + ' of ' + L.total + ')' : 'Start learning') : d.todo ? 'Study ' + plural(d.todo, 'card') : 'Go through them all';
    $('revChk').parentNode.hidden = S.mode === 'match' || S.mode === 'test' || S.mode === 'learn';
  }
  function renderCards() {
    var q = S.find.trim().toLowerCase();
    var list = S.cards.filter(function (c) { return !q || (c.front + '\n' + c.back).toLowerCase().indexOf(q) >= 0; });
    $('cardList').innerHTML = list.length ? list.map(function (c) {
      var s = status(c);
      return '<li class="crow" data-id="' + c.id + '" tabindex="0"><span class="f">' + esc(c.front) + '</span><span class="b">' + esc(c.back) + '</span><span class="st ' + s[0] + '">' + esc(s[1]) + '</span></li>';
    }).join('') : '<li class="empty">' + (S.cards.length ? 'No card has that in it.' : 'No cards yet. <b>Add cards</b> to type or paste some, or make them with AI.') + '</li>';
  }
  $('find').addEventListener('input', function () { S.find = this.value; renderCards(); });
  $('cardList').addEventListener('click', function (e) { var li = e.target.closest('.crow'); if (li) editCard(li.dataset.id); });
  $('cardList').addEventListener('keydown', function (e) { if (e.key === 'Enter') { var li = e.target.closest('.crow'); if (li) editCard(li.dataset.id); } });
  $('modeSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-m]'); if (!b) return;
    S.mode = b.dataset.m;
    Array.prototype.forEach.call(this.children, function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    goLabel();
  });
  $('revChk').addEventListener('change', function () { S.reverse = this.checked; });

  function editCard(id, fromStudy) {
    var c = (fromStudy ? [ST.cur] : S.cards).find(function (x) { return x && x.id === id; });
    if (!c) return Promise.resolve();
    return sheet({
      title: 'Edit the card',
      html: '<label class="field"><span>Front</span><textarea data-k="front" rows="3">' + esc(c.front) + '</textarea></label><label class="field"><span>Back</span><textarea data-k="back" rows="3">' + esc(c.back) + '</textarea></label>' +
        '<label class="field"><span>Memory hook</span><textarea data-k="hook" rows="2" style="min-height:56px" placeholder="Anything that helps you remember it (shown with the answer)">' + esc(c.hook || '') + '</textarea></label>',
      actions: [{ label: 'Delete card', value: 'del', danger: true, left: true }, { label: 'Start over', value: 'reset' }, { label: 'Cancel', value: '' }, { label: 'Save', value: 'save', main: true }],
    }).then(function (r) {
      if (r.v === 'save') return api('edit', { id: S.deckId, card: id, front: r.vals.front, back: r.vals.back, hook: r.vals.hook }).then(function (x) { Object.assign(c, x.card); if (fromStudy) paintCard(); return reloadDeck(); });
      if (r.v === 'reset') return api('reset-card', { id: S.deckId, card: id }).then(function () { toast('That card starts over, as if new.'); return reloadDeck(); });
      if (r.v === 'del') return api('delete-card', { id: S.deckId, card: id }).then(function () { toast('Card deleted.'); if (fromStudy) nextCard(true); return reloadDeck(); });
    }).catch(fail);
  }
  function reloadDeck() {
    return api('deck', { id: S.deckId }).then(function (r) { S.deck = r.deck; S.cards = r.cards; S.plan = r.plan; S.tests = r.tests || []; S.learn = r.learn; if (S.view === 'vDeck') renderDeck(); return refresh(); });
  }

  $('dTitle').addEventListener('click', function () {
    sheet({ title: 'Rename the deck', html: '<input type="text" data-k="title" maxlength="80" value="' + esc(S.deck.title) + '" style="width:100%">', actions: [{ label: 'Cancel', value: '' }, { label: 'Rename', value: 'ok', main: true }] })
      .then(function (r) { if (r.v === 'ok' && r.vals.title.trim()) return api('update', { id: S.deckId, title: r.vals.title }).then(reloadDeck); }).catch(fail);
  });
  $('examBtn').addEventListener('click', function () {
    var d = S.deck;
    var cur = d.exam ? new Date(d.exam) : null;
    var val = cur ? cur.getFullYear() + '-' + String(cur.getMonth() + 1).padStart(2, '0') + '-' + String(cur.getDate()).padStart(2, '0') : '';
    sheet({
      title: 'When is the test?',
      html: '<p>flash plans your days so you\'ve learned every card in time, and the day before, every card comes up once more.</p><input type="date" data-k="date" value="' + val + '" min="' + new Date().toISOString().slice(0, 10) + '">',
      actions: (d.exam ? [{ label: 'No test', value: 'off', left: true, danger: true }] : []).concat([{ label: 'Cancel', value: '' }, { label: 'Save', value: 'ok', main: true }]),
    }).then(function (r) {
      if (r.v === 'off') return api('update', { id: S.deckId, exam: null }).then(reloadDeck);
      if (r.v === 'ok' && r.vals.date) return api('update', { id: S.deckId, exam: r.vals.date }).then(function (x) { if (x.plan) toast(x.plan.say); return reloadDeck(); });
    }).catch(fail);
  });
  $('delBtn').addEventListener('click', function () {
    sheet({ title: 'Delete ' + S.deck.title + '?', html: '<p>All ' + plural(S.deck.total, 'card') + ' and how well you know them. (A copy is kept in ~/.flash/deleted, just in case.)</p>', actions: [{ label: 'Cancel', value: '' }, { label: 'Delete', value: 'del', main: true }] })
      .then(function (r) { if (r.v === 'del') return api('remove', { id: S.deckId }).then(function () { S.deckId = null; toast('Deleted.'); start(); }); }).catch(fail);
  });
  $('exportBtn').addEventListener('click', function () {
    sheet({
      title: 'Export ' + S.deck.title,
      html: '<p>Download the cards to use somewhere else, or to keep.</p>',
      actions: [{ label: 'Cancel', value: '', left: true }, { label: '.flash (for a friend)', value: 'flash' }, { label: '.csv', value: 'csv' }, { label: 'For Quizlet or Anki', value: 'tsv', main: true }],
    }).then(function (r) {
      if (!r.v) return;
      return api('export', { id: S.deckId, format: r.v }).then(function (x) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([x.text], { type: 'text/plain' }));
        a.download = x.name; document.body.appendChild(a); a.click(); a.remove();
        toast(r.v === 'tsv' ? 'Downloaded. Quizlet: Create › Import, paste it (between term and definition: Tab).' : 'Downloaded ' + x.name + '.');
      });
    }).catch(fail);
  });
  $('shareBtn').addEventListener('click', function () {
    if (!S.state.pigeon) {
      sheet({ title: 'Share ' + S.deck.title, html: '<p>Sharing makes a link with <b>pigeon</b>, from the same family of apps. Get it with pca and sign in once, and this button makes a link anyone can open for 24 hours.</p><p>Until then: Export › .flash, and send the file however you like. Your friend opens it in flash with New deck › From a file.</p>' });
      return;
    }
    toast('Making a link with pigeon…');
    api('share', { id: S.deckId }).then(function (x) {
      return sheet({ title: 'A link for ' + S.deck.title, html: '<p>Anyone with it can get the deck for 24 hours. With flash and pigeon: <code>flash get &lt;link&gt;</code>. Without: open it, download the file, then New deck › From a file.</p><input type="text" data-k="url" readonly value="' + esc(x.url) + '" style="width:100%">', actions: [{ label: 'Copy the link', value: 'copy', main: true }] })
        .then(function (r) { if (r.v === 'copy' && navigator.clipboard) navigator.clipboard.writeText(x.url).then(function () { toast('Copied.'); }); });
    }).catch(fail);
  });
  $('addBtn').addEventListener('click', function () { openNew(S.deckId, 'paste'); });
  $('aiBtn').addEventListener('click', function () { openNew(S.deckId, 'ai'); });

  // ── studying ──
  $('goBtn').addEventListener('click', function () {
    if (S.mode === 'match') startMatch();
    else if (S.mode === 'learn') startLearn(S.learn && S.learn.total && S.learn.learned >= S.learn.total);
    else if (S.mode === 'test') testSetup();
    else startStudy(!S.deck.todo);
  });
  function studyPart(which) { ['stCard', 'stMatch', 'stDone', 'stLearn', 'stTest'].forEach(function (id) { $(id).hidden = id !== which; }); }
  function startStudy(all) {
    return api('queue', { id: S.deckId, all: !!all, mode: S.mode, reverse: S.reverse }).then(function (r) {
      ST = { q: r.cards, done: 0, total: r.cards.length, tally: { 1: 0, 2: 0, 3: 0, 4: 0 }, t0: Date.now(), mode: S.mode, reverse: S.reverse, all: !!all, cur: null };
      $('stBack').textContent = '‹ ' + S.deck.title;
      show('vStudy');
      studyPart('stCard');
      if (!ST.q.length) return finish();
      nextCard();
    }).catch(fail);
  }
  function stopStudy() { ST = null; LS = null; TS = null; stopMatch(); }
  $('stBack').addEventListener('click', function () {
    if (TS && !TS.result && TS.answered() && !confirm('Leave the test? Your answers will be lost.')) return;
    stopStudy(); openDeck(S.deckId); refresh();
  });

  function face(c, side) { return ST.reverse ? (side === 'q' ? c.back : c.front) : (side === 'q' ? c.front : c.back); }
  function nextCard(skip) {
    if (skip) ST.cur = null;
    ST.cur = ST.q.shift();
    if (!ST.cur) return finish();
    ST.flipped = false; ST.answered = false; ST.shown = Date.now();
    paintCard();
  }
  function paintCard() {
    var c = ST.cur;
    var q = face(c, 'q'), a = face(c, 'a');
    $('fTxt').textContent = q; $('fTxt').className = 'txt' + (q.length > 140 ? ' long' : '');
    $('bTxt').textContent = a; $('bTxt').className = 'txt' + (a.length > 140 ? ' long' : '');
    $('bQ').textContent = q.length > 160 ? q.slice(0, 157) + '…' : q;
    $('fTag').textContent = c.leech ? 'keeps slipping' : c.isNew ? 'new' : '';
    $('fTag').className = 'tag' + (c.leech ? ' leech' : '');
    $('fHint').textContent = c.hint || '';
    $('bHook').hidden = !c.hook;
    $('bHook').innerHTML = c.hook ? '<b>Remember:</b> ' + esc(c.hook) : '';
    $('card').classList.toggle('flipped', !!ST.flipped);
    sizeCard();
    var m = ST.mode;
    $('aFlip').hidden = m !== 'flip'; $('aQuiz').hidden = m !== 'quiz'; $('aType').hidden = m !== 'type';
    $('showBtn').hidden = !!ST.flipped; $('grades').hidden = !ST.flipped;
    if (m === 'flip') {
      var p = c.preview || {};
      Array.prototype.forEach.call($('grades').children, function (b) { b.querySelector('small').textContent = p[b.dataset.g] || ''; });
      $('keys').textContent = ST.flipped ? '1 2 3 4 to answer (Space is Good)' : 'Space shows the answer';
    } else if (m === 'quiz') {
      if (!ST.answered) {
        var ch = c.choices || { options: [], answer: -1 };
        $('opts').innerHTML = ch.options.map(function (o, i) { return '<button class="opt" data-i="' + i + '"><kbd>' + (i + 1) + '</kbd><span>' + esc(o) + '</span></button>'; }).join('');
      }
      $('keys').textContent = ST.answered ? (ST.right ? '' : 'Enter or Space: next') : '1 2 3 4 to choose';
    } else {
      if (!ST.answered) { $('typed').value = ''; $('typed').disabled = false; $('verdict').hidden = true; $('checkBtn').textContent = 'Check'; setTimeout(function () { $('typed').focus(); }, 30); }
      $('keys').textContent = ST.answered ? (ST.verdict === 'wrong' ? 'Enter: next · Y: I was right, count it' : 'Enter: next · E: that was easy') : 'Enter checks';
    }
    $('hookCur').textContent = c.hook ? 'A new memory hook' : 'Make a memory hook';
    $('hookCur').hidden = !S.state.ai.ok; $('explainCur').hidden = !S.state.ai.ok;
    var done = ST.done, left = ST.q.length + 1;
    $('prog').style.width = Math.round((done / Math.max(1, done + left)) * 100) + '%';
    $('stLeft').textContent = left + ' to go';
  }
  /** The card is as tall as its longer side. */
  function sizeCard() {
    var card = $('card');
    card.style.height = '';
    var h = Math.max(300, $('fTxt').scrollHeight + 90, $('bTxt').scrollHeight + $('bQ').scrollHeight + ($('bHook').hidden ? 0 : $('bHook').scrollHeight + 16) + 100);
    card.style.height = Math.min(h, 560) + 'px';
  }
  function flip() { if (!ST || !ST.cur || ST.flipped) return; ST.flipped = true; paintCard(); }
  $('showBtn').addEventListener('click', flip);
  $('card').addEventListener('click', function () { if (ST && ST.mode === 'flip') flip(); });
  $('grades').addEventListener('click', function (e) { var b = e.target.closest('.grade'); if (b) grade(+b.dataset.g); });

  var grading = false;
  function grade(g) {
    if (!ST || !ST.cur || grading) return;
    grading = true;
    var c = ST.cur;
    api('grade', { id: S.deckId, card: c.id, g: g, ms: Date.now() - ST.shown, mode: ST.mode, reverse: ST.reverse }).then(function (r) {
      ST.tally[g]++; ST.done++;
      S.deck = r.deck;
      if (r.again) { var at = Math.min(ST.q.length, 3 + Math.floor(Math.random() * 3)); ST.q.splice(at, 0, Object.assign({}, c, r.card)); }
      if (r.leech) toast('You keep forgetting that one. A memory hook helps: you\'ll see the button on it next time.');
      nextCard();
    }).catch(fail).then(function () { grading = false; });
  }

  // pick out of four
  $('opts').addEventListener('click', function (e) { var b = e.target.closest('.opt'); if (b) choose(+b.dataset.i); });
  function choose(i) {
    if (!ST || ST.answered) { if (ST && ST.answered && !ST.right) grade(1); return; }
    var ch = ST.cur.choices; if (!ch || i >= ch.options.length) return;
    ST.answered = true; ST.right = i === ch.answer;
    Array.prototype.forEach.call($('opts').children, function (b, k) { if (k === ch.answer) b.classList.add('right'); else if (k === i) b.classList.add('wrong'); b.disabled = false; });
    ST.flipped = true; paintCard();
    if (ST.right) setTimeout(function () { if (ST && ST.answered) grade(3); }, 750);
  }

  // type it
  $('typeForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!ST) return;
    if (ST.answered) return grade(ST.verdict === 'wrong' ? 1 : 3);
    var typed = $('typed').value;
    if (!typed.trim()) { $('typed').focus(); return; }
    api('check', { id: S.deckId, card: ST.cur.id, typed: typed, reverse: ST.reverse }).then(function (r) {
      ST.answered = true; ST.verdict = r.verdict;
      $('typed').disabled = true;
      $('verdict').hidden = false;
      $('verdict').className = 'verdict ' + (r.verdict === 'wrong' ? 'wrong' : 'right');
      $('verdict').textContent = r.verdict === 'right' ? 'Right.' : r.verdict === 'close' ? 'Right (' + r.note + ').' : 'Not quite. The answer is on the card.';
      $('checkBtn').textContent = 'Next';
      ST.flipped = true; paintCard();
      $('checkBtn').focus();
    }).catch(fail);
  });

  $('editCur').addEventListener('click', function () { if (ST && ST.cur) editCard(ST.cur.id, true); });
  $('explainCur').addEventListener('click', function () {
    if (!ST || !ST.cur) return;
    toast('Asking…');
    api('explain', { id: S.deckId, card: ST.cur.id }).then(function (r) { $('toast').hidden = true; return sheet({ title: face(ST.cur, 'q').slice(0, 80), html: '<p style="color:var(--ink);font-size:15px;line-height:1.6">' + esc(r.text) + '</p>' }); }).catch(fail);
  });
  $('hookCur').addEventListener('click', function () {
    if (!ST || !ST.cur) return;
    var c = ST.cur;
    toast('Thinking of a memory hook…');
    api('hook', { id: S.deckId, card: c.id }).then(function (r) { $('toast').hidden = true; c.hook = r.text; ST.flipped = true; paintCard(); }).catch(fail);
  });

  function finish() {
    studyPart('stDone');
    var t = ST.tally, mins = Math.max(1, Math.round((Date.now() - ST.t0) / 60000));
    var knew = t[3] + t[4];
    refresh().then(function (st) {
      var d = st.decks.find(function (x) { return x.id === S.deckId; }) || S.deck;
      var title = !ST.done ? (ST.all ? 'This deck has no cards yet.' : 'Nothing to study here right now.') : knew === ST.done ? 'Every one. Nicely done.' : ST.done >= 10 && knew / ST.done >= 0.8 ? 'That went well.' : 'Done for now.';
      var more = d && d.todo ? '<button class="btn main big" id="moreBtn">Keep going (' + d.todo + ' more)</button>' : ST.done ? '<p>That\'s everything for today. The cards you know come back in a few days; the ones you found hard, sooner.</p>' : '<button class="btn main big" id="allBtn">Go through them all anyway</button>';
      $('stDone').innerHTML = '<h2>' + esc(title) + '</h2>' +
        (ST.done ? '<p>' + plural(ST.done, 'card') + ' in about ' + plural(mins, 'minute') + (st.stats.streak > 1 ? '. ' + st.stats.streak + ' days in a row.' : '.') + '</p><div class="tally">' + (knew ? '<span class="g">' + knew + ' knew</span>' : '') + (t[2] ? '<span class="h">' + t[2] + ' hard</span>' : '') + (t[1] ? '<span class="a">' + t[1] + ' forgot</span>' : '') + '</div>' : '') +
        more + ' <button class="btn big quiet" id="backBtn">Back to the deck</button>';
      var m = $('moreBtn'); if (m) m.onclick = function () { startStudy(false); };
      var a = $('allBtn'); if (a) a.onclick = function () { startStudy(true); };
      $('backBtn').onclick = function () { stopStudy(); openDeck(S.deckId); };
      $('prog').style.width = '100%'; $('stLeft').textContent = '';
    });
  }


  // ── Learn mode: rounds until you know every card ──
  var LS = null;
  var LEVEL = ['New', 'Getting there', 'Almost learned'];
  function learnPrefs() { try { return JSON.parse(localStorage.getItem('flash.learn') || '{}'); } catch (e) { return {}; } }
  function learnMix(c) {
    var n = Math.max(1, c.total);
    $('lMix').innerHTML = '<i class="k" style="width:' + (c.learned / n * 100) + '%"></i><i class="l" style="width:' + (c.learning / n * 100) + '%"></i><i class="w" style="width:' + (c.fresh / n * 100) + '%"></i>';
    $('lMix').setAttribute('aria-label', c.learned + ' learned, ' + c.learning + ' learning, ' + c.fresh + ' not studied yet');
    $('lTxt').textContent = c.learned + ' of ' + c.total + ' learned';
    S.learn = c;
  }
  function startLearn(reset) {
    var p = learnPrefs();
    return api('learn', { id: S.deckId, reset: !!reset, answerWith: p.answerWith || 'back', formats: p.formats || 'both' }).then(function (r) {
      ST = null; TS = null;
      LS = { round: r.round, i: 0, firstTry: 0, asked: 0, n: r.round.length, roundNo: (LS && LS.roundNo || 0) + 1, missedNow: {} };
      $('stBack').textContent = '‹ ' + S.deck.title;
      show('vStudy'); studyPart('stLearn');
      $('prog').style.width = '0%'; $('stLeft').textContent = 'Learn';
      learnMix(r.counts);
      if (!r.round.length) return learnAllDone();
      $('lAsk').hidden = false; $('lDone').hidden = true;
      learnShow();
    }).catch(fail);
  }
  function learnShow() {
    var q = LS.round[LS.i];
    LS.answered = false; LS.shown = Date.now();
    $('lTag').textContent = LEVEL[q.level] || '';
    $('lQ').textContent = q.prompt;
    $('lHint').textContent = q.hint || '';
    $('lFb').hidden = true;
    $('lMC').hidden = q.type !== 'mc'; $('lW').hidden = q.type !== 'written';
    if (q.type === 'mc') {
      $('lOpts').innerHTML = q.options.map(function (o, i) { return '<button class="opt" data-i="' + i + '"><kbd>' + (i + 1) + '</kbd><span>' + esc(o) + '</span></button>'; }).join('');
      $('lKeys').textContent = '1 2 3 4 to choose';
    } else {
      $('lIn').value = ''; $('lIn').disabled = false; $('lGo').disabled = false;
      setTimeout(function () { $('lIn').focus(); }, 30);
      $('lKeys').textContent = 'Enter checks';
    }
    $('prog').style.width = Math.round((LS.i / Math.max(1, LS.round.length)) * 100) + '%';
    $('stLeft').textContent = 'Round ' + LS.roundNo + ': ' + (LS.round.length - LS.i) + ' to go';
  }
  function learnAnswer(right, shownAnswer, note) {
    if (!LS || LS.answered) return;
    LS.answered = true;
    var q = LS.round[LS.i];
    LS.asked++;
    if (right && !LS.missedNow[q.card]) LS.firstTry++;
    if (!right) LS.missedNow[q.card] = true;
    api('learn-answer', { id: S.deckId, card: q.card, right: right, type: q.type, ms: Date.now() - LS.shown }).then(function (r) { learnMix(r.counts); q.newLevel = r.level; }).catch(fail);
    $('lIn').disabled = true; $('lGo').disabled = true;
    var fb = $('lFb');
    fb.hidden = false;
    fb.className = 'answer lfb ' + (right ? 'right' : 'wrong');
    if (right) {
      fb.innerHTML = '<h4>' + (note ? 'Right (' + esc(note) + ')' : ['Right!', 'Yes!', 'That\'s it.', 'Nice.'][LS.asked % 4]) + '</h4>' + (note ? '<p class="want">' + esc(q.answer) + '</p>' : '');
      $('lKeys').textContent = '';
      setTimeout(learnNext, note ? 1400 : 800);
    } else {
      // ask it again at the end of this round, as a choice of four
      LS.round.push(Object.assign({}, q, { level: 0, type: q.options ? 'mc' : q.type, again: true }));
      fb.innerHTML = '<h4>' + (shownAnswer === null ? 'Here\'s the answer' : 'Not quite') + '</h4><p class="want">' + esc(q.answer) + '</p><div class="row"><button class="btn main" id="lNext">Continue</button>' + (shownAnswer ? '<button class="btn quiet" id="lOverride">I was right</button>' : '') + '</div>';
      $('lKeys').textContent = 'Enter: continue';
      $('lNext').onclick = learnNext;
      var o = $('lOverride'); if (o) o.onclick = function () { LS.round.pop(); delete LS.missedNow[q.card]; api('learn-answer', { id: S.deckId, card: q.card, right: true, type: q.type }).then(function (r) { learnMix(r.counts); }); learnNext(); };
      $('lNext').focus();
    }
  }
  function learnNext() {
    if (!LS) return;
    LS.i++;
    if (LS.i < LS.round.length) return learnShow();
    // the round is over
    $('lAsk').hidden = true; $('lDone').hidden = false;
    $('prog').style.width = '100%';
    var c = S.learn;
    var all = c.learned >= c.total;
    if (all) return learnAllDone();
    $('lDone').innerHTML = '<h2>Round ' + LS.roundNo + ' done</h2><p>' + LS.firstTry + ' of ' + LS.n + ' right the first time. You\'ve learned ' + c.learned + ' of ' + c.total + '.</p>' +
      '<button class="btn main big" id="lMore">Next round</button> <button class="btn big quiet" id="lBack">Back to the deck</button>';
    $('lMore').onclick = function () { startLearn(false); };
    $('lBack').onclick = function () { stopStudy(); openDeck(S.deckId); };
    $('lMore').focus();
  }
  function learnAllDone() {
    $('lAsk').hidden = true; $('lDone').hidden = false;
    $('lDone').innerHTML = '<h2>You\'ve learned every card.</h2><p>Now see if it sticks: a practice test, or let the cards come back over the next days with Flip.</p>' +
      '<button class="btn main big" id="lTest">Take a practice test</button> <button class="btn big quiet" id="lAgain">Learn them again</button>';
    $('lTest').onclick = function () { setMode('test'); testSetup(); };
    $('lAgain').onclick = function () { LS = null; startLearn(true); };
  }
  $('lOpts').addEventListener('click', function (e) {
    var b = e.target.closest('.opt'); if (!b || !LS || LS.answered) return;
    var q = LS.round[LS.i], i = +b.dataset.i;
    Array.prototype.forEach.call($('lOpts').children, function (x, k) { if (k === q.key) x.classList.add('right'); else if (k === i) x.classList.add('wrong'); });
    learnAnswer(i === q.key, '');
  });
  $('lForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!LS) return;
    if (LS.answered) return learnNext();
    var typed = $('lIn').value, q = LS.round[LS.i];
    if (!typed.trim()) { $('lIn').focus(); return; }
    api('check', { id: S.deckId, card: q.card, typed: typed, reverse: q.side === 'front' }).then(function (r) {
      learnAnswer(r.verdict !== 'wrong', typed, r.verdict === 'close' ? r.note : '');
    }).catch(fail);
  });
  $('lDunno').addEventListener('click', function () { if (LS && !LS.answered) learnAnswer(false, null); });
  $('lSet').addEventListener('click', function () {
    var p = learnPrefs();
    sheet({
      title: 'Learn settings',
      html: '<label class="field"><span>Answer with</span><select data-k="answerWith"><option value="back"' + (p.answerWith !== 'front' && p.answerWith !== 'both' ? ' selected' : '') + '>The back of the card</option><option value="front"' + (p.answerWith === 'front' ? ' selected' : '') + '>The front of the card</option><option value="both"' + (p.answerWith === 'both' ? ' selected' : '') + '>Both, mixed</option></select></label>' +
        '<label class="field"><span>Questions</span><select data-k="formats"><option value="both"' + (!p.formats || p.formats === 'both' ? ' selected' : '') + '>Pick one of four, then type it</option><option value="mc"' + (p.formats === 'mc' ? ' selected' : '') + '>Only pick one of four</option><option value="written"' + (p.formats === 'written' ? ' selected' : '') + '>Only type it</option></select></label>',
      actions: [{ label: 'Start over', value: 'reset', left: true, danger: true }, { label: 'Cancel', value: '' }, { label: 'Save', value: 'ok', main: true }],
    }).then(function (r) {
      if (r.v === 'ok' || r.v === 'reset') { try { localStorage.setItem('flash.learn', JSON.stringify({ answerWith: r.vals.answerWith, formats: r.vals.formats })); } catch (e) {} }
      if (r.v === 'ok') startLearn(false);
      if (r.v === 'reset') { LS = null; startLearn(true); }
    });
  });

  // ── practice test: a real-looking test, marked at the end ──
  var TS = null;
  function setMode(m) { S.mode = m; Array.prototype.forEach.call($('modeSeg').children, function (x) { x.setAttribute('aria-pressed', String(x.dataset.m === m)); }); goLabel(); }
  function testSetup() {
    var last = S.tests && S.tests[0];
    var n = S.deck.total;
    var counts = [5, 10, 20, 30, 50].filter(function (x) { return x < n; });
    sheet({
      title: 'A practice test',
      html: '<p>Questions like a real test, all on one page. You see your mark when you hand it in.</p>' +
        '<label class="field"><span>How many questions</span><select data-k="count">' + counts.map(function (x) { return '<option value="' + x + '"' + (x === 20 || (x === counts[counts.length - 1] && n <= 20) ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '<option value="all"' + (n <= 20 ? ' selected' : '') + '>All ' + n + '</option></select></label>' +
        '<div class="field"><span>Kinds of question</span>' +
        '<label class="row"><input type="checkbox" data-k="mc" checked> Multiple choice</label>' +
        '<label class="row"><input type="checkbox" data-k="tf" checked> True or false</label>' +
        '<label class="row"><input type="checkbox" data-k="written" checked> Written</label>' +
        '<label class="row"><input type="checkbox" data-k="match"' + (n >= 4 ? ' checked' : ' disabled') + '> Matching</label></div>' +
        '<label class="field"><span>Answer with</span><select data-k="answerWith"><option value="back">The back of the card</option><option value="front">The front of the card</option><option value="both">Both, mixed</option></select></label>' +
        (last && last.missed ? '<label class="row"><input type="checkbox" data-k="missed"> Only the ' + plural(last.missed, 'card') + ' I got wrong last time</label>' : ''),
      actions: [{ label: 'Cancel', value: '' }, { label: 'Start the test', value: 'go', main: true }],
    }).then(function (r) {
      if (r.v !== 'go') return;
      var types = ['mc', 'tf', 'written', 'match'].filter(function (t) { return r.vals[t]; });
      if (!types.length) { toast('Pick at least one kind of question.'); return; }
      startTest({ count: r.vals.count, types: types, answerWith: r.vals.answerWith, only: r.vals.missed ? 'missed' : null });
    });
  }
  function startTest(opts) {
    return api('test-make', Object.assign({ id: S.deckId }, opts)).then(function (r) {
      ST = null; LS = null;
      TS = { id: r.testId, test: r.test, answers: {}, t0: Date.now(), opts: opts, result: null };
      TS.answered = function () { return Object.keys(TS.answers).length; };
      $('stBack').textContent = '‹ ' + S.deck.title;
      show('vStudy'); studyPart('stTest');
      $('prog').style.width = '0%'; $('stLeft').textContent = plural(r.test.length, 'question');
      renderTest();
      window.scrollTo(0, 0);
    }).catch(fail);
  }
  var SECTION = { mc: 'Multiple choice', tf: 'True or false', written: 'Written: type the answer', match: 'Matching: pick the letter that goes with each' };
  function renderTest() {
    var res = TS.result, h = '', sec = '';
    if (res) h += '<div class="score"><b>' + res.percent + '%</b><span>' + res.score + ' out of ' + res.total + (res.percent >= 90 ? '. Excellent.' : res.percent >= 70 ? '. Good work.' : '. Keep going: Learn mode helps with the ones you missed.') + '</span></div>';
    TS.test.forEach(function (q) {
      if (q.type !== sec) { sec = q.type; h += '<h4>' + SECTION[q.type] + '</h4>'; }
      var r = res && res.results.find(function (x) { return x.n === q.n; });
      var a = TS.answers[q.n];
      var cls = r ? (r.right ? ' right' : ' wrong') : '';
      h += '<div class="q' + cls + '" data-n="' + q.n + '"><span class="num">' + q.n + '.</span>';
      if (q.type === 'match') {
        h += '<div class="p">Match each one to its letter.</div><div class="body">' + q.items.map(function (it) {
          var m = r && r.marks.find(function (x) { return x.card === it.card; });
          return '<label class="mrow"><span>' + esc(it.prompt) + (m && !m.right ? ' <span class="small" style="color:var(--again)">(it\'s ' + m.want + ')</span>' : '') + '</span><select data-match="' + it.card + '"' + (res ? ' disabled' : '') + '><option value="">–</option>' + q.options.map(function (o) { return '<option' + (a && a[it.card] === o.letter ? ' selected' : '') + '>' + o.letter + '</option>'; }).join('') + '</select></label>';
        }).join('') + '<div class="mlist">' + q.options.map(function (o) { return '<span><b>' + o.letter + '</b>' + esc(o.text) + '</span>'; }).join('') + '</div></div>';
      } else {
        h += '<div class="p">' + esc(q.prompt) + '</div><div class="body">';
        if (q.type === 'mc') h += q.options.map(function (o, i) { var mk = r ? (o === r.want ? ' right' : a === i ? ' wrong' : '') : ''; return '<button class="ch' + mk + '" data-v="' + i + '" aria-pressed="' + (a === i) + '"' + (res ? ' disabled' : '') + '><kbd>' + String.fromCharCode(65 + i) + '</kbd><span>' + esc(o) + '</span></button>'; }).join('');
        else if (q.type === 'tf') h += '<div class="shown">' + esc(q.shown) + '</div><div class="tf"><button class="ch" data-v="true" aria-pressed="' + (a === true) + '"' + (res ? ' disabled' : '') + '>True</button><button class="ch" data-v="false" aria-pressed="' + (a === false) + '"' + (res ? ' disabled' : '') + '>False</button></div>';
        else h += '<input type="text" data-w="' + q.n + '" value="' + esc(a || '') + '" autocomplete="off" spellcheck="false" placeholder="Your answer"' + (res ? ' disabled' : '') + '>';
        h += '</div>';
        if (r) h += '<div class="mark ' + (r.right ? 'right' : 'wrong') + '">' + (r.right ? (r.close ? 'Right (small typo). It\'s: <b>' + esc(r.want) + '</b>' : 'Right') : 'The answer: <b>' + esc(r.want) + '</b>') + '</div>';
      }
      h += '</div>';
    });
    if (res) h += '<div class="row" style="justify-content:center;margin:16px 0 8px"><button class="btn main big" id="tRetake">Take it again</button>' + (res.missed ? '<button class="btn big" id="tMissed">A test on the ' + (res.missed === 1 ? 'one' : res.missed) + ' I missed</button><button class="btn big quiet" id="tLearn">Learn the deck</button>' : '') + '<button class="btn big quiet" id="tBack">Back to the deck</button></div>';
    $('tPaper').innerHTML = h;
    $('tBar').hidden = !!res;
    testCount();
    if (res) {
      $('tRetake').onclick = function () { startTest(Object.assign({}, TS.opts, { only: null })); };
      var m = $('tMissed'); if (m) m.onclick = function () { startTest(Object.assign({}, TS.opts, { only: 'missed', count: 'all' })); };
      var l = $('tLearn'); if (l) l.onclick = function () { setMode('learn'); startLearn(false); };
      $('tBack').onclick = function () { stopStudy(); openDeck(S.deckId); };
    }
  }
  function testCount() {
    if (!TS) return;
    var total = TS.test.length, done = TS.test.filter(function (q) { var a = TS.answers[q.n]; return q.type === 'match' ? a && Object.keys(a).filter(function (k) { return a[k]; }).length === q.items.length : a !== undefined && a !== ''; }).length;
    $('tCount').textContent = done + ' of ' + total + ' answered';
    $('prog').style.width = Math.round((done / Math.max(1, total)) * 100) + '%';
  }
  $('tPaper').addEventListener('click', function (e) {
    if (!TS || TS.result) return;
    var b = e.target.closest('.ch'); if (!b) return;
    var n = +b.closest('.q').dataset.n, q = TS.test.find(function (x) { return x.n === n; });
    TS.answers[n] = q.type === 'tf' ? b.dataset.v === 'true' : +b.dataset.v;
    Array.prototype.forEach.call(b.parentNode.querySelectorAll('.ch'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    testCount();
  });
  $('tPaper').addEventListener('input', function (e) {
    if (!TS || TS.result) return;
    var t = e.target;
    if (t.dataset.w) TS.answers[+t.dataset.w] = t.value;
    testCount();
  });
  $('tPaper').addEventListener('change', function (e) {
    if (!TS || TS.result) return;
    var t = e.target;
    if (t.dataset.match) { var n = +t.closest('.q').dataset.n; TS.answers[n] = TS.answers[n] || {}; TS.answers[n][t.dataset.match] = t.value; testCount(); }
  });
  $('tSubmit').addEventListener('click', function () {
    if (!TS) return;
    var left = TS.test.length - TS.test.filter(function (q) { return TS.answers[q.n] !== undefined && TS.answers[q.n] !== ''; }).length;
    var go = left ? sheet({ title: 'Hand it in?', html: '<p>' + plural(left, 'question') + ' still blank. Blank ones count as wrong.</p>', actions: [{ label: 'Keep going', value: '' }, { label: 'Hand it in', value: 'ok', main: true }] }).then(function (r) { return r.v === 'ok'; }) : Promise.resolve(true);
    go.then(function (yes) {
      if (!yes) return;
      return api('test-grade', { testId: TS.id, answers: TS.answers, ms: Date.now() - TS.t0 }).then(function (r) {
        TS.result = r;
        renderTest();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        refresh();
      });
    }).catch(fail);
  });

  // ── the match game ──
  var MT = null;
  function startMatch() {
    stopMatch();
    return api('match', { id: S.deckId }).then(function (r) {
      ST = null;
      MT = { tiles: r.tiles, best: r.best, sel: null, left: r.tiles.length / 2, t0: 0, timer: 0, n: r.tiles.length / 2 };
      $('stBack').textContent = '‹ ' + S.deck.title;
      show('vStudy');
      studyPart('stMatch');
      $('prog').style.width = '0%'; $('stLeft').textContent = 'Match each card to its other side';
      $('best').textContent = r.best ? 'Best: ' + (r.best / 1000).toFixed(1) + ' s' : '';
      $('clock').textContent = '0.0';
      $('tiles').innerHTML = MT.tiles.map(function (t, i) { return '<button class="tile ' + t.side + '" data-i="' + i + '">' + esc(t.text) + '</button>'; }).join('');
    }).catch(fail);
  }
  function stopMatch() { if (MT) clearInterval(MT.timer); MT = null; }
  $('againMatch').addEventListener('click', startMatch);
  $('tiles').addEventListener('click', function (e) {
    var b = e.target.closest('.tile'); if (!b || !MT) return;
    if (!MT.t0) { MT.t0 = Date.now(); MT.timer = setInterval(function () { if (MT) $('clock').textContent = ((Date.now() - MT.t0) / 1000).toFixed(1); }, 100); }
    var i = +b.dataset.i, t = MT.tiles[i];
    if (MT.sel === i) { b.classList.remove('on'); MT.sel = null; return; }
    if (MT.sel == null) { MT.sel = i; b.classList.add('on'); return; }
    var other = MT.tiles[MT.sel], ob = $('tiles').children[MT.sel];
    MT.sel = null; ob.classList.remove('on');
    if (other.card === t.card && other.side !== t.side) {
      b.classList.add('gone'); ob.classList.add('gone');
      MT.left--;
      $('prog').style.width = Math.round(((MT.n - MT.left) / MT.n) * 100) + '%';
      if (!MT.left) {
        clearInterval(MT.timer);
        var ms = Date.now() - MT.t0;
        $('clock').textContent = (ms / 1000).toFixed(1) + ' s';
        api('match-done', { id: S.deckId, ms: ms, n: MT.n }).then(function (r) { $('best').textContent = r.record ? 'A new best!' : 'Best: ' + (r.best / 1000).toFixed(1) + ' s'; refresh(); });
      }
    } else {
      [b, ob].forEach(function (x) { x.classList.remove('miss'); void x.offsetWidth; x.classList.add('miss'); });
      MT.t0 -= 1000; // a wrong pair costs a second
    }
  });

  // ── a new deck, or more cards for one ──
  var parseT = 0;
  function openNew(into, tab) {
    S.newFor = into || null;
    var d = into && S.state.decks.find(function (x) { return x.id === into; });
    $('nHead').textContent = d ? 'Add cards to ' + d.title : 'New deck';
    $('nTitleField').hidden = !!d;
    $('nMake').textContent = d ? 'Add them' : 'Make the deck';
    $('aiGo').textContent = d ? 'Make the cards and add them' : 'Make the cards';
    $('nText').value = ''; $('nTitle').value = ''; $('nCount').textContent = '';
    $('nPreview').innerHTML = '<p class="muted small" style="margin:0">The cards show up here as you type.</p>';
    $('totRow').hidden = !S.state.tot || !!d;
    setTab(tab || 'paste');
    stopStudy();
    show('vNew');
    (d ? $('nText') : $('nTitle')).focus();
  }
  function setTab(t) {
    Array.prototype.forEach.call($('nTabs').children, function (x) { x.setAttribute('aria-pressed', String(x.dataset.t === t)); });
    $('tPaste').hidden = t !== 'paste'; $('tFile').hidden = t !== 'file'; $('tAi').hidden = t !== 'ai';
    if (t === 'ai') { $('aiSetup').hidden = S.state.ai.ok; $('aiNote').textContent = S.state.ai.ok ? 'With ' + S.state.ai.name : ''; $('aiGo').disabled = !S.state.ai.ok; }
  }
  $('nTabs').addEventListener('click', function (e) { var b = e.target.closest('button[data-t]'); if (b) setTab(b.dataset.t); });
  $('newBtn').addEventListener('click', function () { openNew(null); });
  $('emptyNew').addEventListener('click', function () { openNew(null); });
  $('nText').addEventListener('input', function () {
    clearTimeout(parseT);
    parseT = setTimeout(function () {
      var text = $('nText').value;
      if (!text.trim()) { $('nPreview').innerHTML = '<p class="muted small" style="margin:0">The cards show up here as you type.</p>'; $('nCount').textContent = ''; return; }
      api('parse', { text: text }).then(function (r) {
        $('nCount').textContent = r.cards.length ? plural(r.cards.length, 'card') : '';
        $('nPreview').innerHTML = (r.cards.length ? r.cards.slice(0, 60).map(function (c) { return '<div class="pc"><span>' + esc(c.front) + '</span><span>' + esc(c.back) + '</span></div>'; }).join('') + (r.cards.length > 60 ? '<p class="small muted">…and ' + (r.cards.length - 60) + ' more</p>' : '') : '<p class="muted small" style="margin:0">No cards yet: put a dash, a colon or a Tab between the two sides.</p>') +
          (r.skipped.length ? '<p class="skip">' + plural(r.skipped.length, 'line') + ' didn\'t look like ' + (r.skipped.length === 1 ? 'a card' : 'cards') + ': ' + esc(r.skipped.slice(0, 3).join(' · ')) + '</p>' : '');
      }).catch(function () {});
    }, 180);
  });
  $('nMake').addEventListener('click', function () {
    var text = $('nText').value;
    var body = S.newFor ? { id: S.newFor, text: text } : { title: $('nTitle').value || 'New deck', text: text };
    if (!S.newFor && !$('nTitle').value.trim()) { $('nTitle').focus(); toast('Give the deck a name first.'); return; }
    api(S.newFor ? 'add' : 'create', body).then(function (r) {
      toast(S.newFor ? plural(r.added, 'card') + ' added.' : r.deck.title + ': ' + plural(r.deck.total, 'card') + '.');
      return refresh().then(function () { openDeck(r.deck.id); });
    }).catch(fail);
  });
  // from a file
  function readFile(f) {
    if (f.size > 40 * 1024 * 1024) return toast('That file is too big (40 MB at most).');
    var rd = new FileReader();
    rd.onload = function () {
      var b64 = String(rd.result).split(',')[1] || '';
      toast('Reading ' + f.name + '…');
      api('import-file', { name: f.name, b64: b64, title: $('nTitle').value.trim() || undefined }).then(function (r) {
        if (r.notes != null) {
          $('aiSrc').value = r.notes;
          if (!$('nTitle').value) $('nTitle').value = r.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
          setTab('ai');
          toast(S.state.ai.ok ? 'Got the notes. Press Make the cards.' : 'Got the notes. Making cards from them needs the free AI key (below).');
          return;
        }
        toast(r.deck.title + ': ' + plural(r.deck.total, 'card') + (r.skipped.length ? ' (' + plural(r.skipped.length, 'line') + ' skipped)' : '') + '.');
        return refresh().then(function () { openDeck(r.deck.id); });
      }).catch(fail);
    };
    rd.readAsDataURL(f);
  }
  $('file').addEventListener('change', function () { if (this.files[0]) readFile(this.files[0]); this.value = ''; });
  ['dragenter', 'dragover'].forEach(function (ev) { $('drop').addEventListener(ev, function (e) { e.preventDefault(); this.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { $('drop').addEventListener(ev, function (e) { e.preventDefault(); this.classList.remove('over'); if (ev === 'drop' && e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); }); });
  $('totBtn').addEventListener('click', function () {
    api('tot').then(function (r) { toast(r.made.length ? 'Brought in ' + plural(r.made.length, 'deck') + '.' : 'Nothing new in Tree of Thought\'s cram.'); return refresh().then(function () { if (r.made[0]) openDeck(r.made[0].id); }); }).catch(fail);
  });
  // with AI
  $('keyForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var k = $('keyIn').value.trim(); if (!k) return;
    toast('Checking the key…');
    api('setup', { provider: 'groq', key: k }).then(function (r) { $('keyIn').value = ''; toast('Done: ' + r.name + '.'); return refresh().then(function () { setTab('ai'); }); }).catch(fail);
  });
  $('aiGo').addEventListener('click', function () {
    var src = $('aiSrc').value.trim();
    if (!src) { $('aiSrc').focus(); toast('Paste some notes, or type a topic.'); return; }
    var b = $('aiGo'); b.disabled = true;
    $('aiNote').textContent = 'Blink is reading' + (src.length > 300 ? ' your notes' : '') + '… (up to a minute)';
    api('make', { source: src, count: +$('aiCount').value, into: S.newFor || undefined, title: $('nTitle').value.trim() || undefined }).then(function (r) {
      toast(plural(r.added, 'card') + ' made by ' + r.by + '. Read them over: click one to fix it.');
      return refresh().then(function () { openDeck(r.deck.id); });
    }).catch(fail).then(function () { b.disabled = false; $('aiNote').textContent = S.state.ai.ok ? 'With ' + S.state.ai.name : ''; });
  });

  // ── how it's going ──
  $('statsBtn').addEventListener('click', function () {
    stopStudy();
    refresh().then(function (st) {
      var s = st.stats;
      $('sBig').textContent = s.streak ? plural(s.streak, 'day') + ' in a row' + (s.best > s.streak ? ' (your best is ' + s.best + ')' : '') + '.' : s.total ? 'No streak right now. Study today to start one.' : 'Nothing studied yet.';
      var bits = [];
      if (s.today) bits.push(plural(s.today, 'card') + ' today' + (s.minutes ? ', about ' + plural(s.minutes, 'minute') : '') + '.');
      if (s.remembered != null) bits.push('You remembered ' + s.remembered + '% of the cards you\'d seen before, over the last 30 days.');
      if (s.total) bits.push(s.total.toLocaleString() + ' cards studied in all.');
      $('sSmall').textContent = bits.join(' ');
      $('heat').innerHTML = s.days.map(function (x) { var n = x[1], l = !n ? '' : n < 10 ? 'l1' : n < 30 ? 'l2' : n < 80 ? 'l3' : 'l4'; return '<i class="' + l + '" title="' + new Date(x[0]).toLocaleDateString() + ': ' + plural(n, 'card') + '"></i>'; }).join('');
      $('sDecks').innerHTML = st.decks.map(function (d) {
        var n = Math.max(1, d.total), review = d.total - d.fresh - d.learning - d.known;
        return '<div class="bar"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(d.title) + '</span><div class="mix"><i class="k" style="width:' + (d.known / n * 100) + '%"></i><i class="r" style="width:' + (review / n * 100) + '%"></i><i class="l" style="width:' + (d.learning / n * 100) + '%"></i><i class="w" style="width:' + (d.fresh / n * 100) + '%"></i></div><span class="small muted">' + Math.round(d.known / n * 100) + '%</span></div>';
      }).join('') || '<p class="muted">No decks yet.</p>';
      show('vStats');
    }).catch(fail);
  });

  // ── settings ──
  $('setBtn').addEventListener('click', function () {
    var st = S.state, s = st.settings;
    var rem = s.remind ? String(s.remind.Hour).padStart(2, '0') + ':' + String(s.remind.Minute).padStart(2, '0') : '16:00';
    sheet({
      title: 'Settings',
      html: '<label class="field"><span>New cards a day</span><input type="number" data-k="perDay" min="1" max="200" value="' + s.perDay + '" style="width:110px"><small>Per deck. With a test date, flash raises it if it has to, so you learn every card in time.</small></label>' +
        (st.mac ? '<label class="field"><span>A reminder each day</span><span class="row"><input type="checkbox" data-k="remindOn"' + (s.remind ? ' checked' : '') + '> at <input type="time" data-k="remindAt" value="' + rem + '"></span><small>A notification, only on days there\'s something to study.</small></label>' : '') +
        '<div class="field"><span>AI</span><small>' + (st.ai.ok ? 'Cards are made with ' + esc(st.ai.name) + ', shared with the rest of the family. To use another key: flash setup again (in Terminal).' : 'Not set up. New deck › Make with AI shows how (a free key, once).') + '</small></div>',
      actions: [{ label: 'Cancel', value: '' }, { label: 'Save', value: 'ok', main: true }],
    }).then(function (r) {
      if (r.v !== 'ok') return;
      var jobs = [api('settings', { perDay: r.vals.perDay })];
      if (st.mac) {
        var was = !!s.remind, now = !!r.vals.remindOn, at = r.vals.remindAt;
        if (now && (!was || at !== rem)) jobs.push(api('remind', { time: at }));
        if (!now && was) jobs.push(api('remind', { time: null }));
      }
      return Promise.all(jobs).then(function () { toast('Saved.'); return refresh(); }).then(function () { if (S.view === 'vDeck') reloadDeck(); });
    }).catch(fail);
  });

  // ── keys ──
  document.addEventListener('keydown', function (e) {
    if ($('sheet').open || e.metaKey || e.ctrlKey || e.altKey) return;
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.id !== 'checkBtn';
    if (S.view === 'vStudy' && LS && !$('stLearn').hidden && !$('lAsk').hidden) {
      var lq = LS.round[LS.i];
      if (e.key === 'Escape') { $('stBack').click(); return; }
      if (LS.answered && e.key === 'Enter' && !$('lFb').hidden && $('lFb').classList.contains('wrong')) { e.preventDefault(); learnNext(); return; }
      if (!LS.answered && lq && lq.type === 'mc' && /^[1-4]$/.test(e.key)) { var ob = $('lOpts').children[+e.key - 1]; if (ob) ob.click(); }
      return;
    }
    if (S.view !== 'vStudy' || !ST || !ST.cur || $('stCard').hidden) { if (e.key === 'Escape' && S.view === 'vStudy' && !TS) $('stBack').click(); return; }
    if (e.key === 'Escape') { $('stBack').click(); return; }
    if (ST.mode === 'type') {
      if (ST.answered && !typing) {
        if (e.key === 'Enter') { e.preventDefault(); grade(ST.verdict === 'wrong' ? 1 : 3); }
        else if ((e.key === 'y' || e.key === 'Y') && ST.verdict === 'wrong') grade(3);
        else if ((e.key === 'e' || e.key === 'E') && ST.verdict !== 'wrong') grade(4);
      }
      return;
    }
    if (typing) return;
    if (ST.mode === 'flip') {
      if (!ST.flipped && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); flip(); }
      else if (ST.flipped && /^[1-4]$/.test(e.key)) grade(+e.key);
      else if (ST.flipped && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); grade(3); }
    } else if (ST.mode === 'quiz') {
      if (!ST.answered && /^[1-4]$/.test(e.key)) choose(+e.key - 1);
      else if (ST.answered && !ST.right && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); grade(1); }
    }
  });

  start();
  setInterval(function () { api('ping').catch(function () { /* the window outlived flash */ }); }, 30000);
})();
