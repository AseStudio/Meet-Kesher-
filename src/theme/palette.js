import { Platform } from 'react-native';
import { colors } from './colors';

// Single source of truth for the "polished" visual language used across
// Profile, UpgradeScreen, and StoreScreen — semantic names built on top
// of the base colors in ./colors, so a screen asks for `palette.danger`
// rather than reaching for `colors.red` directly. This is a superset of
// what those three screens each defined locally before; nothing here
// should be a breaking rename for any of them.
export const palette = {
  primary: colors.primary,
  primaryBright: colors.primaryLight,
  primaryDeep: colors.primaryDark,
  primarySoft: colors.background,
  primarySoftBorder: colors.greyLight,

  ink: colors.text,
  inkMuted: colors.textLight,

  surface: colors.white,
  canvas: colors.background,
  line: colors.greyLight,

  success: colors.green,
  successSoft: '#E7FBF0',
  danger: colors.red,
  dangerSoft: '#FFE9E9',
  live: colors.red,
  liveSoft: '#FFE9E9',
  amber: colors.yellow,
  amberSoft: '#FFF3DE',

  premium: '#7C3AED',
  premiumSoft: '#F1E8FE',
  premiumDeep: '#4C1D95',

  neutralSoft: colors.greyLight,
  neutralText: colors.grey,
};

// The soft-lift shadow used on every card across the polished screens.
// Platform.select once, here, instead of re-declared per file.
export const cardShadow = Platform.select({
  ios: { shadowColor: '#2A1A6B', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 14 },
  android: { elevation: 3 },
  default: { boxShadow: '0 6px 18px rgba(42,26,107,0.08)' },
});

// A lighter lift than cardShadow — CreateSession's existing weight,
// kept as its own named variant rather than forced onto the standard
// cardShadow (which would visibly change that screen's look).
export const softShadow = Platform.select({
  ios: { shadowColor: '#2A1A6B', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 10 },
  android: { elevation: 2 },
  default: { boxShadow: '0 4px 12px rgba(42,26,107,0.06)' },
});

// A slightly stronger lift, for cards that need to visually pop more
// than a standard list card — e.g. a highlighted/featured pack, a hero
// balance card. Kept separate rather than overloading cardShadow's one
// look for every situation.
export const raisedShadow = Platform.select({
  ios: { shadowColor: '#2A1A6B', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.12, shadowRadius: 20 },
  android: { elevation: 6 },
  default: { boxShadow: '0 10px 28px rgba(42,26,107,0.14)' },
});