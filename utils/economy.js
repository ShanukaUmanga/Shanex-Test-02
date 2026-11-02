const fs = require('fs');
const path = require('path');
const {
  MULTIPLIER,
  xpForLevel,
  canLevelUp,
  getRole,
  formatLevelUpMessage,
} = require('./levelling');
const DB_PATH = path.join(__dirname, '..', 'database', 'economy.json');

const COOLDOWNS = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  work: 60 * 60 * 1000,
  crime: 2 * 60 * 60 * 1000,
  mine: 90 * 60 * 1000,
  bombBet: 30 * 60 * 1000,
};

const SHOP = [
  { id: 'pizza', name: '🍕 Pizza', price: 200, emoji: '🍕' },
  { id: 'coffee', name: '☕ Coffee', price: 150, emoji: '☕' },
  { id: 'phone', name: '📱 Phone', price: 15000, emoji: '📱' },
  { id: 'laptop', name: '💻 Laptop', price: 35000, emoji: '💻' },
  { id: 'car', name: '🚗 Car', price: 120000, emoji: '🚗' },
  { id: 'house', name: '🏠 House', price: 500000, emoji: '🏠' },
];

function defaultUser() {
  return {
    wallet: 0,
    bank: 0,
    diamonds: 0,
    xp: 0,
    level: 1,
    role: getRole(1).name,
    autolevelup: true,
    inventory: {},
    lastDaily: 0,
    lastWeekly: 0,
    lastWork: 0,
    lastCrime: 0,
    lastMine: 0,
    lastBombBet: 0,
    bombBetDay: '',
    bombBetTurns: 0,
    rpg: defaultRpg(),
  };
}

function defaultRpg() {
  return {
    lastFish: 0,
    lastHunt: 0,
    lastChop: 0,
    lastForage: 0,
    tools: { rod: 0, bait: 0, axe: 0, bow: 0 },
    bag: {},
  };
}

function loadDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      fs.writeFileSync(DB_PATH, '{}');
      return {};
    }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveDB(data) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function migrateUser(raw) {
  const user = { ...defaultUser(), ...raw };
  user.wallet = Number(user.wallet) || 0;
  user.bank = Number(user.bank) || 0;
  user.diamonds = Number(user.diamonds) || 0;
  user.xp = Number(user.xp) || 0;
  user.level = Number(user.level) || 1;
  user.autolevelup = user.autolevelup !== false;
  user.role = user.role || getRole(user.level).name;
  user.inventory = user.inventory && typeof user.inventory === 'object' ? user.inventory : {};
  user.bombBetDay = typeof user.bombBetDay === 'string' ? user.bombBetDay : '';
  user.bombBetTurns = Number(user.bombBetTurns) || 0;
  const rpg = { ...defaultRpg(), ...(user.rpg && typeof user.rpg === 'object' ? user.rpg : {}) };
  rpg.tools = { ...defaultRpg().tools, ...(rpg.tools && typeof rpg.tools === 'object' ? rpg.tools : {}) };
  rpg.bag = rpg.bag && typeof rpg.bag === 'object' ? rpg.bag : {};
  user.rpg = rpg;
  return user;
}

const ALIAS_KEY = '_jidAliases';

function normalizeEconomyJid(jid) {
  if (!jid || typeof jid !== 'string' || jid.startsWith('_')) return '';
  const [user, server] = jid.split('@');
  const userPart = (user || '').split(':')[0];
  if (!userPart) return '';
  return server ? `${userPart}@${server}` : userPart;
}

function followAlias(group, userId) {
  const map = group?.[ALIAS_KEY] || {};
  let cur = userId;
  const seen = new Set();
  while (map[cur] && !seen.has(cur)) {
    seen.add(cur);
    cur = map[cur];
  }
  return cur;
}

function resolveUserKey(db, groupId, userId) {
  if (!groupId || !userId) return userId;
  const group = db[groupId];
  if (!group) return normalizeEconomyJid(userId) || userId;
  const nid = normalizeEconomyJid(userId) || userId;
  const canon = followAlias(group, nid);
  if (group[canon]) return canon;
  if (group[nid]) return nid;
  if (group[userId]) return userId;
  return canon || nid;
}

