/**
 * RPG timepass commands — fish / hunt / chop / forage / bag / gear shop
 * Single registry (same pattern as economyCommands).
 */

const config = require('../config');
const { getUserData } = require('./economy');
const rpg = require('./rpg');

function px() {
  return config.prefix;
}

function makeRpgCmd(def) {
  const { usage: usageBody, ...rest } = def;
  const cmd = { category: 'games', groupOnly: true, ...rest };
  if (usageBody != null) {
    Object.defineProperty(cmd, 'usage', {
      enumerable: true,
      configurable: true,
      get() {
        return `${config.prefix}${usageBody}`;
      },
    });
  }
  return cmd;
}

function cdReply(extra, waitMs, verb) {
  return extra.reply(`⏳ Too tired to ${verb} yet. Wait *${rpg.formatWait(waitMs)}*.`);
}

const rpgCommands = [
  makeRpgCmd({
    name: 'fish',
    aliases: ['mancing', 'fishing', 'cast'],
    description: 'Go fishing — catch loot, sell later',
    usage: 'fish',
    async execute(sock, msg, args, extra) {
      if (!extra.isGroup) return extra.reply('❌ Fishing is group-only.');
      const result = rpg.doFish(extra.from, extra.sender);
      if (!result.ok) {
        if (result.error === 'cd') return cdReply(extra, result.waitMs, 'fish');
        return extra.reply('❌ Could not fish.');
      }
      const gift = result.giftedRod ? `\n🎁 Found a starter *🎣 fishing rod* in the mud.\n` : '';
      const bait = result.usedBait ? `\n🪱 Used 1 bait.` : '';
      return extra.reply(
        `🎣 *FISHING*\n${gift}` +
          `You reeled in: *${rpg.lootLine(result.catchId)}*\n` +
          `${bait}\n` +
          `Sell with \`${px()}sellloot\` · Gear: \`${px()}rpgshop\``
      );
    },
  }),

  makeRpgCmd({
    name: 'hunt',
    aliases: ['hunting', 'huntgame'],
    description: 'Hunt animals for loot',
    usage: 'hunt',
    async execute(sock, msg, args, extra) {
      if (!extra.isGroup) return extra.reply('❌ Hunting is group-only.');
      const result = rpg.doHunt(extra.from, extra.sender);
      if (!result.ok) {
        if (result.error === 'cd') return cdReply(extra, result.waitMs, 'hunt');
        return extra.reply('❌ Could not hunt.');
      }
      const gear = result.hasBow ? '🏹 Bow equipped' : '✊ Bare-handed (buy a bow for better loot)';
      return extra.reply(
        `🏹 *HUNT*\n${gear}\n` +
          `Caught: *${rpg.lootLine(result.catchId)}*\n\n` +
          `\`${px()}rpgshop\` · \`${px()}sellloot\``
      );
    },
  }),

  makeRpgCmd({
    name: 'chop',
    aliases: ['woodcut', 'wood', 'axe'],
    description: 'Chop trees for wood',
    usage: 'chop',
    async execute(sock, msg, args, extra) {
      if (!extra.isGroup) return extra.reply('❌ Chopping is group-only.');
      const result = rpg.doChop(extra.from, extra.sender);
      if (!result.ok) {
        if (result.error === 'cd') return cdReply(extra, result.waitMs, 'chop');
        return extra.reply('❌ Could not chop.');
      }
      let text =
        `🪓 *CHOP*\n` +
        (result.hasAxe ? 'Axe equipped — extra yield.\n' : `Bare hands. Buy an axe: \`${px()}rpgbuy axe\`\n`) +
        `Got *🪵 Wood x${result.woodQty}*`;
      if (result.oak) text += `\nBonus: *🌳 Oak Log x1*`;
      text += `\n\n\`${px()}sellloot\``;
      return extra.reply(text);
    },
  }),

  makeRpgCmd({
    name: 'forage',
    aliases: ['gather', 'pickup', 'scavenge'],
    description: 'Forage berries, herbs, rare gems',
    usage: 'forage',
    async execute(sock, msg, args, extra) {
      if (!extra.isGroup) return extra.reply('❌ Forage is group-only.');
      const result = rpg.doForage(extra.from, extra.sender);
      if (!result.ok) {
        if (result.error === 'cd') return cdReply(extra, result.waitMs, 'forage');
        return extra.reply('❌ Could not forage.');
      }
      return extra.reply(
        `🍀 *FORAGE*\nYou found: *${rpg.lootLine(result.catchId)}*\n\n\`${px()}sellloot\``
      );
    },
  }),

  makeRpgCmd({
    name: 'rpginv',
    aliases: ['bag', 'loot', 'rpgbag'],
    description: 'Show RPG bag and tools',
    usage: 'rpginv',
    async execute(sock, msg, args, extra) {
      const user = getUserData(extra.from, extra.sender);
      const { toolLine, itemLine, worth } = rpg.bagSummary(user);
      return extra.reply(
        `🎒 *RPG BAG*\n\n` +
          `*Tools*\n${toolLine}\n\n` +
          `*Loot*\n${itemLine}\n\n` +
          `Sell value: *${rpg.fmtCoins(worth)}*\n` +
          `\`${px()}sellloot\` · \`${px()}rpgshop\``
      );
    },
  }),

  makeRpgCmd({
    name: 'rpgshop',
    aliases: ['gearshop', 'fishshop'],
    description: 'Buy fishing rod, bait, axe, bow',
    usage: 'rpgshop',
    async execute(sock, msg, args, extra) {
      const p = px();
      const lines = rpg.GEAR.map(
        (g) => `• \`${g.id}\` ${g.name} — *${rpg.fmtCoins(g.price)}*\n  ${g.desc}`
      );
      return extra.reply(
        `🛒 *RPG GEAR SHOP*\n\n${lines.join('\n\n')}\n\n` +
          `Buy: \`${p}rpgbuy <id>\`\nExample: \`${p}rpgbuy rod\``
      );
    },
  }),

  makeRpgCmd({
    name: 'rpgbuy',
    aliases: ['gearbuy', 'buyrod'],
    description: 'Buy RPG gear',
    usage: 'rpgbuy <item>',
    async execute(sock, msg, args, extra) {
      const id = (args[0] || '').trim().toLowerCase();
      if (!id) {
        return extra.reply(`❌ Usage: \`${px()}rpgbuy rod|bait|axe|bow\`\nSee \`${px()}rpgshop\``);
      }
      const result = rpg.buyGear(extra.from, extra.sender, id);
      if (!result.ok) {
        if (result.error === 'item') return extra.reply(`❌ Unknown gear. Use \`${px()}rpgshop\``);
        if (result.error === 'funds') {
          return extra.reply(
            `❌ Need *${rpg.fmtCoins(result.item.price)}*. Wallet: *${rpg.fmtCoins(result.user.wallet)}*`
          );
        }
        return extra.reply('❌ Purchase failed.');
      }
      return extra.reply(
        `✅ Bought ${result.item.emoji} *${result.item.name}*` +
          (result.add > 1 ? ` (+${result.add})` : '') +
          `\nWallet: *${rpg.fmtCoins(result.user.wallet)}*`
      );
    },
  }),

  makeRpgCmd({
    name: 'sellloot',
    aliases: ['sellall', 'sellbag', 'sellfish'],
    description: 'Sell all RPG loot for coins',
    usage: 'sellloot',
    async execute(sock, msg, args, extra) {
      const result = rpg.sellAllLoot(extra.from, extra.sender);
      if (!result.ok) {
        if (result.error === 'empty') {
          return extra.reply(`🎒 Bag is empty. Try \`${px()}fish\` or \`${px()}hunt\`.`);
        }
        return extra.reply('❌ Could not sell.');
      }
      const list = result.sold
        .map((s) => `${rpg.LOOT[s.id]?.emoji || ''} ${rpg.LOOT[s.id]?.name || s.id} x${s.qty}`)
        .join('\n');
      return extra.reply(
        `💰 *SOLD LOOT*\n${list}\n\n` +
          `+*${rpg.fmtCoins(result.total)}* coins\n` +
          `Wallet: *${rpg.fmtCoins(result.user.wallet)}*`
      );
    },
  }),

  makeRpgCmd({
    name: 'rpg',
    aliases: ['rpghelp', 'timepass'],
    description: 'RPG / timepass command list',
    usage: 'rpg',
    async execute(sock, msg, args, extra) {
      const p = px();
      return extra.reply(
        `🏕️ *RPG / TIMEPASS*\n\n` +
          `*Activities* (cooldowns)\n` +
          `• \`${p}fish\` — catch fish (starter rod on first try)\n` +
          `• \`${p}hunt\` — hunt animals (bow helps)\n` +
          `• \`${p}chop\` — chop wood (axe helps)\n` +
          `• \`${p}forage\` — berries / herbs / gems\n\n` +
          `*Bag*\n` +
          `• \`${p}rpginv\` · \`${p}sellloot\`\n` +
          `• \`${p}rpgshop\` · \`${p}rpgbuy <item>\`\n\n` +
          `Does not replace \`${p}mine\` / \`${p}shop\` (those stay economy).`
      );
    },
  }),
];

module.exports = rpgCommands;
