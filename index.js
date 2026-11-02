
/**
 * WhatsApp MD Bot - Main Entry Point
 */
process.env.PUPPETEER_SKIP_DOWNLOAD = 'true';
process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = 'true';
process.env.PUPPETEER_CACHE_DIR =
  process.env.PUPPETEER_CACHE_DIR || '/tmp/puppeteer_cache_disabled';

const { initializeTempSystem } = require('./utils/tempManager');
const { startCleanup } = require('./utils/cleanup');

initializeTempSystem();
startCleanup();

const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

const forbiddenPatternsConsole = [
  'closing session',
  'closing open session',
  'sessionentry',
  'prekey bundle',
  'pendingprekey',
  '_chains',
  'registrationid',
  'currentratchet',
  'chainkey',
  'ratchet',
  'signal protocol',
  'ephemeralkeypair',
  'indexinfo',
  'basekey'
];

function shouldSuppressConsole(args) {
  const message = args.map(a => {
    if (typeof a === 'string') return a;
    if (typeof a === 'object') {
      try {
        return JSON.stringify(a);
      } catch (_) {
        return String(a);
      }
    }
    return String(a);
  }).join(' ').toLowerCase();

  return forbiddenPatternsConsole.some(pattern => message.includes(pattern));
}

console.log = (...args) => {
  if (!shouldSuppressConsole(args)) originalConsoleLog.apply(console, args);
};

console.error = (...args) => {
  if (!shouldSuppressConsole(args)) originalConsoleError.apply(console, args);
};

console.warn = (...args) => {
  if (!shouldSuppressConsole(args)) originalConsoleWarn.apply(console, args);
};

// Libraries
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
  jidNormalizedUser
} = require('@whiskeysockets/baileys');

const qrcode = require('qrcode-terminal');
const config = require('./config');
const handler = require('./handler');
const antidelete = require('./utils/antidelete');
const savestatus = require('./utils/savestatus');
const autostatus = require('./utils/autostatus');
const { rememberFromMessage, rememberContact } = require('./utils/nameCache');
const groupStatusTracker = require('./utils/groupStatusTracker');
const { createStatusRevoker } = require('./utils/statusRevoke');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const os = require('os');

function cleanupPuppeteerCache() {
  try {
    const home = os.homedir();
    const cacheDir = path.join(home, '.cache', 'puppeteer');

    if (fs.existsSync(cacheDir)) {
      console.log('🧹 Removing Puppeteer cache at:', cacheDir);
      fs.rmSync(cacheDir, { recursive: true, force: true });
      console.log('✅ Puppeteer cache removed');
    }
  } catch (err) {
    console.error('⚠️ Failed to cleanup Puppeteer cache:', err.message || err);
  }
}

// In-memory message store
const store = {
  messages: new Map(),
  byId: new Map(),
  maxPerChat: 20,
  maxById: 300,

  bind: (ev) => {
    ev.on('messages.upsert', ({ messages }) => {
      for (const msg of messages) {
        if (!msg.key?.id) continue;

        rememberFromMessage(msg);
        groupStatusTracker.recordFromMessage(msg);

        const jid = msg.key.remoteJid;
        if (!jid) continue;

        if (!store.messages.has(jid)) {
          store.messages.set(jid, new Map());
        }

        const chatMsgs = store.messages.get(jid);
        chatMsgs.set(msg.key.id, msg);
        store.byId.set(msg.key.id, msg);

        if (chatMsgs.size > store.maxPerChat) {
          const oldestKey = chatMsgs.keys().next().value;
          chatMsgs.delete(oldestKey);
        }

        if (store.byId.size > store.maxById) {
          const oldestId = store.byId.keys().next().value;
          store.byId.delete(oldestId);
        }
      }
    });

    ev.on('contacts.upsert', (contacts) => {
      for (const contact of contacts || []) rememberContact(contact);
    });

    ev.on('contacts.update', (contacts) => {
      for (const contact of contacts || []) rememberContact(contact);
    });

    ev.on('messaging-history.set', ({ contacts, messages }) => {
      for (const contact of contacts || []) rememberContact(contact);

      for (const msg of messages || []) {
        rememberFromMessage(msg);
        groupStatusTracker.recordFromMessage(msg);
      }
    });
  },

  loadMessage: async (jid, id) => {
    return store.messages.get(jid)?.get(id) ||
      store.byId.get(id) || null;
  }
};

