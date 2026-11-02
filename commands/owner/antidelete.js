/**
 * Anti-delete — owner only.
 * Deleted group and DM messages are sent to the owner DM.
 */

const config = require('../../config');
const antidelete = require('../../utils/antidelete');

module.exports = {
  name: 'antidelete',
  aliases: ['ad', 'antirevoke'],
  category: 'owner',
  description: 'Send deleted group and DM messages to the owner',
  usage: ',antidelete <on/off>',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    const p = config.prefix;
    const on = antidelete.isEnabled();

    if (!args[0]) {
      return extra.reply(
        `🗑️ *Anti-delete*\n\n` +
        `Status: *${on ? 'ON' : 'OFF'}*\n\n` +
        `When ON, deleted messages from groups and DMs are sent to the owner DM.\n\n` +
        `\`${p}antidelete on\`\n` +
        `\`${p}antidelete off\``
      );
    }

    const opt = args[0].toLowerCase();
    if (opt === 'on') {
      if (on) return extra.reply('🗑️ Anti-delete is already on.');
      antidelete.setEnabled(true);
      return extra.reply('🗑️ *Anti-delete ON.*\nDeleted group and DM messages will be sent to your DM.');
    }
    if (opt === 'off') {
      if (!on) return extra.reply('🗑️ Anti-delete is already off.');
      antidelete.setEnabled(false);
      return extra.reply('🗑️ *Anti-delete OFF.*');
    }
    return extra.reply(`Usage: \`${p}antidelete on\` or \`${p}antidelete off\``);
  }
};
