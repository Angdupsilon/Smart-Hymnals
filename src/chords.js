/*
 * Smart Hymnals -- carrying chords from one stanza onto another.
 *
 * Hymn books print the chords over the first verse (and the first chorus) and
 * leave every later stanza as bare words. This is the machinery that carries
 * them through: given the chorded stanza and the plain text of a later one, it
 * works out which syllable each chord sits on and hangs it on the same syllable
 * of the later stanza.
 *
 * That works because the stanzas of a hymn share a metre -- one tune has to fit
 * them all -- so the nth syllable of a line falls on the same note every time.
 *
 * None of this touches the DOM: it takes and returns plain
 * `{ chord, text }` segments, where `chord` is the chord that begins at that
 * segment's first character. Both content scripts share it -- Hymnal.net and
 * Songbase mark chords up quite differently, but the question underneath is the
 * same one -- so each site's script only has to read its own markup into
 * segments and write segments back out again.
 *
 * Exposed on `window` because the two content scripts share one isolated world
 * per frame; nothing here is visible to the page itself.
 */

(function () {
  'use strict';

  if (window.SmartHymnalsChords) return;

  var CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]/;
  var LETTER = /[A-Za-z\u00c0-\u024f'\u2019]/;

  /** Offsets, within a word, where each syllable begins. */
  function wordSyllableOffsets(word) {
    var lower = word.toLowerCase();
    var groups = [];
    var re = /[aeiouy\u00e0-\u00fc]+/g;
    var match;
    while ((match = re.exec(lower))) groups.push([match.index, match.index + match[0].length]);
    if (!groups.length) return [0];

    // A trailing "e" is usually silent: "alone", "loves", "loved". It keeps a
    // syllable of its own in "-le" words ("table"), in "-es" after a sibilant
    // ("roses", "churches"), and in "-ed" after t or d ("tempted", "needed").
    if (groups.length > 1) {
      var last = groups[groups.length - 1];
      var isBareE = last[1] - last[0] === 1 && lower.charAt(last[0]) === 'e';
      var tail = lower.slice(last[1]);

      if (isBareE && (tail === '' || tail === 's' || tail === 'd')) {
        var stem = lower.slice(0, last[0]);
        var keep;
        if (tail === 's') {
          keep = /(s|x|z|ch|sh|ge|ce)$/.test(stem);
        } else if (tail === 'd') {
          keep = /(t|d)$/.test(stem);
        } else {
          keep = /[^aeiouy]l$/.test(stem);
        }
        if (!keep) groups.pop();
      }
    }

    var offsets = [0];
    for (var i = 1; i < groups.length; i++) {
      var clusterStart = groups[i - 1][1];
      var nucleus = groups[i][0];
      // The last consonant of the cluster opens the next syllable:
      // "bur|dens", "a|lone", "Je|sus".
      var boundary = nucleus > clusterStart ? nucleus - 1 : nucleus;
      if (boundary <= offsets[offsets.length - 1]) boundary = offsets[offsets.length - 1] + 1;
      if (boundary < lower.length) offsets.push(boundary);
    }
    return offsets;
  }

  /** Offsets, within a line, where each syllable begins. */
  function syllableStarts(text) {
    var starts = [];
    var i = 0;
    while (i < text.length) {
      var ch = text.charAt(i);
      if (CJK.test(ch)) {
        starts.push(i);
        i++;
      } else if (LETTER.test(ch)) {
        var j = i;
        while (j < text.length && LETTER.test(text.charAt(j))) j++;
        var offsets = wordSyllableOffsets(text.slice(i, j));
        for (var k = 0; k < offsets.length; k++) starts.push(i + offsets[k]);
        i = j;
      } else {
        i++;
      }
    }
    return starts;
  }

  /** Chinese chord lines are set with a gap after each character, as the site does. */
  function spaceCJK(text) {
    var out = '';
    for (var i = 0; i < text.length; i++) {
      out += text.charAt(i);
      if (CJK.test(text.charAt(i)) && i + 1 < text.length && CJK.test(text.charAt(i + 1))) out += ' ';
    }
    return out;
  }

  /**
   * Re-hang the chords of `sourceSegments` over `targetText`, syllable for
   * syllable. Returns segments for the target line, or null if there is
   * nothing to hang.
   */
  function transferChords(sourceSegments, targetText, options) {
    var sourceText = sourceSegments.map(function (s) { return s.text; }).join('');
    var chords = [];
    var offset = 0;

    for (var i = 0; i < sourceSegments.length; i++) {
      if (sourceSegments[i].chord) {
        chords.push({ chord: sourceSegments[i].chord, offset: offset });
      }
      offset += sourceSegments[i].text.length;
    }
    if (!chords.length) return null;

    // Hymnal.net sets its own Chinese chord lines with a gap after each
    // character, so a stanza chorded here has to be set the same way to sit
    // beside them. Songbase does not, and rewrites its lines in place, where
    // adding spaces would be editing the lyrics -- hence the opt-out.
    var space = !options || options.spaceChinese !== false;
    var text = space && CJK.test(targetText) ? spaceCJK(targetText) : targetText;
    var sourceStarts = syllableStarts(sourceText);
    var targetStarts = syllableStarts(text);
    if (!targetStarts.length) return null;

    // Which syllable each chord sits on in the source, mapped to the same
    // syllable in the target. Indices are kept strictly increasing so two
    // chords never collapse onto one syllable.
    var cuts = [];
    var previous = -1;
    for (i = 0; i < chords.length; i++) {
      // Nearest syllable rather than the one before: a chord always sits on a
      // real syllable boundary in the source, so when the estimate is off by a
      // character or two ("dis|tress" against "dist|ress") the closest start is
      // the intended one.
      var index = 0;
      for (var s = 1; s < sourceStarts.length; s++) {
        if (Math.abs(sourceStarts[s] - chords[i].offset) < Math.abs(sourceStarts[index] - chords[i].offset)) {
          index = s;
        }
      }
      if (index <= previous) index = previous + 1;
      if (index > targetStarts.length - 1) {
        // A chord struck after the last syllable -- the turnaround at the end
        // of a line, printed hard against the final word ("my he[G]art![D]").
        // There is no syllable left to hang it on, so it goes where the source
        // has it, at the end of the line, and anything past it is dropped.
        cuts.push({ chord: chords[i].chord, offset: text.length });
        break;
      }
      previous = index;
      cuts.push({ chord: chords[i].chord, offset: targetStarts[index] });
    }
    if (!cuts.length) return null;

    var segments = [];
    var position = 0;
    for (i = 0; i < cuts.length; i++) {
      if (cuts[i].offset > position) {
        segments.push({ chord: '', text: text.slice(position, cuts[i].offset) });
        position = cuts[i].offset;
      }
      var end = i + 1 < cuts.length ? cuts[i + 1].offset : text.length;
      if (end < position) end = position;
      segments.push({ chord: cuts[i].chord, text: text.slice(position, end) });
      position = end;
    }
    if (position < text.length) segments.push({ chord: '', text: text.slice(position) });

    return segments;
  }

  /**
   * Hang a template stanza's chords over a set of plain lines, one output line
   * per input line. A line the template has no chords for is still spaced out
   * when it is Chinese, so the whole stanza is set the same way.
   */
  function buildChordLines(lines, templateLines, options) {
    var space = !options || options.spaceChinese !== false;
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var source = templateLines[i];
      var segments = source ? transferChords(source, lines[i], options) : null;
      if (!segments) {
        segments = [{ chord: '', text: space && CJK.test(lines[i]) ? spaceCJK(lines[i]) : lines[i] }];
      }
      out.push(segments);
    }
    return out;
  }

  window.SmartHymnalsChords = {
    CJK: CJK,
    LETTER: LETTER,
    wordSyllableOffsets: wordSyllableOffsets,
    syllableStarts: syllableStarts,
    spaceCJK: spaceCJK,
    transferChords: transferChords,
    buildChordLines: buildChordLines
  };
})();