const processedMessages = new Set();

setInterval(() => {
  processedMessages.clear();
}, 5 * 60 * 1000);

// Logger
const createSuppressedLogger = (level = 'silent') => {
  const forbiddenPatterns = [
    'closing session',
    'closing open session',
    'sessionentry',
    'prekey bundle',
    'pendingprekey',
    '_chains',
    'registrationid',
    'currentratchet',
    'ratchet',
    'signal protocol',
    'ephemeralkeypair',
    'indexinfo',
    'basekey',
    'ratchetkey'
  ];

  let logger;

  try {
    logger = pino({
      level,
      transport: process.env.NODE_ENV === 'production'
        ? undefined
        : {
            target: 'pino-pretty',
            options: {
              colorize: true,
              ignore: 'pid,hostname'
            }
          },
      customLevels: {
        trace: 0,
        debug: 1,
        info: 2,
        warn: 3,
        error: 4,
        fatal: 5
      },
      redact: [
        'registrationId',
        'ephemeralKeyPair',
        'rootKey',
        'chainKey',
        'baseKey'
      ]
    });
  } catch (err) {
    logger = pino({ level });
  }

  const originalInfo = logger.info.bind(logger);

  logger.info = (...args) => {
    const msg = args.map(a => {
      try {
        return typeof a === 'string' ? a : JSON.stringify(a);
      } catch (_) {
        return String(a);
      }
    }).join(' ').toLowerCase();

    if (!forbiddenPatterns.some(pattern => msg.includes(pattern))) {
      originalInfo(...args);
    }
  };

  logger.debug = () => {};
  logger.trace = () => {};

  return logger;
};

// Web pairing dashboard
const dashboardState = {
  qr: null,
  pairCode: null,
  status: 'Starting WhatsApp bot...',
  socket: null,
  credsRegistered: false
};

const express = require('express');
const dashboard = express();

dashboard.use(express.json({ limit: '1mb' }));
dashboard.use(express.static(path.join(__dirname, 'public')));

dashboard.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

dashboard.get('/api/status', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    status: dashboardState.status,
    qr: dashboardState.qr,
    pairCode: dashboardState.pairCode
  });
});

dashboard.post('/api/pair', async (req, res) => {
  try {
    const phone = String(req.body?.phone || '').replace(/\D/g, '');

    if (!/^\d{8,15}$/.test(phone)) {
      return res.status(400).json({
        error: 'Enter a valid WhatsApp number with country code, digits only.'
      });
    }

    if (!dashboardState.socket) {
      return res.status(503).json({
        error: 'WhatsApp is still starting. Please wait and try again.'
      });
    }

    if (dashboardState.credsRegistered) {
      return res.status(409).json({
        error: 'This bot session is already linked. Log out the current session before pairing a new number.'
      });
    }

    const code = await dashboardState.socket.requestPairingCode(phone);

    dashboardState.pairCode =
      String(code).match(/.{1,4}/g)?.join('-') || String(code);

    dashboardState.qr = null;
    dashboardState.status = 'Pairing code generated. Enter it in WhatsApp.';

    return res.json({
      success: true,
      pairCode: dashboardState.pairCode,
      status: dashboardState.status
    });
  } catch (error) {
    console.error('[PAIRING ERROR]', error.message || error);

    return res.status(500).json({
      error: error.message || 'Could not generate pairing code.'
    });
  }
});

const dashboardPort = Number(process.env.PORT || 3000);

dashboard.listen(dashboardPort, '0.0.0.0', () => {
  console.log(`🌐 SHANEX GOLDEN MD dashboard listening on port ${dashboardPort}`);
});

// ==========================================
// CONNECTION SUCCESS WELCOME MESSAGE
// ==========================================

let connectionWelcomeSent = false;
let connectionWelcomeSending = false;

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch (_) {
    return false;
  }
}

