const sharp = require('sharp');

const MAX = 4.8 * 1024 * 1024;

/** Shrink to a JPEG under WhatsApp's image limit. Returns the original buffer when it already fits. */
async function fitWhatsAppImage(buffer) {
  if (!buffer || buffer.length <= MAX) return buffer;

  let width = 1600;
  let quality = 82;
  let out = buffer;

  for (let i = 0; i < 8; i++) {
    out = await sharp(buffer, { animated: false, limitInputPixels: false })
      .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();
    if (out.length <= MAX) return out;
    quality = Math.max(40, quality - 8);
    width = Math.round(width * 0.8);
  }

  if (out.length > 5 * 1024 * 1024) {
    throw new Error('Image still too large after compress');
  }
  return out;
}

module.exports = { fitWhatsAppImage };
