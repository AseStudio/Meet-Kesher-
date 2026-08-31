// Matches the CHECK constraint on profiles.username in the DB — keep
// these in sync if that constraint ever changes.
export const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

// Strips anything that isn't a-z/0-9/_ and lowercases as the person
// types, so by the time they hit submit the format is nearly
// impossible to have violated. Case-insensitive uniqueness without a
// citext column is otherwise a headache, so this just avoids the
// problem: usernames are always lowercase, full stop.
export function sanitizeUsernameInput(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
}

export function isValidUsername(username) {
  return USERNAME_REGEX.test(username || '');
}