async function sendConnectionWelcome(sock) {
  const welcomeConfig = config.connectionWelcome || {};

  if (!welcomeConfig.enabled) return;
  if (connectionWelcomeSent || connectionWelcomeSending) return;

  if (!sock.user?.id) {
    console.warn('[WELCOME] No connected account JID yet.');
    return;
  }

  connectionWelcomeSending = true;

  try {
    // Normalize the connected account JID
    const selfJid = jidNormalizedUser(sock.user.id);
    const number = selfJid.split('@')[0];

    const displayName =
      sock.user.name ||
      sock.user.notify ||
      number;

    // Sri Lanka local date and time
    const now = new Date();

    const date = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Colombo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(now);

    const time = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Colombo',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }).format(now);

    // Social media links from config.js
    const social = welcomeConfig.social || {};

    const socialEntries = [
      ['youtube', '▶️ YouTube'],
      ['instagram', '📸 Instagram'],
      ['github', '💻 GitHub']
    ].filter(([key]) => isValidHttpUrl(social[key]));

    // Plain clickable URLs are used for compatibility.
    // Actual URL buttons need supported interactive-message handling.
    const socialLines = socialEntries.length
      ? socialEntries.map(([key, label]) => `${label}: ${social[key]}`)
      : ['Social links coming soon.'];

    // Premium connection message
    const caption = [
      '╭━━〔 ✨ SHANEX GOLDEN MD 〕━━╮',
      '',
      `👋 Hello, *${displayName}!*`,
      '🎉 *BOT CONNECTION SUCCESSFUL*',
      '',
      '╭─〔 📡 CONNECTION DETAILS 〕',
      `│ 👤 User: *${displayName}*`,
      `│ 📱 Number: *${number}*`,
      `│ 📅 Date: *${date}*`,
      `│ ⏰ Time: *${time}*`,
      '│ 🟢 Status: *Connected Successfully*',
      '╰━━━━━━━━━━━━━━━━━━━━',
      '',
      '⚡ Your WhatsApp account is connected to *SHANEX GOLDEN MD*.',
      '',
      '╭─〔 🌐 FOLLOW ME 〕',
      ...socialLines,
      '╰━━━━━━━━━━━━━━━━━━━━',
      '',
      '> *POWERED BY SHANEX STUDIO*'
    ].join('\n');

    // Image source settings
    const imagePath = path.resolve(
      __dirname,
      welcomeConfig.imagePath || './utils/bot_image.jpg'
    );

    const imageUrl = welcomeConfig.imageUrl;

    let payload;

    if (isValidHttpUrl(imageUrl)) {
      payload = {
        image: { url: imageUrl },
        caption
      };

      console.log('[WELCOME] Sending banner from configured imageUrl.');
    } else if (fs.existsSync(imagePath)) {
      payload = {
        image: fs.readFileSync(imagePath),
        caption
      };

      console.log('[WELCOME] Sending local banner.');
    } else {
      payload = { text: caption };

      console.warn('[WELCOME] Banner unavailable; sending text instead.');
    }

    console.log('[WELCOME] Target:', selfJid);
    console.log('[WELCOME] Sending connection message...');

    const result = await sock.sendMessage(selfJid, payload);

    if (!result?.key?.id) {
      throw new Error('WhatsApp did not return a message ID');
    }

    connectionWelcomeSent = true;

    console.log(
      '[WELCOME] Submitted to WhatsApp. Message ID:',
      result.key.id
    );

    console.log(
      '[WELCOME] Submission is not proof of phone delivery.'
    );

  } catch (error) {
    console.error(
      '[WELCOME ERROR]',
      error?.stack || error?.message || error
    );
  } finally {
    connectionWelcomeSending = false;
  }
}

// ==========================================
// MAIN BOT CONNECTION
// ==========================================

