/**
 * RPG / timepass activities (fish, hunt, chop, forage)
 * Inventory lives on economy.json → user.rpg
 *
 * Inspired by WhatsApp RPG bots (mancing/hunt) and Discord Fish-n-Economy.
 */

const { updateUser, fmtCoins, formatWait } = require('./economy');

const COOLDOWNS = {
  fish: 3 * 60 * 1000,
  hunt: 4 * 60 * 1000,
  chop: 3 * 60 * 1000,
  forage: 2 * 60 * 1000,
};

const GEAR = [
  { id: 'rod', name: '🎣 Fishing Rod', price: 500, emoji: '🎣', desc: 'Required to fish (first catch gifts one)' },
  { id: 'bait', name: '🪱 Bait x5', price: 80, emoji: '🪱', desc: 'Better rare-fish chance (5 uses)', qty: 5 },
  { id: 'axe', name: '🪓 Axe', price: 400, emoji: '🪓', desc: 'More wood when chopping' },
  { id: 'bow', name: '🏹 Bow', price: 600, emoji: '🏹', desc: 'Better hunt loot' },
];

const LOOT = {
  boot: { name: 'Old Boot', emoji: '🥾', sell: 8 },
  seaweed: { name: 'Seaweed', emoji: '🌿', sell: 12 },
  sardine: { name: 'Sardine', emoji: '🐟', sell: 40 },
  salmon: { name: 'Salmon', emoji: '🐠', sell: 90 },
  tuna: { name: 'Tuna', emoji: '🐟', sell: 160 },
  shark: { name: 'Shark', emoji: '🦈', sell: 450 },
  treasure: { name: 'Treasure Chest', emoji: '💎', sell: 900 },
  rabbit: { name: 'Rabbit', emoji: '🐰', sell: 55 },
  deer: { name: 'Deer', emoji: '🦌', sell: 140 },
  boar: { name: 'Boar', emoji: '🐗', sell: 220 },
  wolf: { name: 'Wolf Pelt', emoji: '🐺', sell: 380 },
  wood: { name: 'Wood', emoji: '🪵', sell: 18 },
  oak: { name: 'Oak Log', emoji: '🌳', sell: 45 },
  berry: { name: 'Berries', emoji: '🫐', sell: 22 },
  mushroom: { name: 'Mushroom', emoji: '🍄', sell: 35 },
  herb: { name: 'Herb', emoji: '🍀', sell: 50 },
  gem: { name: 'River Gem', emoji: '💠', sell: 320 },
};

function pickWeighted(entries) {
  const total = entries.reduce((s, e) => s + e.w, 0);
  let r = Math.random() * total;
  for (const e of entries) {
    r -= e.w;
    if (r <= 0) return e;
  }
  return entries[entries.length - 1];
}

function checkCd(user, key) {
  const last = user.rpg[`last${key.charAt(0).toUpperCase()}${key.slice(1)}`] || 0;
  const wait = COOLDOWNS[key];
  if (!last || Date.now() - last >= wait) return { ok: true };
  return { ok: false, waitMs: wait - (Date.now() - last) };
}

function addBag(user, id, qty = 1) {
  user.rpg.bag[id] = (user.rpg.bag[id] || 0) + qty;
}

function lootLine(id, qty = 1) {
  const i = LOOT[id];
  if (!i) return `${id} x${qty}`;
  return `${i.emoji} ${i.name} x${qty} (sell ${fmtCoins(i.sell)} each)`;
}

function bagSummary(user) {
  const tools = user.rpg.tools || {};
  const toolLine = [
    tools.rod ? `🎣 Rod x${tools.rod}` : null,
    tools.bait ? `🪱 Bait x${tools.bait}` : null,
    tools.axe ? `🪓 Axe x${tools.axe}` : null,
    tools.bow ? `🏹 Bow x${tools.bow}` : null,
  ]
    .filter(Boolean)
    .join(' · ') || 'None';

  const bag = user.rpg.bag || {};
  const items = Object.entries(bag).filter(([, q]) => q > 0);
  const itemLine = items.length
    ? items.map(([id, q]) => {
        const i = LOOT[id];
        return `${i?.emoji || '📦'} ${i?.name || id} x${q}`;
      }).join('\n')
    : 'Empty';

  const worth = items.reduce((s, [id, q]) => s + (LOOT[id]?.sell || 0) * q, 0);
  return { toolLine, itemLine, worth };
}

