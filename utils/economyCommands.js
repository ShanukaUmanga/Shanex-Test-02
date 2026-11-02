const config = require('../config');
const {
  SHOP,
  getUserData,
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
  setAutoLevelUp,
  getRole,
  formatLevelUpMessage,
  formatWait,
  fmtCoins,
  fmtCompactMoney,
  inventorySummary,
} = require('./economy');
const { ROLES } = require('./levelling');
const { tag, getTargetUser } = require('./funHelpers');

function px() {
  return config.prefix;
}

function sendMention(sock, msg, extra, text, mentions = []) {
  return sock.sendMessage(extra.from, { text, mentions }, { quoted: msg });
}

function getMentionTarget(msg) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo || {};
  if (ctx.mentionedJid?.[0]) return ctx.mentionedJid[0];
  // Reply to a user's message → treat them as the target
  if (ctx.quotedMessage || ctx.stanzaId) {
    return ctx.participant || null;
  }
  return null;
}

function parseAmount(args) {
  return parseInt(args.find((a) => /^\d+$/.test(a)), 10);
}

function dualMoney(n) {
  return `${fmtCoins(n)} | ${fmtCompactMoney(n)}`;
}

function walletLine(user) {
  return (
    `Rank: *${user.role || getRole(user.level).name}*\n` +
    `Level: *${user.level}* (${user.xp}/${xpForLevel(user.level)} XP)\n` +
    `Wallet: *${dualMoney(user.wallet)}*\n` +
    `Bank: *${dualMoney(user.bank)}*\n` +
    `Diamonds: *${fmtCoins(user.diamonds)}* 💎`
  );
}

function levelNotice(result) {
  if (!result?.leveled) return '';
  return `\n\n${formatLevelUpMessage(result.before, result.after, result.role, result.diamondsEarned)}`;
}