async function startBot() {
  const sessionFolder = `./${config.sessionName}`;
  const sessionFile = path.join(sessionFolder, 'creds.json');

  // Restore KnightBot session if supplied
  if (config.sessionID && config.sessionID.startsWith('KnightBot!')) {
    try {
      const [header, b64data] = config.sessionID.split('!');

      if (header !== 'KnightBot' || !b64data) {
        throw new Error(
          "Invalid session format. Expected 'KnightBot!.....'"
        );
      }

      const cleanB64 = b64data.replace('...', '');
      const compressedData = Buffer.from(cleanB64, 'base64');
      const decompressedData = zlib.gunzipSync(compressedData);

      if (!fs.existsSync(sessionFolder)) {
        fs.mkdirSync(sessionFolder, { recursive: true });
      }

      fs.writeFileSync(sessionFile, decompressedData, 'utf8');

      console.log('📡 Session retrieved from KnightBot Session');
    } catch (e) {
      console.error('Session restore error:', e.message);
    }
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

  dashboardState.credsRegistered = Boolean(state.creds.registered);

  const { version } = await fetchLatestBaileysVersion();
  const suppressedLogger = createSuppressedLogger('silent');

  const sock = makeWASocket({
    version,
    logger: suppressedLogger,
    printQRInTerminal: false,
    browser: ['Chrome', 'Windows', '10.0'],
    auth: state,
    syncFullHistory: false,
    downloadHistory: false,
    markOnlineOnConnect: false,
    getMessage: async () => undefined,
    cachedGroupMetadata: async (jid) => handler.peekGroupMetadata(jid),
    useCachedGroupMetadata: true
  });

  dashboardState.socket = sock;
  dashboardState.status = 'Connecting to WhatsApp';

  sock.rawGroupMetadata = sock.groupMetadata.bind(sock);
  sock.revokeGroupStatus = createStatusRevoker(sock);

  store.bind(sock.ev);
  sock.store = store;

  // Connection watchdog
  let lastActivity = Date.now();
  const INACTIVITY_TIMEOUT = 30 * 60 * 1000;

  sock.ev.on('messages.upsert', () => {
    lastActivity = Date.now();
  });

  const watchdogInterval = setInterval(async () => {
    if (
      Date.now() - lastActivity > INACTIVITY_TIMEOUT &&
      sock.ws.readyState === 1
    ) {
      console.log('⚠️ No activity detected. Forcing reconnect...');

      await sock.end(undefined, undefined, { reason: 'inactive' });

      clearInterval(watchdogInterval);
      setTimeout(() => startBot(), 5000);
    }
  }, 5 * 60 * 1000);

  sock.ev.on('connection.update', (update) => {
    const { connection } = update;

    if (connection === 'open') {
      lastActivity = Date.now();
      sock.groupAlertsReadyAt = Date.now() + 15000;
    } else if (connection === 'close') {
      clearInterval(watchdogInterval);
    }
  });

  // Main connection update handler
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n\n📱 Scan this QR code with WhatsApp:\n');
      qrcode.generate(qr, { small: true });

      try {
        const QRCode = require('qrcode');

        dashboardState.qr = await QRCode.toDataURL(qr);
        dashboardState.pairCode = null;
        dashboardState.status =
          'QR ready — scan it from WhatsApp Linked devices';
      } catch (qrError) {
        dashboardState.qr = null;

        console.error(
          '[DASHBOARD QR ERROR]',
          qrError.message || qrError
        );
      }
    }

    if (connection === 'close') {
      dashboardState.status = 'WhatsApp disconnected — reconnecting...';
      dashboardState.socket = null;

      const statusCode =
        lastDisconnect?.error?.output?.statusCode;

      const shouldReconnect =
        statusCode !== DisconnectReason.loggedOut;

      const errorMessage =
        lastDisconnect?.error?.message || 'Unknown error';

      if ([515, 503, 502, 504, 408].includes(statusCode)) {
        console.log(
          `⚠️ Connection closed (${statusCode}). Reconnecting...`
        );
      } else {
        console.log(
          'Connection closed due to:',
          errorMessage,
          '\nReconnecting:',
          shouldReconnect
        );
      }

      if (shouldReconnect) {
        setTimeout(() => startBot(), 3000);
      }
    } else if (connection === 'open') {
      dashboardState.status = 'WhatsApp connected successfully';
      dashboardState.credsRegistered = true;
      dashboardState.qr = null;
      dashboardState.pairCode = null;

      console.log('\n✅ Bot connected successfully!');
      console.log(`📱 Bot Number: ${sock.user.id.split(':')[0]}`);
      console.log(`🤖 Bot Name: ${config.botName}`);
      console.log(`⚡ Prefix: ${config.prefix}`);

      const ownerNames = Array.isArray(config.ownerName)
        ? config.ownerName.join(',')
        : config.ownerName;

      console.log(`👑 Owner: ${ownerNames}\n`);
      console.log('Bot is ready to receive messages!\n');

      sock.groupAlertsReadyAt = Date.now() + 15000;

      // Send welcome card after connection settles.
      // Do not block command handling.
      setTimeout(() => {
        if (sock.ws?.readyState === 1) {
          sendConnectionWelcome(sock).catch(err => {
            console.error('[WELCOME ERROR]', err);
          });
        }
      }, 3000);

      // Set bot status
      if (config.autoBio) {
        await sock.updateProfileStatus(
          `${config.botName} | Active 24/7`
        );
      }

      handler.initializeAntiCall(sock);

      // Cleanup inactive chats
      const now = Date.now();

      for (const [jid, chatMsgs] of store.messages.entries()) {
        const timestamps = Array.from(chatMsgs.values()).map(
          m => m.messageTimestamp * 1000 || 0
        );

        if (
          timestamps.length > 0 &&
          now - Math.max(...timestamps) > 24 * 60 * 60 * 1000
        ) {
          store.messages.delete(jid);
        }
      }

      console.log(
        `🧹 Store cleaned. Active chats: ${store.messages.size}`
      );
    }
  });

  // Save credentials
  sock.ev.on('creds.update', saveCreds);

  const isSystemJid = (jid) => {
    if (!jid) return true;

    return jid.includes('@broadcast') ||
      jid.includes('status.broadcast') ||
      jid.includes('@newsletter') ||
      jid.includes('@newsletter.');
  };

  // ==========================================
  // MESSAGE HANDLER
  // ==========================================

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    for (const msg of messages) {
      if (!msg.message || !msg.key?.id) continue;

      const from = msg.key.remoteJid;

      if (!from) continue;

      // Status saving and reactions
      if (
        from === 'status@broadcast' ||
        from.includes('status@broadcast')
      ) {
        if (!processedMessages.has(msg.key.id)) {
          processedMessages.add(msg.key.id);

          savestatus.autoSave(sock, msg).catch(err => {
            console.error('[savestatus]', err.message);
          });

          if (type === 'notify') {
            autostatus.reactToStatus(sock, msg.key).catch(err => {
              console.error('[autostatus] react:', err.message);
            });
          }
        }

        continue;
      }

      // Process only new messages
      if (type !== 'notify') continue;

      if (isSystemJid(from)) continue;

      const msgId = msg.key.id;

      if (processedMessages.has(msgId)) continue;

      const MESSAGE_AGE_LIMIT = 5 * 60 * 1000;
      let messageAge = 0;

      if (msg.messageTimestamp) {
        const timestamp = Number(msg.messageTimestamp);

        messageAge = Date.now() - timestamp * 1000;

        if (messageAge > MESSAGE_AGE_LIMIT) {
          continue;
        }
      }

      processedMessages.add(msgId);

      // Store message
      if (msg.key?.id) {
        if (!store.messages.has(from)) {
          store.messages.set(from, new Map());
        }

        const chatMsgs = store.messages.get(from);
        chatMsgs.set(msg.key.id, msg);

        if (chatMsgs.size > store.maxPerChat) {
          const sortedIds = Array.from(chatMsgs.entries())
            .sort(
              (a, b) =>
                (a[1].messageTimestamp || 0) -
                (b[1].messageTimestamp || 0)
            )
            .map(([id]) => id);

          for (
            let i = 0;
            i < sortedIds.length - store.maxPerChat;
            i++
          ) {
            chatMsgs.delete(sortedIds[i]);
          }
        }
      }

      // Anti-delete
      antidelete.onMessage(sock, msg).catch(err => {
        console.error('[antidelete]', err.message);
      });

      // Process bot commands
      handler.handleMessage(sock, msg).catch(err => {
        if (
          !err.message?.includes('rate-overlimit') &&
          !err.message?.includes('not-authorized')
        ) {
          console.error('Error handling message:', err.message);
        }
      });

      // Additional background operations
      setImmediate(async () => {
        if (config.autoRead && from.endsWith('@g.us')) {
          try {
            await sock.readMessages([msg.key]);
          } catch (_) {
            // Ignore read errors
          }
        }

        if (from.endsWith('@g.us')) {
          try {
            const groupMetadata =
              await handler.getGroupMetadata(
                sock,
                msg.key.remoteJid
              );

            if (groupMetadata) {
              await handler.handleAntilink(
                sock,
                msg,
                groupMetadata
              );
            }
          } catch (_) {
            // Ignore group metadata errors
          }
        }
      });
    }
  });

  // Message receipt updates
  sock.ev.on('message-receipt.update', () => {
    // Silently handled
  });

  sock.ev.on('messages.update', (updates) => {
    antidelete.onUpdates(sock, updates).catch(err => {
      console.error('[antidelete]', err.message);
    });
  });

  // Group participant updates
  sock.ev.on('group-participants.update', async (update) => {
    if (!sock.ws?.isOpen) return;

    if (
      sock.groupAlertsReadyAt &&
      Date.now() < sock.groupAlertsReadyAt
    ) {
      return;
    }

    await handler.handleGroupUpdate(sock, update);
  });

  sock.ev.on('error', (error) => {
    if (isTransientNetworkError(error)) return;

    console.error(
      'Socket error:',
      error.message || error
    );
  });

  return sock;
}

