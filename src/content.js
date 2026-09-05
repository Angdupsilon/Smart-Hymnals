/*
 * Smart Hymnals
 *
 * Adds smart tools to a hymn page: a "Multilingual" button next to the site's
 * Text / Lead Sheet group, syllable-accurate chords through every stanza, and
 * Chinese-English line alignment. Clicking the button swaps the single-column
 * lyrics for a two-column view: the page's own language on the left, a
 * translation on the right, chosen with a toggle that sits above the
 * right-hand column.
 *
 * Translations are discovered from the coloured hymn-number badges under the
 * title (`.hymn-nums`). A badge rendered as an <a> is a translation that exists
 * online; a plain <span> is a number with no page to link to. The sidebar
 * "Languages" list is used only to pick up query-string variants of those same
 * pages (Hymnal.net serves Simplified Chinese as `?gb=1`).
 *
 * The view mirrors the site's own lyric controls: the Text / Lead Sheet pair
 * and the Repeat Chorus, Show Chords and Repeat Chords checkboxes beneath
 * them. Lead Sheet is an engraved image with no second-language equivalent,
 * so the button greys out there.
 */

(function () {
  'use strict';

  if (window.__hymnalMultilingualLoaded) return;
  window.__hymnalMultilingualLoaded = true;

  var PREF_KEY = 'hymnalMultilingualPrefs';
  var pageCache = new Map();

  /* ------------------------------------------------------------------ *
   * Lyric extraction
   * ------------------------------------------------------------------ */

  /**
   * Read a `.text-container` into an array of lines, treating <br> as the
   * line break. Text is taken as text nodes only, never as HTML, so nothing
   * from a fetched page is ever injected as markup.
   */
  function extractLines(el) {
    var lines = [];
    var current = '';

    (function walk(node) {
      for (var i = 0; i < node.childNodes.length; i++) {
        var child = node.childNodes[i];
        if (child.nodeType === Node.TEXT_NODE) {
          current += child.nodeValue;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          if (child.tagName === 'BR') {
            lines.push(current);
            current = '';
          } else {
            walk(child);
          }
        }
      }
    })(el);
    lines.push(current);

    // Non-breaking spaces carry the indentation of chorus lines, so they are
    // converted rather than stripped. Only trailing whitespace is trimmed.
    lines = lines.map(function (line) {
      return line.replace(/\u00a0/g, ' ').replace(/\s+$/, '');
    });

    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return lines;
  }

  /**
   * Read a `.chord-container` into lines of {chord, text} segments.
   *
   * The site writes a chorded line as a run of `.chord-text` blocks -- each
   * holding a `.chord` span followed by the words it sits over -- interleaved
   * with bare text for the stretches that carry no chord. Only the first verse
   * and first chorus are marked up this way; every other stanza repeats the
   * plain words, which is why `null` here means "this stanza has no chords".
   */
  function extractChordLines(container) {
    var lineEls = container.querySelectorAll('.line');
    if (!lineEls.length || !container.querySelector('.chord')) return null;

    var lines = [];
    for (var i = 0; i < lineEls.length; i++) {
      var segments = [];

      for (var j = 0; j < lineEls[i].childNodes.length; j++) {
        var node = lineEls[i].childNodes[j];

        // A segment carrying neither a chord nor a word is nothing at all: the
        // markup is pretty-printed, so the gaps between its blocks are newlines
        // that clean() has just taken away.
        if (node.nodeType === Node.TEXT_NODE) {
          var between = clean(node.nodeValue);
          if (between) segments.push({ chord: '', text: between });
          continue;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        var name = '';
        var text = '';

        if (node.classList && node.classList.contains('chord-text')) {
          var chordEl = node.querySelector('.chord');
          if (chordEl) name = chordName(chordEl);
          for (var k = 0; k < node.childNodes.length; k++) {
            if (node.childNodes[k] !== chordEl) text += node.childNodes[k].textContent;
          }
          text = clean(text);
        } else {
          text = clean(node.textContent);
        }

        if (name || text) segments.push({ chord: name, text: text });
      }

      if (segments.length) lines.push(segments);
    }

    return lines.length ? lines : null;
  }

  /**
   * The site pretty-prints its chord markup, so a segment's text arrives
   * wrapped in newlines and indentation that are formatting rather than lyric
   * -- the spacing that matters is written as `&nbsp;`. Those newlines go
   * first, before the non-breaking spaces become ordinary ones: `\s` matches a
   * non-breaking space too, so stripping in the other order would eat the very
   * spaces that hold a chord over its own syllable.
   */
  function clean(text) {
    return text.replace(/[ \t]*[\r\n]+[ \t]*/g, '').replace(/\u00a0/g, ' ');
  }

  /**
   * A chord's name. The site sets the quality as a superscript -- `A<sup>7</sup>`
   * -- so the element's text arrives with the markup's own line breaks around
   * it; they are collapsed here, since `.hn-chord` is set `pre` and would
   * otherwise break a name across two lines.
   */
  function chordName(el) {
    return el.textContent.replace(/\s+/g, ' ').trim();
  }

  /**
   * Collect the stanzas of a hymn document.
   *
   * Rows marked `js-duplicate-row` are the repeated choruses that the site
   * reveals only with Repeat Chorus ticked, so `withRepeats` decides whether to
   * keep them and the panel matches whatever the page is showing.
   *
   * Each stanza gets a key -- "v3" for verse 3, "c0" for the first chorus --
   * which is what lets two languages with different verse counts line up.
   */
  function parseStanzas(root, withRepeats) {
    var article = root.querySelector('article.js-stanzas');
    if (!article) return null;

    var stanzas = [];
    var chorusIndex = 0;
    var nodes = article.querySelectorAll('.verse');

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!withRepeats && node.classList.contains('js-duplicate-row')) continue;

      var textEl = node.querySelector('.text-container');
      if (!textEl) continue;

      var lines = extractLines(textEl);
      if (!lines.length) continue;

      var type = node.getAttribute('data-type') || 'verse';
      var numEl = node.querySelector('.verse-num');
      var num = numEl ? numEl.textContent.trim() : '';
      // Never a container this extension has rewritten: those keep the site's
      // own markup parked in a hidden child, which reads back as chordless
      // lines and would stand in for the repeats that belong there.
      var chordEl = node.querySelector('.chord-container:not(.hn-injected)');
      var key;

      if (type === 'chorus') {
        key = 'c' + chorusIndex++;
      } else if (num) {
        key = 'v' + num;
      } else {
        key = 'x' + stanzas.length;
      }

      stanzas.push({
        type: type,
        num: num,
        lines: lines,
        key: key,
        chordLines: chordEl ? extractChordLines(chordEl) : null
      });
    }

    return stanzas.length ? stanzas : null;
  }

  /**
   * Pair up two stanza lists by key so matching verses sit on the same row.
   * Where one language has a stanza the other lacks (English 787 has four
   * verses, Chinese 572 has five) the missing side becomes an empty cell.
   */
  function alignStanzas(left, right) {
    var leftKeys = left.map(function (s) { return s.key; });
    var rightKeys = right.map(function (s) { return s.key; });
    var rows = [];
    var i = 0;
    var j = 0;

    while (i < left.length || j < right.length) {
      if (i >= left.length) { rows.push([null, right[j++]]); continue; }
      if (j >= right.length) { rows.push([left[i++], null]); continue; }

      if (left[i].key === right[j].key) {
        rows.push([left[i++], right[j++]]);
        continue;
      }

      // Look ahead: whichever side is "behind" gets an empty cell opposite it.
      var inRight = rightKeys.indexOf(left[i].key, j);
      var inLeft = leftKeys.indexOf(right[j].key, i);

      if (inRight !== -1 && (inLeft === -1 || inRight - j <= inLeft - i)) {
        rows.push([null, right[j++]]);
      } else if (inLeft !== -1) {
        rows.push([left[i++], null]);
      } else {
        rows.push([left[i++], right[j++]]);
      }
    }

    return rows;
  }

  /* ------------------------------------------------------------------ *
   * Syllables
   *
   * Hymn stanzas share a metre -- 787 is 10.9.10.9 -- so the nth syllable of
   * a line falls on the same note in every stanza. That makes the syllable
   * index the right coordinate for carrying chords from the first stanza to
   * the rest. Chinese is exact here, one character to a syllable; English is
   * estimated from vowel groups, which is approximate but self-consistent,
   * since the same estimate is applied to the stanza the chords come from and
   * the stanza they land on.
   *
   * The work itself lives in src/chords.js, since the Songbase script asks the
   * same question of quite different markup.
   * ------------------------------------------------------------------ */

  var buildChordLines = window.SmartHymnalsChords.buildChordLines;

  /* ------------------------------------------------------------------ *
   * Transposing
   *
   * The site's key buttons retune every `.chord` in the document, which covers
   * what this extension renders too. The one gap is the translation column:
   * it is parsed out of a separately fetched page, so its chords arrive in
   * that page's own printed key and have to be shifted to whatever key this
   * page is currently showing before they are drawn.
   * ------------------------------------------------------------------ */

  var SHARP_SCALE = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  var FLAT_SCALE = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
  var FLAT_KEYS = ['F', 'B♭', 'E♭', 'A♭', 'D♭', 'G♭', 'C♭'];

  function noteIndex(note) {
    var base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[note.charAt(0).toUpperCase()];
    if (base === undefined) return -1;
    var accidental = note.charAt(1);
    if (accidental === '♯' || accidental === '#') base += 1;
    else if (accidental === '♭' || accidental === 'b') base -= 1;
    return (base + 12) % 12;
  }

  /** "D Major" -> the root note "D". */
  function keyRoot(text) {
    return (text || '').trim().split(/\s+/)[0] || '';
  }

  function transposeChordName(name, delta, useFlats) {
    if (!name || !delta) return name;
    var scale = useFlats ? FLAT_SCALE : SHARP_SCALE;
    // Split on "/" so a slash chord's bass note moves with its root.
    return name.split('/').map(function (part) {
      return part.replace(/^(\s*)([A-G])([♯♭#b]?)/, function (whole, space, letter, accidental) {
        var index = noteIndex(letter + accidental);
        if (index < 0) return whole;
        return space + scale[(index + delta) % 12];
      });
    }).join('/');
  }

  function transposeLines(chordLines, delta, useFlats) {
    if (!chordLines || !delta) return chordLines;
    return chordLines.map(function (segments) {
      return segments.map(function (segment) {
        return { chord: transposeChordName(segment.chord, delta, useFlats), text: segment.text };
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * Smart alignment
   *
   * Chinese sets the same thought in more, shorter lines than English: verse 1
   * of hymn 787 is four English lines against seven Chinese ones, because a
   * single English line is often carried by a comma-joined pair such as
   * "我所有苦況，" + "必須告訴主，". Merging those pairs back together makes the
   * two columns line up thought for thought.
   *
   * Which pairs to merge is chosen by weighing the lines rather than guessing
   * from punctuation alone -- every line here ends in a comma, so punctuation
   * cannot tell the joins from the breaks. Instead the Chinese lines are cut
   * into exactly as many groups as there are lines opposite, picking the cut
   * that makes each group's share of the stanza closest to the share of the
   * line it faces. Punctuation then acts as a guard rail: a full stop or
   * semicolon ends a thought, so merging across one is penalised heavily.
   * ------------------------------------------------------------------ */

  /** Rough spoken weight of a line: characters, ignoring punctuation. */
  function lineWeight(text) {
    var stripped = text.replace(/[\s，。；：！？、,.;:!?'"‘’“”()（）\-—]/g, '');
    return stripped.length || 1;
  }

  /** How costly it is to merge the line ending in this text into the next. */
  function mergePenalty(text, total) {
    var trimmed = text.replace(/\s+$/, '');
    var last = trimmed.charAt(trimmed.length - 1);
    if (last === '') return 0;
    if ('。！？.!?'.indexOf(last) !== -1) return Math.pow(0.40 * total, 2);
    if ('；;'.indexOf(last) !== -1) return Math.pow(0.15 * total, 2);
    return 0;
  }

  /**
   * Choose how to group `lines` into exactly `other.length` runs, matching each
   * run's weight to the line it will face. Returns [start, end) pairs, or null
   * when there is nothing to gain.
   */
  function smartCuts(lines, other) {
    var groups = other.length;
    var n = lines.length;
    if (!groups || n <= groups) return null;

    var w = lines.map(lineWeight);
    var total = w.reduce(function (a, b) { return a + b; }, 0);
    var otherWeights = other.map(lineWeight);
    var otherTotal = otherWeights.reduce(function (a, b) { return a + b; }, 0) || 1;

    // What each group should weigh, as its opposite's share of the stanza.
    var target = otherWeights.map(function (x) { return x / otherTotal * total; });

    var i, k, a, b;
    var prefix = [0];
    for (i = 0; i < n; i++) prefix.push(prefix[i] + w[i]);

    // penaltyPrefix[i] = cost of merging across every boundary before line i.
    var penaltyPrefix = [0];
    for (i = 1; i <= n - 1; i++) {
      penaltyPrefix[i] = penaltyPrefix[i - 1] + mergePenalty(lines[i - 1], total);
    }

    var dp = [];
    var back = [];
    for (k = 0; k <= groups; k++) {
      dp.push(new Array(n + 1).fill(Infinity));
      back.push(new Array(n + 1).fill(-1));
    }
    dp[0][0] = 0;

    for (k = 1; k <= groups; k++) {
      for (b = k; b <= n - (groups - k); b++) {
        for (a = k - 1; a < b; a++) {
          if (dp[k - 1][a] === Infinity) continue;
          var diff = (prefix[b] - prefix[a]) - target[k - 1];
          var cost = dp[k - 1][a] + diff * diff + (penaltyPrefix[b - 1] - penaltyPrefix[a]);
          if (cost < dp[k][b]) {
            dp[k][b] = cost;
            back[k][b] = a;
          }
        }
      }
    }

    if (dp[groups][n] === Infinity) return null;

    var cuts = [];
    var end = n;
    for (k = groups; k >= 1; k--) {
      var start = back[k][end];
      cuts.unshift([start, end]);
      end = start;
    }
    return cuts;
  }

  /* ------------------------------------------------------------------ *
   * Language discovery
   * ------------------------------------------------------------------ */

  function sameOrigin(url) {
    try {
      return new URL(url, location.href).origin === location.origin;
    } catch (e) {
      return false;
    }
  }

  function absolute(href) {
    return new URL(href, location.href).href;
  }

  function isSimplified(url) {
    return new URL(url, location.href).searchParams.get('gb') === '1';
  }

  /** The hymnal a URL belongs to: "h" English, "ch" Chinese, "ht" Tagalog... */
  function collectionOf(url) {
    var match = new URL(url, location.href).pathname.match(/\/hymn\/([^\/]+)\//);
    return match ? match[1] : '';
  }

  function describe(url, label, code) {
    return {
      url: url,
      label: label,
      code: code,
      collection: collectionOf(url),
      gb: isSimplified(url),
      chinese: collectionOf(url) === 'ch'
    };
  }

  /**
   * Build the list of translations offered for this hymn.
   *
   * Primary source: the badges under the title. Secondary source: sidebar
   * links whose path matches a badge we already found, which is how the
   * Simplified Chinese `?gb=1` variant is picked up. Matching on path keeps
   * "Relevant" and "See Also" links (different hymns) out of the list, without
   * depending on the sidebar's English label text.
   */
  function discoverLanguages() {
    var byUrl = new Map();
    var paths = new Map();

    var badges = document.querySelectorAll('.hymn-nums a.label[href]');
    for (var i = 0; i < badges.length; i++) {
      var a = badges[i];
      var href = a.getAttribute('href');
      if (!href || !sameOrigin(href)) continue;

      var url = absolute(href);
      var label = (a.getAttribute('title') || '').trim() || a.textContent.trim();
      var entry = describe(url, label, a.textContent.trim());
      byUrl.set(url, entry);
      paths.set(new URL(url).pathname, entry);
    }

    if (!byUrl.size) return [];

    var sidebar = document.querySelectorAll('.hymn-related-songs a[href]');
    for (var k = 0; k < sidebar.length; k++) {
      var link = sidebar[k];
      var raw = link.getAttribute('href');
      if (!raw || !sameOrigin(raw)) continue;

      var full = absolute(raw);
      if (byUrl.has(full)) continue;

      var base = paths.get(new URL(full).pathname);
      if (!base) continue; // a different hymn, not a translation of this one

      if (isSimplified(full)) {
        // Same page, different script. Qualify both so the toggle is unambiguous.
        var stem = base.label;
        base.label = stem + ' (Traditional)';
        byUrl.set(full, describe(full, stem + ' (Simplified)', base.code));
      } else {
        byUrl.set(full, describe(full, link.textContent.trim(), base.code));
      }
    }

    return Array.from(byUrl.values());
  }

  /** The language of the page we are already on, for the left-hand heading. */
  function currentSide() {
    var active = document.querySelector('.hymn-nums .label-success');
    var label = active ? (active.getAttribute('title') || '').trim() : '';
    if (!label) label = 'Original';
    if (isSimplified(location.href)) label += ' (Simplified)';
    return describe(location.href, label, active ? active.textContent.trim() : '');
  }

  /* ------------------------------------------------------------------ *
   * The site's lyric controls
   *
   * Hymnal.net used to offer five formats -- Text, Text+, Chords, Piano and
   * Guitar -- as one button group, so a single reading of `.active` said
   * everything about what the page was showing. It now offers two buttons and
   * three checkboxes: Piano and Guitar became one transposable Lead Sheet,
   * Text+ became "Repeat Chorus", Chords became "Show Chords", and the site
   * grew a "Repeat Chords" of its own. Format and toggles are therefore read
   * separately, and always from the page rather than from a copy kept here,
   * so the panel mirrors whatever the reader has switched on.
   * ------------------------------------------------------------------ */

  /** The site's format buttons, by the class each one carries. */
  var FORMAT_BUTTONS = { text: 'text', leadsheet: 'score' };

  function currentFormat() {
    var active = document.querySelector('.lyrics-format button.active');
    if (active) {
      for (var format in FORMAT_BUTTONS) {
        if (active.classList.contains(FORMAT_BUTTONS[format])) return format;
      }
    }
    try {
      if (FORMAT_BUTTONS[localStorage.lyricsFormat]) return localStorage.lyricsFormat;
    } catch (e) { /* localStorage may be unavailable */ }
    return 'text';
  }

  /**
   * One of the site's lyric checkboxes. The element is the truth once the page
   * has run, since the site ticks the boxes from localStorage on load; reading
   * the same key is the fallback for the moment before that, and for a page
   * that renders no toggle row at all.
   */
  function siteToggle(selector, storageKey) {
    var box = document.querySelector(selector);
    if (box) return box.checked;
    try {
      return localStorage[storageKey] === 'true';
    } catch (e) {
      return false;
    }
  }

  function showChords() { return siteToggle('.toggle-show-chords', 'showChords'); }
  function repeatChorus() { return siteToggle('.toggle-repeat-chorus', 'repeatChorus'); }
  function repeatChords() { return siteToggle('.toggle-repeat-chords', 'repeatChords'); }

  /** Lead Sheet is an engraved image, so only Text has a two-column form. */
  function isSupportedFormat(format) {
    return format === 'text';
  }

  /* ------------------------------------------------------------------ *
   * Fetching a translation
   * ------------------------------------------------------------------ */

  function loadTranslation(url) {
    if (pageCache.has(url)) return Promise.resolve(pageCache.get(url));

    return fetch(url, { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var plain = parseStanzas(doc, false);
        if (!plain) throw new Error('No lyrics found on that page.');

        var titleEl = doc.querySelector('#song-title, #song-title-xs');
        // No scripts run on a parsed document, so its chords are still in the
        // key the page was printed in -- `#fromkeysig`, not `#keysig`.
        var keyEl = doc.querySelector('#fromkeysig') || doc.querySelector('#keysig');
        var data = {
          plain: plain,
          repeat: parseStanzas(doc, true) || plain,
          title: titleEl ? titleEl.textContent.trim() : '',
          key: keyEl ? keyRoot(keyEl.textContent) : ''
        };
        pageCache.set(url, data);
        return data;
      });
  }

  /* ------------------------------------------------------------------ *
   * Preferences
   * ------------------------------------------------------------------ */

  function readPrefs() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(PREF_KEY, function (items) {
          if (chrome.runtime.lastError) return resolve({});
          resolve((items && items[PREF_KEY]) || {});
        });
      } catch (e) {
        resolve({});
      }
    });
  }

  function writePrefs(prefs) {
    try {
      var payload = {};
      payload[PREF_KEY] = prefs;
      chrome.storage.local.set(payload, function () {
        void chrome.runtime.lastError;
      });
    } catch (e) { /* storage unavailable; preferences simply are not persisted */ }
  }

  /* ------------------------------------------------------------------ *
   * Rendering
   * ------------------------------------------------------------------ */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /**
   * One line of chorded lyrics: each chord stacked over the words it covers.
   *
   * A chord that actually exists is given the site's own `chord` class as well.
   * The site transposes with `$(".chord").each(...)` across the whole document,
   * so tagging them this way lets its key up/down buttons retune everything
   * this extension draws, in both columns, with no extra wiring. Empty
   * placeholders are left untagged so they are not fed to its parser.
   */
  /**
   * A chord name written the way chord symbols are set: the quality raised, so
   * "G7" reads G with a superscript seven. It is what the site does with its
   * own chords, and a stanza chorded here sits directly beneath those.
   */
  function chordSymbol(name) {
    var fragment = document.createDocumentFragment();
    var digits = /\d+/g;
    var position = 0;
    var match;

    while ((match = digits.exec(name))) {
      if (match.index > position) {
        fragment.appendChild(document.createTextNode(name.slice(position, match.index)));
      }
      fragment.appendChild(el('sup', null, match[0]));
      position = match.index + match[0].length;
    }
    if (position < name.length) fragment.appendChild(document.createTextNode(name.slice(position)));

    return fragment;
  }

  /**
   * One segment split into a cell per word, the chord staying on the word it
   * was struck over. A cell is the smallest thing the line can wrap between,
   * so splitting here is what lets a long chordless stretch break at a space
   * instead of running off a narrow screen.
   */
  function wordCells(segment) {
    var tokens = segment.text.match(/\S+\s*|\s+/g) || [''];
    return tokens.map(function (token, i) {
      return { chord: i === 0 ? (segment.chord || '') : '', text: token };
    });
  }

  function renderChordLine(segments) {
    var line = el('div', 'hn-cline');
    var cells = [];
    var group = null;
    var i;

    for (i = 0; i < segments.length; i++) cells = cells.concat(wordCells(segments[i]));

    for (i = 0; i < cells.length; i++) {
      if (!cells[i].chord && !cells[i].text) continue;
      if (!group) {
        group = el('div', 'hn-grp');
        line.appendChild(group);
      }

      var name = cells[i].chord;
      // Room after a name only where another chord follows close enough to run
      // into it ("BmD"). Everywhere else the lyrics keep their own spacing,
      // rather than being pushed apart to make room for nothing.
      var crowded = name && cells[i + 1] && cells[i + 1].chord;
      var chord = el('span', (name ? 'chord hn-chord' : 'hn-chord') + (crowded ? ' hn-chord-gap' : ''));
      if (name) chord.appendChild(chordSymbol(name));

      var cell = el('div', 'hn-seg');
      cell.appendChild(chord);
      cell.appendChild(el('span', 'hn-word', cells[i].text));
      group.appendChild(cell);

      // A chord can land inside a word ("a|lone", "Je|sus"), which splits it
      // into two cells. The line may only wrap where a cell ended on
      // whitespace, so a word is never broken across two lines.
      if (/\s$/.test(cells[i].text)) group = null;
    }

    return line;
  }

  function renderStanza(stanza, lines, chordLines) {
    var cell = el('div', 'hn-cell');
    if (!stanza) {
      cell.classList.add('hn-cell-empty');
      return cell;
    }

    var marker = el('div', 'hn-num');
    if (stanza.type === 'verse' && stanza.num) {
      marker.appendChild(el('span', 'hn-num-badge', stanza.num));
    }
    cell.appendChild(marker);

    var body = el('div', 'hn-text' + (stanza.type === 'chorus' ? ' hn-chorus' : ''));
    var i;
    if (chordLines) {
      for (i = 0; i < chordLines.length; i++) body.appendChild(renderChordLine(chordLines[i]));
    } else {
      for (i = 0; i < lines.length; i++) body.appendChild(el('div', 'hn-line', lines[i] || ' '));
    }
    cell.appendChild(body);
    return cell;
  }

  /* ------------------------------------------------------------------ *
   * Sharpening the site's repeated chords
   *
   * Hymnal.net now carries verse one's chords through the later stanzas
   * itself, rendering them into a second `.repeat-chord-container` beside each
   * stanza's plain one and swapping the two with its "Repeat Chords" box. It
   * places them by word, though, so a chord falling inside a word lands at the
   * start of it and two chords sharing a word are printed together: verse 2 of
   * 787 comes out "[A]He will [Bm D]deliver," where the metre puts them on
   * "de[Bm]li[D]ver,".
   *
   * This extension places chords by syllable, which is the coordinate stanzas
   * of a shared metre actually have in common. Rather than offering a second
   * control saying the same thing as the site's, it rewrites the site's own
   * containers in place: the site's checkbox stays in charge of whether the
   * repeats show at all, and only their placement changes.
   * ------------------------------------------------------------------ */

  function siteStanzas() {
    var article = document.querySelector('.hymn-content .lyrics article.js-stanzas');
    return article ? article.querySelectorAll('.verse') : [];
  }

  /**
   * Where a stanza's repeated chords should be drawn, or null for the stanzas
   * that need none -- the ones the site chorded from the hymnal itself.
   */
  function repeatTarget(verse) {
    var repeat = verse.querySelector('.repeat-chord-container');
    if (repeat) return repeat;
    // Not every hymn gets a repeat container: where the site has none it
    // leaves the plain container on show instead, and chords can go there so
    // long as it is one the site did not chord itself.
    var plain = verse.querySelector('.chord-container');
    return plain && !plain.querySelector('.chord') ? plain : null;
  }

  /**
   * Put a container back the way the site rendered it.
   *
   * The originals are parked in a hidden child rather than detached, because
   * the site transposes with a document-wide `$(".chord").each(...)`: a
   * detached copy would sit out every key change and come back in the wrong
   * key, while a hidden one is retuned along with everything else.
   */
  function restoreContainer(container) {
    var keep = null;
    var child = container.firstChild;

    while (child) {
      var next = child.nextSibling;
      if (child.nodeType === Node.ELEMENT_NODE && child.classList.contains('hn-original')) keep = child;
      else container.removeChild(child);
      child = next;
    }

    if (keep) {
      while (keep.firstChild) container.insertBefore(keep.firstChild, keep);
      container.removeChild(keep);
    }
    container.classList.remove('hn-injected');
  }

  function refineRepeatChords(enable) {
    var verses = siteStanzas();
    var templates = {};
    var i, verse, target, type;

    // Templates come only from the stanzas the site chorded from the hymnal --
    // the first verse and the first chorus -- never from one written here.
    for (i = 0; i < verses.length; i++) {
      var source = verses[i].querySelector('.chord-container:not(.repeat-chord-container)');
      if (!source || source.classList.contains('hn-injected')) continue;
      type = verses[i].getAttribute('data-type') || 'verse';
      if (templates[type]) continue;
      var parsed = extractChordLines(source);
      if (parsed) templates[type] = parsed;
    }

    for (i = 0; i < verses.length; i++) {
      verse = verses[i];
      target = repeatTarget(verse);
      if (!target) continue;
      type = verse.getAttribute('data-type') || 'verse';

      if (target.classList.contains('hn-injected')) {
        if (!enable) restoreContainer(target);
        continue;
      }

      if (!enable || !templates[type]) continue;

      var textEl = verse.querySelector('.text-container');
      var lines = textEl ? extractLines(textEl) : null;
      if (!lines || !lines.length) continue;

      var keep = el('div', 'hn-original hn-hidden');
      while (target.firstChild) keep.appendChild(target.firstChild);
      target.appendChild(keep);

      var built = buildChordLines(lines, templates[type]);
      for (var k = 0; k < built.length; k++) target.appendChild(renderChordLine(built[k]));
      target.classList.add('hn-injected');
    }
  }

  /**
   * Follow the site's "Repeat Chords" box for as long as the page lives.
   *
   * Kept apart from the panel because it applies to every hymn, including the
   * ones with nothing to translate into -- and because it belongs to the
   * site's own chord sheet rather than to the two-column view.
   */
  function followRepeatChords() {
    var box = document.querySelector('.toggle-repeat-chords');
    // The site has already ticked its boxes from localStorage by now, so the
    // repeats it is showing can be sharpened straight away.
    refineRepeatChords(repeatChords());
    if (box) {
      box.addEventListener('change', function () { refineRepeatChords(box.checked); });
    }
  }

  function build() {
    var formatRow = document.querySelector('.row.text-center .lyrics-format');
    var hymnContent = document.querySelector('.hymn-content');
    if (!hymnContent) return;

    /* What the panel stands in for while it is open.
     *
     * Only the single-column lyrics, never the whole `.hymn-content` -- the
     * lead sheet is their sibling inside it, and the site sizes its engraving
     * once, from `$(".leadsheet").width()` read the moment the button is
     * pressed. The site's own handler runs before this extension's, so hiding
     * the block would have that measurement taken inside `display: none`: the
     * sheet came out 30px wide and stayed there, since nothing re-measures it
     * afterwards. Hiding the lyrics alone leaves the block laid out, and the
     * site keeps `hidden` on everything else in it anyway. */
    var siteLyrics = hymnContent.querySelector('.lyrics') || hymnContent;

    followRepeatChords();

    var languages = discoverLanguages();
    if (!languages.length) return; // nothing to compare against

    var here = currentSide();

    /* -------- the Multilingual button -------- *
     * Deliberately placed outside `.lyrics-format`: Hymnal.net binds its own
     * handler to `.lyrics-format button` and clears `.active` on all of them.
     */
    var group = el('div', 'btn-group hn-multi-group');
    var button = el('button', 'btn btn-default hn-multi-btn', 'Multilingual');
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    group.appendChild(button);

    /* Everything this extension adds is gathered into one strip, set off from
     * the site's own format buttons by a divider, so it reads as belonging to
     * the extension rather than to Hymnal.net. The feedback link sits here for
     * the same reason -- and because down in the panel it was both hard to
     * find and easy to mistake for part of the site. */
    var controls = el('span', 'hn-controls');
    controls.appendChild(group);

    var feedback = buildFeedback();
    controls.appendChild(feedback.toggle);

    var row = formatRow && formatRow.parentNode ? formatRow.parentNode : null;
    if (row) {
      row.appendChild(controls);
      // The form drops in under the strip that opened it -- below the site's
      // own toggle row, where that follows, rather than splitting the two.
      var toggleRow = document.querySelector('.text-toggles');
      var after = toggleRow && toggleRow.parentNode === row.parentNode ? toggleRow : row;
      row.parentNode.insertBefore(feedback.form, after.nextSibling);
    } else {
      hymnContent.parentNode.insertBefore(controls, hymnContent);
      hymnContent.parentNode.insertBefore(feedback.form, hymnContent);
    }

    /* -------- the side-by-side panel -------- *
     * A sibling of `.hymn-content`, not a child, because the site hides
     * `.hymn-content > div` whenever a format button is pressed.
     */
    var panel = el('div', 'hn-multi-panel hn-hidden');
    var grid = el('div', 'hn-grid');

    var leftHead = el('div', 'hn-head hn-head-left');
    leftHead.appendChild(el('span', 'hn-head-label', here.label));

    // The transpose control used to be borrowed into this heading, because it
    // sat inside .hymn-content and went away with it when the panel opened. It
    // now lives up in the site's own format row, which stays on show, so it is
    // left where it is -- and left to the site to hide and reveal. Every chord
    // drawn here still carries the site's `chord` class, so one press of it
    // retunes both columns along with the page.

    var rightHead = el('div', 'hn-head hn-head-right');
    var select = el('select', 'hn-select');
    select.setAttribute('aria-label', 'Translation language');
    for (var i = 0; i < languages.length; i++) {
      var option = el('option', null, languages[i].label);
      option.value = languages[i].url;
      select.appendChild(option);
    }
    rightHead.appendChild(select);

    var smartWrap = el('label', 'hn-toggle hn-hidden');
    var smartBox = document.createElement('input');
    smartBox.type = 'checkbox';
    smartBox.className = 'hn-smart-box';
    smartWrap.appendChild(smartBox);
    smartWrap.appendChild(el('span', null, 'Smart align'));
    smartWrap.title = 'Merge short Chinese lines so they line up with the longer lines opposite.';
    rightHead.appendChild(smartWrap);

    var status = el('div', 'hn-status');
    var body = el('div', 'hn-body');

    grid.appendChild(leftHead);
    grid.appendChild(rightHead);
    grid.appendChild(status);
    grid.appendChild(body);
    panel.appendChild(grid);

    hymnContent.parentNode.insertBefore(panel, hymnContent.nextSibling);

    /* -------- behaviour -------- */

    var isOpen = false;
    // What the reader last asked for, which is not the same as `isOpen`: the
    // panel also closes on its own in Piano and Guitar mode. Only a click on
    // the button moves this, so it is what carries over to the next hymn.
    var wantOpen = false;
    var userToggled = false;
    var requestToken = 0;
    var originalByMode = {};

    function selected() {
      return languages.filter(function (l) { return l.url === select.value; })[0] || languages[0];
    }

    /** Which column holds Chinese, if either. Null means no smart align. */
    function chineseSide() {
      if (here.chinese) return 'left';
      if (selected() && selected().chinese) return 'right';
      return null;
    }

    function refreshToggles() {
      smartWrap.classList.toggle('hn-hidden', chineseSide() === null);
    }

    /**
     * Which reading of the stanzas the panel is showing: "repeat" keeps the
     * site's `js-duplicate-row` choruses, so the chorus follows every verse,
     * and "plain" drops them. It tracks the site's own Repeat Chorus box.
     */
    function stanzaSet() {
      return repeatChorus() ? 'repeat' : 'plain';
    }

    function originalStanzas() {
      var set = stanzaSet();
      if (!originalByMode[set]) originalByMode[set] = parseStanzas(document, set === 'repeat');
      return originalByMode[set];
    }

    function setStatus(message, isError) {
      status.textContent = message || '';
      status.classList.toggle('hn-error', !!isError);
      status.classList.toggle('hn-hidden', !message);
    }

    /** The stanza whose chords the rest of that kind borrow. */
    function chordTemplate(stanzas, type) {
      for (var s = 0; s < stanzas.length; s++) {
        if (stanzas[s].type === type && stanzas[s].chordLines) return stanzas[s];
      }
      return null;
    }

    /**
     * Chord lines for a stanza: its own if the page supplies them, otherwise
     * the template's chords re-hung over its words -- but only when the site's
     * "Repeat Chords" is on, since otherwise it prints the bare words.
     */
    function chordLinesFor(stanza, template) {
      if (stanza.chordLines) return stanza.chordLines;
      if (!repeatChords() || !template || !template.chordLines) return null;

      return buildChordLines(stanza.lines, template.chordLines);
    }

    /** Apply a smart-align grouping to plain lines and to chord lines alike. */
    function applyCuts(cuts, lines, chordLines) {
      var merged = cuts.map(function (cut) {
        return lines.slice(cut[0], cut[1]).join('');
      });
      var mergedChords = null;
      if (chordLines && chordLines.length === lines.length) {
        mergedChords = cuts.map(function (cut) {
          var segments = [];
          for (var i = cut[0]; i < cut[1]; i++) segments = segments.concat(chordLines[i]);
          return segments;
        });
      }
      return { lines: merged, chordLines: mergedChords || chordLines };
    }

    function render(translation) {
      body.textContent = '';

      var chordsMode = showChords();
      var leftStanzas = originalStanzas();
      var rightStanzas = translation[stanzaSet()];
      var rows = alignStanzas(leftStanzas, rightStanzas);
      var side = smartBox.checked ? chineseSide() : null;

      // The left column is parsed from the live page, so it is already in
      // whatever key the reader has transposed to. The right column came from
      // a separately fetched page and has to be shifted to match.
      var liveKey = document.querySelector('#keysig');
      var nowKey = liveKey ? keyRoot(liveKey.textContent) : '';
      var fromKey = translation.key || '';
      var shift = 0;
      var useFlats = FLAT_KEYS.indexOf(nowKey) !== -1;
      if (chordsMode && nowKey && fromKey) {
        var a = noteIndex(nowKey);
        var b = noteIndex(fromKey);
        if (a >= 0 && b >= 0) shift = (a - b + 12) % 12;
      }

      var templates = {
        left: { verse: chordTemplate(leftStanzas, 'verse'), chorus: chordTemplate(leftStanzas, 'chorus') },
        right: { verse: chordTemplate(rightStanzas, 'verse'), chorus: chordTemplate(rightStanzas, 'chorus') }
      };

      for (var r = 0; r < rows.length; r++) {
        var left = rows[r][0];
        var right = rows[r][1];

        var leftLines = left ? left.lines : [];
        var rightLines = right ? right.lines : [];
        var leftChords = chordsMode && left ? chordLinesFor(left, templates.left[left.type]) : null;
        var rightChords = chordsMode && right ? chordLinesFor(right, templates.right[right.type]) : null;
        if (rightChords && shift) rightChords = transposeLines(rightChords, shift, useFlats);

        // Merging needs both sides present to know how many lines to aim for.
        if (side && left && right) {
          var from = side === 'left' ? left : right;
          var against = side === 'left' ? right : left;
          var cuts = smartCuts(from.lines, against.lines);
          if (cuts) {
            var applied = applyCuts(cuts, from.lines, side === 'left' ? leftChords : rightChords);
            if (side === 'left') {
              leftLines = applied.lines;
              leftChords = applied.chordLines;
            } else {
              rightLines = applied.lines;
              rightChords = applied.chordLines;
            }
          }
        }

        var row = el('div', 'hn-row');
        row.appendChild(renderStanza(left, leftLines, leftChords));
        row.appendChild(renderStanza(right, rightLines, rightChords));
        body.appendChild(row);
      }
    }

    function show() {
      var url = select.value;
      var token = ++requestToken;
      setStatus('Loading translation…', false);

      loadTranslation(url)
        .then(function (data) {
          if (token !== requestToken) return; // a newer selection won
          setStatus('', false);
          render(data);
        })
        .catch(function (err) {
          if (token !== requestToken) return;
          body.textContent = '';
          setStatus('Could not load that translation. ' + (err && err.message ? err.message : ''), true);
        });
    }

    function open() {
      if (!originalStanzas()) {
        setStatus('No lyrics found on this page.', true);
        return;
      }
      isOpen = true;
      button.classList.add('hn-on');
      button.setAttribute('aria-pressed', 'true');
      siteLyrics.classList.add('hn-hidden');
      panel.classList.remove('hn-hidden');
      refreshToggles();
      resyncColumnToggle();
      show();
    }

    function close() {
      isOpen = false;
      requestToken++;
      button.classList.remove('hn-on');
      button.setAttribute('aria-pressed', 'false');
      siteLyrics.classList.remove('hn-hidden');
      panel.classList.add('hn-hidden');
      resyncColumnToggle();
    }

    /**
     * Nudge the site into re-deciding whether its one/two-column control
     * applies. That control belongs to the single-column lyrics, which are
     * hidden while the panel is open; the site works out whether to offer it
     * by measuring them, and only ever re-measures on a window resize. Firing
     * one is how it is asked to look again -- through the site's own path,
     * rather than by reaching into its state.
     */
    function resyncColumnToggle() {
      if (!document.querySelector('.column-toggle')) return;
      window.dispatchEvent(new Event('resize'));
    }

    /**
     * Keep in step with the site's format buttons. Text has a two-column
     * equivalent, so the panel stays open and re-renders; Lead Sheet is an
     * engraved image, so it closes and the button greys.
     */
    function syncFormat() {
      var allowed = isSupportedFormat(currentFormat());
      button.disabled = !allowed;
      button.title = allowed ? '' : 'Multilingual view is available in Text mode.';
      refreshToggles();
      if (!allowed) {
        if (isOpen) close(); // leaves `wantOpen` alone: the reader did not ask for this
      } else if (isOpen) {
        show();
      } else if (wantOpen) {
        open();
      }
    }

    button.addEventListener('click', function (event) {
      event.preventDefault();
      if (button.disabled) return;
      if (isOpen) close(); else open();
      // Taken from `isOpen` rather than assumed, so a page with no lyrics --
      // where open() bails out -- is not remembered as open.
      userToggled = true;
      wantOpen = isOpen;
      savePrefs();
    });

    select.addEventListener('change', function () {
      refreshToggles();
      savePrefs();
      if (isOpen) show();
    });

    smartBox.addEventListener('change', function () {
      savePrefs();
      if (isOpen) show();
    });

    // Transposing rewrites every `.chord` in the document, including the ones
    // rendered here, so the view needs no redraw -- but the parsed copy held in
    // memory is now a key behind, so it is dropped.
    var keyButtons = document.querySelectorAll('.keysig-up, .keysig-down');
    for (var t = 0; t < keyButtons.length; t++) {
      keyButtons[t].addEventListener('click', function () {
        originalByMode = {};
      });
    }

    // The site's own handler runs first and sets `.active`, so by the time this
    // fires `currentFormat()` already reports the newly chosen format.
    var formatButtons = document.querySelectorAll('.lyrics-format button');
    for (var b = 0; b < formatButtons.length; b++) {
      formatButtons[b].addEventListener('click', syncFormat);
    }

    /* Repeat Chorus, Show Chords and Repeat Chords all change what the panel
     * should be showing. These listeners are added after the site's own and
     * after followRepeatChords(), so the page has already settled into its new
     * state by the time the panel reads it back. */
    function syncToggles() {
      // Repeat Chorus changes which stanzas the page offers, so the parsed
      // copy is dropped rather than reused.
      originalByMode = {};
      if (isOpen) show();
    }

    var siteToggles = document.querySelectorAll(
      '.toggle-show-chords, .toggle-repeat-chorus, .toggle-repeat-chords');
    for (var s = 0; s < siteToggles.length; s++) {
      siteToggles[s].addEventListener('change', syncToggles);
    }

    function savePrefs() {
      var choice = selected();
      writePrefs({
        collection: choice ? choice.collection : '',
        gb: choice ? choice.gb : false,
        label: choice ? choice.label : '',
        smartAlign: smartBox.checked,
        multilingual: wantOpen
      });
    }

    // Restore the view, language and toggles chosen on a previous hymn. A
    // `repeatChords` left here by an older version is ignored and dropped on
    // the next write: the site owns that choice now.
    readPrefs().then(function (prefs) {
      if (prefs && prefs.smartAlign) smartBox.checked = true;
      // Unless the reader beat the read to it, in which case their click wins.
      if (prefs && prefs.multilingual && !userToggled) wantOpen = true;

      var match = null;
      if (prefs && prefs.collection) {
        match = languages.filter(function (l) {
          return l.collection === prefs.collection && !!l.gb === !!prefs.gb;
        })[0];
      }
      if (!match && prefs && prefs.label) {
        match = languages.filter(function (l) { return l.label === prefs.label; })[0];
      }
      if (match) select.value = match.url;

      refreshToggles();
      if (isOpen) show();
      // Reopens the panel here if it was left open, but only where the current
      // format supports it.
      else if (wantOpen) syncFormat();
    });

    syncFormat();
  }

  /* ------------------------------------------------------------------ *
   * Feedback
   *
   * The message is posted by the background service worker rather than from
   * here, so the request is not subject to hymnal.net's page CSP and the form
   * endpoint is never exposed to the page.
   * ------------------------------------------------------------------ */

  function buildFeedback() {
    var toggle = el('button', 'hn-fb-toggle', 'Feedback');
    toggle.type = 'button';
    toggle.title = 'Suggest an improvement to Smart Hymnals';
    toggle.setAttribute('aria-expanded', 'false');

    var form = el('form', 'hn-fb-form hn-hidden');
    form.appendChild(el('div', 'hn-fb-heading', 'Feedback on Smart Hymnals'));

    var message = el('textarea', 'hn-fb-message');
    message.rows = 4;
    message.maxLength = 2000;
    message.required = true;
    message.placeholder = 'What would make this better? Bugs, wording, a hymn that lines up oddly…';
    message.setAttribute('aria-label', 'Your feedback');
    form.appendChild(message);

    var email = el('input', 'hn-fb-email');
    email.type = 'email';
    email.maxLength = 200;
    email.placeholder = 'Your email (optional, only if you would like a reply)';
    email.setAttribute('aria-label', 'Your email, optional');
    form.appendChild(email);

    // Honeypot: hidden from people, filled in by most bots. Formspree discards
    // any submission where `_gotcha` has a value.
    var gotcha = el('input', 'hn-fb-gotcha');
    gotcha.type = 'text';
    gotcha.tabIndex = -1;
    gotcha.autocomplete = 'off';
    gotcha.setAttribute('aria-hidden', 'true');
    form.appendChild(gotcha);

    var actions = el('div', 'hn-fb-actions');
    var send = el('button', 'btn btn-default hn-fb-send', 'Send');
    send.type = 'submit';
    actions.appendChild(send);
    var result = el('span', 'hn-fb-result');
    actions.appendChild(result);
    form.appendChild(actions);

    form.appendChild(el('p', 'hn-fb-note',
      'Sends your message, this hymn’s address and the extension version. Nothing else, and nothing is stored in your browser.'));

    toggle.addEventListener('click', function () {
      var opening = form.classList.contains('hn-hidden');
      form.classList.toggle('hn-hidden', !opening);
      toggle.classList.toggle('hn-on', opening);
      toggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
      if (opening) {
        form.scrollIntoView({ block: 'nearest' });
        message.focus();
      }
    });

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var text = message.value.trim();
      if (!text) {
        result.textContent = 'Please write a message first.';
        result.className = 'hn-fb-result hn-error';
        return;
      }

      send.disabled = true;
      result.textContent = 'Sending…';
      result.className = 'hn-fb-result';

      var payload = {
        message: text,
        email: email.value.trim(),
        _gotcha: gotcha.value,
        page: location.href
      };

      // The toggle's label stays put on success. It sits in a row of buttons,
      // and relabelling it would shift everything beside it.
      var done = function (response) {
        if (response && response.ok) {
          message.value = '';
          email.value = '';
          send.disabled = true;
          result.textContent = 'Thank you — that has been sent.';
          result.className = 'hn-fb-result hn-fb-ok';
        } else {
          send.disabled = false;
          result.textContent = (response && response.error) || 'Could not send. Please try again later.';
          result.className = 'hn-fb-result hn-error';
        }
      };

      try {
        chrome.runtime.sendMessage({ type: 'hymnal-feedback', payload: payload }, function (response) {
          if (chrome.runtime.lastError) {
            return done({ ok: false, error: 'Could not reach the extension. Try reloading the page.' });
          }
          done(response);
        });
      } catch (e) {
        done({ ok: false, error: 'Could not reach the extension. Try reloading the page.' });
      }
    });

    // Typing again after a successful send re-arms the button.
    message.addEventListener('input', function () {
      if (send.disabled && message.value.trim()) {
        send.disabled = false;
        result.textContent = '';
        result.className = 'hn-fb-result';
      }
    });

    return { toggle: toggle, form: form };
  }

  build();
})();
