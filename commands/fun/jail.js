const APIs = require('../../utils/api');
const { getCardTarget } = require('../../utils/funHelpers');

const CELLS = ['A-12', 'B-07', 'C-21', 'D-03', 'E-19', 'F-11'];

module.exports = {
  name: 'jail',
  aliases: ['arrest', 'lockup'],
  category: 'fun',
  description: 'Jail mugshot card of a user',
  usage: '.jail @user [crime]',

  async execute(sock, msg, args, extra) {
    try {
      const target = await getCardTarget(sock, msg, extra);
      const crime = args.filter((a) => !a.startsWith('@')).join(' ').trim() || 'Too many jokes';
      const cell = CELLS[Math.floor(Math.random() * CELLS.length)];
      const image = await APIs.getCardImage('jail', {
        name: target.name,
        pic: target.pic,
        crime,
        sentence: '30 DAYS',
        cell,
        theme: 'dark',
      });
      await sock.sendMessage(extra.from, {
        image,
        caption: `LOCKED UP: ${target.mentionText}\nCrime: ${crime}\nSentence: 30 DAYS · Cell ${cell}`,
        mentions: target.mentions,
      }, { quoted: msg });
    } catch (error) {
      console.error('[jail]', error.message);
      await extra.reply('❌ Jail card failed. Try again.');
    }
  },
};
