// Single source of truth for the shareable session join link.
//
// Deliberately NOT window.location.origin — that's web-only (breaks on
// native, since there's no `window`) and even on web it resolves to
// whatever's in the address bar (localhost:19006 in dev, a preview
// deploy URL, etc.), which isn't a link worth sharing. A fixed domain
// works identically everywhere and matches the pattern CreateSession.js
// already uses for its own share link.
export const JOIN_LINK_DOMAIN = 'https://kesher.app/join';

export function getSessionJoinLink(code) {
  return `${JOIN_LINK_DOMAIN}/${(code || '').toString()}`;
}
