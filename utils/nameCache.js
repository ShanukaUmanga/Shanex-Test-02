const fs = require('fs');
const path = require('path');
const jidHelper = require('./jidHelper');

const FILE = path.join(__dirname, '..', 'database', 'cardNames.json');
const names = new Map();

function isNiceName(value) {
  const t = String(value || '').trim();
  if (!t || t.length < 2) return false;
  if (/^\d+$/.test(t) || t.startsWith('+') || t.includes('@')) return false;
  if (/^(unknown|this person)$/i.test(t)) return false;
  return true;
}

function keyVariants(jid) {
  if (!jid) return [];
  const raw = String(jid);
  const user = raw.split('@')[0].split(':')[0];
  if (!user) return [];
  return [
    raw,
    raw.split(':')[0],
    user,
    `${user}@s.whatsapp.net`,
    `${user}@lid`,
    `${user}@hosted.lid`,
  ];
}

function allKeys(jid) {
  const keys = new Set(keyVariants(jid));
  if (typeof jidHelper.buildComparableIds === 'function') {
    for (const id of jidHelper.buildComparableIds(jid) || []) {
      for (const key of keyVariants(id)) keys.add(key);
    }
  }
  return [...keys];
}

function load() {
  try {
    if (!fs.existsSync(FILE)) return;
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const [key, value] of Object.entries(data || {})) {
      if (isNiceName(value)) names.set(key, String(value).trim());
    }
  } catch {}
}

let writeTimer;
function saveSoon() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(Object.fromEntries(names)));
    } catch {}
  }, 400);
}

function rememberName(jid, name) {
  if (!jid || /@(g\.us|broadcast|newsletter)\b/i.test(String(jid))) return;
  if (!isNiceName(name)) return;
  const n = String(name).trim();
  for (const key of allKeys(jid)) names.set(key, n);
  saveSoon();
}

function lookupName(...jids) {
  for (const jid of jids.flat().filter(Boolean)) {
    for (const key of allKeys(jid)) {
      if (names.has(key)) return names.get(key);
    }
  }
  return '';
}

function rememberFromMessage(msg) {
  if (!msg) return;
  const name = msg.pushName;
  if (!isNiceName(name)) return;
  rememberName(msg.key?.participant, name);
  rememberName(msg.key?.participantAlt, name);
  rememberName(msg.key?.senderPn, name);
  rememberName(msg.key?.senderLid, name);
  // In a DM sent by the bot, remoteJid is the other person but pushName is the bot's.
  if (!msg.key?.fromMe && msg.key?.remoteJid && !String(msg.key.remoteJid).endsWith('@g.us')) {
    rememberName(msg.key.remoteJid, name);
  }
}

function rememberContact(contact) {
  if (!contact) return;
  const name = contact.notify || contact.name || contact.verifiedName || contact.pushname;
  rememberName(contact.id, name);
  rememberName(contact.lid, name);
  rememberName(contact.phoneNumber, name);
  rememberName(contact.jid, name);
}

load();

module.exports = {
  isNiceName,
  rememberName,
  lookupName,
  rememberFromMessage,
  rememberContact,
};