function mergeUserRecords(into, from) {
  if (!from || into === from) return;
  into.wallet = (into.wallet || 0) + (from.wallet || 0);
  into.bank = (into.bank || 0) + (from.bank || 0);
  into.diamonds = (into.diamonds || 0) + (from.diamonds || 0);
  into.xp = Math.max(into.xp || 0, from.xp || 0);
  if ((from.level || 1) > (into.level || 1)) {
    into.level = from.level;
    into.role = from.role || into.role;
  }
  into.inventory = { ...(into.inventory || {}) };
  for (const [k, v] of Object.entries(from.inventory || {})) {
    into.inventory[k] = (into.inventory[k] || 0) + (Number(v) || 0);
  }
  for (const k of ['lastDaily', 'lastWeekly', 'lastWork', 'lastCrime', 'lastMine', 'lastBombBet']) {
    into[k] = Math.max(into[k] || 0, from[k] || 0);
  }
  into.bombBetTurns = Math.max(into.bombBetTurns || 0, from.bombBetTurns || 0);
  if ((from.bombBetDay || '') > (into.bombBetDay || '')) into.bombBetDay = from.bombBetDay;
  if (from.rpg && typeof from.rpg === 'object') {
    into.rpg = { ...defaultRpg(), ...(into.rpg || {}), ...from.rpg };
    into.rpg.tools = { ...defaultRpg().tools, ...(into.rpg?.tools || {}), ...(from.rpg.tools || {}) };
    into.rpg.bag = { ...(into.rpg?.bag || {}), ...(from.rpg.bag || {}) };
  }
}

/** Merge PN + LID (and other JID variants) into one economy account. */
function linkJids(groupId, ids) {
  const clean = [...new Set((ids || []).map(normalizeEconomyJid).filter(Boolean))];
  if (!groupId || !clean.length) return clean[0] || '';

  const db = loadDB();
  if (!db[groupId]) db[groupId] = {};
  const group = db[groupId];

  const existing = clean.filter((id) => group[id] && typeof group[id] === 'object');
  const canonical =
    existing.sort((a, b) => totalWealth(migrateUser(group[b])) - totalWealth(migrateUser(group[a])))[0] ||
    clean.find((id) => id.endsWith('@lid')) ||
    clean[0];

  for (const id of existing) {
    if (id === canonical) continue;
    const into = migrateUser(group[canonical] || {});
    mergeUserRecords(into, migrateUser(group[id]));
    group[canonical] = into;
    delete group[id];
  }

  group[ALIAS_KEY] = group[ALIAS_KEY] || {};
  for (const id of clean) group[ALIAS_KEY][id] = canonical;
  saveDB(db);
  return canonical;
}

function ensureUser(db, groupId, userId) {
  if (!db[groupId]) db[groupId] = {};
  const key = resolveUserKey(db, groupId, userId);
  db[groupId][key] = migrateUser(db[groupId][key] || {});
  return db[groupId][key];
}

function addXp(user, amount) {
  user.xp += amount;
}

function applyLevelUps(user) {
  const before = user.level;
  let diamondsEarned = 0;

  while (canLevelUp(user.level, user.xp, MULTIPLIER)) {
    user.xp -= xpForLevel(user.level, MULTIPLIER);
    user.level += 1;
    const reward = 2 + Math.floor(user.level / 3);
    user.diamonds += reward;
    diamondsEarned += reward;
  }

  user.role = getRole(user.level).name;

  return {
    leveled: before !== user.level,
    before,
    after: user.level,
    role: user.role,
    diamondsEarned,
  };
}

function saveUserWithAutoLevel(db, user) {
  const levelResult = user.autolevelup !== false ? applyLevelUps(user) : { leveled: false };
  saveDB(db);
  return levelResult;
}

function tryAutoLevelUp(groupId, userId) {
  const db = loadDB();
  const user = ensureUser(db, groupId, userId);
  if (!user.autolevelup) return { leveled: false };

  const levelResult = applyLevelUps(user);
  if (levelResult.leveled) saveDB(db);
  return levelResult;
}

function setAutoLevelUp(groupId, userId, enabled) {
  const db = loadDB();
  const user = ensureUser(db, groupId, userId);
  user.autolevelup = !!enabled;
  saveDB(db);
  return user.autolevelup;
}

function totalWealth(user) {
  return (user.wallet || 0) + (user.bank || 0);
}

function getUserData(groupId, userId) {
  const db = loadDB();
  return ensureUser(db, groupId, userId);
}

