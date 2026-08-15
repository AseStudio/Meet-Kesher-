// ⚠️ ASSUMPTION FLAGGED: CreateSession.js almost certainly already
// generates sessions.code and sessions.password somehow — I don't have
// that file's content in front of me right now, so this is a
// standalone implementation, not a shared one. If CreateSession.js's
// version differs (length, character set, a uniqueness retry against
// existing codes), prefer that one instead and point ChannelChatScreen
// at it, so codes stay consistent app-wide instead of having two
// slightly different generators.

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1 — avoids characters people misread
const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function randomString(chars, length) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function generateSessionCode(length = 6) {
  return randomString(CODE_CHARS, length);
}

export function generateSessionPassword(length = 8) {
  return randomString(PASSWORD_CHARS, length);
}