/** usageBody is without prefix, e.g. "buy <item>" */
function makeEcoCmd(def) {
  const { usage: usageBody, ...rest } = def;
  const cmd = { category: 'economy', groupOnly: true, ...rest };
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

const economyCommands = [
  makeEcoCmd({
    name: 'daily',
    aliases: ['claim', 'dailyreward'],
    description: 'Claim daily coins (100–500)',
    usage: 'daily',
    async execute(sock, msg, args, extra) {
      const result = claimDaily(extra.from, extra.sender);
      if (!result.ok) {
        return extra.reply(`⏳ Daily already claimed. Try again in *${formatWait(result.waitMs)}*.`);
      }
      return extra.reply(
        `💰 *Daily reward claimed!*\n\n+${fmtCoins(result.amount)} coins\n\n${walletLine(result.user)}${levelNotice(result.levelResult)}`
      );
    },
  }),

  makeEcoCmd({
    name: 'weekly',
    aliases: ['weeklyreward'],
    description: 'Claim weekly coins (1000–2500)',
    usage: 'weekly',
    async execute(sock, msg, args, extra) {
      const result = claimWeekly(extra.from, extra.sender);
      if (!result.ok) {
        return extra.reply(`⏳ Weekly already claimed. Try again in *${formatWait(result.waitMs)}*.`);
      }
      return extra.reply(
        `📅 *Weekly reward claimed!*\n\n+${fmtCoins(result.amount)} coins\n\n${walletLine(result.user)}${levelNotice(result.levelResult)}`
      );
    },
  }),

  makeEcoCmd({
    name: 'work',
    aliases: ['job'],
    description: 'Work for coins (1h cooldown)',
    usage: 'work',
    async execute(sock, msg, args, extra) {
      const result = doWork(extra.from, extra.sender);
      if (!result.ok) {
        return extra.reply(`⏳ You're tired. Work again in *${formatWait(result.waitMs)}*.`);
      }
      return extra.reply(
        `💼 *Work complete!*\n\nYou earned *${fmtCoins(result.amount)}* coins.\n\n${walletLine(result.user)}${levelNotice(result.levelResult)}`
      );
    },
  }),

  makeEcoCmd({
    name: 'crime',
    aliases: ['rob', 'heist'],
    description: 'Risky crime — win or lose coins (2h cooldown)',
    usage: 'crime',
    async execute(sock, msg, args, extra) {
      const result = doCrime(extra.from, extra.sender);
      if (!result.ok) {
        return extra.reply(`⏳ Lay low for *${formatWait(result.waitMs)}* before crime again.`);
      }
      if (result.success) {
        return extra.reply(
          `🕵️ *Crime successful!*\n\nStole *${fmtCoins(result.amount)}* coins.\n\n${walletLine(result.user)}${levelNotice(result.levelResult)}`
        );
      }
      return extra.reply(
        `🚔 *Busted!*\n\nLost *${fmtCoins(result.amount)}* coins.\n\n${walletLine(result.user)}`
      );
    },
  }),

  makeEcoCmd({
    name: 'mine',
    aliases: ['dig'],
    description: 'Mine coins — chance for diamonds (1.5h cooldown)',
    usage: 'mine',
    async execute(sock, msg, args, extra) {
      const result = doMine(extra.from, extra.sender);
      if (!result.ok) {
        return extra.reply(`⏳ Rest your pickaxe. Mine again in *${formatWait(result.waitMs)}*.`);
      }
      let text = `⛏️ *Mining complete!*\n\nFound *${fmtCoins(result.amount)}* coins.`;
      if (result.diamonds) text += `\nBonus: *+${result.diamonds}* 💎`;
      return extra.reply(`${text}\n\n${walletLine(result.user)}${levelNotice(result.levelResult)}`);
    },
  }),

  makeEcoCmd({
    name: 'balance',
    aliases: ['bal', 'wallet'],
    description: 'Check wallet, bank, diamonds & level',
    usage: 'balance [@user]',
    async execute(sock, msg, args, extra) {
      const { jid } = getTargetUser(msg, extra);
      const user = getUserData(extra.from, jid);
      const isSelf = jid === extra.sender;
      const inv = inventorySummary(user.inventory);

      const text =
        `${isSelf ? '💼 *Your profile*' : `💼 *${tag(jid)}* profile`}\n\n` +
        `${walletLine(user)}\n` +
        `Items: ${inv}`;

      return isSelf ? extra.reply(text) : sendMention(sock, msg, extra, text, [jid]);
    },
  }),

  makeEcoCmd({
    name: 'dep',
    aliases: ['deposit'],
    description: 'Deposit coins into bank',
    usage: 'dep <amount>',
    async execute(sock, msg, args, extra) {
      const amount = parseAmount(args);
      if (!amount) return extra.reply(`❌ Usage: \`${px()}dep <amount>\``);

      const result = deposit(extra.from, extra.sender, amount);
      if (!result.ok) {
        return extra.reply(result.error === 'funds'
          ? '❌ Not enough coins in wallet.'
          : '❌ Invalid amount.');
      }
      return extra.reply(
        `🏦 *Deposited ${fmtCoins(result.amount)} coins*\n\n${walletLine(result.user)}`
      );
    },
  }),

  makeEcoCmd({
    name: 'wd',
    aliases: ['withdraw'],
    description: 'Withdraw coins from bank',
    usage: 'wd <amount>',
    async execute(sock, msg, args, extra) {
      const amount = parseAmount(args);
      if (!amount) return extra.reply(`❌ Usage: \`${px()}wd <amount>\``);

      const result = withdraw(extra.from, extra.sender, amount);
      if (!result.ok) {
        return extra.reply(result.error === 'funds'
          ? '❌ Not enough coins in bank.'
          : '❌ Invalid amount.');
      }
      return extra.reply(
        `💵 *Withdrew ${fmtCoins(result.amount)} coins*\n\n${walletLine(result.user)}`
      );
    },
  }),

  makeEcoCmd({
    name: 'pay',
    aliases: ['transfer', 'give'],
    description: 'Send coins to another member',
    usage: 'pay @user <amount> | reply + pay <amount>',
    async execute(sock, msg, args, extra) {
      const targetId = getMentionTarget(msg);
      const amount = parseAmount(args);

      if (!targetId) {
        return extra.reply(
          `❌ Mention someone or *reply* to their message.\n\n` +
            `Usage:\n` +
            `• \`${px()}pay @user <amount>\`\n` +
            `• Reply to their msg → \`${px()}pay <amount>\``
        );
      }
      if (targetId === extra.sender) return extra.reply('❌ You cannot pay yourself.');
      if (!amount) {
        return extra.reply(
          `❌ Amount required.\n\n` +
            `• \`${px()}pay @user <amount>\`\n` +
            `• Reply → \`${px()}pay <amount>\``
        );
      }

      const result = transfer(extra.from, extra.sender, targetId, amount);
      if (!result.ok) {
        if (result.error === 'funds') {
          const user = getUserData(extra.from, extra.sender);
          return extra.reply(`❌ Not enough coins. Wallet: *${fmtCoins(user.wallet)}* 🪙`);
        }
        return extra.reply('❌ Invalid transfer.');
      }

      return sendMention(
        sock, msg, extra,
        `✅ *Transfer complete!*\n\n${tag(extra.sender)} → ${tag(targetId)}\n` +
        `Amount: *${fmtCoins(result.amount)}* 🪙\n\nWallet: *${fmtCoins(result.user.wallet)}* 🪙`,
        [extra.sender, targetId]
      );
    },
  }),

  makeEcoCmd({
    name: 'shop',
    aliases: ['store', 'market'],
    description: 'View the shop',
    usage: 'shop',
    async execute(sock, msg, args, extra) {
      const lines = SHOP.map((item) =>
        `• \`${item.id}\` ${item.name} — *${fmtCoins(item.price)}* 🪙`
      );
      return extra.reply(
        `🛒 *Shop*\n\n${lines.join('\n')}\n\nBuy with: \`${px()}buy <item>\`\nExample: \`${px()}buy pizza\``
      );
    },
  }),

  makeEcoCmd({
    name: 'buy',
    aliases: ['purchase'],
    description: 'Buy an item from the shop',
    usage: 'buy <item>',
    async execute(sock, msg, args, extra) {
      const itemId = args.join(' ').trim().toLowerCase();
      if (!itemId) {
        return extra.reply(`❌ Usage: \`${px()}buy <item>\`\nUse \`${px()}shop\` to see items.`);
      }

      const result = buyItem(extra.from, extra.sender, itemId);
      if (!result.ok) {
        if (result.error === 'item') {
          return extra.reply(`❌ Item not found. Use \`${px()}shop\` to browse.`);
        }
        if (result.error === 'funds') {
          return extra.reply(`❌ Not enough coins. Need *${fmtCoins(result.item.price)}* 🪙`);
        }
        return extra.reply('❌ Purchase failed.');
      }

      return extra.reply(
        `🛍️ *Purchased ${result.item.name}!*\n\n` +
        `Price: *${fmtCoins(result.item.price)}* 🪙\n\n${walletLine(result.user)}`
      );
    },
  }),

  makeEcoCmd({
    name: 'levelup',
    aliases: ['rankup', 'lvlup'],
    description: 'Level up using XP (grants diamonds)',
    usage: 'levelup',
    async execute(sock, msg, args, extra) {
      const result = levelUp(extra.from, extra.sender);
      if (!result.ok) {
        return extra.reply(
          `❌ Not enough XP.\n\nLevel *${result.level}* needs *${result.needed}* XP.\nYou have *${result.have}* XP.`
        );
      }
      return extra.reply(
        `⬆️ *Level up!*\n\n${formatLevelUpMessage(result.before, result.level, result.role, result.diamonds)}\n\n${walletLine(result.user)}`
      );
    },
  }),

  makeEcoCmd({
    name: 'role',
    aliases: ['rank', 'rango'],
    description: 'Show your level rank title',
    usage: 'role [@user]',
    async execute(sock, msg, args, extra) {
      const { jid } = getTargetUser(msg, extra);
      const user = getUserData(extra.from, jid);
      const isSelf = jid === extra.sender;
      const role = getRole(user.level);
      const next = ROLES.find((r) => r.min > user.level);

      const text =
        `${isSelf ? '🎖️ *Your rank*' : `🎖️ *${tag(jid)} rank*`}\n\n` +
        `Rank: *${user.role || role.name}*\n` +
        `Level: *${user.level}*\n` +
        `XP: *${user.xp}* / *${xpForLevel(user.level)}*\n` +
        (next ? `Next rank *${next.name}* at level *${next.min}*` : '🏆 Max rank reached!');

      return isSelf ? extra.reply(text) : sendMention(sock, msg, extra, text, [jid]);
    },
  }),

  makeEcoCmd({
    name: 'autolevelup',
    aliases: ['autolevel', 'alup'],
    description: 'Toggle automatic level-up notifications',
    usage: 'autolevelup on|off',
    async execute(sock, msg, args, extra) {
      const arg = (args[0] || '').toLowerCase();
      const user = getUserData(extra.from, extra.sender);

      if (arg === 'on' || arg === 'enable') {
        setAutoLevelUp(extra.from, extra.sender, true);
        return extra.reply('✅ Auto level-up *enabled*. You will rank up automatically when you have enough XP.');
      }
      if (arg === 'off' || arg === 'disable') {
        setAutoLevelUp(extra.from, extra.sender, false);
        return extra.reply(
          `❌ Auto level-up *disabled*. Use \`${px()}levelup\` manually when ready.`
        );
      }

      return extra.reply(
        `⚙️ Auto level-up is currently *${user.autolevelup !== false ? 'ON' : 'OFF'}*.\n\n` +
        `Use \`${px()}autolevelup on\` or \`${px()}autolevelup off\``
      );
    },
  }),

  makeEcoCmd({
    name: 'topcoins',
    aliases: ['leaderboard', 'rich', 'baltop', 'coinboard'],
    description: 'Richest members (wallet + bank)',
    usage: 'topcoins',
    async execute(sock, msg, args, extra) {
      const top = getTop(extra.from, 10);
      if (!top.length) {
        return extra.reply(`📊 No economy data yet. Try \`${px()}daily\` or \`${px()}work\`!`);
      }

      const medals = ['🥇', '🥈', '🥉'];
      const lines = top.map(([jid, user], i) => {
        const medal = medals[i] || `${i + 1}.`;
        return `${medal} ${tag(jid)} — *${fmtCompactMoney(totalWealth(user))}*`;
      });

      return sendMention(
        sock, msg, extra,
        `🏆 *Leaderboard*\n\n${lines.join('\n')}`,
        top.map(([jid]) => jid)
      );
    },
  }),

  makeEcoCmd({
    name: 'resetbalance',
    aliases: ['econreset'],
    ownerOnly: true,
    description: 'Reset a user\'s full economy data (owner)',
    usage: 'resetbalance @user',
    async execute(sock, msg, args, extra) {
      const targetId = getMentionTarget(msg);
      if (!targetId) {
        return extra.reply(`❌ Mention a user.\n\nUsage: \`${px()}resetbalance @user\``);
      }

      resetBalance(extra.from, targetId);
      return sendMention(sock, msg, extra, `🔄 Reset full economy for ${tag(targetId)}.`, [targetId]);
    },
  }),

  makeEcoCmd({
    name: 'resetcoin',
    aliases: ['resetcoins'],
    ownerOnly: true,
    description: 'Reset wallet & bank for a user (owner)',
    usage: 'resetcoin @user',
    async execute(sock, msg, args, extra) {
      const targetId = getMentionTarget(msg);
      if (!targetId) {
        return extra.reply(`❌ Mention a user.\n\nUsage: \`${px()}resetcoin @user\``);
      }

      resetCoin(extra.from, targetId);
      return sendMention(sock, msg, extra, `🪙 Reset coins for ${tag(targetId)}.`, [targetId]);
    },
  }),

  makeEcoCmd({
    name: 'resetdi',
    aliases: ['resetdiamonds'],
    ownerOnly: true,
    description: 'Reset diamonds for a user (owner)',
    usage: 'resetdi @user',
    async execute(sock, msg, args, extra) {
      const targetId = getMentionTarget(msg);
      if (!targetId) {
        return extra.reply(`❌ Mention a user.\n\nUsage: \`${px()}resetdi @user\``);
      }

      resetDi(extra.from, targetId);
      return sendMention(sock, msg, extra, `💎 Reset diamonds for ${tag(targetId)}.`, [targetId]);
    },
  }),

  makeEcoCmd({
    name: 'economy',
    aliases: ['eco'],
    description: 'Economy command list',
    usage: 'economy',
    async execute(sock, msg, args, extra) {
      const p = px();
      return extra.reply(
        `💰 *Group Economy*\n\n` +
        `*Earn*\n` +
        `• \`${p}daily\` • \`${p}weekly\` • \`${p}work\` • \`${p}crime\` • \`${p}mine\`\n\n` +
        `*Wallet*\n` +
        `• \`${p}balance\` • \`${p}dep\` • \`${p}wd\` • \`${p}pay @user <amt>\`\n\n` +
        `*Shop & Level*\n` +
        `• \`${p}shop\` • \`${p}buy <item>\` • \`${p}levelup\` • \`${p}role\`\n` +
        `• \`${p}autolevelup on/off\`\n\n` +
        `*Games*\n` +
        `• \`${p}slots\` • \`${p}rps rock|paper|scissors\`\n` +
        `• \`${p}horse <1-4> <amt>\` — derby race, 4× payout\n` +
        `• \`${p}coinflip <heads|tails> <amt>\` — 2× payout\n` +
        `• \`${p}fish\` · \`${p}hunt\` · \`${p}chop\` · \`${p}forage\` — RPG loot\n` +
        `• \`${p}rpg\` — RPG help · \`${p}rpginv\` · \`${p}sellloot\`\n\n` +
        `*Rank*\n` +
        `• \`${p}topcoins\` / \`${p}leaderboard\``
      );
    },
  }),
];

module.exports = economyCommands;
