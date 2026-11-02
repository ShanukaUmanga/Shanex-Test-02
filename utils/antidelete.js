/**
 * Anti-delete: owner toggle. Watches groups and private chats.
 * Recovered messages go to the owner DM.
 * Media is saved to temp at arrival because the CDN link usually dies after revoke.
 */

const fs = require('fs');
const path = require('path');
const { downloadMediaMessage, proto, WAMessageStubType } = require('@whiskeysockets/baileys');
const config = require('../config');
const { getTempDir, deleteTempFile } = require('./tempManager');

const STATE_FILE = path.join(__dirname, '../database/antidelete.json');
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

function setEnabled(value) {
  enabled = value === true;
  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ enabled }, null, 2));
  } catch (error) {
    console.error('[antidelete] save failed:', error.message);
  }
  if (!enabled) {
    for (const [jid, chat] of cache) {
      for (const id of [...chat.keys()]) dropEntry(jid, id);
    }
  }
  return enabled;
}

function isEnabled() {
  return enabled;
}

loadState();

const cache = new Map();
const handled = new Set();
const MAX_AGE_MS = 15 * 60 * 1000;
const MAX_PER_CHAT = 40;
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

const MEDIA_TYPES = {
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'document',
  stickerMessage: 'sticker',
};

function unwrap(message) {
  let current = message;
  for (let i = 0; i < 5 && current; i++) {
    const next = current.ephemeralMessage?.message
      || current.viewOnceMessage?.message
      || current.viewOnceMessageV2?.message
      || current.viewOnceMessageV2Extension?.message
      || current.documentWithCaptionMessage?.message;
    if (!next) break;
    current = next;
  }
  return current || null;
}

function isWatched(jid) {
  if (!enabled || !jid) return false;
  if (jid.includes('@broadcast') || jid.includes('@newsletter')) return false;
  return jid.endsWith('@g.us')
    || jid.endsWith('@s.whatsapp.net')
    || jid.endsWith('@lid');
}

function ownerJids() {
  return (config.ownerNumber || [])
    .map((n) => String(n).replace(/\D/g, ''))
    .filter((n) => n.length >= 10)
    .map((n) => `${n}@s.whatsapp.net`);
}

function protocolOf(msg) {
  return unwrap(msg?.message)?.protocolMessage || null;
}

function isRevoke(msg) {
  const protoMsg = protocolOf(msg);
  return protoMsg?.type === proto.Message.ProtocolMessage.Type.REVOKE && !!protoMsg.key?.id;
}

function markHandled(jid, id) {
  const key = `${jid}:${id}`;
  if (handled.has(key)) return false;
  handled.add(key);
  setTimeout(() => handled.delete(key), 2 * 60 * 1000);
  return true;
}

function dropEntry(jid, id) {
  const chat = cache.get(jid);
  const entry = chat?.get(id);
  if (!entry) return;
  if (entry.mediaPath) deleteTempFile(entry.mediaPath);
  chat.delete(id);
  if (chat.size === 0) cache.delete(jid);
}

function trimChat(jid) {
  const chat = cache.get(jid);
  if (!chat || chat.size <= MAX_PER_CHAT) return;
  const oldest = [...chat.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt);
  while (chat.size > MAX_PER_CHAT && oldest.length) {
    const [id] = oldest.shift();
    dropEntry(jid, id);
  }
}

function sweep() {
  const now = Date.now();
  for (const [jid, chat] of cache) {
    if (!isWatched(jid)) {
      for (const id of [...chat.keys()]) dropEntry(jid, id);
      continue;
    }
    for (const [id, entry] of chat) {
      if (now - entry.cachedAt > MAX_AGE_MS) dropEntry(jid, id);
    }
  }
}
const sweepTimer = setInterval(sweep, 5 * 60 * 1000);
if (typeof sweepTimer.unref === 'function') sweepTimer.unref();

