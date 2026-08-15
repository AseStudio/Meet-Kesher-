// Single source of truth for lobby timing, shared across Lobby and Dashboard
export const LOBBY_DURATION_SECONDS = 300; // 5 minutes

export const AGORA_APP_ID = 'c585bcd3c1c940a29e8f1e904b873ba1';

// Hard ceiling on session size, enforced both here (CreateSession's
// counter can't be set above this) and server-side (see the
// enforce_session_capacity trigger in the capacity migration) — a
// client-side cap alone can't stop a modified client or a request sent
// straight to the API. Raise this once usage patterns justify the
// extra Agora participant-minute cost of bigger sessions.
export const MAX_ATTENDEES_CAP = 20;