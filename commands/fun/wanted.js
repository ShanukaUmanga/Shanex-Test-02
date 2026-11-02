const APIs = require('../../utils/api');
const { getCardTarget } = require('../../utils/funHelpers');

module.exports = {
  name: 'wanted',
  aliases: ['poster'],
  category: 'fun',
  description: 'Wanted poster card of a user',
  usage: '.wanted @user [crime]',

  async execute(sock, msg, args, extra) {
    try {
      const target = await getCardTarget(sock, msg, extra);
      const crime = args.filter((a) => !a.startsWith('@')).join(' ').trim() || 'Too many jokes';
      const image = await APIs.getCardImage('wanted', {
        name: target.name,
        pic: target.pic,
        crime,
        reward: '$10,000',
        theme: 'wanted',
      });
      await sock.sendMessage(extra.from, {
        image,
        caption: `WANTED: ${target.mentionText}\nCrime: ${crime}\nReward: $10,000`,
        mentions: target.mentions,
      }, { quoted: msg });
    } catch (error) {
      console.error('[wanted]', error.message);
      await extra.reply('❌ Wanted card failed. Try again.');
    }
  },
};