/** Load user, run mutator, save. mutator may return extra fields. */
function updateUser(groupId, userId, mutator) {
  const db = loadDB();
  const user = ensureUser(db, groupId, userId);
  const extra = (typeof mutator === 'function' ? mutator(user) : null) || {};
  saveDB(db);
  return { user, ...extra };
}

function getBalance(groupId, userId) {
  return getUserData(groupId, userId).wallet;
}

/** Add or remove wallet coins. Negative delta deducts (floored at 0). */
function adjustWallet(groupId, userId, delta) {
  const amount = Math.trunc(Number(delta));
  if (!Number.isFinite(amount) || amount === 0) {
    const user = getUserData(groupId, userId);
    return { ok: true, changed: 0, user };
  }

  const db = loadDB();
  const user = ensureUser(db, groupId, userId);

  if (amount < 0) {
    const take = Math.min(user.wallet, Math.abs(amount));
    user.wallet -= take;
    saveDB(db);
    return { ok: true, changed: -take, user };
  }

  user.wallet += amount;
  saveDB(db);
  return { ok: true, changed: amount, user };
}

/** Deduct exact amount if funds allow; otherwise fail. */
function deductWallet(groupId, userId, amount) {
  if (!Number.isInteger(amount) || amount < 1) return { ok: false, error: 'invalid' };
  const db = loadDB();
  const user = ensureUser(db, groupId, userId);
  if (user.wallet < amount) return { ok: false, error: 'funds', user };
  user.wallet -= amount;
  saveDB(db);
  return { ok: true, amount, user };
}

/** Check bomb-bet cooldown (6h). Does not start the bet. */
function checkBombBet(groupId, userId) {
  const user = getUserData(groupId, userId);
  const cd = checkCooldown(user, 'bombBet');
  if (!cd.ok) return { ok: false, waitMs: cd.waitMs, user };
  return { ok: true, user };
}

/** Mark bomb-bet cooldown after a stake is successfully placed. */
function markBombBet(groupId, userId) {
  const db = loadDB();
  const user = ensureUser(db, groupId, userId);
  setCooldown(user, 'bombBet');
  saveDB(db);
  return user;
}

const MAX_BOMB_BET_TURNS = 15;

function bombBetDayKey() {
  return new Date().toISOString().slice(0, 10);
}

/** Daily bomb-bet turns from economy.json (resets each UTC day). */
function getBombBetTurns(groupId, userId) {
  const db = loadDB();
  const user = ensureUser(db, groupId, userId);
  const day = bombBetDayKey();
  if (user.bombBetDay !== day) {
    user.bombBetDay = day;
    user.bombBetTurns = 0;
    saveDB(db);
  }
  const turns = user.bombBetTurns || 0;
  return {
    turns,
    remaining: Math.max(0, MAX_BOMB_BET_TURNS - turns),
    max: MAX_BOMB_BET_TURNS,
    day,
    user,
  };
}

/** Increment daily bomb-bet turn counter; returns new turn count (1-based used). */
function consumeBombBetTurn(groupId, userId) {
  const db = loadDB();
  const user = ensureUser(db, groupId, userId);
  const day = bombBetDayKey();
  if (user.bombBetDay !== day) {
    user.bombBetDay = day;
    user.bombBetTurns = 0;
  }
  user.bombBetTurns = (user.bombBetTurns || 0) + 1;
  saveDB(db);
  return user.bombBetTurns;
}

/** Owner/admin helper: reset a user's bomb bet turns for today. */
function resetBombBetTurns(groupId, userId) {
  const db = loadDB();
  const user = ensureUser(db, groupId, userId);
  user.bombBetDay = bombBetDayKey();
  user.bombBetTurns = 0;
  saveDB(db);
  return user;
}

function checkCooldown(user, key) {
  const last = user[`last${key.charAt(0).toUpperCase()}${key.slice(1)}`] || 0;
  const wait = COOLDOWNS[key];
  if (!last || Date.now() - last >= wait) return { ok: true };
  return { ok: false, waitMs: wait - (Date.now() - last) };
}

function setCooldown(user, key) {
  const field = `last${key.charAt(0).toUpperCase()}${key.slice(1)}`;
  user[field] = Date.now();
}

function claimDaily(groupId, userId) {
  const db = loadDB();
  const user = ensureUser(db, groupId, userId);
  const cd = checkCooldown(user, 'daily');
  if (!cd.ok) return { ok: false, waitMs: cd.waitMs };

  const amount = 100 + Math.floor(Math.random() * 401);
  user.wallet += amount;
  addXp(user, 25);
  setCooldown(user, 'daily');
  const levelResult = saveUserWithAutoLevel(db, user);
  return { ok: true, amount, user, levelResult };
}

