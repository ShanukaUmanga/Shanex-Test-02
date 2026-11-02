/**
 * SHANEX GOLDEN MD - Unified Next Generation message theme.
 * Used by the shared command reply helper so text-based command responses
 * keep one consistent visual identity without changing command logic.
 */
const config = require('../config');

const BRAND = 'ＳＨＡＮＥＸ  ＧＯＬＤＥＮ  ＭＤ';
const TOP = '╭━━━〔 ✦ 𝐒𝐇𝐀𝐍𝐄𝐗 𝐆𝐎𝐋𝐃𝐄𝐍 𝐌𝐃 ✦ 〕━━━╮';
const BOTTOM = '╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯';

function formatBotReply(value) {
  if (value === null || value === undefined) value = '';
  const body = typeof value === 'string' ? value : String(value);

  // Keep already-branded layouts, menus, and multi-media captions untouched.
  if (body.includes('𝐒𝐇𝐀𝐍𝐄𝐗 𝐆𝐎𝐋𝐃𝐄𝐍 𝐌𝐃') || body.includes('ＳＨＡＮＥＸ')) {
    return body;
  }

  // Preserve empty responses and avoid adding decoration to extremely long output.
  if (!body.trim() || body.length > 12000) return body;

  const prefix = config.prefix || '.';
  const footer = `\n\n╰─『 ${BRAND} 』`;
  return `${TOP}\n${body}${footer}`;
}

module.exports = { formatBotReply };
