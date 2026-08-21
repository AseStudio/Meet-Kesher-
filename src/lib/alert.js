import { Alert, Platform } from 'react-native';

/**
 * Drop-in replacement for React Native's Alert.alert(title, message, buttons).
 *
 * Why this exists: react-native-web does not reliably render Alert.alert's
 * button UI — on web, calling Alert.alert with a multi-button array (a
 * Cancel/Confirm-style dialog) silently shows nothing, which means any
 * action gated behind one of those buttons' onPress never runs. This showed
 * up as "the button does nothing" for several destructive-confirm flows
 * (end session, leave session, ban, clear board, cancel session, etc.).
 *
 * On native (iOS/Android) this just calls through to the real Alert.alert.
 * On web it falls back to window.alert / window.confirm so the same call
 * site works correctly on every platform without every screen needing its
 * own Platform.OS branch.
 */
export function showAlert(title, message, buttons) {
  if (Platform.OS !== 'web') {
    return Alert.alert(title, message, buttons);
  }

  const text = message ? `${title}\n\n${message}` : title;

  // No buttons, or a single (implicit "OK") button — plain message alert.
  if (!buttons || buttons.length <= 1) {
    window.alert(text);
    if (buttons && buttons[0] && typeof buttons[0].onPress === 'function') {
      buttons[0].onPress();
    }
    return;
  }

  // Multi-button — treat the non-cancel button as the "confirm" action.
  const confirmBtn = buttons.find(b => b.style !== 'cancel') || buttons[buttons.length - 1];
  const cancelBtn = buttons.find(b => b.style === 'cancel');
  if (window.confirm(text)) {
    confirmBtn?.onPress?.();
  } else {
    cancelBtn?.onPress?.();
  }
}
