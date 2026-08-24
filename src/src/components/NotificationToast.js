import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

function ToastItem({ text, onDone }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => onDone());
    }, 2600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View style={[styles.toast, { opacity }]}>
      <Text style={styles.toastText} numberOfLines={2}>{text}</Text>
    </Animated.View>
  );
}

/**
 * Stack of independently fading toasts. Each one manages its own
 * fade-in/hold/fade-out lifecycle and calls onDismiss(id) when it's done,
 * so multiple notifications arriving close together (a reaction right
 * after a chat message, say) stack and clear independently instead of
 * one clobbering the other's animation state.
 *
 * Usage:
 *   const [toasts, setToasts] = useState([]);
 *   const pushToast = (text) => setToasts(p => [...p, { id: `${Date.now()}-${Math.random()}`, text }]);
 *   const dismissToast = (id) => setToasts(p => p.filter(t => t.id !== id));
 *   <NotificationToastStack toasts={toasts} onDismiss={dismissToast} />
 */
export default function NotificationToastStack({ toasts, onDismiss }) {
  if (!toasts?.length) return null;
  return (
    <View style={styles.stack} pointerEvents="none">
      {toasts.map((t) => (
        <ToastItem key={t.id} text={t.text} onDone={() => onDismiss(t.id)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    position: 'absolute',
    top: 70,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 90,
    gap: 8,
  },
  toast: {
    backgroundColor: 'rgba(20,20,40,0.92)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    maxWidth: '86%',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  toastText: { color: colors.white, fontSize: 13, fontWeight: '600', textAlign: 'center' },
});