// ==========================================
// START BOT
// ==========================================

console.log('🚀 Starting WhatsApp MD Bot...\n');
console.log(`📦 Bot Name: ${config.botName}`);
console.log(`⚡ Prefix: ${config.prefix}`);

const ownerNames = Array.isArray(config.ownerName)
  ? config.ownerName.join(',')
  : config.ownerName;

console.log(`👑 Owner: ${ownerNames}\n`);

cleanupPuppeteerCache();

startBot().catch(err => {
  console.error('Error starting bot:', err);
  process.exit(1);
});

// ==========================================
// NETWORK ERROR HANDLING
// ==========================================

function isTransientNetworkError(err) {
  if (!err) return false;

  const msg = String(err.message || err);

  const code =
    err.code ||
    err.response?.statusCode ||
    err.output?.statusCode;

  if (
    code === 408 ||
    code === 502 ||
    code === 503 ||
    code === 504 ||
    code === 515 ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'ERR_NON_2XX_3XX_RESPONSE'
  ) {
    return true;
  }

  return /Gateway Time-out|gateway timeout|timed?\s*out|socket hang up|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|Connection Closed|Stream Errored/i.test(msg);
}

function briefErr(err) {
  if (!err) return 'unknown';

  const code =
    err.code ||
    err.response?.statusCode ||
    err.output?.statusCode ||
    '';

  const msg = err.message || String(err);

  return code ? `${code}: ${msg}` : msg;
}

