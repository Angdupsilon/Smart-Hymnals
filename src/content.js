/*
 * Hymnal.net Multilingual Lyrics
 *
 * Adds a "Multilingual" button next to the Text / Text+ / Chords / Piano / Guitar
 * group on a hymn page. Clicking it swaps the single-column lyrics for a two
 * column view: the page's own language on the left, a translation on the right,
 * chosen with a toggle that sits above the right-hand column.
 *
 * Translations are discovered from the coloured hymn-number badges under the
 * title (`.hymn-nums`). A badge rendered as an <a> is a translation that exists
 * online; a plain <span> is a number with no page to link to. The sidebar
 * "Languages" list is used only to pick up query-string variants of those same
 * pages (Hymnal.net serves Simplified Chinese as `?gb=1`).
 *
 * The view mirrors whichever of the site's two text modes is active: Text, or
 * Text+ which repeats the chorus after every stanza. It is unavailable in the
 * Chords, Piano and Guitar modes, which have no second-language equivalent.
 */

(function () {
  'use strict';

  if (window.__hymnalMultilingualLoaded) return;
  window.__hymnalMultilingualLoaded = true;

  var PREF_KEY = 'hymnalMultilingualPrefs';
  var TEXT_FORMATS = ['text', 'textplus'];
  var ALL_FORMATS = ['text', 'textplus', 'chords', 'piano', 'guitar'];
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
   * Collect the stanzas of a hymn document.
   *
   * Rows marked `js-duplicate-row` are the repeated choruses that the site
   * reveals only in Text+ mode, so `withRepeats` decides whether to keep them
   * and the panel matches whichever mode the page is in.
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
      var key;

      if (type === 'chorus') {
        key = 'c' + chorusIndex++;
      } else if (num) {
        key = 'v' + num;
      } else {
        key = 'x' + stanzas.length;
      }

      stanzas.push({ type: type, num: num, lines: lines, key: key });
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
    if ('。！？.!?'.indexOf(last) !== -1 && last !== '') return Math.pow(0.40 * total, 2);
    if ('；;'.indexOf(last) !== -1 && last !== '') return Math.pow(0.15 * total, 2);
    return 0;
  }

  /**
   * Merge `lines` into exactly `other.length` groups, matching each group's
   * weight to the corresponding line opposite. Returns the merged lines, or
   * the originals when there is nothing to gain.
   */
  function smartMerge(lines, other) {
    var groups = other.length;
    var n = lines.length;
    if (!groups || n <= groups) return lines;

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

    if (dp[groups][n] === Infinity) return lines;

    var cuts = [];
    var end = n;
    for (k = groups; k >= 1; k--) {
      var start = back[k][end];
      cuts.unshift([start, end]);
      end = start;
    }

    // Chinese runs without spaces, and the comma each line already ends with
    // does the separating, so the pieces join directly.
    return cuts.map(function (cut) {
      return lines.slice(cut[0], cut[1]).join('');
    });
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
   * Lyrics format
   * ------------------------------------------------------------------ */

  /** Which of the site's five lyric modes is showing. */
  function currentFormat() {
    var active = document.querySelector('.lyrics-format button.active');
    if (active) {
      for (var i = 0; i < ALL_FORMATS.length; i++) {
        if (active.classList.contains(ALL_FORMATS[i])) return ALL_FORMATS[i];
      }
    }
    try {
      if (ALL_FORMATS.indexOf(localStorage.lyricsFormat) !== -1) return localStorage.lyricsFormat;
    } catch (e) { /* localStorage may be unavailable */ }
    return 'text';
  }

  function isTextFormat(format) {
    return TEXT_FORMATS.indexOf(format) !== -1;
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
        var data = {
          text: plain,
          textplus: parseStanzas(doc, true) || plain,
          title: titleEl ? titleEl.textContent.trim() : ''
        };
        pageCache.set(url, data);
        return data;
      });
  }

  /* ------------------------------------------------------------------ *
   * Preferences
   *
   * The language is remembered by hymnal ("ch" plus the Simplified flag)
   * rather than by its display name, so the choice carries to the next hymn
   * even when that hymn labels the option differently.
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

  function renderStanza(stanza, lines) {
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
    for (var i = 0; i < lines.length; i++) {
      body.appendChild(el('div', 'hn-line', lines[i] || ' '));
    }
    cell.appendChild(body);
    return cell;
  }

  function build() {
    var formatRow = document.querySelector('.row.text-center .lyrics-format');
    var hymnContent = document.querySelector('.hymn-content');
    if (!hymnContent) return;

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

    if (formatRow && formatRow.parentNode) {
      formatRow.parentNode.appendChild(group);
    } else {
      hymnContent.parentNode.insertBefore(group, hymnContent);
    }

    /* -------- the side-by-side panel -------- *
     * A sibling of `.hymn-content`, not a child, because the site hides
     * `.hymn-content > div` whenever a format button is pressed.
     */
    var panel = el('div', 'hn-multi-panel hn-hidden');
    var grid = el('div', 'hn-grid');

    var leftHead = el('div', 'hn-head hn-head-left');
    leftHead.appendChild(el('span', 'hn-head-label', here.label));

    var rightHead = el('div', 'hn-head hn-head-right');
    var select = el('select', 'hn-select');
    select.setAttribute('aria-label', 'Translation language');
    for (var i = 0; i < languages.length; i++) {
      var option = el('option', null, languages[i].label);
      option.value = languages[i].url;
      select.appendChild(option);
    }
    rightHead.appendChild(select);

    var smartWrap = el('label', 'hn-smart hn-hidden');
    var smartBox = document.createElement('input');
    smartBox.type = 'checkbox';
    smartBox.className = 'hn-smart-box';
    smartWrap.appendChild(smartBox);
    smartWrap.appendChild(el('span', 'hn-smart-text', 'Smart align'));
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

    function refreshSmartToggle() {
      smartWrap.classList.toggle('hn-hidden', chineseSide() === null);
    }

    function mode() {
      return currentFormat() === 'textplus' ? 'textplus' : 'text';
    }

    function originalStanzas() {
      var m = mode();
      if (!originalByMode[m]) originalByMode[m] = parseStanzas(document, m === 'textplus');
      return originalByMode[m];
    }

    function setStatus(message, isError) {
      status.textContent = message || '';
      status.classList.toggle('hn-error', !!isError);
      status.classList.toggle('hn-hidden', !message);
    }

    function render(translation) {
      body.textContent = '';

      var rows = alignStanzas(originalStanzas(), translation[mode()]);
      var side = smartBox.checked ? chineseSide() : null;

      for (var r = 0; r < rows.length; r++) {
        var left = rows[r][0];
        var right = rows[r][1];

        // Merging needs both sides present to know how many lines to aim for.
        var leftLines = left ? left.lines : [];
        var rightLines = right ? right.lines : [];
        if (side === 'left' && left && right) {
          leftLines = smartMerge(left.lines, right.lines);
        } else if (side === 'right' && left && right) {
          rightLines = smartMerge(right.lines, left.lines);
        }

        var row = el('div', 'hn-row');
        row.appendChild(renderStanza(left, leftLines));
        row.appendChild(renderStanza(right, rightLines));
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
      hymnContent.classList.add('hn-hidden');
      panel.classList.remove('hn-hidden');
      show();
    }

    function close() {
      isOpen = false;
      requestToken++;
      button.classList.remove('hn-on');
      button.setAttribute('aria-pressed', 'false');
      hymnContent.classList.remove('hn-hidden');
      panel.classList.add('hn-hidden');
    }

    /**
     * Keep in step with the site's format buttons. Text and Text+ both have a
     * two-column equivalent, so the panel stays open and re-renders; the sheet
     * music modes do not, so it closes and the button greys out.
     */
    function syncFormat() {
      var allowed = isTextFormat(currentFormat());
      button.disabled = !allowed;
      button.title = allowed ? '' : 'Multilingual view is available in Text and Text+ mode.';
      if (!allowed) {
        if (isOpen) close();
      } else if (isOpen) {
        show();
      }
    }

    button.addEventListener('click', function (event) {
      event.preventDefault();
      if (button.disabled) return;
      if (isOpen) close(); else open();
    });

    select.addEventListener('change', function () {
      refreshSmartToggle();
      savePrefs();
      if (isOpen) show();
    });

    smartBox.addEventListener('change', function () {
      savePrefs();
      if (isOpen) show();
    });

    // The site's own handler runs first and sets `.active`, so by the time this
    // fires `currentFormat()` already reports the newly chosen mode.
    var formatButtons = document.querySelectorAll('.lyrics-format button');
    for (var b = 0; b < formatButtons.length; b++) {
      formatButtons[b].addEventListener('click', syncFormat);
    }

    function savePrefs() {
      var choice = selected();
      writePrefs({
        collection: choice ? choice.collection : '',
        gb: choice ? choice.gb : false,
        label: choice ? choice.label : '',
        smartAlign: smartBox.checked
      });
    }

    // Restore the language and smart-align setting chosen on a previous hymn.
    readPrefs().then(function (prefs) {
      if (prefs && prefs.smartAlign) smartBox.checked = true;

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

      refreshSmartToggle();
      if (isOpen) show();
    });

    refreshSmartToggle();
    syncFormat();
  }

  build();
})();
