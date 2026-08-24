import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors } from '../theme/colors'; // adjust path if this file lives elsewhere

/**
 * ErrorBoundary
 * -------------
 * React only lets class components catch render/effect errors — hooks
 * can't do this, so this stays a class despite the rest of the app being
 * function components.
 *
 * Wrap screens that are secondary to an active session (chat, polls,
 * reactions, etc) with this. Without it, an uncaught error ANYWHERE in
 * that screen's tree unmounts the entire app by default — which is what
 * just happened: a bug in ChatPanel crashed the whole React tree, which
 * tore down SessionMain's Agora client along with it, which is why the
 * host looked like they'd left the call. This contains a crash to the
 * screen it happened in instead of letting it cascade.
 *
 * Use the withErrorBoundary helper below to wrap a screen's component
 * when registering it, e.g. in App.js:
 *
 *   <Stack.Screen name="ChatPanel" component={withErrorBoundary(ChatPanel)} />
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong on this screen</Text>
          <Text style={styles.subtitle}>The rest of your session is unaffected — go back and try again.</Text>
          <TouchableOpacity style={styles.btn} onPress={() => this.props.navigation?.goBack?.()}>
            <Text style={styles.btnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

export function withErrorBoundary(Component) {
  return function Wrapped(props) {
    return (
      <ErrorBoundary navigation={props.navigation}>
        <Component {...props} />
      </ErrorBoundary>
    );
  };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A1A', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  title: { color: colors.white, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  subtitle: { color: 'rgba(255,255,255,0.6)', fontSize: 13, textAlign: 'center' },
  btn: { marginTop: 8, backgroundColor: colors.primary, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 14 },
  btnText: { color: colors.white, fontWeight: '700', fontSize: 14 },
});