function claimWeekly(groupId, userId) {
  const db = loadDB();
  const user = ensureUser(db, groupId, userId);
  const cd = checkCooldown(user, 'weekly');
  if (!cd.ok) return { ok: false, waitMs: cd.waitMs };

  const amount = 1000 + Math.floor(Math.random() * 1501);
  user.wallet += amount;
  addXp(user, 100);
  setCooldown(user, 'weekly');
  const levelResult = saveUserWithAutoLevel(db, user);
  return { ok: true, amount, user, levelResult };
}

function doWork(groupId, userId) {
  const db = loadDB();
  const user = ensureUser(db, groupId, userId);
  const cd = checkCooldown(user, 'work');
  if (!cd.ok) return { ok: false, waitMs: cd.waitMs };

  const amount = 50 + Math.floor(Math.random() * 151);
  user.wallet += amount;
  addXp(user, 15);
  setCooldown(user, 'work');
  const levelResult = saveUserWithAutoLevel(db, user);
  return { ok: true, amount, user, levelResult };
}

function doCrime(groupId, userId) {
  const db = loadDB();
  const user = ensureUser(db, groupId, userId);
  const cd = checkCooldown(user, 'crime');
  if (!cd.ok) return { ok: false, waitMs: cd.waitMs };

  const success = Math.random() < 0.55;
  if (success) {
    const amount = 100 + Math.floor(Math.random() * 301);
    user.wallet += amount;
    addXp(user, 20);
    setCooldown(user, 'crime');
    const levelResult = saveUserWithAutoLevel(db, user);
    return { ok: true, success: true, amount, user, levelResult };
  }

  const fine = Math.min(user.wallet, 50 + Math.floor(Math.random() * 101));
  user.wallet -= fine;
  setCooldown(user, 'crime');
  saveDB(db);
  return { ok: true, success: false, amount: fine, user };
}

function doMine(groupId, userId) {
  const db = loadDB();
  const user = ensureUser(db, groupId, userId);
  const cd = checkCooldown(user, 'mine');
  if (!cd.ok) return { ok: false, waitMs: cd.waitMs };

  const amount = 80 + Math.floor(Math.random() * 171);
  user.wallet += amount;
  addXp(user, 18);
  let diamonds = 0;
  if (Math.random() < 0.15) {
    diamonds = 1 + Math.floor(Math.random() * 3);
    user.diamonds += diamonds;
  }
  setCooldown(user, 'mine');
  const levelResult = saveUserWithAutoLevel(db, user);
  return { ok: true, amount, diamonds, user, levelResult };
}

function deposit(groupId, userId, amount) {
  if (!Number.isInteger(amount) || amount < 1) return { ok: false, error: 'invalid' };
  const db = loadDB();
  const user = ensureUser(db, groupId, userId);
  if (user.wallet < amount) return { ok: false, error: 'funds' };
  user.wallet -= amount;
  user.bank += amount;
  saveDB(db);
  return { ok: true, amount, user };
}

function withdraw(groupId, userId, amount) {
  if (!Number.isInteger(amount) || amount < 1) return { ok: false, error: 'invalid' };
  const db = loadDB();
  const user = ensureUser(db, groupId, userId);
  if (user.bank < amount) return { ok: false, error: 'funds' };
  user.bank -= amount;
  user.wallet += amount;
  saveDB(db);
  return { ok: true, amount, user };
}

function transfer(groupId, fromId, toId, amount) {
  if (!Number.isInteger(amount) || amount < 1) return { ok: false, error: 'invalid' };

  const db = loadDB();
  const fromKey = resolveUserKey(db, groupId, fromId);
  const toKey = resolveUserKey(db, groupId, toId);
  if (fromKey === toKey) return { ok: false, error: 'self' };
  const sender = ensureUser(db, groupId, fromKey);
  const receiver = ensureUser(db, groupId, toKey);
  if (sender.wallet < amount) return { ok: false, error: 'funds' };

  sender.wallet -= amount;
  receiver.wallet += amount;
  saveDB(db);
  return { ok: true, amount, user: sender };
}

