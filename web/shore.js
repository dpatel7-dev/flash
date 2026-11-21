/* shore.js: the edge of a lake, at the bottom of flash's window.
 *
 *   always: trees on the far shore and their reflection, ripples on the water,
 *   reeds and cattails along the bank, a little wooden dock with a frog on it,
 *   and Blink the firefly flying lazy loops, now and then resting on a cattail.
 *   day (light mode): dragonflies darting over the water and hovering.
 *   night (dark mode): fireflies blinking everywhere (and in the water), a
 *   path of moonlight, and the frog singing.
 * The page's own white or black shows through: no painted sky.
 *
 *   Shore.start(canvas, { night: () => bool, share: 0.4 })
 */
(function (root) {
  'use strict';
  var PS = root.PixelScene;

  var DAY = {
    tree: ['#b9d8bf', '#a6cdb0', '#c9e2cd'], pine: '#8fbf9c', refl: '#d6e9f0', water: ['#b4d9ea', '#d2e9f2', '#94c6dd'], lake: ['#f1f8fb', '#e9f4f8', '#e1eff5'],
    bank: ['#86b874', '#74a965', '#98c785', '#6a9c5c'], reed: ['#5f9b56', '#4f8a4a', '#78b067'], cat: ['#8a5a35', '#a06a40'],
    dock: ['#b48d60', '#977249', '#6f5236'], frog: { G: '#5fa14f', g: '#467e3c', w: '#f4f6e6', k: '#1d2a18', y: '#e9eca0' },
    dragon: [['#2f8fb8', '#1f6f94'], ['#3aa37a', '#2a7d5c'], ['#d0604b', '#a8473a']], wing: '#cfe6f0',
  };
  var NIGHT = {
    tree: ['#0f1d16', '#13241a', '#0c1812'], pine: '#16291e', refl: '#0b1a21', water: ['#163848', '#1d4a60', '#122d3a'], lake: ['#03090c', '#040c10', '#050f14'],
    bank: ['#14301b', '#18381f', '#112a17', '#1c3f23'], reed: ['#1d3f25', '#17331e', '#24492b'], cat: ['#3b2a1c', '#4a3422'],
    dock: ['#3d3125', '#30261c', '#221b14'], frog: { G: '#2f5a29', g: '#234620', w: '#c8cbb8', k: '#080c07', y: '#8c9a62' },
    fly: '#e8f25c', halo: 'rgba(232, 242, 92, 0.16)', moon: '#d8e6ff',
  };
  var BLINK = ['....ww.ww...', '...wWWwWw...', '....oOOOO.a.', '..YYOOOORKa.', 'g.YGYOOORKE.', '..yYYdddd...', 'g....l.l....'];
  var BLINK_UP = ['...ww...ww..', '...wWw.wWw..', '....oOOOO.a.', '..YYOOOORKa.', 'g.YGYOOORKE.', '..yYYdddd...', 'g....l.l....'];
  var INK = { O: '#3b3426', o: '#5a4e36', K: '#1c1a17', R: '#d9553b', Y: '#e8f25c', y: '#c9e03a', G: '#f6ff9a', g: '#d7f07a', W: '#b7c9d9', w: '#e3edf5', E: '#ffffff', a: '#3b3426', l: '#3b3426', d: '#6b5c40' };
  var INK_NIGHT = Object.assign({}, INK, { O: '#7a6646', o: '#9a8460', d: '#a8926a', K: '#4d453a', a: '#8f7c5a', l: '#8f7c5a', W: '#6f8396', w: '#9fb2c4' });
  var FROG = ['..GG.GG..', '.GwkGwkG.', 'GGGGGGGGG', 'gGyyyyyGg', '.gg...gg.'];
  var FROG_SING = ['..GG.GG..', '.GwkGwkG.', 'GGGGGGGGG', 'gGyyyyyGg', '.gyyyyyg.', '..yyyyy..'];

  function start(cv, opts) {
    opts = opts || {};
    var share = opts.share || 0.4;
    var A = {};

    function build(o) {
      var W = o.W, H = o.H, rnd = o.rnd, P = o.night ? NIGHT : DAY;
      var top = Math.round(H * (1 - share));
      var far = top + 6, bank = H - Math.max(10, Math.round((H - top) * 0.22));
      var back = PS.canvas(W, H), g = back.getContext('2d');
      // the lake: a faint tint, a little deeper toward the near bank
      for (var ly = far; ly < bank + 2; ly++) { g.fillStyle = P.lake[Math.min(2, Math.floor(((ly - far) / (bank - far)) * 3))]; g.fillRect(0, ly, W, 1); }
      // the far shore: rounded trees and the odd pine, and their reflection below
      var x = -4;
      while (x < W) {
        var pine = rnd() < 0.22, tw = pine ? 5 + Math.floor(rnd() * 3) : 7 + Math.floor(rnd() * 10), th = pine ? 8 + Math.floor(rnd() * 5) : 4 + Math.floor(rnd() * 6), c = pine ? P.pine : P.tree[Math.floor(rnd() * 3)];
        for (var i = 0; i < tw; i++) {
          var u = (i - (tw - 1) / 2) / (tw / 2);
          var hh = pine ? Math.round(th * (1 - Math.abs(u))) : Math.round(th * Math.sqrt(Math.max(0, 1 - u * u)));
          g.fillStyle = c; g.fillRect(x + i, far - hh, 1, hh + 1);
          if (hh > 1) { g.fillStyle = P.refl; g.fillRect(x + i, far + 1, 1, Math.max(1, Math.round(hh * 0.55))); }
        }
        x += tw - (pine ? 1 : 3);
      }
      // the near bank: grass, with tufts
      for (var bx = 0; bx < W; bx++) {
        var y0 = bank + Math.round(Math.sin(bx / 17) * 1.3 + Math.sin(bx / 5.3) * 0.5);
        for (var y = y0; y < H; y++) { g.fillStyle = P.bank[(bx * 7 + y * 3) % 13 < 2 ? 1 : (bx + y * 5) % 19 === 0 ? 2 : y - y0 > 4 && (bx + y) % 7 === 0 ? 3 : 0]; g.fillRect(bx, y, 1, 1); }
        if (rnd() < 0.3) { g.fillStyle = P.bank[2]; g.fillRect(bx, y0 - 1 - Math.floor(rnd() * 2), 1, 2); }
      }
      // reeds and cattails, in a few clumps (more toward the sides)
      var reeds = [];
      var clumps = Math.max(3, Math.round(W / 70));
      for (var k = 0; k < clumps; k++) {
        var side = rnd(), cx = Math.floor(side < 0.35 ? rnd() * W * 0.18 : side < 0.7 ? W - rnd() * W * 0.18 : rnd() * W);
        for (var j = 0; j < 3 + rnd() * 4; j++) {
          var rx = cx + Math.floor(rnd() * 10) - 5, rh = Math.round((bank - far) * (0.25 + rnd() * 0.35));
          reeds.push({ x: rx, h: rh, c: P.reed[Math.floor(rnd() * 3)], cat: rnd() < 0.35, ph: rnd() * 6, base: bank + Math.round(Math.sin(rx / 17) * 1.3) });
        }
      }
      // the dock, off the right-hand bank
      var dock = { x: Math.round(W * (0.62 + rnd() * 0.12)), w: Math.max(24, Math.round(W * 0.14)), y: bank - 4 };
      if (dock.x + dock.w > W - 4) dock.x = W - dock.w - 4;
      g.fillStyle = P.dock[0]; g.fillRect(dock.x, dock.y, dock.w, 2);
      g.fillStyle = P.dock[1]; for (var pl = dock.x; pl < dock.x + dock.w; pl += 4) g.fillRect(pl, dock.y, 1, 2);
      g.fillStyle = P.dock[2]; for (var po = dock.x + 1; po < dock.x + dock.w; po += 9) g.fillRect(po, dock.y + 2, 2, 5);
      var ripples = [];
      for (var r = 0; r < W / 7; r++) ripples.push({ x: rnd() * W, y: far + 4 + rnd() * (bank - far - 6), w: 2 + Math.floor(rnd() * 5), ph: rnd() * 6, c: Math.floor(rnd() * 3) });
      var flies = [];
      if (o.night) for (var f = 0; f < Math.max(8, W / 22); f++) flies.push({ x: rnd() * W, y: top - 10 + rnd() * (bank - top + 6), ph: rnd() * 20, sp: 0.5 + rnd() * 0.8, vx: (rnd() - 0.5) * 3, vy: (rnd() - 0.5) * 1.5 });
      var dragons = [];
      if (!o.night) for (var d = 0; d < Math.max(2, Math.round(W / 160)); d++) dragons.push({ x: rnd() * W, y: far + rnd() * (bank - far), tx: rnd() * W, ty: far + rnd() * (bank - far), hover: rnd() * 2, c: P.dragon[Math.floor(rnd() * 3)] });
      A.blink = null;
      return { P: P, top: top, far: far, bank: bank, back: back, reeds: reeds, dock: dock, ripples: ripples, flies: flies, dragons: dragons, rnd: rnd, frog: { sing: 0, next: 3 } };
    }

    function draw(g, S, t, dt) {
      var P = S.P, W = S.W, far = S.far, bank = S.bank;
      // ripples on the water
      S.ripples.forEach(function (r) {
        var a = 0.35 + 0.45 * Math.max(0, Math.sin(t * 0.8 + r.ph));
        g.globalAlpha = a; g.fillStyle = P.water[r.c];
        g.fillRect(r.x + Math.sin(t * 0.4 + r.ph) * 2, r.y, r.w, 1);
      });
      g.globalAlpha = 1;
      // moonlight on the water
      if (S.night) {
        for (var m = 0; m < bank - far - 4; m += 2) {
          g.globalAlpha = 0.55 - (m / (bank - far)) * 0.4;
          g.fillStyle = P.moon;
          var mw = 3 + Math.round(m * 0.25), mx = W * 0.3 + Math.sin(t * 1.1 + m * 0.7) * 1.5 - mw / 2;
          g.fillRect(mx, far + 3 + m, mw, 1);
        }
        g.globalAlpha = 1;
      }
      g.drawImage(S.back, 0, 0);
      // reeds, swaying
      S.reeds.forEach(function (r) {
        for (var k = 0; k < r.h; k++) {
          var sway = Math.sin(t * 0.7 + r.ph) * Math.pow(k / r.h, 2) * 2.2;
          g.fillStyle = r.c; g.fillRect(r.x + sway, r.base - k, 1, 1);
          if (r.cat && k > r.h - 6 && k < r.h - 1) { g.fillStyle = P.cat[k % 2]; g.fillRect(r.x + sway - 1, r.base - k, 3, 1); }
        }
        r.tip = { x: r.x + Math.sin(t * 0.7 + r.ph) * 2.2, y: r.base - r.h };
      });
      frog(g, S, t, dt);
      if (S.night) fireflies(g, S, t, dt); else dragonflies(g, S, t, dt);
      blink(g, S, t, dt);
    }

    function frog(g, S, t, dt) {
      var f = S.frog, d = S.dock;
      f.next -= dt;
      if (S.night && f.next < 0 && !f.sing) { f.sing = 1.6; f.next = 4 + S.rnd() * 6; }
      if (f.sing) f.sing = Math.max(0, f.sing - dt);
      var singing = f.sing > 0 && Math.floor(f.sing * 5) % 2 === 0;
      PS.sprite(g, singing ? FROG_SING : FROG, d.x + Math.round(d.w * 0.6), d.y - 5, S.P.frog, false);
    }

    function fireflies(g, S, t, dt) {
      S.flies.forEach(function (f) {
        f.x += (f.vx + Math.sin(t * 0.5 + f.ph) * 1.5) * dt; f.y += (f.vy + Math.cos(t * 0.6 + f.ph) * 0.8) * dt;
        if (f.x < -2) f.x = S.W + 2; if (f.x > S.W + 2) f.x = -2;
        if (f.y < S.top - 14 || f.y > S.bank - 2) f.vy = -f.vy;
        // a slow blink: dark most of the time, then a soft flash
        var c = ((t * f.sp + f.ph) % 4) / 4, on = c < 0.28 ? Math.sin((c / 0.28) * Math.PI) : 0;
        if (on <= 0.05) { g.globalAlpha = 0.35; g.fillStyle = '#3a3a20'; g.fillRect(f.x, f.y, 1, 1); g.globalAlpha = 1; return; }
        g.globalAlpha = on; g.fillStyle = S.P.halo; g.fillRect(f.x - 1, f.y - 1, 3, 3); g.fillRect(f.x - 2, f.y, 5, 1); g.fillRect(f.x, f.y - 2, 1, 5);
        g.fillStyle = S.P.fly; g.fillRect(f.x, f.y, 1, 1);
        if (f.y < S.far && f.y > S.top - 14) { /* over the far trees: no reflection */ } else if (f.y < S.bank - 2) { g.globalAlpha = on * 0.35; g.fillRect(f.x, S.bank - (f.y - S.far) * 0.25 - 2, 1, 1); }
        g.globalAlpha = 1;
      });
    }

    function dragonflies(g, S, t, dt) {
      S.dragons.forEach(function (d) {
        if (d.hover > 0) d.hover -= dt;
        else {
          var dx = d.tx - d.x, dy = d.ty - d.y, dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 2) { d.hover = 0.6 + S.rnd() * 2.2; d.tx = Math.max(4, Math.min(S.W - 8, d.x + (S.rnd() - 0.5) * 120)); d.ty = S.far + 2 + S.rnd() * (S.bank - S.far - 6); }
          else { var sp = 60 * dt; d.x += (dx / dist) * Math.min(sp, dist); d.y += (dy / dist) * Math.min(sp, dist); d.dir = dx < 0 ? -1 : 1; }
        }
        var x = Math.round(d.x), y = Math.round(d.y + (d.hover > 0 ? Math.sin(t * 9) * 0.4 : 0)), dir = d.dir || 1;
        g.fillStyle = d.c[0]; g.fillRect(dir > 0 ? x - 4 : x + 1, y, 4, 1);
        g.fillStyle = d.c[1]; g.fillRect(dir > 0 ? x : x, y, 1, 1);
        var flap = Math.floor(t * 30) % 2;
        g.fillStyle = S.P.wing; g.globalAlpha = 0.85;
        g.fillRect(dir > 0 ? x - 2 : x + 1, y - 1 - flap, 2, 1); g.fillRect(dir > 0 ? x - 1 : x + 2, y + 1 + flap, 2, 1);
        g.globalAlpha = 1;
      });
    }

    // Blink: lazy loops over the water; now and then a rest on a cattail
    function blink(g, S, t, dt) {
      var b = A.blink;
      if (!b) b = A.blink = { x: S.W * 0.4, y: S.far + 2, tx: S.W * 0.5, ty: S.far, dir: 1, rest: 0, timer: 6 };
      b.timer -= dt;
      if (b.rest > 0) {
        b.rest -= dt;
        if (b.perch && b.perch.tip) { b.x = b.perch.tip.x - 6; b.y = b.perch.tip.y - 7; }
        if (b.rest <= 0) { b.perch = null; b.timer = 6 + S.rnd() * 6; b.tx = S.rnd() * (S.W - 20) + 4; b.ty = S.top - 4 + S.rnd() * (S.bank - S.top - 12); }
      } else {
        if (b.landing && b.perch && b.perch.tip) { b.tx = b.perch.tip.x - 6; b.ty = b.perch.tip.y - 7; }
        var dx = b.tx - b.x, dy = b.ty - b.y, dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 3) {
          if (b.landing && b.perch) { b.landing = false; b.rest = 4 + S.rnd() * 5; }
          else if (b.timer < 0) {
            var cats = S.reeds.filter(function (r) { return r.cat && r.tip; });
            if (cats.length) { b.perch = cats[Math.floor(S.rnd() * cats.length)]; b.landing = true; } else b.timer = 6;
          } else { b.tx = Math.max(2, Math.min(S.W - 14, b.x + (S.rnd() - 0.5) * 90)); b.ty = S.top - 4 + S.rnd() * (S.bank - S.top - 12); }
        } else {
          var sp = 14 * dt;
          b.x += (dx / dist) * Math.min(sp, dist); b.y += (dy / dist) * Math.min(sp, dist) + Math.sin(t * 3) * 0.06;
          if (Math.abs(dx) > 1) b.dir = dx < 0 ? -1 : 1;
        }
      }
      var ink = S.night ? INK_NIGHT : INK;
      var pic = b.rest > 0 ? BLINK : Math.floor(t * 10) % 2 ? BLINK : BLINK_UP;
      // the glow
      var tail = b.dir > 0 ? b.x + 3 : b.x + 8, ty = b.y + 4;
      var pulse = 0.55 + 0.45 * Math.sin(t * (S.night ? 2.2 : 1.4));
      g.globalAlpha = (S.night ? 0.32 : 0.16) * pulse; g.fillStyle = S.night ? '#e8f25c' : '#d7f07a';
      g.fillRect(tail - 3, ty - 2, 7, 5); g.fillRect(tail - 2, ty - 3, 5, 7);
      g.globalAlpha = 1;
      PS.sprite(g, pic, b.x, b.y, ink, b.dir < 0);
    }

    return PS.start(cv, { night: opts.night, build: build, draw: draw, fps: opts.fps || 20 });
  }

  root.Shore = { start: start };
})(window);
