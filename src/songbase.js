/*
 * Smart Hymnals -- Repeat chords on songbase.life.
 *
 * Songbase prints the chords over the first stanza and the first chorus and
 * leaves the later stanzas as bare words. This adds a "Repeat chords" toggle
 * beside the transpose control that carries those chords through the whole
 * song, matched syllable by syllable -- the same idea as the Hymnal.net script,
 * over quite different markup.
 *
 * Songbase writes a chord as an empty span sitting *inside* the word, at the
 * character it belongs over:
 *
 *   <div class="line">What a <span class="chord-word">w<span class="chord"
 *      data-uncopyable-text="G"></span>onderful</span> change ...</div>
 *
 * The label itself is drawn by CSS (`[data-uncopyable-text]::after`) out of an
 * absolutely positioned box, which is why the span is empty and why a chord
 * does not disturb the words it hangs over. Repeating chords therefore means
 * writing exactly that shape back out, so the site's own stylesheet lays the
 * result out and nothing here has to know how a chord is drawn.
 *
 * The one thing to design around is that the app is React and re-renders the
 * whole of `.lyrics` from its source on every transpose -- one childList
 * mutation, every node out and back in -- which discards the toggle along with
 * anything injected. So the toggle is re-added and the chords re-applied after
 * each render, watched for by a MutationObserver. That turns out to be a
 * feature rather than a cost: by then the site has already retuned the first
 * stanza, so re-reading it copies the new chords across and transposing works
 * with no key arithmetic here at all.
 */

