/**
 * Horse Race Bet — pick a horse (1–4), stake coins, 4× payout if it wins
 * Usage: {prefix}horse <1-4> <amount>
 */

const config = require('../../config');
const { deductWallet, adjustWallet, fmtCoins } = require('../../utils/economy');
const { tag } = require('../../utils/funHelpers');

const MIN_BET = 50;
const MAX_BET = 50000;
const HORSES = 4;
const TRACK_LEN = 12;
const PAYOUT_MULT = 4;
const MAX_TURNS = 15;
const FRAME_DELAY_MS = 900;

/** groupId:userId -> { day: 'YYYY-MM-DD', turns: number } */
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
  return { key, entry, turns: entry.turns, remaining: MAX_TURNS - entry.turns };
}

function consumeTurn(groupId, userId) {
  const { entry } = getTurnInfo(groupId, userId);
  entry.turns += 1;
  return entry.turns;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Build race board. positions: array of 0..TRACK_LEN for each horse. */
function renderTrack(positions, winner = null, finished = false) {
  const lines = [];
  for (let i = 0; i < HORSES; i++) {
    const pos = Math.min(Math.max(positions[i], 0), TRACK_LEN);
    const dashes = '—'.repeat(pos);
    const isWinner = finished && winner === i + 1;
    const horse = isWinner ? '🏇' : '🐎';
    const flag = isWinner ? '🚩' : '';
    const pad = finished && isWinner ? '' : '—'.repeat(Math.max(0, TRACK_LEN - pos));
    lines.push(`Line ${i + 1}: |${dashes}${horse}${i + 1}${flag}${pad}`);
  }
  return lines.join('\n');
}

/**
 * Simulate a race that ends with `winner` (1–4) finishing first.
 * Returns an array of position snapshots for animation.
 */
function simulateRace(winner) {
  const frames = [];
  const pos = Array(HORSES).fill(0);
  frames.push([...pos]);

  while (pos[winner - 1] < TRACK_LEN) {
    for (let i = 0; i < HORSES; i++) {
      if (pos[i] >= TRACK_LEN) continue;
      let step = Math.floor(Math.random() * 3); // 0–2
      if (i === winner - 1) step = Math.max(step, 1); // winner always moves
      else if (pos[i] >= TRACK_LEN - 2 && Math.random() < 0.7) step = 0; // hold others back near finish
      pos[i] = Math.min(TRACK_LEN, pos[i] + step);
    }
    // Ensure nobody else finishes before winner
    for (let i = 0; i < HORSES; i++) {
      if (i !== winner - 1 && pos[i] >= TRACK_LEN && pos[winner - 1] < TRACK_LEN) {
        pos[i] = TRACK_LEN - 1;
      }
    }
    frames.push([...pos]);
    if (frames.length > 40) break; // safety
  }

  pos[winner - 1] = TRACK_LEN;
  frames.push([...pos]);
  return frames;
}

function helpText() {
  const p = px();
  return (
    `🏁 *DERBY DAY*\n\n` +
    `Bet on a horse (1–4). Winner pays *${PAYOUT_MULT}×* your stake.\n\n` +
    `Usage: \`${p}horse <1-4> <amount>\`\n` +
    `Example: \`${p}horse 1 1000\`\n\n` +
    `Min bet: *${fmtCoins(MIN_BET)}* · Max: *${fmtCoins(MAX_BET)}*\n` +
    `Daily races: *${MAX_TURNS}* per player`
  );
}

module.exports = {
  name: 'horse',
  aliases: ['derby', 'race', 'horserace'],
  category: 'fun',
  description: 'Bet on a horse race — 4× payout if your horse wins',
  groupOnly: true,
  get usage() {
    return `${config.prefix}horse <1-4> <amount>`;
  },

  async execute(sock, msg, args, extra) {
    try {
      const p = px();
      const horseNum = parseInt(args[0], 10);
      const amount = parseInt(args[1], 10);

      if (!Number.isInteger(horseNum) || horseNum < 1 || horseNum > HORSES || !Number.isInteger(amount)) {
        return extra.reply(helpText());
      }

      if (amount < MIN_BET) {
        return extra.reply(`❌ Min bet is *${fmtCoins(MIN_BET)}* coins.`);
      }
      if (amount > MAX_BET) {
        return extra.reply(`❌ Max bet is *${fmtCoins(MAX_BET)}* coins.`);
      }

      const { turns, remaining } = getTurnInfo(extra.from, extra.sender);
      if (remaining <= 0) {
        return extra.reply(
          `🎟️ You've used all *${MAX_TURNS}* races today.\nCome back tomorrow!`
        );
      }

      const deducted = deductWallet(extra.from, extra.sender, amount);
      if (!deducted.ok) {
        if (deducted.error === 'funds') {
          return extra.reply(
            `❌ Not enough coins.\nWallet: *${fmtCoins(deducted.user?.wallet || 0)}* 🪙\nNeed: *${fmtCoins(amount)}*`
          );
        }
        return extra.reply('❌ Invalid bet amount.');
      }

      const turn = consumeTurn(extra.from, extra.sender);
      const winner = 1 + Math.floor(Math.random() * HORSES);
      const won = winner === horseNum;
      const playerTag = tag(extra.sender);
      const frames = simulateRace(winner);

      const header = `🏁 *DERBY DAY: RACE TRACK* 🏁\n━━━━━━━━━━━━━━━━━━\n`;

      // Opening frame
      let raceMsg = await sock.sendMessage(
        extra.from,
        {
          text:
            header +
            renderTrack(frames[0]) +
            `\n━━━━━━━━━━━━━━━━━━\n` +
            `👤 *Player:* ${playerTag}\n` +
            `🏇 *Your Bet:* Horse ${horseNum} · *${fmtCoins(amount)}* 🪙\n` +
            `⏳ Race starting...`,
          mentions: [extra.sender],
        },
        { quoted: msg }
      );

      // Mid frames (skip some for pace)
      const midIdx = [
        Math.floor(frames.length * 0.35),
        Math.floor(frames.length * 0.65),
        frames.length - 2,
      ].filter((i, idx, arr) => i > 0 && i < frames.length - 1 && arr.indexOf(i) === idx);

      for (const i of midIdx) {
        await sleep(FRAME_DELAY_MS);
        await sock.sendMessage(extra.from, {
          text:
            header +
            renderTrack(frames[i]) +
            `\n━━━━━━━━━━━━━━━━━━\n` +
            `👤 *Player:* ${playerTag}\n` +
            `🏇 *Your Bet:* Horse ${horseNum}\n` +
            `🏃 Racing...`,
          mentions: [extra.sender],
          edit: raceMsg.key,
        });
      }

      await sleep(FRAME_DELAY_MS);

      let payoutLine = '';
      if (won) {
        const payout = amount * PAYOUT_MULT;
        const result = adjustWallet(extra.from, extra.sender, payout);
        payoutLine =
          `✨ *VICTORY!*\n` +
          `💰 *Payout:* ${fmtCoins(payout)} 🪙\n` +
          `Wallet: *${fmtCoins(result.user.wallet)}* 🪙`;
      } else {
        payoutLine =
          `💀 *YOU LOST!*\n` +
          `💸 Lost stake: *${fmtCoins(amount)}* 🪙\n` +
          `Wallet: *${fmtCoins(deducted.user.wallet)}* 🪙`;
      }

      const finalText =
        header +
        renderTrack(frames[frames.length - 1], winner, true) +
        `\n━━━━━━━━━━━━━━━━━━\n` +
        `👤 *Player:* ${playerTag}\n` +
        `🏇 *Your Bet:* Horse ${horseNum}\n` +
        `🏆 *Winner:* Horse ${winner}\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `${payoutLine}\n` +
        `🎟️ Turn: ${turn}/${MAX_TURNS}`;

      await sock.sendMessage(extra.from, {
        text: finalText,
        mentions: [extra.sender],
        edit: raceMsg.key,
      });
    } catch (e) {
      console.error('[horse]', e);
      await extra.reply('❌ Race crashed. Please try again.');
    }
  },
};
