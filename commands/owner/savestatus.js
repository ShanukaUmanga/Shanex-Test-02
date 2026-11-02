/**
 * savestatus — owner only.
 * Reply to a status to save it, or turn on auto-save for every status.
 */

const config = require('../../config');
const savestatus = require('../../utils/savestatus');

module.exports = {
  name: 'savestatus',
  aliases: ['savesm', 'savest'],
  category: 'owner',
  description: 'Save a replied status to your chat, or auto-save every status',
  usage: ',savestatus [on/off]',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    const p = config.prefix;
    const sub = (args[0] || '').toLowerCase();

    if (['on', 'off', 'enable', 'disable'].includes(sub)) {
      const enable = sub === 'on' || sub === 'enable';
      if (enable === savestatus.isEnabled()) {
        return extra.reply(`💾 Auto-save is already *${enable ? 'ON' : 'OFF'}*.`);
      }
      savestatus.setEnabled(enable);
      return extra.reply(
        enable
          ? '💾 *Auto-save ON.*\nEvery new status will be sent to your chat.'
          : '💾 *Auto-save OFF.*'
      );
    }

    const ctx = savestatus.contextOf(msg);
    const quoted = savestatus.unwrap(ctx?.quotedMessage);
    const cached = savestatus.findRecent(ctx?.stanzaId);
    const content = quoted?.imageMessage || quoted?.videoMessage || quoted?.audioMessage || quoted?.conversation || quoted?.extendedTextMessage
      ? quoted
      : cached?.message;
    if (content) {
      const dest = savestatus.ownerJid(sock);
      if (!dest) return extra.reply('❌ Owner number is not set.');
      const header = savestatus.statusHeader(savestatus.authorJid([
        ctx?.participantAlt,
        cached?.key?.participantAlt,
        ctx?.participant,
        cached?.key?.participant,
      ]));
      try {
        await savestatus.saveStatusContent(sock, dest, content, header.text, header.mentions);
      } catch (error) {
        console.error('[savestatus]', error.message);
        return extra.reply(`❌ Could not save that status. ${error.message}`);
      }
      return;
    }

    if (!args[0] || sub === 'status') {
      const on = savestatus.isEnabled();
      return extra.reply(
        `💾 *Save status*\n\n` +
        `Auto-save: *${on ? 'ON' : 'OFF'}*\n\n` +
        `Reply to a status with \`${p}savestatus\` to save that one.\n` +
        `\`${p}savestatus on\` — save every new status to your chat\n` +
        `\`${p}savestatus off\` — stop auto-save`
      );
    }

    return extra.reply(`Reply to a status, then send \`${p}savestatus\`.`);
  },
};
