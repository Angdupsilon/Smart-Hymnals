/*
 * Hymnal.net Multilingual Lyrics -- feedback relay.
 *
 * The content script hands feedback here rather than posting it itself, for
 * two reasons: a request made from the service worker is not subject to
 * hymnal.net's page CSP, and the form endpoint is never visible to the page.
 *
 * FEEDBACK_ENDPOINT is a write-only Formspree form URL. It cannot be used to
 * read past submissions or to reach the owner's account, so publishing it in
 * the extension only risks unsolicited posts to that one form -- which the
 * honeypot below, Formspree's own spam filtering, and the rate limit here are
 * there to blunt. If it is ever abused, delete the form in Formspree and paste
 * in a new URL.
 */

var FEEDBACK_ENDPOINT = 'https://formspree.io/f/mykrqzzv';

var RATE_KEY = 'hymnalFeedbackRate';
var MIN_GAP_MS = 60 * 1000;   // no more than one message a minute
var DAILY_CAP = 10;           // and no more than ten a day
var MAX_MESSAGE = 2000;

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (!request || request.type !== 'hymnal-feedback') return false;

  submitFeedback(request.payload, sender)
    .then(sendResponse)
    .catch(function () {
      sendResponse({ ok: false, error: 'Could not send. Please try again later.' });
    });

  return true; // keep the message channel open for the async reply
});

function submitFeedback(payload, sender) {
  payload = payload || {};

  if (!FEEDBACK_ENDPOINT) {
    return Promise.resolve({
      ok: false,
      error: 'Feedback is not configured in this build of the extension.'
    });
  }

  // Silently accept anything a bot filled into the honeypot, so it gets no
  // signal about what was rejected.
  if (payload._gotcha) return Promise.resolve({ ok: true });

  var message = String(payload.message || '').trim();
  if (!message) return Promise.resolve({ ok: false, error: 'Please write a message first.' });
  if (message.length > MAX_MESSAGE) message = message.slice(0, MAX_MESSAGE);

  var email = String(payload.email || '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Promise.resolve({ ok: false, error: 'That email address does not look right.' });
  }

  // Trust the sender's own URL over anything the page could have put in the
  // payload, and only accept hymnal.net pages.
  var page = (sender && sender.tab && sender.tab.url) || String(payload.page || '');
  if (!/^https:\/\/(www\.)?hymnal\.net\//.test(page)) page = '';

  return checkRate().then(function (verdict) {
    if (!verdict.ok) return verdict;

    var body = {
      message: message,
      page: page,
      version: chrome.runtime.getManifest().version,
      _subject: 'Hymnal.net Multilingual feedback'
    };
    if (email) body.email = email;

    return fetch(FEEDBACK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    }).then(function (response) {
      if (!response.ok) {
        return { ok: false, error: 'The feedback service rejected that (' + response.status + ').' };
      }
      return recordSend().then(function () { return { ok: true }; });
    }).catch(function () {
      return { ok: false, error: 'No network connection to the feedback service.' };
    });
  });
}

/** One a minute, ten a day -- enough for real feedback, not enough to flood. */
function checkRate() {
  return new Promise(function (resolve) {
    chrome.storage.local.get(RATE_KEY, function (items) {
      var now = Date.now();
      var state = (items && items[RATE_KEY]) || { last: 0, day: '', count: 0 };
      var today = new Date(now).toISOString().slice(0, 10);

      if (state.day !== today) {
        state.day = today;
        state.count = 0;
      }
      if (now - (state.last || 0) < MIN_GAP_MS) {
        return resolve({ ok: false, error: 'Just a moment before sending another message.' });
      }
      if (state.count >= DAILY_CAP) {
        return resolve({ ok: false, error: 'That is enough feedback for one day — thank you!' });
      }
      resolve({ ok: true });
    });
  });
}

function recordSend() {
  return new Promise(function (resolve) {
    chrome.storage.local.get(RATE_KEY, function (items) {
      var now = Date.now();
      var state = (items && items[RATE_KEY]) || { last: 0, day: '', count: 0 };
      var today = new Date(now).toISOString().slice(0, 10);

      if (state.day !== today) {
        state.day = today;
        state.count = 0;
      }
      state.last = now;
      state.count += 1;

      var payload = {};
      payload[RATE_KEY] = state;
      chrome.storage.local.set(payload, function () {
        void chrome.runtime.lastError;
        resolve();
      });
    });
  });
}