function doFish(groupId, userId) {
  return updateUser(groupId, userId, (user) => {
    const cd = checkCd(user, 'fish');
    if (!cd.ok) return { ok: false, error: 'cd', waitMs: cd.waitMs };

    let giftedRod = false;
    if ((user.rpg.tools.rod || 0) < 1) {
      user.rpg.tools.rod = 1;
      giftedRod = true;
    }

    const usedBait = (user.rpg.tools.bait || 0) > 0;
    if (usedBait) user.rpg.tools.bait -= 1;

    const table = usedBait
      ? [
          { id: 'seaweed', w: 12 },
          { id: 'sardine', w: 28 },
          { id: 'salmon', w: 28 },
          { id: 'tuna', w: 18 },
          { id: 'shark', w: 10 },
          { id: 'treasure', w: 4 },
        ]
      : [
          { id: 'boot', w: 18 },
          { id: 'seaweed', w: 18 },
          { id: 'sardine', w: 32 },
          { id: 'salmon', w: 20 },
          { id: 'tuna', w: 9 },
          { id: 'shark', w: 2.5 },
          { id: 'treasure', w: 0.5 },
        ];

    const catchId = pickWeighted(table).id;
    addBag(user, catchId, 1);
    user.rpg.lastFish = Date.now();
    user.xp += 8;
    return { ok: true, catchId, usedBait, giftedRod };
  });
}

function doHunt(groupId, userId) {
  return updateUser(groupId, userId, (user) => {
    const cd = checkCd(user, 'hunt');
    if (!cd.ok) return { ok: false, error: 'cd', waitMs: cd.waitMs };

    const hasBow = (user.rpg.tools.bow || 0) > 0;
    const table = hasBow
      ? [
          { id: 'rabbit', w: 30 },
          { id: 'deer', w: 35 },
          { id: 'boar', w: 22 },
          { id: 'wolf', w: 13 },
        ]
      : [
          { id: 'berry', w: 25 },
          { id: 'rabbit', w: 50 },
          { id: 'deer', w: 20 },
          { id: 'boar', w: 5 },
        ];

    const catchId = pickWeighted(table).id;
    addBag(user, catchId, 1);
    user.rpg.lastHunt = Date.now();
    user.xp += 10;
    return { ok: true, catchId, hasBow };
  });
}

function doChop(groupId, userId) {
  return updateUser(groupId, userId, (user) => {
    const cd = checkCd(user, 'chop');
    if (!cd.ok) return { ok: false, error: 'cd', waitMs: cd.waitMs };

    const hasAxe = (user.rpg.tools.axe || 0) > 0;
    const woodQty = hasAxe ? 2 + Math.floor(Math.random() * 3) : 1 + Math.floor(Math.random() * 2);
    addBag(user, 'wood', woodQty);
    let oak = 0;
    if (hasAxe && Math.random() < 0.28) {
      oak = 1;
      addBag(user, 'oak', 1);
    }
    user.rpg.lastChop = Date.now();
    user.xp += 7;
    return { ok: true, woodQty, oak, hasAxe };
  });
}

function doForage(groupId, userId) {
  return updateUser(groupId, userId, (user) => {
    const cd = checkCd(user, 'forage');
    if (!cd.ok) return { ok: false, error: 'cd', waitMs: cd.waitMs };

    const table = [
      { id: 'berry', w: 40 },
      { id: 'mushroom', w: 30 },
      { id: 'herb', w: 22 },
      { id: 'gem', w: 8 },
    ];
    const catchId = pickWeighted(table).id;
    addBag(user, catchId, 1);
    user.rpg.lastForage = Date.now();
    user.xp += 6;
    return { ok: true, catchId };
  });
}

function buyGear(groupId, userId, itemId) {
  const item = GEAR.find(
    (g) => g.id === String(itemId || '').toLowerCase() || g.name.toLowerCase().includes(String(itemId || '').toLowerCase())
  );
  if (!item) return { ok: false, error: 'item' };

  return updateUser(groupId, userId, (user) => {
    if (user.wallet < item.price) return { ok: false, error: 'funds', item };
    user.wallet -= item.price;
    const add = item.qty || 1;
    user.rpg.tools[item.id] = (user.rpg.tools[item.id] || 0) + add;
    return { ok: true, item, add };
  });
}

function sellAllLoot(groupId, userId) {
  return updateUser(groupId, userId, (user) => {
    const bag = user.rpg.bag || {};
    let total = 0;
    const sold = [];
    for (const [id, qty] of Object.entries(bag)) {
      const n = Number(qty) || 0;
      if (n < 1 || !LOOT[id]) continue;
      const gold = LOOT[id].sell * n;
      total += gold;
      sold.push({ id, qty: n, gold });
    }
    if (!total) return { ok: false, error: 'empty' };
    user.wallet += total;
    user.rpg.bag = {};
    return { ok: true, total, sold };
  });
}

module.exports = {
  COOLDOWNS,
  GEAR,
  LOOT,
  checkCd,
  lootLine,
  bagSummary,
  doFish,
  doHunt,
  doChop,
  doForage,
  buyGear,
  sellAllLoot,
  formatWait,
  fmtCoins,
};
