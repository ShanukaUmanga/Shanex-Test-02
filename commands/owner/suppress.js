/**
 * Suppress this group only.
 * Members get no command reply. Owner and group admins still can use every command.
 */

const config = require('../../config');
const database = require('../../database');

module.exports = {
  name: 'suppress',
  aliases: ['silence', 'grpmute'],
  category: 'owner',
  description: 'In this group, only owner and admins can use the bot. Other groups stay normal.',
  usage: ',suppress <on/off>',
  groupOnly: true,
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    const p = config.prefix;
    const settings = database.getGroupSettings(extra.from);
    const on = settings.suppress === true;

    if (!args[0]) {
      return extra.reply(
        `🔇 *Group suppress*\n\n` +
        `This group: *${on ? 'ON' : 'OFF'}*\n\n` +
        `ON: members get no reply. Owner and admins can still use every command here.\n` +
        `Other groups are not affected.\n\n` +
        `\`${p}suppress on\`\n` +
        `\`${p}suppress off\``
      );
    }

    const opt = args[0].toLowerCase();
    if (opt === 'on') {
      if (on) return extra.reply('🔇 This group is already suppressed.');
      database.updateGroupSettings(extra.from, { suppress: true });
      return extra.reply('🔇 *Suppressed.*\n\nMembers will get no reply in this group. You and the admins can still use kick, antibot, and every other command. Other groups are unchanged.');
    }

    if (opt === 'off') {
      if (!on) return extra.reply('🔊 This group is not suppressed.');
      database.updateGroupSettings(extra.from, { suppress: false });
      return extra.reply('🔊 *Suppress off.* Everyone can use the bot in this group again.');
    }

    return extra.reply(`Usage: \`${p}suppress on\` or \`${p}suppress off\``);
  }
};
