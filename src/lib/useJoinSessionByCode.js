import { useState } from 'react';
import { supabase } from './supabase';

// Was previously only reachable from AttendeeDashboard, hardcoded there.
// Extracted so HostDashboard can offer the exact same "join a session"
// flow — ban check, session_attendees insert, live-vs-lobby routing —
// instead of a second, copy-pasted version that could drift out of sync.
// Nothing in here reads profile.role: joining a session by code has
// never actually required an "attendee" account, only the UI to reach it.
export function useJoinSessionByCode(navigation) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [joinError, setJoinError] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);

  const handleJoin = async () => {
    setJoinError('');
    if (!code.trim() || code.length < 6) return setJoinError('Enter a valid 6-character code.');
    if (!password.trim()) return setJoinError('Enter the session password.');

    setJoinLoading(true);
    try {
      const { data: session, error } = await supabase
        .from('sessions')
        .select('*')
        .eq('code', code.trim().toUpperCase())
        .single();

      if (error || !session) {
        setJoinError('Session not found. Check your code.');
        setJoinLoading(false);
        return;
      }

      if (session.password !== password.trim()) {
        setJoinError('Incorrect password.');
        setJoinLoading(false);
        return;
      }

      if (session.status === 'ended') {
        setJoinError('This session has already ended.');
        setJoinLoading(false);
        return;
      }

      if (session.status === 'cancelled') {
        setJoinError('This session was cancelled by the host.');
        setJoinLoading(false);
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();

      // Check ban BEFORE adding them as an attendee
      if (user) {
        const { data: ban } = await supabase
          .from('bans')
          .select('id')
          .eq('host_id', session.host_id)
          .eq('banned_user_id', user.id)
          .maybeSingle();

        if (ban) {
          setJoinError("You have been banned from this host's sessions.");
          setJoinLoading(false);
          return;
        }

        const { data: existing } = await supabase
          .from('session_attendees')
          .select('id')
          .eq('session_id', session.id)
          .eq('user_id', user.id)
          .maybeSingle();

        if (!existing) {
          await supabase.from('session_attendees').insert({
            session_id: session.id,
            user_id: user.id,
          });
        }
      }

      if (session.status === 'live') {
        navigation.navigate('AttendeeSession', { session });
      } else {
        navigation.navigate('Lobby', { session, attendee: true });
      }
    } catch (err) {
      setJoinError(err.message || 'Failed to join session.');
    } finally {
      setJoinLoading(false);
    }
  };

  return { code, setCode, password, setPassword, joinError, joinLoading, handleJoin };
}
