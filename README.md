# Hymnal.net Multilingual Lyrics

A Chrome extension that adds a **Multilingual** button to hymn pages on
[hymnal.net](https://www.hymnal.net). Clicking it shows the hymn's lyrics in two
columns — the page's own language on the left, a translation on the right — with
a dropdown above the right column for choosing among the translations that hymn
actually has.

## Installing

Chrome does not allow installing an unpacked extension from a `.zip`, so load
the folder directly:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Open any hymn page, e.g. <https://www.hymnal.net/en/hymn/h/787>.

The **Multilingual** button appears next to Text / Text+ / Chords / Piano /
Guitar. It is only added when the hymn actually has a translation to show.

## Text and Text+

The panel mirrors whichever of the site's two text modes is active, in both
columns at once:

- **Text** — each stanza once, the chorus in its printed position.
- **Text+** — the chorus repeated after every stanza, matching what the site
  does when it unhides its `js-duplicate-row` rows.

Switching between the two while the panel is open re-renders it in place. The
button is greyed out in **Chords**, **Piano** and **Guitar**, which have no
second-language equivalent; choosing one of those closes the panel and hands
the page back to the site.

## Smart align (Chinese)

Chinese sets the same thought in more, shorter lines than English. Verse 1 of
hymn 787 is four English lines against seven Chinese ones, because one English
line is often carried by a comma-joined pair. Ticking **Smart align**, beside
the language menu, merges those pairs so the columns read across:

| Smart align off | Smart align on | English |
|---|---|---|
| 我所有苦況，<br>必須告訴主， | 我所有苦況，必須告訴主， | I must tell Jesus all of my trials; |
| 我不能獨自擔此憂鬱； | 我不能獨自擔此憂鬱； | I cannot bear these burdens alone; |
| 我在患難中，<br>惟主能安撫， | 我在患難中，惟主能安撫， | In my distress He kindly will help me; |
| 擦去我眼淚，<br>將我體恤。 | 擦去我眼淚，將我體恤。 | He ever loves and cares for His own. |

Only the text is joined — nothing is reworded, so the merged line means exactly
what its pieces meant.

Which lines to merge cannot be read off the punctuation: every line above ends
in a comma, so commas mark the joins and the breaks equally. Instead the Chinese
lines are cut into exactly as many groups as there are lines opposite, choosing
the cut where each group's share of the stanza best matches the share of the
line it faces. Punctuation is then a guard rail rather than the signal — a full
stop or semicolon closes a thought, so merging across one is penalised heavily.
The search is a small dynamic program over the stanza, so it finds the best cut
rather than merging greedily left to right.

The checkbox appears only when one of the two columns is Chinese, and works in
either direction — reading a Chinese page with English on the right merges the
left column instead. Stanzas that already match line for line are left alone, as
are stanzas with no counterpart opposite.

## Remembering your choice

The chosen language and the Smart align setting are saved with
`chrome.storage.local` and restored on the next hymn you open.

The language is remembered by hymnal — the `ch` in `/en/hymn/ch/572`, plus the
Simplified flag — rather than by its display name, because the same language is
not always labelled identically. Hymn 787 offers "Chinese (Traditional)" since
it also lists a Simplified variant, while a hymn with only one Chinese page
labels it plainly "Chinese"; matching on the hymnal carries the choice across
both. The display name is kept as a fallback.

## How translations are found

Nothing is hard-coded and no external service is involved — the extension reads
the same links the page already shows you.

Under each hymn title is a row of coloured number badges (`B415` `C572` `E787`
`K572` `T787`). In the page's HTML these are:

```html
<div class="text-center hymn-nums">
  <span class="label label-default"  title="Burmese">B415</span>
  <a    class="label label-primary"  title="Chinese" href="/en/hymn/ch/572">C572</a>
  <span class="label label-success"  title="English">E787</span>
  <span class="label label-default"  title="Korean">K572</span>
  <a    class="label label-primary"  title="Tagalog" href="/en/hymn/ht/787">T787</a>
</div>
```

Three things fall out of that markup:

- A badge rendered as `<a>` has a page on the site; a `<span>` is a hymn number
  in a book with no page to link to. Only the anchors become options, which is
  why Burmese and Korean are not offered for hymn 787.
- The `title` attribute supplies the language name for the dropdown.
- `label-success` marks the language you are currently reading, which becomes
  the heading over the left column.

The sidebar's *Languages* list is then consulted for one extra case: Hymnal.net
serves Simplified Chinese as a query variant of the same page (`/en/hymn/ch/572`
vs `/en/hymn/ch/572?gb=1`). Only sidebar links whose **path already matches a
badge** are taken, which picks up that variant while ignoring the *Relevant* and
*See Also* links to different hymns — and does so without depending on the
sidebar's English label text. Links to other sites (the Portuguese entry points
at hinario.org) are skipped, since they are a different site with a different
layout.

