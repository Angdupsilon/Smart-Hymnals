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
 */

(function () {
  'use strict';

  if (window.__hymnalMultilingualLoaded) return;
  window.__hymnalMultilingualLoaded = true;

  var STORAGE_KEY = 'hymnalPreferredLanguage';
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
   * Collect the stanzas of a hymn document. Rows marked `js-duplicate-row` are
   * the repeated choruses that Hymnal.net only reveals in "Text+" mode; they
   * are skipped so both columns show the hymn in its default shape.
   *
   * Each stanza gets a key -- "v3" for verse 3, "c0" for the first chorus --
   * which is what lets two languages with different verse counts line up.
   */
  function parseStanzas(root) {
    var article = root.querySelector('article.js-stanzas');
    if (!article) return null;

    var stanzas = [];
    var chorusIndex = 0;
    var nodes = article.querySelectorAll('.verse');

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.classList.contains('js-duplicate-row')) continue;

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
    return new URL(url).searchParams.get('gb') === '1';
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
      var entry = { url: url, label: label, code: a.textContent.trim() };
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
        byUrl.set(full, { url: full, label: stem + ' (Simplified)', code: base.code });
      } else {
        byUrl.set(full, { url: full, label: link.textContent.trim(), code: base.code });
      }
    }

    return Array.from(byUrl.values());
  }

  /** The language of the page we are already on, for the left-hand heading. */
  function currentLanguageLabel() {
    var active = document.querySelector('.hymn-nums .label-success');
    var label = active ? (active.getAttribute('title') || '').trim() : '';
    if (!label) label = 'Original';
    if (isSimplified(location.href)) label += ' (Simplified)';
    return label;
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
        var stanzas = parseStanzas(doc);
        if (!stanzas) throw new Error('No lyrics found on that page.');

        var titleEl = doc.querySelector('#song-title, #song-title-xs');
        var data = {
          stanzas: stanzas,
          title: titleEl ? titleEl.textContent.trim() : ''
        };
        pageCache.set(url, data);
        return data;
      });
  }

  /* ------------------------------------------------------------------ *
   * Preference storage
   * ------------------------------------------------------------------ */

  function readPreference() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(STORAGE_KEY, function (items) {
          if (chrome.runtime.lastError) return resolve('');
          resolve((items && items[STORAGE_KEY]) || '');
        });
      } catch (e) {
        resolve('');
      }
    });
  }

  function writePreference(label) {
    try {
      var payload = {};
      payload[STORAGE_KEY] = label;
      chrome.storage.local.set(payload, function () {
        void chrome.runtime.lastError;
      });
    } catch (e) { /* storage unavailable; preference simply is not persisted */ }
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

  function renderStanza(stanza) {
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
    for (var i = 0; i < stanza.lines.length; i++) {
      body.appendChild(el('div', 'hn-line', stanza.lines[i] || ' '));
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

    var originalLabel = currentLanguageLabel();

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
    leftHead.appendChild(el('span', 'hn-head-label', originalLabel));

    var rightHead = el('div', 'hn-head hn-head-right');
    var select = el('select', 'hn-select');
    select.setAttribute('aria-label', 'Translation language');
    for (var i = 0; i < languages.length; i++) {
      var option = el('option', null, languages[i].label);
      option.value = languages[i].url;
      select.appendChild(option);
    }
    rightHead.appendChild(select);

    var status = el('div', 'hn-status');
    var body = el('div', 'hn-body');

    grid.appendChild(leftHead);
    grid.appendChild(rightHead);
    grid.appendChild(status);
    grid.appendChild(body);
    panel.appendChild(grid);

    hymnContent.parentNode.insertBefore(panel, hymnContent.nextSibling);

    /* -------- behaviour -------- */

    var originalStanzas = parseStanzas(document);
    var isOpen = false;
    var requestToken = 0;

    function setStatus(message, isError) {
      status.textContent = message || '';
      status.classList.toggle('hn-error', !!isError);
      status.classList.toggle('hn-hidden', !message);
    }

    function render(translation) {
      body.textContent = '';
      var rows = alignStanzas(originalStanzas, translation.stanzas);
      for (var r = 0; r < rows.length; r++) {
        var row = el('div', 'hn-row');
        row.appendChild(renderStanza(rows[r][0]));
        row.appendChild(renderStanza(rows[r][1]));
        body.appendChild(row);
      }
    }

    function show(url) {
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
      if (!originalStanzas) {
        originalStanzas = parseStanzas(document);
        if (!originalStanzas) {
          setStatus('No lyrics found on this page.', true);
          return;
        }
      }
      isOpen = true;
      button.classList.add('hn-on');
      button.setAttribute('aria-pressed', 'true');
      hymnContent.classList.add('hn-hidden');
      panel.classList.remove('hn-hidden');
      show(select.value);
    }

    function close() {
      isOpen = false;
      requestToken++;
      button.classList.remove('hn-on');
      button.setAttribute('aria-pressed', 'false');
      hymnContent.classList.remove('hn-hidden');
      panel.classList.add('hn-hidden');
    }

    button.addEventListener('click', function (event) {
      event.preventDefault();
      if (isOpen) close(); else open();
    });

    select.addEventListener('change', function () {
      var chosen = languages.filter(function (l) { return l.url === select.value; })[0];
      if (chosen) writePreference(chosen.label);
      if (isOpen) show(select.value);
    });

    // Switching to Text / Chords / Piano / Guitar returns to the normal view
    // rather than leaving two competing lyric displays on screen.
    var formatButtons = document.querySelectorAll('.lyrics-format button');
    for (var b = 0; b < formatButtons.length; b++) {
      formatButtons[b].addEventListener('click', function () {
        if (isOpen) close();
      });
    }

    // Re-select whatever language was chosen last time, when it is offered here.
    readPreference().then(function (preferred) {
      if (!preferred) return;
      var match = languages.filter(function (l) { return l.label === preferred; })[0];
      if (match) select.value = match.url;
    });
  }

  build();
})();
