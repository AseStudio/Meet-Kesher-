// Single source of truth for what each session mode allows. Imported by
// CreateSession.js (locking attendee count / guests for interview),
// SessionMain.js (host toolbar/board-picker/dropdown), and
// AttendeeSession.js (attendee toolbar) — so the four modes can't drift
// out of sync between the host and attendee views the way duplicated
// per-screen logic has in this codebase before.
//
// maxParticipants is enforced server-side (see the
// enforce_interview_capacity trigger migration) for the actual hard
// block — this value is for UI purposes (locking the attendee-count
// stepper in CreateSession, disabling "Allow Guests") only.

export const SESSION_MODES = ['classroom', 'interview', 'meeting', 'gettogether'];

const CAPABILITIES = {
  classroom: {
    board: true,
    boardTypes: ['whiteboard', 'blackboard', 'graph'],
    agenda: true,
    poll: true,
    chat: true,
    reactions: true,
    signals: true, // raise hand / correction / speak
    documents: false,
    allowGuests: true,
    maxParticipants: null, // host-set max_attendees applies, no extra cap
  },
  interview: {
    board: false,
    boardTypes: [],
    agenda: false,
    poll: false,
    chat: false,
    reactions: false,
    signals: false,
    documents: true, // host <-> applicant file exchange
    allowGuests: false, // guests have no session_attendees row, so the
    // 2-person cap (enforced in the DB) can't see or count them —
    // simplest correct fix is not allowing them in interview sessions
    // at all, rather than trying to retrofit guest-counting.
    maxParticipants: 2, // host + one applicant, hard cap
  },
  meeting: {
    board: true,
    boardTypes: ['graph'], // only board type meeting mode allows
    agenda: true,
    poll: true,
    chat: true,
    reactions: true,
    signals: true,
    documents: false,
    allowGuests: true,
    maxParticipants: null,
  },
  gettogether: {
    board: false,
    boardTypes: [],
    agenda: false,
    poll: false,
    chat: true,
    reactions: true,
    signals: false,
    documents: false,
    allowGuests: true,
    maxParticipants: null,
  },
};

export function getSessionModeCapabilities(mode) {
  return CAPABILITIES[mode] || CAPABILITIES.classroom;
}
