/**
 * Game button ownership helpers.
 * Button ids look like: crash_cash__<ownerToken>, bj_hit__<token>, bombcfg_1__<token>
 */

function ownerToken(jid) {
  return String(jid || '')
    .split('@')[0]
    .split(':')[0]
    .replace(/[^a-zA-Z0-9]/g, '');
}

function withOwner(prefix, ownerJid) {
  return `${prefix}__${ownerToken(ownerJid)}`;
}

function tokenFromId(id) {
  const s = String(id || '');
  const m = s.match(/__([a-zA-Z0-9]+)(?:\s|$)/);
  if (m) return m[1];
  // also allow trailing token after last __
  const i = s.lastIndexOf('__');
  if (i >= 0) {
    const t = s.slice(i + 2).trim().split(/\s+/)[0];
    if (/^[a-zA-Z0-9]+$/.test(t)) return t;
  }
  return '';
}

function isGameButtonId(id) {
  const s = String(id || '').toLowerCase();
  return (
    s.includes('crash_cash') ||
    s.includes('bj_hit') ||
    s.includes('bj_stand') ||
    /bombcfg/.test(s) ||
    s.includes('rps_accept') ||
    s.includes('rps_decline') ||
    s.includes('rps_rock') ||
    s.includes('rps_paper') ||
    s.includes('rps_scissors') ||
    s.includes('rps_cancel')
  );
}

/** true if button has no owner tag, or tag matches clicker */
function isButtonOwner(id, clickerJid) {
  const token = tokenFromId(id);
  if (!token) return true;
  return token === ownerToken(clickerJid);
}

module.exports = {
  ownerToken,
  withOwner,
  tokenFromId,
  isGameButtonId,
  isButtonOwner,
};
