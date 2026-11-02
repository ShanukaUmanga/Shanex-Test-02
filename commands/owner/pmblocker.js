/**
 * PM Blocker Command — auto-block people who DM the bot
 */

const config = require('../../config');
const pmblocker = require('../../utils/pmblocker');

module.exports = {
  name: 'pmblocker',
  aliases: ['pmblock', 'blockpm'],
  category: 'owner',
  description: 'Auto-block users who DM the bot',
  usage: '.pmblocker on|off|status|setmsg <text>',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    const sub = (args[0] || '').toLowerCase();
    const p = config.prefix;
    const state = pmblocker.readState();

    if (!sub || !['on', 'off', 'status', 'setmsg'].includes(sub)) {
      return extra.reply(
        `*PMBLOCKER (Owner only)*\n\n` +
          `\`${p}pmblocker on\` — Enable PM auto-block\n` +
          `\`${p}pmblocker off\` — Disable PM blocker\n` +
          `\`${p}pmblocker status\` — Show status\n` +
          `\`${p}pmblocker setmsg <text>\` — Set warning message`
      );
    }

    if (sub === 'status') {
      return extra.reply(
        `PM Blocker is currently *${state.enabled ? 'ON' : 'OFF'}*\nMessage: ${state.message}`
      );
    }

    if (sub === 'setmsg') {
      const newMsg = args.slice(1).join(' ').trim();
      if (!newMsg) {
        return extra.reply(`Usage: \`${p}pmblocker setmsg <message>\``);
      }
      pmblocker.writeState(state.enabled, newMsg);
      return extra.reply('✅ PM Blocker message updated.');
    }

    const enable = sub === 'on';
    if (enable === state.enabled) {
      return extra.reply(`PM Blocker is already *${enable ? 'ON' : 'OFF'}*.`);
    }

    pmblocker.writeState(enable);
    return extra.reply(`PM Blocker is now *${enable ? 'ENABLED' : 'DISABLED'}*.`);
  },
};
