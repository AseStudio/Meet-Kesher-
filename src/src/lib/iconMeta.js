import React from 'react';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

// Mode → icon. Single source of truth so the host view and attendee
// view always show the same badge for the same session mode — this
// used to be defined twice (once per screen, one still emoji-based),
// which is how they drifted apart.
export const MODE_ICON_META = {
  classroom:   { icon: 'school-outline',    set: 'ion' },
  interview:   { icon: 'briefcase-outline', set: 'ion' },
  meeting:     { icon: 'people-outline',    set: 'ion' },
  gettogether: { icon: 'party-popper',      set: 'mci' },
};
export const DEFAULT_MODE_ICON = { icon: 'calendar-outline', set: 'ion' };

export function ModeIcon({ mode, size = 12, color = colors.white }) {
  const meta = MODE_ICON_META[mode] || DEFAULT_MODE_ICON;
  const IconSet = meta.set === 'mci' ? MaterialCommunityIcons : Ionicons;
  return <IconSet name={meta.icon} size={size} color={color} />;
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