(function () {
  'use strict';

  if (window.__smartHymnalsSongbaseLoaded) return;
  window.__smartHymnalsSongbaseLoaded = true;

  var PREF_KEY = 'hymnalMultilingualPrefs';
  var buildChordLines = window.SmartHymnalsChords.buildChordLines;

  // Songbase rewrites its lines in place rather than drawing a separate chord
  // sheet, so its Chinese lyrics must come back out character for character.
  var TRANSFER = { spaceChinese: false };

  var repeatOn = false;
  var applying = false;   // keeps the observer from reacting to our own writes
  var scheduled = false;

  // The untouched children of every line this script rewrote, so switching the
  // toggle off restores the site's own markup exactly. Keyed weakly: React
  // discards these nodes on the next render and the entries go with them.
  var stashed = new WeakMap();

  /* ------------------------------------------------------------------ *
   * Reading the page
   * ------------------------------------------------------------------ */

  /** The stanzas and choruses of the song, in the order they are printed. */
  function stanzasOf(lyrics) {
    return lyrics.querySelectorAll(':scope > .stanza, :scope > .chorus');
  }

  function kindOf(stanza) {
    return stanza.classList.contains('chorus') ? 'chorus' : 'stanza';
  }

  /** Chords the site printed itself, as opposed to ones repeated here. */
  function hasOwnChords(stanza) {
    return !stanza.classList.contains('sh-repeated') && !!stanza.querySelector('.chord');
  }

  /**
   * Read one `.line` into `{ chord, text }` segments, where `chord` is the
   * chord that begins at that segment's first character -- the shape
   * src/chords.js works in.
   *
   * The chord spans are empty and their label lives in an attribute, so the
   * line's own text is exactly the lyric: walking it in order yields both the
   * words and the character offset each chord sits at.
   */
  function readLine(line) {
    var segments = [{ chord: '', text: '' }];

    (function walk(node) {
      for (var i = 0; i < node.childNodes.length; i++) {
        var child = node.childNodes[i];

        if (child.nodeType === Node.TEXT_NODE) {
          segments[segments.length - 1].text += child.nodeValue;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          if (child.classList.contains('chord')) {
            segments.push({ chord: chordName(child), text: '' });
          } else {
            walk(child);
          }
        }
      }
    })(line);

    // A line that opens on a chord leaves the seeded segment empty.
    if (!segments[0].text && !segments[0].chord && segments.length > 1) segments.shift();
    return segments;
  }

  function chordName(el) {
    return (el.getAttribute('data-uncopyable-text') || el.textContent || '').trim();
  }

  /* ------------------------------------------------------------------ *
   * Writing chords back out
   * ------------------------------------------------------------------ */

  /**
   * Replace a line's contents with the same words, now carrying `segments`'
   * chords in Songbase's own markup. Returns false, leaving the line alone, if
   * there was no chord to hang.
   *
   * Chords are gathered into character offsets first and then hung on whole
   * words, because `.chord-word` is `display: inline-block`: wrapping a run of
   * words in one would stop the line breaking anywhere inside it. One word to a
   * chord-word is both what the site does and what leaves long lines wrapping
   * where they always did.
   *
   * A chord landing in the space before a word belongs to that word, which is
   * how the site writes a chord struck on its first beat.
   */
  function writeLine(line, segments) {
    var text = '';
    var marks = [];
    var i;

    for (i = 0; i < segments.length; i++) {
      if (segments[i].chord) marks.push({ chord: segments[i].chord, offset: text.length });
      text += segments[i].text;
    }
    if (!marks.length) return false;

    var frag = document.createDocumentFragment();
    var tokens = text.match(/\s+|\S+/g) || [];   // words and the gaps between them
    var mark = 0;
    var position = 0;

    // The last word takes whatever is left, which is what catches a chord
    // struck at the very end of the line -- its offset is the end of the text,
    // so it falls outside every token's span.
    var lastWord = -1;
    for (i = 0; i < tokens.length; i++) if (!/^\s/.test(tokens[i])) lastWord = i;

    for (i = 0; i < tokens.length; i++) {
      var token = tokens[i];
      var start = position;
      var end = position + token.length;
      position = end;

      if (/^\s/.test(token)) {
        // Whitespace carries no chord of its own; anything falling inside it is
        // left for the word coming next.
        frag.appendChild(document.createTextNode(token));
        continue;
      }

      var here = [];
      while (mark < marks.length && (marks[mark].offset < end || i === lastWord)) {
        here.push({ chord: marks[mark].chord, offset: Math.max(0, marks[mark].offset - start) });
        mark++;
      }

      frag.appendChild(here.length ? chordWord(token, here) : document.createTextNode(token));
    }

    stash(line);
    line.textContent = '';
    line.appendChild(frag);
    return true;
  }

  /** One `<span class="chord-word">`, with its chords marked inside the word. */
  function chordWord(word, marks) {
    var span = document.createElement('span');
    span.className = 'chord-word';

    var position = 0;
    for (var i = 0; i < marks.length; i++) {
      var offset = Math.min(marks[i].offset, word.length);
      if (offset > position) {
        span.appendChild(document.createTextNode(word.slice(position, offset)));
        position = offset;
      }
      var chord = document.createElement('span');
      chord.className = 'chord';
      chord.setAttribute('data-uncopyable-text', marks[i].chord);
      span.appendChild(chord);
    }
    if (position < word.length) span.appendChild(document.createTextNode(word.slice(position)));

    return span;
  }

  function stash(line) {
    if (stashed.has(line)) return;
    var keep = document.createDocumentFragment();
    while (line.firstChild) keep.appendChild(line.firstChild);
    stashed.set(line, keep);
  }

  /* ------------------------------------------------------------------ *
   * Repeating the chords
   * ------------------------------------------------------------------ */

  /**
   * Carry the chords of the first chorded stanza of each kind onto every later
   * stanza of that kind that has none. Verses take a verse's chords and
   * choruses a chorus's, since the two are rarely the same shape.
   */
  function repeatChords(lyrics) {
    var stanzas = stanzasOf(lyrics);
    var templates = {};
    var i, kind;

    for (i = 0; i < stanzas.length; i++) {
      kind = kindOf(stanzas[i]);
      if (templates[kind] || !hasOwnChords(stanzas[i])) continue;
      templates[kind] = readStanza(stanzas[i]);
    }

    for (i = 0; i < stanzas.length; i++) {
      kind = kindOf(stanzas[i]);
      if (stanzas[i].querySelector('.chord') || !templates[kind]) continue;
      applyTemplate(stanzas[i], templates[kind]);
    }
  }

  function readStanza(stanza) {
    var lines = stanza.querySelectorAll('.line');
    var out = [];
    for (var i = 0; i < lines.length; i++) out.push(readLine(lines[i]));
    return out;
  }

  function applyTemplate(stanza, template) {
    var lines = stanza.querySelectorAll('.line');
    var plain = [];
    var i;
    for (i = 0; i < lines.length; i++) plain.push(lines[i].textContent);

    var built = buildChordLines(plain, template, TRANSFER);
    var chorded = false;
    for (i = 0; i < lines.length; i++) {
      if (writeLine(lines[i], built[i])) chorded = true;
    }
    if (!chorded) return;

    stanza.classList.add('sh-repeated');

    // The site drops the stanza number by the height of a chord row on the
    // stanzas it chords itself, so the number stays level with the first line.
    // A stanza chorded here needs the same.
    var number = stanza.querySelector('.stanza-number');
    if (number) number.classList.add('with-chords');
  }

  /** Put back every line this script rewrote, leaving the page as it found it. */
  function undoChords(lyrics) {
    var stanzas = lyrics.querySelectorAll('.sh-repeated');

    for (var i = 0; i < stanzas.length; i++) {
      var lines = stanzas[i].querySelectorAll('.line');
      for (var j = 0; j < lines.length; j++) {
        var original = stashed.get(lines[j]);
        if (!original) continue;
        lines[j].textContent = '';
        lines[j].appendChild(original);
        stashed.delete(lines[j]);
      }
      var number = stanzas[i].querySelector('.stanza-number');
      if (number) number.classList.remove('with-chords');
      stanzas[i].classList.remove('sh-repeated');
    }
  }

  /** Is there anything on this song for the toggle to do? */
  function worthOffering(lyrics) {
    var stanzas = stanzasOf(lyrics);
    var chorded = {};
    var i;

    for (i = 0; i < stanzas.length; i++) {
      if (hasOwnChords(stanzas[i])) chorded[kindOf(stanzas[i])] = true;
    }
    for (i = 0; i < stanzas.length; i++) {
      // A stanza already repeated counts: it is bare in the site's own markup.
      if (chorded[kindOf(stanzas[i])] && !hasOwnChords(stanzas[i])) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ *
   * The toggle
   * ------------------------------------------------------------------ */

  function addToggle(controls) {
    var label = document.createElement('label');
    label.className = 'sh-repeat';
    label.title = 'Carry the first stanza’s chords onto the later stanzas, matched syllable by syllable.';

    var box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = repeatOn;

    label.appendChild(box);
    label.appendChild(document.createTextNode('Repeat chords'));

    box.addEventListener('change', function () {
      repeatOn = box.checked;
      savePref(repeatOn);

      var lyrics = document.querySelector('.song-app .lyrics');
      if (!lyrics) return;

      applying = true;
      try {
        if (repeatOn) repeatChords(lyrics);
        else undoChords(lyrics);
      } finally {
        applying = false;
      }
    });

    controls.appendChild(label);
    placeToggle(controls, label);
  }

  /**
   * Decide whether the toggle can share the site's row of controls.
   *
   * `.song-controls` is a two-column grid: the transpose control is pinned to
   * the right-hand cell, and the left one is free on most songs. But a song
   * with more than one tune gets a `.tune-selector` placed in exactly that left
   * cell, and it is `position: relative`, so it painted over the toggle and took
   * every click -- the box could not be ticked at all, the tune menu opened
   * instead.
   *
   * Rather than naming that one element, this asks the general question: does
   * anything else actually occupy the row? Absolutely positioned children --
   * the bookmark, the share and music buttons, which the site parks elsewhere on
   * the page -- take no grid cell and do not count. If anything does, the toggle
   * takes a row of its own below.
   */
  function placeToggle(controls, label) {
    var crowded = false;

    for (var i = 0; i < controls.children.length; i++) {
      var child = controls.children[i];
      if (child === label || child.classList.contains('transpose-controls')) continue;
      if (getComputedStyle(child).position === 'absolute') continue;
      crowded = true;
      break;
    }

    label.classList.toggle('sh-own-row', crowded);
  }

  /* ------------------------------------------------------------------ *
   * Keeping up with React
   * ------------------------------------------------------------------ */

  function sync() {
    if (applying) return;

    var lyrics = document.querySelector('.song-app .lyrics');
    if (!lyrics) return;

    var controls = lyrics.querySelector('.song-controls');
    if (!controls || !worthOffering(lyrics)) return;

    applying = true;
    try {
      if (!controls.querySelector('.sh-repeat')) addToggle(controls);
      if (repeatOn) repeatChords(lyrics);
    } finally {
      applying = false;
    }
  }

  /**
   * Coalesce the burst of mutations a render produces into a single pass.
   *
   * A timeout rather than requestAnimationFrame: rAF is suspended in a tab that
   * is not painting, so a song opened in a background tab would sit unchorded
   * until it was looked at.
   */
  function schedule() {
    if (applying || scheduled) return;
    scheduled = true;
    setTimeout(function () {
      scheduled = false;
      sync();
    }, 0);
  }

  function watch() {
    var root = document.querySelector('.application-container') || document.body;
    new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
    sync();
  }

  /* ------------------------------------------------------------------ *
   * Preferences
   *
   * Shared with the Hymnal.net script, under the same key and the same field,
   * so turning Repeat chords on for one site turns it on for the other.
   * ------------------------------------------------------------------ */

  function savePref(value) {
    try {
      chrome.storage.local.get(PREF_KEY, function (items) {
        if (chrome.runtime.lastError) return;
        var prefs = (items && items[PREF_KEY]) || {};
        prefs.repeatChords = value;
        var payload = {};
        payload[PREF_KEY] = prefs;
        chrome.storage.local.set(payload, function () {
          void chrome.runtime.lastError;
        });
      });
    } catch (e) { /* storage unavailable; the choice simply is not remembered */ }
  }

  function start() {
    try {
      chrome.storage.local.get(PREF_KEY, function (items) {
        if (!chrome.runtime.lastError && items && items[PREF_KEY]) {
          repeatOn = !!items[PREF_KEY].repeatChords;
        }
        watch();
      });
    } catch (e) {
      watch();
    }
  }

  start();
})();