The chosen page is fetched with `fetch()` from the same origin and parsed with
`DOMParser`. Lyrics are read out of `article.js-stanzas`, taking `.text-container`
from each `.verse`, with `<br>` as the line break. Text is taken as text nodes
only and inserted with `textContent`, so nothing fetched is ever treated as
markup.

## Lining up verses

Translations are not always the same length: English hymn 787 has four verses,
Chinese 572 and Tagalog 787 have five. Stanzas are therefore matched by identity
rather than by position — verse 3 to verse 3, first chorus to first chorus — and
where one language has a stanza the other lacks, the opposite cell is left
blank. Each stanza pair is its own CSS grid row, so the two columns stay aligned
even when the translation runs much longer than the original.

Repeated choruses marked `js-duplicate-row` are kept or dropped according to
whether the page is in Text+ or Text, so both columns show the hymn in the same
shape the site would.

## Notes on fitting in with the site

- The button is deliberately **outside** the site's `.lyrics-format` button
  group. Hymnal.net binds `$(".lyrics-format button").on("click", …)` and clears
  `.active` across that group, so a button placed inside it would be reset by
  the site's own handler.
- The panel is a **sibling** of `.hymn-content`, not a child, because the site
  runs `$(".hymn-content > div").addClass("hidden")` whenever a format button is
  pressed.
- Pressing Text or Text+ re-renders the panel in that mode; pressing Chords,
  Piano or Guitar closes it and restores the normal view, rather than leaving
  two lyric displays fighting over the page. The site's own handler runs first
  and sets `.active`, so by the time this extension's listener fires the newly
  chosen mode is already readable from the DOM.
- The pressed state uses its own `hn-on` class instead of Bootstrap's `active`,
  because the site ships `.btn-default.active { background: … !important }` —
  which in light mode paints the button plain white and makes "on" invisible.
- Colours come from the CSS custom properties Hymnal.net defines on
  `<html data-theme="light|dark">` (`--hymn-main-color`, `--verse-num-background`,
  and so on), so the panel follows the site's own theme toggle. Every var has a
  light-mode fallback in case one is renamed.
- All injected classes are namespaced `hn-`.

## Permissions

`storage` only — it remembers the language you last picked and whether Smart
align was on, and restores both on the next hymn.

There is no `host_permissions` entry. The content script runs only on
`hymnal.net` hymn pages, and translations are same-origin requests, so no
cross-origin access is needed. Nothing is collected, stored remotely, or sent
anywhere.

## Layout

```
manifest.json          MV3 manifest
src/content.js         language discovery, fetching, alignment, rendering
src/content.css        panel and button styles, themed from the site's variables
icons/                 generated PNGs (16/32/48/128)
tools/make_icons.py    regenerates icons/ (standard library only)
```

## Known limits

- Viewing the Simplified Chinese page does not offer Traditional as the
  right-hand column (and vice versa); the cross-script pairing is only offered
  from another language's page.
- The Portuguese translation lives on hinario.org and is not shown, since
  reading it would mean granting the extension access to a second site.
- Only the Text and Text+ modes are mirrored — chords, piano and guitar
  leadsheets are left to the site's own buttons.
- Smart align only merges lines, so it can bring a longer Chinese stanza down to
  the line count opposite but cannot split a shorter one to match a longer
  translation.

## Publishing to the Chrome Web Store

The extension is Manifest V3, contains no remote code, and requests a single
low-risk permission, which is what the review process cares about. To package:

```bash
zip -r hymnal-multilingual.zip manifest.json src icons -x '*.DS_Store'
```

Upload that zip in the Developer Dashboard. For the privacy section, declare no
data collection and justify `storage` as "remembers the user's preferred
translation language."
