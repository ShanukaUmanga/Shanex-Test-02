/**
 * BratGPT - Generate animated brat-style text sticker
 * API: https://api.starlights.uk/api/maker/bratvid
 */

const axios = require('axios');
const config = require('../../config');
const { writeExifVid } = require('../../utils/exif');

const API_URL = 'https://api.starlights.uk/api/maker/bratvid';
const MAX_TEXT = 100;

module.exports = {
  name: 'bratgpt',
  aliases: ['brat', 'bratvid'],
  category: 'general',
  description: 'Generate animated brat text sticker',
  usage: '.bratgpt <text>',

  async execute(sock, msg, args, extra) {
    try {
      let text = args.join(' ').trim();

      if (!text) {
        const quoted =
          msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        text = (
          quoted?.conversation ||
          quoted?.extendedTextMessage?.text ||
          quoted?.imageMessage?.caption ||
          ''
        ).trim();
      }

      if (!text) {
        return extra.reply(
          `❌ Please provide text!\n\nExample: ${extra.prefix || config.prefix}bratgpt lawde apna kaam kar`
        );
      }

      if (text.length > MAX_TEXT) {
        return extra.reply(`❌ Text is too long! Maximum ${MAX_TEXT} characters.`);
      }


      const { data, headers, status } = await axios.get(API_URL, {
        params: { text },
        responseType: 'arraybuffer',
        timeout: 60000,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: 'video/*,application/json,*/*',
        },
        validateStatus: () => true,
      });

      const buffer = Buffer.from(data || []);
      const contentType = String(headers['content-type'] || '');

      if (status !== 200 || !buffer.length) {
        throw new Error(`API error (${status})`);
      }

      if (contentType.includes('json') || buffer.slice(0, 1).toString() === '{') {
        let errMsg = 'API did not return a video';
        try {
          errMsg = JSON.parse(buffer.toString('utf8'))?.message || errMsg;
        } catch { /* ignore */ }
        throw new Error(errMsg);
      }

      const webpBuffer = await writeExifVid(buffer, {
        packname: config.packname || config.botName,
      });

      await sock.sendMessage(
        extra.from,
        { sticker: webpBuffer },
        { quoted: msg }
      );
    } catch (error) {
      console.error('[bratgpt] error:', error.message);
      if (error.code === 'ECONNABORTED' || /timeout/i.test(error.message)) {
        return extra.reply('❌ Request timed out. Try again.');
      }
      return extra.reply('❌ Failed to generate brat sticker. Try again.');
    }
  },
};
