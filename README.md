# Smart Hymnals

A Chrome extension that adds smart tools to hymn pages on
[hymnal.net](https://www.hymnal.net):

- **Multilingual lyrics** — a button beside the site's Text / Lead Sheet
  controls shows the hymn in two columns: the page's own language on the left,
  any available translation on the right, chosen with a dropdown above the
  right column. It follows the site's Repeat Chorus and Show Chords boxes, so
  both columns always show what the page is showing.
- **Sharper repeat chords** — Hymnal.net repeats verse one's chords through the
  later stanzas by word; this places them by syllable instead, which is what
  stanzas of a shared metre actually have in common.
- **Smart align** — merges Chinese lines so the columns read across line for
  line against an English translation.
- **Transposing** — the site's key control keeps working, retuning both columns
  and any repeated stanzas at once.

and one to song pages on [songbase.life](https://songbase.life):

- **Repeat chords** — the same idea over Songbase's own markup, as a toggle
  beside its transpose control. See [Songbase](#songbase) below.

## Installing

Chrome does not allow installing an unpacked extension from a `.zip`, so load
the folder directly:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Open any hymn page, e.g. <https://www.hymnal.net/en/hymn/h/787>, or any
   Songbase song, e.g. <https://songbase.life/songs/1>.

The **Multilingual** button appears next to Text / Lead Sheet. It is only added
when the hymn actually has a translation to show.

## Lyric modes

Hymnal.net's September 2026 update replaced its five-button format group — Text,
Text+, Chords, Piano, Guitar — with two buttons and three checkboxes. Piano and
Guitar became one transposable **Lead Sheet**; Text+ became **Repeat Chorus**,
Chords became **Show Chords**, and the site added a **Repeat Chords** of its
own. This extension reads those controls rather than keeping its own copy, so
the panel mirrors whatever the reader has switched on:

- **Repeat Chorus** — the chorus after every stanza, matching what the site does
  when it unhides its `js-duplicate-row` rows.
- **Show Chords** — chords stacked over the words, in both languages.

Ticking either while the panel is open re-renders it in place. The button is
greyed out in **Lead Sheet**, which is an engraved image with no second-language
equivalent; choosing it closes the panel and hands the page back to the site.

## Repeat chords

Hymnal.net prints chords over the first verse and the first chorus only. It now
carries them through the later stanzas itself, rendering them into a second
`.repeat-chord-container` beside each stanza's plain one and swapping the two
with its **Repeat Chords** box.

It places them by word, though. A chord falling inside a word lands at the start
of it, and two chords sharing a word are printed together — verse 2 of 787 comes
out `[A]He will [Bm D]deliver,` where the metre puts them on `de[Bm]li[D]ver,`.
Hymn 1 verse 5 is starker: `[E♭ E♭7 A♭]Worshippers!` against a first verse that
sings `[E♭]Ev [E♭7]er [A♭]One.`

Rather than offering a second control saying the same thing as the site's, this
extension rewrites the site's own containers in place, by syllable:
`[E♭]Wors[E♭7]hip[A♭]pers!`. The site's checkbox stays in charge of whether the
repeats show at all — only their placement changes — and unticking it restores
the site's markup exactly.

The originals are parked in a hidden child of the container rather than
detached, because the site transposes with a document-wide
`$(".chord").each(...)`: a detached copy would sit out every key change and come
back in the wrong key, while a hidden one is retuned along with everything else.

Chords are placed by **syllable**, not by character position. Hymn stanzas share
a metre — 787 is 10.9.10.9 — so the nth syllable of a line falls on the same
note in every stanza. Verse 1 line 3 carries `A7 · D · A · Bm · D` on syllables
0, 3, 5, 8, 9, and each later stanza receives them on its own syllables 0, 3, 5,
8, 9:

| | line |
|---|---|
| v1 | `[A7]In my dis[D]tress He [A]kindly will [Bm]help [D]me;` |
| v2 | `[A7]If I but [D]ask Him, [A]He will de[Bm]li[D]ver,` |
| v3 | `[A7]I must tell [D]Jesus, [A]I must tell [Bm]Je[D]sus;` |
| v4 | `[A7]I must tell [D]Jesus; [A]He will e[Bm]nab[D]le` |

Chinese is exact here — one character to a syllable. English is estimated from
vowel groups, with the usual silent-`e` cases handled (`alone`, `loves`,
`loved` are one syllable at the end; `table`, `roses`, `tempted` are not). The
estimate does not have to be linguistically perfect, only *consistent*, since
the same estimator reads the stanza the chords come from and the stanza they
land on. Where it does drift, each chord is matched to the **nearest** syllable
boundary rather than the preceding one, which absorbs an off-by-a-character
split such as `dis|tress` against `dist|ress`.

## Transposing

The site's key up/down control keeps working while the panel is open. It used to
be borrowed into the panel's heading, because it sat inside `.hymn-content` and
went away with it; the update moved it up into the site's own format row, which
stays on show, so it is now left where it is and left to the site to hide and
reveal.

Every chord this extension draws is tagged with the site's `chord` class, and
the site transposes with a document-wide `$(".chord").each(...)`, so one press
retunes both columns and any repeated stanzas at once. The one gap is the
translation column: it is parsed from a separately fetched page, so its chords
arrive in that page's printed key and are shifted to the current key before
being drawn.

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

The chosen language and Smart align are saved with `chrome.storage.local` and
restored on the next hymn you open. Repeat Chorus, Show Chords and Repeat Chords
belong to the site, which remembers them in its own `localStorage`.

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
the site's Repeat Chorus box, so both columns show the hymn in the same shape
the site would.

## Notes on fitting in with the site

- The button is deliberately **outside** the site's `.lyrics-format` button
  group. Hymnal.net binds `$(".lyrics-format button").on("click", …)` and clears
  `.active` across that group, so a button placed inside it would be reset by
  the site's own handler.
- The panel is a **sibling** of `.hymn-content`, not a child, because the site
  runs `$(".hymn-content > div").addClass("hidden")` whenever a format button is
  pressed.
- While the panel is open it hides `.hymn-content .lyrics`, **not**
  `.hymn-content` itself. The lead sheet is the lyrics' sibling inside that
  block, and the site sizes its engraving once, from `$(".leadsheet").width()`
  read the instant the button is pressed. The site's handler runs before this
  extension's, so hiding the whole block had that measurement taken inside
  `display: none` -- the sheet came out 30px wide and stayed there, since
  nothing re-measures it afterwards. Hiding the lyrics alone leaves the block
  laid out; the site keeps `hidden` on everything else in it anyway.
- Ticking Repeat Chorus or Show Chords re-renders the panel; pressing Lead
  Sheet closes it and restores the normal view, rather than leaving two lyric
  displays fighting over the page. The site's own handlers run first, so by the
  time this extension's listeners fire the page has already settled into its new
  state and can simply be read back.
- The one/two-column control belongs to the single-column lyrics, which are
  hidden while the panel is open. The site decides whether to offer it by
  measuring them, and only re-measures on a window resize, so opening and
  closing the panel fires one — asking through the site's own path rather than
  reaching into its state.
- The pressed state uses its own `hn-on` class instead of Bootstrap's `active`,
  because the site ships `.btn-default.active { background: … !important }` —
  which in light mode paints the button plain white and makes "on" invisible.
- The site's navbar search is `hidden-xs hidden-sm col-md-3`, so between 768 and
  991px wide Hymnal.net hides it and leaves it reachable only inside the *More*
  dropdown. That band is still the desktop layout — a half-width window, or a
  tablet held sideways — and search is the main way to reach another hymn, so
  the extension puts it back. It cannot go beside the menu there (the container
  is 750px and the menu already runs to about 660), so it takes a full-width row
  of its own under the links; the navbar is two rows tall in that band as a
  result. This is the site's own behaviour, not something the extension caused —
  it is fixed here because losing the search bar on a desktop screen is worse
  than a taller navbar.
- Colours come from the CSS custom properties Hymnal.net defines on
  `<html data-theme="light|dark">` (`--hymn-main-color`, `--verse-num-background`,
  and so on), so the panel follows the site's own theme toggle. Every var has a
  light-mode fallback in case one is renamed.
- All injected classes are namespaced `hn-`.

## Songbase

[songbase.life](https://songbase.life) has the same gap: the chords are printed
over the first stanza and the first chorus, and every later stanza repeats the
bare words. A **Repeat chords** checkbox appears beside its transpose control
and carries them through, verses taking a verse's chords and choruses a
chorus's.

The syllable matching is the identical problem, so it is the identical code —
[`src/chords.js`](src/chords.js) is shared by both content scripts. What differs
is the markup at each end, and Songbase's is quite unlike Hymnal.net's. A chord
is an empty span sitting *inside* the word, at the character it hangs over:

```html
<div class="line">What a <span class="chord-word">w<span class="chord"
   data-uncopyable-text="G"></span>onderful</span> change in my life ...</div>
```

The label is drawn by CSS — `[data-uncopyable-text]::after { content: attr(…) }`
out of an absolutely positioned box — which is why the span is empty and why a
chord does not disturb the words underneath it. Repeating chords therefore means
writing exactly that shape back out, so the site's own stylesheet lays the result
out and nothing here has to know how a chord is drawn. Chords are hung one word
to a `.chord-word`, as the site does, because that element is `inline-block`:
wrapping a run of words in a single one would stop a long line breaking anywhere
inside it.

Three things follow from Songbase being a React app rather than a server-rendered
page:

- **Every render wipes everything injected.** Pressing transpose replaces the
  whole of `.lyrics` from source — one `childList` mutation, every node out and
  back in — taking the checkbox with it. So the script re-adds the toggle and
  re-applies the chords after each render, watched for with a `MutationObserver`.
- **That makes transposing free.** By the time the observer fires, the site has
  already retuned the first stanza, so re-reading it copies the new chords
  across. There is no key arithmetic on this side at all.
- **Navigation is the same event.** Songbase never reloads the page, so opening
  another song is just another render, and the observer picks it up. The chosen
  setting carries from song to song, and from Hymnal.net, since both scripts keep
  it under the same key.

Switching the toggle off restores the site's own nodes: the original children of
every rewritten line are kept in a `WeakMap` and put back, rather than
re-deriving them.

### Where the toggle sits

`.song-controls` is a two-column grid, `3fr 1fr`, with the transpose control
pinned to the narrow right-hand cell. The toggle takes the wide left one, so the
two read as a single row.

That cell is not always free. A song with more than one tune — hymn 1608, say —
gets a `.tune-selector` there, and it is `position: relative` where a plain label
is `static`, so it painted over the toggle and **took every click**: the box could
not be ticked at all, the tune menu opened instead. Overlapping controls are
invisible in a screenshot; `document.elementFromPoint` over the label returned
`DIV.tune-selector`, which is what named it.

The toggle now takes a row of its own whenever anything else occupies that cell.
The test is deliberately not "is there a `.tune-selector`" but "does any child
other than the transpose control actually take a grid cell" — the bookmark, share
and music buttons are `position: absolute` and take none, so they do not count,
and a control the site adds later will be handled without a code change. The
label also carries `position: relative` so it wins the paint order regardless.

The checkbox only appears where it has something to do — a song with no chords
at all, or one the site has chorded throughout, does not get one.

Songbase's Chinese lyrics are left character for character. Hymnal.net sets its
own Chinese chord lines with a gap after each character and the extension has to
match it to sit beside them, but Songbase rewrites its lines in place, where
adding spaces would be editing the lyrics; hence the `spaceChinese` opt-out in
the shared code.

## Feedback

A **Feedback** button opens a short form — message, optional email — that posts
straight to you. The reader needs no account and no login anywhere.

It sits in the extension's own control strip, beside Multilingual and Repeat
chords and divided off from Hymnal.net's format buttons, so it is easy to spot
and reads as part of the extension rather than part of the site. It is there on
every hymn page whether or not the multilingual view is open; the form drops in
directly beneath the strip that opened it.

### Why Formspree

The requirement was: readers send feedback without signing in to anything, and
it must not put the owner's account at risk. That rules most options out.

| | verdict |
|---|---|
| **Formspree** | **Recommended.** Free tier ~50 messages/month. You get an opaque form id; your email address never appears in the extension. Real CORS + JSON API, so the form can report success or failure honestly. Spam filtering and a honeypot field are built in. |
| GitHub issues | Rejected — needs the reader to have a GitHub account and be logged in. Creating issues on their behalf would mean shipping a personal access token inside a public extension: a credential with write access to your repos, extractable by anyone. Exactly the account compromise to avoid. |
| `mailto:` | Rejected — publishes your address to scrapers, needs a configured mail client, and most readers abandon it. |
| Google Forms | Workable fallback if you outgrow 50/month — free and unlimited, but submissions must be sent `no-cors`, so the page cannot tell whether it worked and would have to claim success blindly. |
| Own backend / Worker | Most control, but something to host, secure and maintain for a feedback box. |

The form id is write-only. Published in the extension it cannot read past
submissions or reach your account — the worst case is unwanted posts to that one
form, which is what the protections below are for. If it is ever abused, delete
the form in Formspree and paste in a new id.

### Wiring it up

`FEEDBACK_ENDPOINT` at the top of [`src/background.js`](src/background.js) is
already set to `https://formspree.io/f/mykrqzzv`. To point it somewhere else,
create a form at [formspree.io](https://formspree.io) and replace that value.
Left blank, the Send button reports that feedback is not configured rather than
failing silently.

Formspree asks you to confirm the first submission to a new form by email, so
send yourself one test message after loading the extension.

### How it is kept from being abused

- **Posted from the service worker**, not the content script, so the request is
  not subject to hymnal.net's page CSP and the endpoint is never visible to the
  page.
- **Honeypot** — a `_gotcha` field hidden off-screen. Bots fill it; Formspree
  discards those. It is positioned away rather than `display:none` so a bot
  filling every field still takes the bait.
- **Rate limited** in the worker: one message a minute, ten a day.
- **The page URL is taken from the sender tab**, not from the message body, and
  only hymnal.net pages are accepted — so nothing on the page can forge it.
- Message capped at 2000 characters; the email field is optional and validated.

## Permissions

- `storage` — remembers the language and toggles you last chose.
- `host_permissions: https://formspree.io/*` — solely so the service worker can
  post the feedback form. Remove both this and `src/background.js` if you drop
  the feedback feature.

Translations are same-origin requests from a hymnal.net page, so they need no
permission of their own. Nothing is collected or transmitted except a feedback
message you type and send yourself.

## Layout

```
manifest.json          MV3 manifest
src/chords.js          syllables and chord transfer; shared by both sites
src/content.js         hymnal.net: language discovery, fetching, alignment, rendering
src/content.css        hymnal.net: panel and button styles, themed from its variables
src/songbase.js        songbase.life: repeat chords, re-applied on every React render
src/songbase.css       songbase.life: the toggle, themed from its variables
src/background.js      service worker; relays feedback, rate limits it
icons/                 generated PNGs (16/32/48/128)
tools/make_icons.py    regenerates icons/ (standard library only)
```

## Known limits

- Viewing the Simplified Chinese page does not offer Traditional as the
  right-hand column (and vice versa); the cross-script pairing is only offered
  from another language's page.
- The Portuguese translation lives on hinario.org and is not shown, since
  reading it would mean granting the extension access to a second site.
- The lead sheet is an engraved image, so it is left to the site's own button.
- Repeat chords are placed from the whole stanza's syllable stream, so a line
  the estimator over-counts can pull the next line's first chord back onto it.
  Hymn 1 verse 5 loses its third line's opening `A♭` this way.
- Smart align only merges lines, so it can bring a longer Chinese stanza down to
  the line count opposite but cannot split a shorter one to match a longer
  translation.
- English syllable splitting is a heuristic. Chords land on the right syllable,
  but the letters a chord sits over can break a shade off inside a long word
  (`e-nab-le` rather than `e-na-ble`). Chinese is exact.
- Repeat chords assumes stanzas of a hymn share a metre, which is what makes one
  tune fit them all. A hymn with an irregular stanza will place those chords
  loosely. Where a later stanza has fewer lines than the one the chords come
  from, the extra lines are simply left bare.
- On Songbase, only the toggle's own state is added to the page; the site keeps
  no per-song setting, so a song opened fresh is chorded straight away rather
  than remembering that this particular song was left alone.

## Publishing to the Chrome Web Store

The extension is Manifest V3, contains no remote code, and requests a single
low-risk permission, which is what the review process cares about. To package:

```bash
zip -r smart-hymnals.zip manifest.json src icons -x '*.DS_Store'
```

Upload that zip in the Developer Dashboard. For the privacy section, declare no
data collection and justify `storage` as "remembers the user's preferred
translation language."
