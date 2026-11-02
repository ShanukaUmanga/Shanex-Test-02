'use strict';

// Real TLDs only. Bare "word.word" counts as a link ONLY if the TLD is here.
const TLDS = new Set([
  'com', 'net', 'org', 'io', 'co', 'in', 'me', 'app', 'dev', 'xyz', 'info', 'biz', 'link', 'site', 'online',
  'store', 'shop', 'live', 'tv', 'gg', 'ly', 'to', 'cc', 'ai', 'us', 'uk', 'pk', 'ng', 'id', 'ru', 'de', 'fr',
  'br', 'tk', 'ml', 'ga', 'cf', 'gq', 'top', 'club', 'fun', 'vip', 'pro', 'click', 'page', 'tech', 'space',
  'website', 'icu', 'buzz', 'in.net', 'co.in', 'co.uk', 'com.br', 'com.ng', 'com.pk',
]);

// Always treat as links (short/invite domains), even without protocol
const ALWAYS = /\b(chat\.whatsapp\.com|wa\.me|whatsapp\.com\/channel|t\.me|telegram\.me|discord\.gg|discord\.com\/invite|bit\.ly|tinyurl\.com|youtu\.be|instagram\.com|tiktok\.com|fb\.me|goo\.gl|is\.gd|cutt\.ly|rb\.gy)\b/i;

const PROTO = /\b(?:https?:\/\/|www\.)\S+/i;

// bare domain: label(.label)*.tld, optional path. Labels must be 2+ chars to skip "a.b"
const BARE = /(?<![@\w.-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+)([a-z]{2,24})(?=$|[\/\s:?#)\]},!'".])/gi;

function stripBypassChars(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF\u180E]/g, '');
}

function unwrapMessage(message) {
  let m = message;
  if (!m || typeof m !== 'object') return {};
  if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
  if (m.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;
  if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;
  if (m.viewOnceMessageV2Extension?.message) m = m.viewOnceMessageV2Extension.message;
  if (m.documentWithCaptionMessage?.message) m = m.documentWithCaptionMessage.message;
  return m || {};
}

function hasLink(text = '') {
  if (!text) return false;
  const t = stripBypassChars(text);
  if (PROTO.test(t) || ALWAYS.test(t)) return true;

  for (const m of t.matchAll(BARE)) {
    const labels = m[1].slice(0, -1).split('.');
    const tld = m[2].toLowerCase();
    const sld = `${labels[labels.length - 1].toLowerCase()}.${tld}`;
    if (labels.some((l) => /^\d+$/.test(l)) && /^\d/.test(m[0])) continue; // "1.5x", "2.0"
    if (TLDS.has(sld) || TLDS.has(tld)) {
      if (labels[labels.length - 1].length >= 2) return true;
    }
  }
  return false;
}

function msgHasLink(msg) {
  const m = unwrapMessage(msg?.message);
  const ext = m.extendedTextMessage;
  if (ext?.matchedText || ext?.canonicalUrl) return true;
  const body = m.conversation
    || ext?.text
    || m.imageMessage?.caption
    || m.videoMessage?.caption
    || m.documentMessage?.caption
    || '';
  return hasLink(body);
}

module.exports = { hasLink, msgHasLink };
