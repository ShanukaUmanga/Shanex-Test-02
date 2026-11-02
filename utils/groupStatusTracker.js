/**
 * Remembers group status post keys (per group, 24h) so they can be revoked later.
 * WhatsApp has no API to list a group's statuses, so only posts the bot has seen are known.
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'database', 'groupStatuses.json');
const TTL_MS = 24 * 60 * 60 * 1000;

let data = {};
let saveTimer = null;

function load() {
  try {
    if (fs.existsSync(FILE)) data = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {};
  } catch {
    data = {};
  }
  prune();
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('[groupStatusTracker] save failed:', e.message);
    }
  }, 400);
}

function prune() {
  const cutoff = Date.now() - TTL_MS;
  for (const jid of Object.keys(data)) {
    data[jid] = (data[jid] || []).filter((e) => e.ts >= cutoff);
    if (!data[jid].length) delete data[jid];
  }
}

function unwrap(message) {
  let m = message;
  for (let i = 0; i < 5 && m; i++) {
    const inner =
      m.ephemeralMessage?.message ||
      m.deviceSentMessage?.message ||
      m.viewOnceMessage?.message ||
      m.viewOnceMessageV2?.message ||
      m.documentWithCaptionMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m;
}

function isGroupStatusMessage(message) {
  const m = unwrap(message);
  return !!(m?.groupStatusMessage || m?.groupStatusMessageV2);
}

function record(key, timestamp) {
  const jid = key?.remoteJid;
  if (!jid || !jid.endsWith('@g.us') || !key.id) return;

  const secs = typeof timestamp?.toNumber === 'function' ? timestamp.toNumber() : Number(timestamp);
  const ts = secs ? secs * 1000 : Date.now();
  if (Date.now() - ts > TTL_MS) return;

  const list = data[jid] || (data[jid] = []);
  if (list.some((e) => e.key.id === key.id)) return;

  list.push({
    key: {
      remoteJid: jid,
      id: key.id,
      fromMe: !!key.fromMe,
      ...(key.participant ? { participant: key.participant } : {}),
    },
    ts,
  });
  save();
}

function recordFromMessage(msg) {
  if (!msg?.key || !isGroupStatusMessage(msg.message)) return;
  record(msg.key, msg.messageTimestamp);
}

function list(jid) {
  prune();
  return [...(data[jid] || [])];
}

function remove(jid, ids) {
  if (!data[jid]) return;
  const drop = new Set(ids);
  data[jid] = data[jid].filter((e) => !drop.has(e.key.id));
  if (!data[jid].length) delete data[jid];
  save();
}

load();

module.exports = { isGroupStatusMessage, record, recordFromMessage, list, remove };