async function cacheMessage(sock, msg) {
  const jid = msg.key?.remoteJid;
  if (!jid || msg.key.fromMe || !isWatched(jid) || isRevoke(msg)) return;

  const inner = unwrap(msg.message);
  if (!inner) return;

  const contentType = Object.keys(MEDIA_TYPES).find((key) => inner[key]);
  const text = inner.conversation || inner.extendedTextMessage?.text || '';
  const mediaNode = contentType ? inner[contentType] : null;
  const caption = mediaNode?.caption || '';
  if (!text && !mediaNode) return;

  if (!cache.has(jid)) cache.set(jid, new Map());
  cache.get(jid).set(msg.key.id, {
    contentType: contentType || 'conversation',
    text: text || caption,
    caption,
    mimetype: mediaNode?.mimetype || null,
    ptt: !!mediaNode?.ptt,
    fileName: mediaNode?.fileName || null,
    sender: msg.key.participant || msg.key.remoteJid,
    mediaPath: null,
    cachedAt: Date.now(),
  });
  trimChat(jid);

  if (!mediaNode) return;
  try {
    const buffer = await downloadMediaMessage(
      msg,
      'buffer',
      {},
      { reuploadRequest: sock.updateMediaMessage }
    );
    const entry = cache.get(jid)?.get(msg.key.id);
    if (!entry) return;
    if (!buffer?.length || buffer.length > MAX_MEDIA_BYTES) return;
    const mediaPath = path.join(getTempDir(), `antidel_${msg.key.id}`);
    fs.writeFileSync(mediaPath, buffer);
    if (!cache.get(jid)?.get(msg.key.id)) {
      deleteTempFile(mediaPath);
      return;
    }
    entry.mediaPath = mediaPath;
  } catch {
    // text/caption still gets forwarded if the file cannot be saved
  }
}

async function groupLabel(sock, jid) {
  try {
    const meta = await sock.groupMetadata(jid);
    return meta?.subject || 'group';
  } catch {
    return 'group';
  }
}

async function chatLabel(sock, jid) {
  if (!jid.endsWith('@g.us')) {
    const num = String(jid).split('@')[0] || 'unknown';
    return { where: 'DM', name: `@${num}`, mention: jid };
  }
  const name = await groupLabel(sock, jid);
  return { where: 'Group', name, mention: null };
}

async function sendRecovered(sock, jid, entry, deleter) {
  const owners = ownerJids();
  if (!owners.length || !entry) return;

  const place = await chatLabel(sock, jid);
  const deleterNum = String(deleter || '').split('@')[0] || 'unknown';
  const senderNum = String(entry.sender || '').split('@')[0] || 'unknown';
  const header = `🗑️ *Deleted message*\n${place.where}: ${place.name}\nBy: @${deleterNum}\nFrom: @${senderNum}`;
  const mentions = [deleter, entry.sender, place.mention].filter(Boolean);

  for (const owner of owners) {
    if (entry.mediaPath && fs.existsSync(entry.mediaPath)) {
      const kind = MEDIA_TYPES[entry.contentType] || 'document';
      const file = fs.readFileSync(entry.mediaPath);
      const payload = { [kind]: file, mentions };
      if (kind === 'image' || kind === 'video') {
        payload.caption = entry.caption ? `${header}\n\n${entry.caption}` : header;
      }
      if (kind === 'audio') {
        payload.mimetype = entry.mimetype || 'audio/ogg; codecs=opus';
        payload.ptt = entry.ptt;
      }
      if (kind === 'document') {
        payload.mimetype = entry.mimetype || 'application/octet-stream';
        payload.fileName = entry.fileName || 'file';
        payload.caption = header;
      }
      await sock.sendMessage(owner, payload);
      if (kind === 'audio' || kind === 'sticker') {
        await sock.sendMessage(owner, { text: header, mentions });
      }
    } else {
      const body = entry.text || 'Media could not be saved.';
      await sock.sendMessage(owner, { text: `${header}\n\n${body}`, mentions });
    }
  }
}

async function recover(sock, jid, messageId, deleter) {
  if (!isWatched(jid) || !messageId) return;
  if (!markHandled(jid, messageId)) return;
  const entry = cache.get(jid)?.get(messageId);
  if (!entry) return;
  try {
    await sendRecovered(sock, jid, entry, deleter);
  } catch (error) {
    console.error('[antidelete] resend failed:', error.message);
  } finally {
    dropEntry(jid, messageId);
  }
}

async function onMessage(sock, msg) {
  if (isRevoke(msg)) {
    const protoMsg = protocolOf(msg);
    const jid = protoMsg.key.remoteJid || msg.key.remoteJid;
    const deleter = msg.key.participant || msg.key.remoteJid;
    await recover(sock, jid, protoMsg.key.id, deleter);
    return;
  }
  await cacheMessage(sock, msg);
}

async function onUpdates(sock, updates) {
  for (const item of updates || []) {
    const stub = item?.update?.messageStubType;
    if (stub !== WAMessageStubType.REVOKE && stub !== 1) continue;
    const jid = item.key?.remoteJid;
    const deleter = item.update?.key?.participant || item.key?.participant || jid;
    await recover(sock, jid, item.key?.id, deleter);
  }
}

module.exports = { onMessage, onUpdates, isEnabled, setEnabled };
