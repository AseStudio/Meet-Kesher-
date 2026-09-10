// Single source of truth for lobby timing, shared across Lobby and Dashboard
export const LOBBY_DURATION_SECONDS = 300; // 5 minutes

export const AGORA_APP_ID = 'c585bcd3c1c940a29e8f1e904b873ba1';

// Single source of truth for plan pricing/limits, shared across UpgradeScreen
// (what's being sold) and CreateSession (what the attendee cap actually is).
// Keeping this in one place means the two screens can never quietly drift
// out of sync the way maxAttendees previously did — it was defined here in
// spirit but only ever actually wired up on the Upgrade screen.
export const PLANS = [
  { key: 'free', name: 'Free', price: '$0', tagline: 'Get a feel for Kesher', hostMinutes: 30, recordingMinutes: 0, maxAttendees: 20, attendCap: '3 sessions/mo' },
  { key: 'pro', name: 'Pro', price: '$4.99', tagline: 'For regular hosts', hostMinutes: 90, recordingMinutes: 30, maxAttendees: 30, attendCap: '5 sessions/mo' },
  { key: 'max', name: 'Max', price: '$8.99', tagline: 'Most popular', badge: 'POPULAR', hostMinutes: 180, recordingMinutes: 60, maxAttendees: 40, attendCap: '10 sessions/mo' },
  { key: 'premium', name: 'Premium', price: '$15.99', tagline: 'For power users', hostMinutes: 540, recordingMinutes: 180, maxAttendees: 50, attendCap: '20 sessions/mo' },
];

const PLANS_BY_KEY = Object.fromEntries(PLANS.map((p) => [p.key, p]));

export function getPlan(planKey) {
  return PLANS_BY_KEY[planKey] || PLANS_BY_KEY.free;
}

export function getPlanMaxAttendees(planKey) {
  return getPlan(planKey).maxAttendees;
}