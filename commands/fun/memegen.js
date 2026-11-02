/**
 * Meme sticker maker — top/bottom text on an image via KnightAPI /api/img/meme
 * Image: replied image/sticker, image sent with the command, else the target's DP.
 */

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const sharp = require('sharp');
const APIs = require('../../utils/api');
const { writeExifImg } = require('../../utils/exif');
const { getCardTarget } = require('../../utils/funHelpers');
const { webp2png } = require('../../utils/webp2mp4');
const config = require('../../config');

function unwrap(message) {
  let m = message || {};
  if (m.ephemeralMessage) m = m.ephemeralMessage.message || {};
  if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message || {};
  if (m.viewOnceMessage) m = m.viewOnceMessage.message || {};
  return m;
}

async function imageFromMessage(sock, msg, extra) {
  const own = unwrap(msg.message);
  const ctx = own.extendedTextMessage?.contextInfo || own.imageMessage?.contextInfo || {};
  const quoted = unwrap(ctx.quotedMessage);

  let source = null;
  if (own.imageMessage) {
    source = { key: msg.key, message: own, sticker: false };
  } else if (quoted.imageMessage || quoted.stickerMessage) {
    source = {
      key: { remoteJid: extra.from, id: ctx.stanzaId, participant: ctx.participant },
      message: quoted,
      sticker: !!quoted.stickerMessage,
    };
  }
  if (!source) return null;

  if (source.sticker && source.message.stickerMessage?.isAnimated) {
    throw new Error('Animated stickers are not supported.');
  }
  let buffer = await downloadMediaMessage(
    { key: source.key, message: source.message },
    'buffer',
    {},
    { logger: undefined, reuploadRequest: sock.updateMediaMessage }
  );
  if (!buffer) throw new Error('Could not download that image.');
  if (source.sticker) buffer = await webp2png(buffer);
  return APIs.uploadTempImage(buffer, source.sticker ? 'image.png' : 'image.jpg', source.sticker ? 'image/png' : 'image/jpeg');
}

module.exports = {
  name: 'memegen',
  aliases: ['makememe'],
  category: 'fun',
  description: 'Make a meme with top (and optional bottom) text',
  usage: '.memegen top text | bottom text',

  async execute(sock, msg, args, extra) {
    const text = args.filter((a) => !/^@\d+$/.test(a)).join(' ').trim();
    const [top, ...rest] = text.split('|');
    const topText = (top || '').trim();
    const bottomText = rest.join('|').trim();

    if (!topText) {
      return extra.reply(
        `🖼️ *Meme maker*\n\n` +
        `${config.prefix}memegen top text\n` +
        `${config.prefix}memegen top text | bottom text\n\n` +
        `Reply to an image/sticker, send an image with this caption, or reply/@mention someone to use their DP.`
      );
    }

    try {
      let url = await imageFromMessage(sock, msg, extra);
      if (!url) url = (await getCardTarget(sock, msg, extra)).pic;

      const image = await APIs.getMemeImage({ url, top: topText, bottom: bottomText });
      const webp = await sharp(image)
        .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality: 80 })
        .toBuffer();
      const sticker = await writeExifImg(webp, { packname: config.packname });
      await sock.sendMessage(extra.from, { sticker }, { quoted: msg });
    } catch (error) {
      console.error('[memegen]', error.message);
      await extra.reply(`❌ Meme failed: ${error.message}`);
    }
  },
};
