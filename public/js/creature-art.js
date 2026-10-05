// HOMESTEAD Creature art: draws a stored appearance as layered SVG.
//
// It never rolls anything: the same stored appearance always draws the same
// Creature. Layers, back to front: background, tail, body and clothing,
// boots, back spikes, horns and ears, head, patches and markings, eyes, mouth,
// hair, glowing mark, accessories. Drawn on a 120 x 120 grid with a big head
// over a small body and thick outlines, so it still reads at avatar size.
//
// Colours are the --art-* tokens in styles/tailwind-input.css. Only names
// from the config are ever written into the markup: anything unknown falls
// back to a default, so a stored value can never inject markup.
(function () {
  var cfg = window.HOMESTEAD_CREATURE_CONFIG;
  var COLORS = new Set(cfg.ART_COLORS.concat(['ink', 'void']));
  var uid = 0;

  function art(name, fallback) {
    return 'rgb(var(--art-' + (COLORS.has(name) ? name : fallback) + '))';
  }
  function token(name) { return 'rgb(var(--' + name + '))'; }
  function r1(n) { return Math.round(n * 10) / 10; }
  function mirror(markup) {
    return markup + '<g transform="translate(120 0) scale(-1 1)">' + markup + '</g>';
  }
  function path(d, fill, stroke, width) {
    return '<path d="' + d + '" style="fill:' + (fill || 'none') + ';stroke:' + (stroke || 'none') +
      ';stroke-width:' + (width == null ? 3 : width) + '"/>';
  }
  function circle(cx, cy, r, fill, stroke, width) {
    return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" style="fill:' + (fill || 'none') +
      ';stroke:' + (stroke || 'none') + ';stroke-width:' + (width == null ? 3 : width) + '"/>';
  }
  // A limb or tail: an outline stroke under a coloured stroke.
  function limb(d, color, outline, width) {
    return path(d, 'none', outline, width + 3.5) + path(d, 'none', color, width);
  }

  // A bumpy outline (fuzz, clouds) around a circle.
  function bumpy(cx, cy, r, n, amp, rot) {
    var d = '';
    for (var i = 0; i < n; i++) {
      var a0 = rot + (i / n) * Math.PI * 2;
      var a1 = rot + ((i + 1) / n) * Math.PI * 2;
      var am = (a0 + a1) / 2;
      if (i === 0) d += 'M' + r1(cx + r * Math.cos(a0)) + ' ' + r1(cy + r * Math.sin(a0));
      d += 'Q' + r1(cx + (r + amp * 2) * Math.cos(am)) + ' ' + r1(cy + (r + amp * 2) * Math.sin(am)) +
        ' ' + r1(cx + r * Math.cos(a1)) + ' ' + r1(cy + r * Math.sin(a1));
    }
    return d + 'Z';
  }
  // A star polygon (jagged heads, star pupils).
  function star(cx, cy, outer, inner, n, rot) {
    var d = '';
    for (var i = 0; i < n * 2; i++) {
      var a = rot + (i / (n * 2)) * Math.PI * 2;
      var r = i % 2 ? inner : outer;
      d += (i ? 'L' : 'M') + r1(cx + r * Math.cos(a)) + ' ' + r1(cy + r * Math.sin(a));
    }
    return d + 'Z';
  }
  // Spikes fanning out from the head's centre, at angles in degrees.
  function radial(angles, base, tip, half) {
    return angles.map(function (deg) {
      var a = deg * Math.PI / 180;
      var bx = 60 + base * Math.cos(a), by = 50 + base * Math.sin(a);
      var px = -Math.sin(a) * half, py = Math.cos(a) * half;
      return 'M' + r1(bx + px) + ' ' + r1(by + py) + 'L' + r1(60 + tip * Math.cos(a)) + ' ' +
        r1(50 + tip * Math.sin(a)) + 'L' + r1(bx - px) + ' ' + r1(by - py) + 'Z';
    }).join('');
  }

  // Head silhouettes, centred on (60, 50). HEAD_TOP is where each one's top
  // edge sits, so hair and horns sit on it.
  var HEADS = {
    round: 'M26 50a34 34 0 1 0 68 0a34 34 0 1 0 -68 0Z',
    bean: 'M30 50a30 36 0 1 0 60 0a30 36 0 1 0 -60 0Z',
    wide: 'M20 54a40 29 0 1 0 80 0a40 29 0 1 0 -80 0Z',
    square: 'M40 18H80Q96 18 96 34V68Q96 84 80 84H40Q24 84 24 68V34Q24 18 40 18Z',
    drop: 'M60 14C80 26 96 40 96 58C96 74 84 84 72 84C70 91 64 92 63 86C59 92 52 92 51 84C36 84 24 74 24 58C24 40 40 26 60 14Z',
    ghost: 'M26 50C26 30 41 16 60 16C79 16 94 30 94 50V80Q90 88 84 82Q78 76 72 82Q66 88 60 82Q54 76 48 82Q42 88 36 82Q30 76 26 80Z',
    hex: 'M60 14L92 32V68L60 86L28 68V32Z',
    fuzzy: bumpy(60, 50, 31, 14, 2.5, 0),
    cloud: bumpy(60, 52, 27, 7, 4.5, -Math.PI / 2),
    onion: 'M60 10C64 24 94 32 94 56C94 76 79 85 60 85C41 85 26 76 26 56C26 32 56 24 60 10Z',
    gem: 'M44 16H76L96 38V62L76 84H44L24 62V38Z',
    lobed: 'M30 54C20 30 40 12 52 26C56 22 64 22 68 26C80 12 100 30 90 54C94 74 80 84 60 84C40 84 26 74 30 54Z',
    jagged: star(60, 50, 40, 31, 12, -Math.PI / 2),
  };
  var HEAD_TOP = { round: 16, bean: 14, wide: 25, square: 18, drop: 16, ghost: 16, hex: 14, fuzzy: 16,
    cloud: 18, onion: 14, gem: 16, lobed: 20, jagged: 12 };

  var BODIES = {
    stubby: 'M42 80Q39 106 50 108H70Q81 106 78 80Z',
    round: 'M40 94a20 15 0 1 0 40 0a20 15 0 1 0 -40 0Z',
    tall: 'M46 78Q42 108 52 110H68Q78 108 74 78Z',
  };

  // Backgrounds, one per rarity: from plain to glitched.
  function background(kind) {
    var out = '<rect width="120" height="120" style="fill:' + token('raised') + '"/>';
    var line = token('line');
    var x, y;
    if (kind === 'dots') {
      for (y = 8; y < 120; y += 14) for (x = 8 + ((y / 14) % 2) * 7; x < 120; x += 14) out += circle(x, y, 1.8, line, 'none', 0);
    } else if (kind === 'stripes') {
      for (x = -120; x < 120; x += 16) out += path('M' + x + ' 120L' + (x + 120) + ' 0', 'none', line, 5);
    } else if (kind === 'burst') {
      var rays = '';
      for (var i = 0; i < 16; i += 2) {
        var a0 = i / 16 * Math.PI * 2, a1 = (i + 1) / 16 * Math.PI * 2;
        rays += 'M60 56L' + r1(60 + 120 * Math.cos(a0)) + ' ' + r1(56 + 120 * Math.sin(a0)) +
          'L' + r1(60 + 120 * Math.cos(a1)) + ' ' + r1(56 + 120 * Math.sin(a1)) + 'Z';
      }
      out += path(rays, line, 'none', 0);
    } else if (kind === 'sparkle') {
      out += path(bumpy(60, 56, 48, 24, 2, 0), 'none', line, 2);
      [[14, 18, 'lemon'], [104, 22, 'bubblegum'], [12, 96, 'bubblegum'], [106, 100, 'lemon'], [96, 64, 'sky']].forEach(function (s) {
        out += path(star(s[0], s[1], 6, 1.8, 4, 0), art(s[2], 'lemon'), 'none', 0);
      });
    } else if (kind === 'glitch') {
      for (y = 0; y < 120; y += 12) for (x = (y / 12) % 2 ? 12 : 0; x < 120; x += 24) {
        out += '<rect x="' + x + '" y="' + y + '" width="12" height="12" style="fill:' + line + '"/>';
      }
      out += '<rect x="6" y="30" width="34" height="4" style="fill:' + art('toxic') + '"/>' +
        '<rect x="84" y="78" width="30" height="4" style="fill:' + art('bubblegum') + '"/>' +
        '<rect x="70" y="12" width="20" height="3" style="fill:' + art('sky') + '"/>';
    }
    return out;
  }

  function eyes(kind, iris, O) {
    var white = art('bone'), ink = art('ink');
    function eye(x, y, r) {
      return circle(x, y, r, white, O) + circle(x + r * 0.15, y + r * 0.1, r * 0.5, ink, 'none', 0) +
        circle(x - r * 0.15, y - r * 0.2, r * 0.17, white, 'none', 0);
    }
    switch (kind) {
      case 'one': return eye(60, 47, 12);
      case 'sleepy':
        return eye(47, 47, 9) + eye(73, 47, 9) +
          path('M38 47A9 9 0 0 1 56 47Z', 'currentColor', O) + path('M64 47A9 9 0 0 1 82 47Z', 'currentColor', O);
      case 'angry':
        return eye(47, 48, 8.5) + eye(73, 48, 8.5) + path('M37 35L55 41M83 35L65 41', 'none', O, 4);
      case 'visor':
        return '<rect x="31" y="39" width="58" height="16" rx="8" style="fill:' + iris + ';stroke:' + O + ';stroke-width:3"/>' +
          path('M39 44H53', 'none', white, 2.5);
      case 'spiral':
        var sp = function (x) {
          return circle(x, 47, 9, white, O) +
            path('M' + x + ' 47m-1 0a1 1 0 1 1 2 0a3 3 0 1 1 -5 0a5 5 0 1 1 8 0', 'none', ink, 1.8);
        };
        return sp(47) + sp(73);
      case 'three': return eye(42, 48, 7.5) + eye(60, 41, 7.5) + eye(78, 48, 7.5);
      case 'star':
        return circle(47, 47, 9, white, O) + circle(73, 47, 9, white, O) +
          path(star(47, 47, 6, 2.5, 5, -Math.PI / 2) + star(73, 47, 6, 2.5, 5, -Math.PI / 2), iris, ink, 1);
      default: return eye(47, 47, 9) + eye(73, 47, 9);
    }
  }

  function mouth(kind, O) {
    var bone = art('bone');
    switch (kind) {
      case 'smile': return path('M52 63Q60 69 68 63', 'none', O);
      case 'fang':
        return path('M50 64L52.5 70.5L55.5 66Z M70 64L67.5 70.5L64.5 66Z', bone, O, 1.5) + path('M46 62Q60 72 74 62', 'none', O);
      case 'teeth':
        return path('M44 60Q60 80 76 60Z', art('ink'), O) +
          path('M46.5 61.5L50 66L53.5 62.5L57 67L60 63L63 67L66.5 62.5L70 66L73.5 61.5Z', bone, 'none', 0);
      case 'zigzag': return path('M45 64L50 60L55 66L60 60L65 66L70 60L75 64', 'none', O);
      case 'tongue':
        return path('M56 66Q55 77 61 77Q67 77 66 66Z', art('bubblegum'), O, 2.5) + path('M46 62Q60 72 74 62', 'none', O);
      default: return path('M46 62Q60 73 74 62', 'none', O);
    }
  }

  function hair(kind, color, O) {
    switch (kind) {
      case 'mohawk': return path('M49 25L51 5L57 16L60 -1L63 16L69 5L71 25Z', color, O);
      case 'double': return path('M43 28L44 8L48 18L51 4L54 24Z M66 24L69 4L72 18L76 8L77 28Z', color, O);
      case 'messy':
        return path('M38 30C34 20 44 12 48 20C46 8 60 6 61 16C64 6 78 8 75 20C82 14 90 24 82 32C72 24 50 24 38 30Z', color, O);
      case 'buzz': return path('M30 36Q60 4 90 36Q60 22 30 36Z', color, O, 2.5);
      case 'spikes': return path(radial([-144, -126, -108, -90, -72, -54, -36], 30, 45, 5), color, O);
      case 'liberty': return path(radial([-140, -115, -90, -65, -40], 28, 60, 4.5), color, O);
      case 'flame':
        return path('M42 28C36 14 46 12 48 2C53 12 55 14 58 0C62 12 66 10 69 -2C71 12 80 14 76 28Z', color, O);
      case 'halo':
        return path(radial([-170, -150, -130, -110, -70, -50, -30, -10], 30, 46, 5), color, O) +
          path(radial([-90], 30, 50, 6), art('lemon'), O);
      case 'storm':
        return [['M48 24L40 12L47 13L40 -1'], ['M60 22L56 8L63 9L58 -4'], ['M72 24L78 11L71 12L79 -1']].map(function (d) {
          return limb(d[0], color, O, 3.5);
        }).join('');
      default: return '';
    }
  }

  function horns(kind, skin, O) {
    var bone = art('bone');
    switch (kind) {
      case 'nubs': return mirror(path('M36 32Q29 14 40 15Q45 22 45 29Z', bone, O));
      case 'ears': return mirror(path('M32 44L8 22L38 30Z', skin, O) + path('M28 36L16 27L33 31Z', art('bubblegum'), 'none', 0));
      case 'floppy': return mirror(path('M30 40Q6 42 10 68Q22 66 34 52Z', skin, O));
      case 'antenna': return mirror(path('M48 24L39 4', 'none', O, 3) + circle(39, 4, 4.5, art('toxic'), O, 2.5));
      case 'devil': return mirror(path('M38 28Q22 20 25 1Q34 14 47 21Z', bone, O));
      case 'ram': return mirror(limb('M34 32C14 26 10 52 24 56C33 58 34 47 26 46', bone, O, 6));
      case 'quad': return mirror(path('M40 26Q26 16 30 0Q37 13 48 20Z', bone, O) + path('M28 44Q12 40 10 28Q20 34 30 36Z', bone, O));
      default: return '';
    }
  }

  function clothing(kind, color, mark, O) {
    var bone = art('bone');
    var shirt = 'M30 80H90V112H30Z';
    switch (kind) {
      case 'tee': return path(shirt, color, 'none', 0) + path(star(60, 92, 5, 2, 5, -Math.PI / 2), mark, 'none', 0);
      case 'vest': return path('M30 80H55V112H30Z M65 80H90V112H65Z', color, 'none', 0);
      case 'jacket':
      case 'studded':
      case 'spiked':
        var out = path('M30 80H56V112H30Z M64 80H90V112H64Z', color, 'none', 0) +
          path('M51 80L58 94L60 84 M69 80L62 94L60 84', 'none', O, 2.5);
        if (kind !== 'jacket') out += circle(46, 86, 1.6, bone, 'none', 0) + circle(74, 86, 1.6, bone, 'none', 0) +
          circle(46, 94, 1.6, bone, 'none', 0) + circle(74, 94, 1.6, bone, 'none', 0) +
          circle(46, 102, 1.6, bone, 'none', 0) + circle(74, 102, 1.6, bone, 'none', 0);
        return out;
      default: return '';
    }
  }

  function marking(kind, color, O) {
    switch (kind) {
      case 'star': return path(star(80, 62, 5, 2, 5, -Math.PI / 2), color, O, 1.5);
      case 'x': return path('M76 58L84 66M84 58L76 66', 'none', color, 3);
      case 'bolt': return path('M80 54L75 63H80L77 70L86 60H81L84 54Z', color, O, 1.5);
      case 'crack': return path('M74 55L80 60L76 63L83 68', 'none', color, 3);
      default: return '';
    }
  }

  function accessory(kind, O, top) {
    var bone = art('bone'), ink = art('ink');
    function ring(x, y, r) { return circle(x, y, r, 'none', O, 5) + circle(x, y, r, 'none', bone, 2.5); }
    switch (kind) {
      case 'earring': return ring(29, 63, 4);
      case 'nosering': return ring(60, 57, 3);
      case 'lipring': return ring(68, 69, 3);
      case 'pin': return path('M74 28L86 36', 'none', O, 5) + path('M74 28L86 36', 'none', bone, 2.5) + circle(86, 36, 2.5, bone, O, 1.5);
      case 'chain': return path('M46 90Q60 101 74 90', 'none', O, 5) + path('M46 90Q60 101 74 90', 'none', bone, 2.5) +
        path('M46 90Q60 101 74 90', 'none', ink, 1.5).replace('stroke-width:1.5', 'stroke-width:1.5;stroke-dasharray:2 3');
      case 'collar':
        return '<rect x="43" y="84" width="34" height="6" rx="3" style="fill:' + ink + ';stroke:' + O + ';stroke-width:2"/>' +
          path('M48 84L50 79L52 84Z M58 84L60 79L62 84Z M68 84L70 79L72 84Z', bone, O, 1.2);
      case 'shades':
        return mirror(path('M33 40H56V49Q56 55 50 55H39Q33 55 33 49Z', ink, O) + path('M37 44H44', 'none', bone, 2)) +
          path('M56 44H64', 'none', O, 3);
      case 'halo':
        return '<ellipse cx="60" cy="' + (top - 7) + '" rx="18" ry="4.5" style="fill:none;stroke:' + O + ';stroke-width:6"/>' +
          '<ellipse cx="60" cy="' + (top - 7) + '" rx="18" ry="4.5" style="fill:none;stroke:' + art('lemon') + ';stroke-width:3"/>';
      default: return '';
    }
  }

  // Returns an SVG string. opts.cls sets its classes.
  function render(a, opts) {
    opts = opts || {};
    a = a || {};
    var id = 'cr' + (++uid);
    var O = a.outline === 'neon' ? art('toxic') : art('ink');
    var skin = art(a.skin, 'slime');
    var hairColor = art(a.hairColor, 'bubblegum');
    var mark = art(a.markColor, 'lemon');
    var head = HEADS[a.head] ? a.head : 'round';
    var body = BODIES[a.body] ? a.body : 'stubby';
    var dy = HEAD_TOP[head] - 16;
    var shift = function (markup) { return markup ? '<g transform="translate(0 ' + dy + ')">' + markup + '</g>' : ''; };
    var mutation = a.mutation;

    var out = '<svg viewBox="0 0 120 120" class="' + (opts.cls || 'h-24 w-24') + '" aria-hidden="true" focusable="false">' +
      '<defs><clipPath id="' + id + 'b"><path d="' + BODIES[body] + '"/></clipPath>' +
      '<filter id="' + id + 'g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5"/></filter></defs>' +
      background(a.background) +
      '<g stroke-linejoin="round" stroke-linecap="round" style="color:' + skin + '">';

    if (mutation === 'tail') out += limb('M72 100Q100 106 98 82', skin, O, 5) + path('M92 84L99 72L104 85Z', skin, O, 2.5);
    // Arms, body, clothing (clipped to the body), then the body outline again.
    out += limb('M44 88Q31 92 33 101', skin, O, 5) + limb('M76 88Q89 92 87 101', skin, O, 5);
    out += path(BODIES[body], skin, 'none', 0) +
      '<g clip-path="url(#' + id + 'b)">' + clothing(a.clothing, art(a.clothingColor, 'ink'), mark, O) + '</g>' +
      path(BODIES[body], 'none', O);
    // Punk boots.
    out += mirror(path('M43 104H57V112Q57 116 53 116H41Q37 116 38 112Z', art('ink'), O, 2.5) + path('M40 113H55', 'none', art('bone'), 1.5));

    if (mutation === 'spikes') out += path(radial([170, 195, 220, 320, 345, 10], 28, 44, 6), skin, O);
    out += shift(horns(a.horns, skin, O));
    if (mutation === 'horns') out += shift(path('M52 26L60 1L68 26Z', art('bone'), O));
    out += path(HEADS[head], skin, O);
    if (head === 'square') out += path('M44 74H76', 'none', O, 2);
    if (mutation === 'patches') {
      out += '<rect x="31" y="55" width="14" height="13" rx="2" style="fill:' + mark + ';stroke:' + O + ';stroke-width:2"/>' +
        path('M31 58H34M31 65H34M42 58H45M42 65H45M70 24L82 32M73 22L71 27M78 26L76 31', 'none', O, 2);
    }
    out += marking(a.marking, mark, O);
    out += eyes(a.eyes, art(a.eyeColor, 'toxic'), O);
    if (mutation === 'extra-eye') {
      out += shift(circle(60, 31, 5.5, art('bone'), O, 2.5) + circle(60.5, 31.5, 2.6, art('ink'), 'none', 0));
    }
    out += mouth(a.mouth, O);
    if (mutation === 'fangs') out += path('M51 64L54 77L58 65Z M69 64L66 77L62 65Z', art('bone'), O, 2);
    out += shift(hair(a.hair, hairColor, O));
    if (mutation === 'glowing-mark') {
      var rune = 'M60 24L65 30L60 36L55 30Z';
      out += shift('<g filter="url(#' + id + 'g)">' + path(rune, art('toxic'), art('toxic'), 4) + '</g>' +
        path(rune, art('toxic'), O, 1.5) + circle(60, 30, 1.5, O, 'none', 0));
    }
    out += accessory(a.accessory, O, HEAD_TOP[head]);
    return out + '</g></svg>';
  }

  window.HOMESTEAD_CREATURE_ART = { render: render };
})();
