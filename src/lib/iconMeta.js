import React from 'react';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

// Mode → icon + color. HostDashboard.js and AttendeeDashboard.js each keep
// their own local copy of this same table (icon/set/color/soft/label) and
// already theme their session-list rows correctly with it. This shared
// version previously only had icon/set — every screen that imports
// ModeIcon from *here* instead (SessionMain, AttendeeSession, LobbyScreen,
// GuestWaitingScreen, EndSession — i.e. the actual live-session flow) had
// no choice but to hardcode a single fixed color at every call site,
// which is why every mode showed up looking like classroom's blue/purple
// no matter what was actually picked in Create Session. Values are drawn
// from the exact same theme/colors.js tokens the dashboards use, so a
// session's badge always matches the swatch it was created under.
export const MODE_ICON_META = {
  classroom:   { icon: 'school-outline',    set: 'ion', color: colors.primary, soft: '#F4F3FF', label: 'Classroom' },
  interview:   { icon: 'briefcase-outline', set: 'ion', color: colors.yellow,  soft: '#FFF3DE', label: 'Interview' },
  meeting:     { icon: 'people-outline',    set: 'ion', color: colors.green,   soft: '#E7FBF0', label: 'Meeting' },
  gettogether: { icon: 'party-popper',      set: 'mci', color: colors.red,     soft: '#FFE9E9', label: 'Get Together' },
};
export const DEFAULT_MODE_ICON = { icon: 'calendar-outline', set: 'ion', color: colors.primary, soft: '#F4F3FF', label: 'Session' };

export function getModeMeta(mode) {
  return MODE_ICON_META[mode] || DEFAULT_MODE_ICON;
}
export const getModeColor = (mode) => getModeMeta(mode).color;
export const getModeSoft = (mode) => getModeMeta(mode).soft;

// `color` stays an optional override (some call sites deliberately want a
// fixed white/dark icon regardless of mode, e.g. sitting on an already
// mode-colored solid chip) — but when it's omitted, this now defaults to
// the mode's own accent instead of a hardcoded white that made every
// mode look the same.
export function ModeIcon({ mode, size = 12, color }) {
  const meta = getModeMeta(mode);
  const IconSet = meta.set === 'mci' ? MaterialCommunityIcons : Ionicons;
  return <IconSet name={meta.icon} size={size} color={color || meta.color} />;
}

// Signal icon lookup — used by attendee toolbar buttons, the "Signal
// sent" badge, and the host's incoming-signal chip, so there's one
// place mapping key → icon instead of separate literals per screen.
export const SIGNAL_ICON = {
  hand: 'hand-left-outline',
  correction: 'alert-circle-outline',
  speak: 'megaphone-outline',
};

// Whiteboard / Blackboard / Graph board type picker — used by
// SessionMain's board-type modal.
export const BOARD_TYPE_ICON = {
  whiteboard: 'easel-outline',
  blackboard: 'square-outline',
  graph: 'stats-chart-outline',
};
