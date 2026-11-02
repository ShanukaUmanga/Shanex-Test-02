/**
 * Save WhatsApp statuses into the owner's own chat.
 * State: database/savestatus.json
 */

const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const config = require('../config');
const { lidToMention } = require('./jidHelper');

const STATE_FILE = path.join(__dirname, '../database/savestatus.json');
const TIMEOUT_MS = 30000;
const RECENT_MAX = 100;
const RECENT_MS = 24 * 60 * 60 * 1000;
const recent = new Map();
let enabled = false;

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8') || '{}');
    enabled = data.enabled === true;
  } catch {
    enabled = false;
  }
}

function isEnabled() {
  return enabled;
}

function setEnabled(value) {
  enabled = value === true;
  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ enabled }, null, 2));
  } catch (error) {
    console.error('[savestatus] save failed:', error.message);
  }
  return enabled;
}

loadState();

function ownerJid(sock) {
  const raw = (config.ownerNumber || [])[0] || sock?.user?.id || '';
  const num = String(raw).split(':')[0].split('@')[0].replace(/\D/g, '');
  return num.length >= 8 ? `${num}@s.whatsapp.net` : null;
}

function unwrap(message) {
  let current = message;
  for (let i = 0; i < 5 && current; i++) {
    const next = current.ephemeralMessage?.message
      || current.viewOnceMessage?.message
      || current.viewOnceMessageV2?.message
      || current.viewOnceMessageV2Extension?.message;
    if (!next) break;
    current = next;
  }
  return current || null;
}

function downloadMedia(mediaMsg, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Download timed out')), TIMEOUT_MS);
    downloadContentFromMessage(mediaMsg, type)
      .then(async (stream) => {
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        clearTimeout(timer);
        resolve(Buffer.concat(chunks));
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function authorJid(candidates) {
  return lidToMention(candidates).jid;
}

function statusHeader(mentionJid) {
  const who = lidToMention(mentionJid);
  if (!who.jid) return { text: '💾 *Saved Status*', mentions: [] };
  return { text: `💾 *Saved Status* from ${who.text}`, mentions: who.mentions };
}

function remember(msg) {
  if (!msg?.key?.id || msg.key.fromMe) return;
  recent.set(msg.key.id, { msg, at: Date.now() });
  while (recent.size > RECENT_MAX) {
    const oldest = recent.keys().next().value;
    recent.delete(oldest);
  }
}

function findRecent(id) {
  if (!id) return null;
  const hit = recent.get(id);
  if (!hit) return null;
  if (Date.now() - hit.at > RECENT_MS) {
    recent.delete(id);
    return null;
  }
  return hit.msg;
}

function contextOf(msg) {
  const raw = unwrap(msg?.message) || msg?.message || {};
  return raw.extendedTextMessage?.contextInfo
    || raw.imageMessage?.contextInfo
    || raw.videoMessage?.contextInfo
    || raw.audioMessage?.contextInfo
    || raw.stickerMessage?.contextInfo
    || null;
}

async function saveStatusContent(sock, destJid, content, header, mentions = []) {
  const quoted = unwrap(content);
  if (!quoted) throw new Error('Empty status');
  const mention = mentions.filter(Boolean);
  const withMentions = (payload) => (mention.length ? { ...payload, mentions: mention } : payload);

  if (quoted.imageMessage) {
    const buf = await downloadMedia(quoted.imageMessage, 'image');
    const caption = quoted.imageMessage.caption || '';
    await sock.sendMessage(destJid, withMentions({
      image: buf,
      caption: caption ? `${header}\n\n${caption}` : header,
    }));
    return 'image';
  }
  if (quoted.videoMessage) {
    const buf = await downloadMedia(quoted.videoMessage, 'video');
    const caption = quoted.videoMessage.caption || '';
    await sock.sendMessage(destJid, withMentions({
      video: buf,
      caption: caption ? `${header}\n\n${caption}` : header,
      mimetype: 'video/mp4',
    }));
    return 'video';
  }
  if (quoted.audioMessage) {
    const buf = await downloadMedia(quoted.audioMessage, 'audio');
    await sock.sendMessage(destJid, withMentions({ text: header }));
    await sock.sendMessage(destJid, {
      audio: buf,
      mimetype: quoted.audioMessage.mimetype || 'audio/ogg; codecs=opus',
      ptt: !!quoted.audioMessage.ptt,
    });
    return 'audio';
  }
  const text = quoted.conversation || quoted.extendedTextMessage?.text;
  if (text) {
    await sock.sendMessage(destJid, withMentions({ text: `${header}\n\n${text}` }));
    return 'text';
  }
  throw new Error('Unsupported status type');
}

async function autoSave(sock, msg) {
  remember(msg);
  if (!enabled || msg.key?.fromMe) return;
  const age = msg.messageTimestamp ? Date.now() - (Number(msg.messageTimestamp) * 1000) : 0;
  if (age > 10 * 60 * 1000) return;
  const dest = ownerJid(sock);
  if (!dest) return;
  const header = statusHeader(authorJid([
    msg.key.participantAlt,
    msg.key.participant,
    msg.key.remoteJidAlt,
  ]));
  try {
    await saveStatusContent(sock, dest, msg.message, header.text, header.mentions);
  } catch (error) {
    if (error.message === 'Unsupported status type' || error.message === 'Empty status') return;
    throw error;
  }
}

module.exports = {
  isEnabled,
  setEnabled,
  ownerJid,
  unwrap,
  saveStatusContent,
  autoSave,
  authorNumber: authorJid,
  authorJid,
  statusHeader,
  contextOf,
  findRecent,
};