function buyItem(groupId, userId, itemId) {
  const item = SHOP.find((s) => s.id === itemId || s.name.toLowerCase().includes(itemId.toLowerCase()));
  if (!item) return { ok: false, error: 'item' };

  const db = loadDB();
  const user = ensureUser(db, groupId, userId);
  if (user.wallet < item.price) return { ok: false, error: 'funds', item };

  user.wallet -= item.price;
  user.inventory[item.id] = (user.inventory[item.id] || 0) + 1;
  saveDB(db);
  return { ok: true, item, user };
}

function levelUp(groupId, userId) {
  const db = loadDB();
  const user = ensureUser(db, groupId, userId);
  const needed = xpForLevel(user.level, MULTIPLIER);

  if (!canLevelUp(user.level, user.xp, MULTIPLIER)) {
    return { ok: false, error: 'xp', needed, have: user.xp, level: user.level };
  }

  const before = user.level;
  user.xp -= needed;
  user.level += 1;
  const reward = 2 + Math.floor(user.level / 3);
  user.diamonds += reward;
  user.role = getRole(user.level).name;
  saveDB(db);

  return {
    ok: true,
    level: user.level,
    before,
    role: user.role,
    diamonds: reward,
    user,
  };
}

function resetBalance(groupId, userId) {
  const db = loadDB();
  ensureUser(db, groupId, userId);
  db[groupId][userId] = defaultUser();
  saveDB(db);
  return true;
}

function resetCoin(groupId, userId) {
  const db = loadDB();
  const user = ensureUser(db, groupId, userId);
  user.wallet = 0;
  user.bank = 0;
  saveDB(db);
  return true;
}

function resetDi(groupId, userId) {
  const db = loadDB();
  const user = ensureUser(db, groupId, userId);
  user.diamonds = 0;
  saveDB(db);
  return true;
}

function getTop(groupId, limit = 10) {
  const db = loadDB();
  const group = db[groupId] || {};

  return Object.entries(group)
    .filter(([jid, raw]) => jid !== ALIAS_KEY && raw && typeof raw === 'object')
    .map(([jid, raw]) => [jid, migrateUser(raw)])
    .filter(([, user]) => totalWealth(user) > 0)
    .sort((a, b) => totalWealth(b[1]) - totalWealth(a[1]))
    .slice(0, limit);
}

function formatWait(ms) {
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.ceil((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(m, 1)}m`;
}

function fmtCoins(n) {
  return Number(n || 0).toLocaleString('en-US');
}

/**
 * Compact money for leaderboards:
 * 0–9999 → plain number · 10k+ → k · 1L+ → lakh · 1M+ → M · 1Cr+ → Cr
 */
function fmtCompactMoney(n) {
  const v = Math.floor(Number(n) || 0);
  if (v < 0) return `-${fmtCompactMoney(-v)}`;
  if (v < 10000) return String(v);

  const trim = (x) => {
    const s = x.toFixed(1);
    return s.endsWith('.0') ? s.slice(0, -2) : s;
  };

  if (v < 100000) return `${trim(v / 1000)}k`; // 10k – 99.9k
  if (v < 1000000) return `${trim(v / 100000)} lakh`; // 1 – 9.9 lakh
  if (v < 10000000) return `${trim(v / 1000000)}M`; // 1M – 9.9M
  return `${trim(v / 10000000)}Cr`; // 1Cr+
}

function inventorySummary(inventory) {
  const entries = Object.entries(inventory || {}).filter(([, qty]) => qty > 0);
  if (!entries.length) return 'None';
  return entries
    .map(([id, qty]) => {
      const item = SHOP.find((s) => s.id === id);
      return `${item?.emoji || '📦'} ${item?.name || id} x${qty}`;
    })
    .join(', ');
}

module.exports = {
  SHOP,
  getUserData,
  linkJids,
  updateUser,
  getBalance,
  adjustWallet,
  deductWallet,
  checkBombBet,
  markBombBet,
  MAX_BOMB_BET_TURNS,
  getBombBetTurns,
  consumeBombBetTurn,
  resetBombBetTurns,
  claimDaily,
  claimWeekly,
  doWork,
  doCrime,
  doMine,
  deposit,
  withdraw,
  transfer,
  buyItem,
  levelUp,
  resetBalance,
  resetCoin,
  resetDi,
  getTop,
  totalWealth,
  xpForLevel,
  tryAutoLevelUp,
  setAutoLevelUp,
  getRole,
  formatLevelUpMessage,
  formatWait,
  fmtCoins,
  fmtCompactMoney,
  inventorySummary,
};