// ==========================================
// PROCESS ERROR HANDLING
// ==========================================

process.on('uncaughtException', (err) => {
  if (
    err.code === 'ENOSPC' ||
    err.errno === -28 ||
    err.message?.includes('no space left on device')
  ) {
    console.error(
      '⚠️ ENOSPC Error: No space left on device. Attempting cleanup...'
    );

    const { cleanupOldFiles } = require('./utils/cleanup');
    cleanupOldFiles();

    console.warn(
      '⚠️ Cleanup completed. Bot may experience issues until space is freed.'
    );

    return;
  }

  if (isTransientNetworkError(err)) {
    console.warn(
      `⚠️ Transient error (ignored): ${briefErr(err)}`
    );
    return;
  }

  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
  if (
    err?.code === 'ENOSPC' ||
    err?.errno === -28 ||
    err?.message?.includes('no space left on device')
  ) {
    console.warn('⚠️ ENOSPC Error in promise.');

    const { cleanupOldFiles } = require('./utils/cleanup');
    cleanupOldFiles();

    return;
  }

  if (
    err?.message &&
    err.message.includes('rate-overlimit')
  ) {
    console.warn(
      '⚠️ Rate limit reached. Please slow down your requests.'
    );
    return;
  }

  if (isTransientNetworkError(err)) {
    console.warn(
      `⚠️ Network blip: ${briefErr(err)}`
    );
    return;
  }

  console.error(
    'Unhandled Rejection:',
    briefErr(err)
  );
});

// Export store for use in commands
module.exports = { store };
