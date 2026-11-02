/**
 * PM Blocker — auto-block non-owner/sudo DMs when enabled
 * State: database/pmblocker.json
 */

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../database');
const STATE_FILE = path.join(DB_PATH, 'pmblocker.json');

const DEFAULT_MESSAGE =
  '⚠️ Direct messages are blocked!\nYou cannot DM this bot. Please contact the owner in group chats only.';

/** In-flight blocks — avoid double warn/block on rapid spam */
const pending = new Set();

function readState() {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return { enabled: false, message: DEFAULT_MESSAGE };
    }
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8') || '{}');
    return {
      enabled: !!data.enabled,
      message:
        typeof data.message === 'string' && data.message.trim()
          ? data.message
          : DEFAULT_MESSAGE,
    };
  } catch {
    return { enabled: false, message: DEFAULT_MESSAGE };
  }
}

function writeState(enabled, message) {
  try {
    if (!fs.existsSync(DB_PATH)) fs.mkdirSync(DB_PATH, { recursive: true });
    const current = readState();
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(
        {
          enabled: !!enabled,
          message:
            typeof message === 'string' && message.trim()
              ? message.trim()
              : current.message,
        },
        null,
        2
      ),
      'utf8'
    );
    return true;
  } catch (e) {
    console.error('[pmblocker] save error:', e.message);
    return false;
  }
}

function isEnabled() {
  return readState().enabled;
}

function getMessage() {
  return readState().message || DEFAULT_MESSAGE;
}

/**
 * If PM blocker is on, warn + block the DM sender.
 * @returns {Promise<boolean>} true if the message was handled (caller should stop)
 */
async function handleDm(sock, msg, { isExempt = false } = {}) {
  if (!isEnabled() || isExempt || msg.key.fromMe) return false;

  const jid = msg.key.remoteJid;
  if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') return false;
  if (pending.has(jid)) return true;

  pending.add(jid);
  try {
    try {
      await sock.sendMessage(jid, { text: getMessage() }, { quoted: msg });
    } catch (e) {
      console.warn('[pmblocker] warn send failed:', e.message);
    }

    try {
      await sock.updateBlockStatus(jid, 'block');
      console.log('[pmblocker] blocked:', jid);
    } catch (e) {
      console.warn('[pmblocker] block failed:', e.message);
    }
  } finally {
    // keep brief debounce, then allow again if unblock happens later
    setTimeout(() => pending.delete(jid), 5000);
  }

  return true;
}

module.exports = {
  readState,
  writeState,
  isEnabled,
  getMessage,
  handleDm,
  DEFAULT_MESSAGE,
};
