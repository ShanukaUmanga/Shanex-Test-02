/**
 * Coinflip — pick heads or tails, 2× payout
 * Usage: {prefix}coinflip <heads|tails> <amount>
 * No buttons needed.
 */

const config = require('../../config');
const { deductWallet, adjustWallet, fmtCoins, getBalance } = require('../../utils/economy');

const MIN_BET = 50;
const MAX_BET = 50000;
const PAYOUT_MULT = 1.2;
const MAX_TURNS = 15;

/** groupId:userId -> { day, turns } */
const dailyTurns = new Map();

function px() {
  return config.prefix;
}

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getTurnInfo(groupId, userId) {
  const key = `${groupId}:${userId}`;
  const day = dayKey();
  let entry = dailyTurns.get(key);
  if (!entry || entry.day !== day) {
    entry = { day, turns: 0 };
    dailyTurns.set(key, entry);
  }
  return { entry, turns: entry.turns, remaining: MAX_TURNS - entry.turns };
}

function consumeTurn(groupId, userId) {
  const { entry } = getTurnInfo(groupId, userId);
  entry.turns += 1;
  return entry.turns;
}

function parseSide(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (['h', 'heads', 'head', 'headss'].includes(s)) return 'heads';
  if (['t', 'tails', 'tail', 'tailss'].includes(s)) return 'tails';
  return null;
}

function helpText() {
  const p = px();
  return (
    `🪙 *COINFLIP*\n\n` +
    `Pick *heads* or *tails*. Win pays *${PAYOUT_MULT}×* your stake.\n\n` +
    `Usage: \`${p}coinflip <heads|tails> <amount>\`\n` +
    `Aliases: \`${p}cf\` · \`${p}flip\`\n` +
    `Example: \`${p}coinflip heads 500\`\n\n` +
    `Min: *${fmtCoins(MIN_BET)}* · Max: *${fmtCoins(MAX_BET)}*\n` +
    `Daily flips: *${MAX_TURNS}* per player`
  );
}

module.exports = {
  name: 'coinflip',
  aliases: ['cf', 'flip', 'coin'],
  category: 'games',
  description: 'Bet on heads or tails — 2× payout',
  groupOnly: true,
  get usage() {
    return `${config.prefix}coinflip <heads|tails> <amount>`;
  },

  async execute(sock, msg, args, extra) {
    try {
      if (!extra.isGroup) {
        return extra.reply('❌ Coinflip only works in groups.');
      }

      if (!args.length) {
        return extra.reply(helpText());
      }

      const side = parseSide(args[0]);
      const amount = parseInt(args[1], 10);

      if (!side || !Number.isInteger(amount)) {
        return extra.reply(helpText());
      }

      if (amount < MIN_BET || amount > MAX_BET) {
        return extra.reply(
          `❌ Bet must be between *${fmtCoins(MIN_BET)}* and *${fmtCoins(MAX_BET)}* coins.`
        );
      }

      const { turns, remaining } = getTurnInfo(extra.from, extra.sender);
      if (remaining <= 0) {
        return extra.reply(
          `🎟️ Daily coinflip limit reached (*${MAX_TURNS}/${MAX_TURNS}*). Try again tomorrow.`
        );
      }

      const deducted = deductWallet(extra.from, extra.sender, amount);
      if (!deducted.ok) {
        if (deducted.error === 'funds') {
          return extra.reply(
            `❌ Not enough coins. Wallet: *${fmtCoins(deducted.user.wallet)}*`
          );
        }
        return extra.reply('❌ Invalid bet amount.');
      }

      const turn = consumeTurn(extra.from, extra.sender);
      const result = Math.random() < 0.5 ? 'heads' : 'tails';
      const won = result === side;
      const emoji = result === 'heads' ? '🟡' : '⚪';

      let text =
        `🪙 *COINFLIP*\n\n` +
        `You picked: *${side}*\n` +
        `Result: ${emoji} *${result.toUpperCase()}*\n` +
        `🎟️ Turn: *${turn}/${MAX_TURNS}*\n\n`;

      if (won) {
        const payout = amount * PAYOUT_MULT;
        adjustWallet(extra.from, extra.sender, payout);
        text +=
          `✅ You won *${fmtCoins(payout)}* coins!\n` +
          `💰 Wallet: *${fmtCoins(getBalance(extra.from, extra.sender))}*`;
      } else {
        text +=
          `❌ You lost *${fmtCoins(amount)}* coins.\n` +
          `💰 Wallet: *${fmtCoins(getBalance(extra.from, extra.sender))}*`;
      }

      return extra.reply(text);
    } catch (e) {
      console.error('[coinflip]', e);
      return extra.reply('❌ Coinflip failed. Try again.');
    }
  },
};
