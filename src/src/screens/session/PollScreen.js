import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';

/**
 * PollScreen
 * ----------
 * Previously this screen was entirely local/fake: hardcoded `liveResults`,
 * no Supabase, no realtime, and — since AttendeeSession.js never had a
 * "Poll" button at all — attendees had no way to reach it in the first
 * place. This rebuild makes it a real, multiplayer feature.
 *
 * Requires the caller to pass identity + role through navigation, same
 * pattern as ChatPanel.js:
 *
 *   navigation.navigate('PollScreen', {
 *     session,
 *     currentUser: hostUser,      // or currentUserRef.current on the attendee side
 *     isHost: true,               // or false
 *   })
 *
 * WHY A DEDICATED CHANNEL, NOT session-control:
 * Same reasoning as ChatPanel.js (see that file's header) — Supabase
 * won't let a second, independent subscription add listeners to a topic
 * that's already actively joined elsewhere (session-control is held open
 * by SessionMain/AttendeeSession for the whole session). This screen owns
 * `session-poll-${session.id}` exclusively.
 *
 * NOTIFYING THE REST OF THE APP:
 * SessionMain.js / AttendeeSession.js can't safely listen on this
 * screen's topic either, for the same reason. Instead they each run a
 * separate, uniquely-named `session-polls-watch-${session.id}` channel
 * that only watches `postgres_changes` INSERT on session_polls — the
 * exact pattern session-messages-watch already uses for chat unread
 * badges/toasts. That's what powers the "📊 New poll" toast and the Poll
 * toolbar badge on both screens without touching this screen's realtime
 * topic at all.
 *
 * DATA MODEL:
 * One `session_polls` row per launched poll (NOT per draft — nothing is
 * written until the host taps Launch). `poll_votes` holds one row per
 * (poll_id, voter_id), upserted so re-voting changes an existing vote
 * instead of creating a duplicate. Vote tallies are derived client-side
 * from a `{ voterId: optionIndex }` map rather than incremented counters,
 * so a changed vote naturally moves from one option's count to another
 * without needing to separately track "previous option". On close, the
 * final tally is snapshotted into `session_polls.results` so poll history
 * doesn't need a second query against poll_votes later.
 *
 * --- SQL (run once) ---------------------------------------------------
 * create table if not exists session_polls (
 *   id uuid primary key default gen_random_uuid(),
 *   session_id uuid not null references sessions(id) on delete cascade,
 *   question text not null,
 *   options jsonb not null,               -- ["Figma","Adobe XD","Sketch"]
 *   status text not null default 'live' check (status in ('live','closed')),
 *   results jsonb,                        -- [12,5,3] — snapshotted on close
 *   created_by uuid not null references auth.users(id),
 *   created_by_name text,
 *   created_at timestamptz not null default now(),
 *   closed_at timestamptz
 * );
 *
 * create table if not exists poll_votes (
 *   id uuid primary key default gen_random_uuid(),
 *   poll_id uuid not null references session_polls(id) on delete cascade,
 *   session_id uuid not null references sessions(id) on delete cascade,
 *   voter_id uuid not null references auth.users(id),
 *   voter_name text,
 *   option_index int not null,
 *   created_at timestamptz not null default now(),
 *   unique (poll_id, voter_id)
 * );
 *
 * alter table session_polls enable row level security;
 * alter table poll_votes enable row level security;
 *
 * create policy "select polls" on session_polls for select using (true);
 * create policy "host inserts polls" on session_polls for insert with check (created_by = auth.uid());
 * create policy "host updates own polls" on session_polls for update using (created_by = auth.uid());
 *
 * create policy "select votes" on poll_votes for select using (true);
 * create policy "insert own vote" on poll_votes for insert with check (voter_id = auth.uid());
 * create policy "update own vote" on poll_votes for update using (voter_id = auth.uid());
 * ------------------------------------------------------------------------
 * NOTE: the two "select ... using (true)" policies above are permissive —
 * tighten to a session_attendees membership check before shipping this
 * beyond testing, same caveat as the rest of this app's client-trust model.
 */

export default function PollScreen({ navigation, route }) {
  const { session, currentUser, isHost = false } = route.params || {};
  const myId = currentUser?.id ?? null;
  const myName = currentUser?.name || (isHost ? 'Host' : 'Attendee');

  // ─── Builder (host only, before launch) ───
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);

  // ─── Current poll (live or just-closed) ───
  const [poll, setPoll] = useState(null); // { id, question, options, status, results }
  const [loadingPoll, setLoadingPoll] = useState(true);
  // { voterId: optionIndex } — the single source of truth tallies are
  // derived from. See file header for why this shape instead of raw counts.
  const [votesMap, setVotesMap] = useState({});

  // ─── History (host only) ───
  const [pastPolls, setPastPolls] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  const channelRef = useRef(null);

  // ─── Load whatever poll is currently live for this session (if any) on
  // mount, so a late-arriving attendee or a host who navigated away and
  // back both land on the right state instead of a blank builder. ───
  useEffect(() => {
    if (!session?.id) return;
    loadCurrentPoll();
    if (isHost) loadPastPolls();
  }, [session?.id]);

  const loadCurrentPoll = async () => {
    setLoadingPoll(true);
    const { data, error } = await supabase
      .from('session_polls')
      .select('*')
      .eq('session_id', session.id)
      .eq('status', 'live')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn('loadCurrentPoll error', error);
      setLoadingPoll(false);
      return;
    }
    if (data) {
      setPoll(data);
      await loadVotesFor(data.id);
    }
    setLoadingPoll(false);
  };

  const loadVotesFor = async (pollId) => {
    const { data, error } = await supabase
      .from('poll_votes')
      .select('voter_id, option_index')
      .eq('poll_id', pollId);
    if (error) {
      console.warn('loadVotesFor error', error);
      return;
    }
    const map = {};
    (data || []).forEach((v) => { map[v.voter_id] = v.option_index; });
    setVotesMap(map);
  };

  const loadPastPolls = async () => {
    const { data, error } = await supabase
      .from('session_polls')
      .select('*')
      .eq('session_id', session.id)
      .eq('status', 'closed')
      .order('closed_at', { ascending: false })
      .limit(20);
    if (!error) setPastPolls(data || []);
  };

  // ─── Realtime — this screen's own dedicated topic (see file header) ───
  useEffect(() => {
    if (!session?.id) return;
    const ch = supabase.channel(`session-poll-${session.id}`);

    ch.on('broadcast', { event: 'poll-launched' }, ({ payload }) => {
      setPoll(payload.poll);
      setVotesMap({});
    });

    ch.on('broadcast', { event: 'poll-vote' }, ({ payload }) => {
      setVotesMap((prev) => ({ ...prev, [payload.voterId]: payload.optionIndex }));
    });

    ch.on('broadcast', { event: 'poll-closed' }, ({ payload }) => {
      setPoll((prev) => (prev && prev.id === payload.pollId ? { ...prev, status: 'closed', results: payload.results } : prev));
      if (isHost) loadPastPolls();
    });

    ch.subscribe();
    channelRef.current = ch;
    return () => supabase.removeChannel(ch);
  }, [session?.id]);

  // ─── Builder helpers ───
  const addOption = () => {
    if (options.length < 6) setOptions([...options, '']);
  };
  const removeOption = (i) => {
    if (options.length <= 2) return; // need at least 2 to launch
    setOptions(options.filter((_, idx) => idx !== i));
  };

  const launchPoll = async () => {
    const trimmedQuestion = question.trim();
    const trimmedOptions = options.map((o) => o.trim()).filter(Boolean);
    if (!trimmedQuestion) return Alert.alert('Missing question', 'Add a question before launching.');
    if (trimmedOptions.length < 2) return Alert.alert('Not enough options', 'Add at least 2 options.');
    if (!myId) return Alert.alert('Not ready', 'Still confirming your identity — try again in a moment.');

    const { data, error } = await supabase
      .from('session_polls')
      .insert({
        session_id: session.id,
        question: trimmedQuestion,
        options: trimmedOptions,
        status: 'live',
        created_by: myId,
        created_by_name: myName,
      })
      .select()
      .single();

    if (error) {
      console.warn('launchPoll error', error);
      Alert.alert('Could not launch poll', error.message);
      return;
    }

    setPoll(data);
    setVotesMap({});
    setQuestion('');
    setOptions(['', '']);
    channelRef.current?.send({ type: 'broadcast', event: 'poll-launched', payload: { poll: data } });
  };

  const castVote = async (optionIndex) => {
    if (!poll || poll.status !== 'live' || !myId) return;
    // Optimistic local update — the broadcast below will also echo this
    // back to us, but skipping our own echo (see the realtime listener
    // dedup pattern used in ChatPanel) isn't needed here since setting
    // the same value twice is harmless; kept simple on purpose.
    setVotesMap((prev) => ({ ...prev, [myId]: optionIndex }));

    channelRef.current?.send({
      type: 'broadcast',
      event: 'poll-vote',
      payload: { pollId: poll.id, optionIndex, voterId: myId },
    });

    const { error } = await supabase
      .from('poll_votes')
      .upsert(
        { poll_id: poll.id, session_id: session.id, voter_id: myId, voter_name: myName, option_index: optionIndex },
        { onConflict: 'poll_id,voter_id' }
      );
    if (error) console.warn('castVote persist error', error);
  };

  const closePoll = async () => {
    if (!poll) return;
    const results = poll.options.map((_, i) => Object.values(votesMap).filter((v) => v === i).length);

    const { error } = await supabase
      .from('session_polls')
      .update({ status: 'closed', results, closed_at: new Date().toISOString() })
      .eq('id', poll.id);
    if (error) {
      console.warn('closePoll error', error);
      Alert.alert('Could not close poll', error.message);
      return;
    }

    setPoll((prev) => ({ ...prev, status: 'closed', results }));
    channelRef.current?.send({ type: 'broadcast', event: 'poll-closed', payload: { pollId: poll.id, results } });
    loadPastPolls();
  };

  const startNewPoll = () => {
    setPoll(null);
    setVotesMap({});
  };

  // ─── Derived tallies ───
  const totalVotes = Object.keys(votesMap).length;
  const counts = poll
    ? (poll.status === 'closed' && poll.results ? poll.results : poll.options.map((_, i) => Object.values(votesMap).filter((v) => v === i).length))
    : [];
  const myVoteIndex = myId != null ? votesMap[myId] : undefined;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>📊 Poll</Text>
        {isHost ? (
          <TouchableOpacity onPress={() => setShowHistory((v) => !v)}>
            <Text style={styles.historyToggle}>{showHistory ? 'Hide history' : 'History'}</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 24 }} />
        )}
      </View>

      {loadingPoll ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>

          {isHost && showHistory && (
            <View style={styles.historySection}>
              <Text style={styles.sectionTitle}>Past Polls</Text>
              {pastPolls.length === 0 ? (
                <Text style={styles.emptyHistoryText}>No closed polls yet this session.</Text>
              ) : (
                pastPolls.map((p) => {
                  const total = (p.results || []).reduce((a, b) => a + b, 0);
                  return (
                    <View key={p.id} style={styles.historyCard}>
                      <Text style={styles.historyQuestion}>{p.question}</Text>
                      <Text style={styles.historyMeta}>{total} votes total</Text>
                      {(p.options || []).map((opt, i) => {
                        const c = p.results?.[i] ?? 0;
                        const pct = total > 0 ? Math.round((c / total) * 100) : 0;
                        return (
                          <View key={i} style={styles.historyResultRow}>
                            <View style={styles.historyResultBar}>
                              <View style={[styles.historyResultFill, { width: `${pct}%` }]} />
                              <Text style={styles.historyResultLabel} numberOfLines={1}>{opt}</Text>
                            </View>
                            <Text style={styles.historyResultPct}>{pct}%</Text>
                          </View>
                        );
                      })}
                    </View>
                  );
                })
              )}
            </View>
          )}

          {!poll ? (
            isHost ? (
              <View style={styles.createSection}>
                <Text style={styles.sectionTitle}>Create a Poll</Text>
                <Text style={styles.label}>Question</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Ask your question..."
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={question}
                  onChangeText={setQuestion}
                  multiline
                />
                <Text style={styles.label}>Options</Text>
                {options.map((opt, i) => (
                  <View key={i} style={styles.optionRow}>
                    <View style={styles.optionLetter}>
                      <Text style={styles.optionLetterText}>{String.fromCharCode(65 + i)}</Text>
                    </View>
                    <TextInput
                      style={styles.optionInput}
                      placeholder={`Option ${String.fromCharCode(65 + i)}`}
                      placeholderTextColor="rgba(255,255,255,0.3)"
                      value={opt}
                      onChangeText={(val) => {
                        const updated = [...options];
                        updated[i] = val;
                        setOptions(updated);
                      }}
                    />
                    {options.length > 2 && (
                      <TouchableOpacity style={styles.removeOptionBtn} onPress={() => removeOption(i)}>
                        <Text style={styles.removeOptionText}>✕</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
                <TouchableOpacity style={styles.addOptionBtn} onPress={addOption}>
                  <Text style={styles.addOptionText}>+ Add Option</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.launchBtn} onPress={launchPoll}>
                  <Text style={styles.launchBtnText}>🚀 Launch Poll</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.waitingSection}>
                <Text style={styles.waitingIcon}>📊</Text>
                <Text style={styles.waitingText}>Waiting for the host to launch a poll…</Text>
              </View>
            )
          ) : (
            <View style={styles.liveSection}>
              <View style={styles.livePollHeader}>
                <View style={[styles.livePollBadge, poll.status === 'closed' && styles.closedPollBadge]}>
                  {poll.status === 'live' && <View style={styles.liveDot} />}
                  <Text style={[styles.livePollText, poll.status === 'closed' && styles.closedPollText]}>
                    {poll.status === 'live' ? 'LIVE POLL' : 'POLL CLOSED'}
                  </Text>
                </View>
                {isHost && poll.status === 'live' && (
                  <TouchableOpacity style={styles.closeBtn} onPress={closePoll}>
                    <Text style={styles.closeBtnText}>Close Poll</Text>
                  </TouchableOpacity>
                )}
                {isHost && poll.status === 'closed' && (
                  <TouchableOpacity style={styles.closeBtn} onPress={startNewPoll}>
                    <Text style={styles.closeBtnText}>New Poll</Text>
                  </TouchableOpacity>
                )}
              </View>
              <Text style={styles.pollQuestion}>{poll.question}</Text>
              <Text style={styles.totalVotes}>{totalVotes} vote{totalVotes === 1 ? '' : 's'} total</Text>

              {poll.options.map((label, i) => {
                const c = counts[i] ?? 0;
                const pct = totalVotes > 0 ? Math.round((c / totalVotes) * 100) : 0;
                const isMine = myVoteIndex === i;
                const canVote = poll.status === 'live' && !isHost;
                return (
                  <TouchableOpacity
                    key={i}
                    style={[styles.resultRow, isMine && styles.resultRowVoted]}
                    onPress={() => canVote && castVote(i)}
                    disabled={!canVote}
                    activeOpacity={canVote ? 0.7 : 1}
                  >
                    <View style={styles.resultBar}>
                      <View style={[styles.resultFill, { width: `${pct}%` }]} />
                      <Text style={styles.resultLabel} numberOfLines={1}>
                        {isMine ? '✓ ' : ''}{label}
                      </Text>
                    </View>
                    <View style={styles.resultStats}>
                      <Text style={styles.resultPercent}>{pct}%</Text>
                      <Text style={styles.resultVotes}>{c} vote{c === 1 ? '' : 's'}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}

              {!isHost && poll.status === 'live' && (
                <Text style={styles.voteHint}>
                  {myVoteIndex != null ? 'Tap another option to change your vote.' : 'Tap an option to vote.'}
                </Text>
              )}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A1A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 40, backgroundColor: '#0D0D2B' },
  backText: { fontSize: 24, color: colors.white },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.white },
  historyToggle: { color: colors.primaryLight, fontSize: 13, fontWeight: '600' },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 20, gap: 12 },

  waitingSection: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 12 },
  waitingIcon: { fontSize: 44 },
  waitingText: { color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center' },

  historySection: { gap: 10, marginBottom: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  emptyHistoryText: { color: 'rgba(255,255,255,0.4)', fontSize: 13 },
  historyCard: { backgroundColor: '#1E1E3F', borderRadius: 14, padding: 14, gap: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  historyQuestion: { color: colors.white, fontSize: 14, fontWeight: '700' },
  historyMeta: { color: 'rgba(255,255,255,0.45)', fontSize: 11 },
  historyResultRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  historyResultBar: { flex: 1, height: 26, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 6, justifyContent: 'center', paddingHorizontal: 8, overflow: 'hidden' },
  historyResultFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: 'rgba(91,46,255,0.3)', borderRadius: 6 },
  historyResultLabel: { color: colors.white, fontSize: 11, fontWeight: '600', zIndex: 1 },
  historyResultPct: { color: colors.primaryLight, fontSize: 11, fontWeight: '700', width: 34, textAlign: 'right' },

  createSection: { gap: 12 },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: colors.white, marginBottom: 8 },
  label: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.7)' },
  input: { backgroundColor: '#1E1E3F', borderRadius: 12, padding: 14, fontSize: 15, color: colors.white, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', outlineStyle: 'none', minHeight: 60 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  optionLetter: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  optionLetterText: { color: colors.white, fontWeight: '700' },
  optionInput: { flex: 1, backgroundColor: '#1E1E3F', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: colors.white, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', outlineStyle: 'none' },
  removeOptionBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,59,59,0.15)', alignItems: 'center', justifyContent: 'center' },
  removeOptionText: { color: colors.red, fontSize: 12, fontWeight: '700' },
  addOptionBtn: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', borderRadius: 12, paddingVertical: 12, alignItems: 'center', borderStyle: 'dashed' },
  addOptionText: { color: 'rgba(255,255,255,0.5)', fontWeight: '600' },
  launchBtn: { backgroundColor: colors.primary, paddingVertical: 16, borderRadius: 16, alignItems: 'center', elevation: 8 },
  launchBtnText: { color: colors.white, fontSize: 16, fontWeight: '700' },

  liveSection: { gap: 14 },
  livePollHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  livePollBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,59,59,0.2)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  closedPollBadge: { backgroundColor: 'rgba(255,255,255,0.1)' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.red },
  livePollText: { color: colors.red, fontSize: 12, fontWeight: '700' },
  closedPollText: { color: 'rgba(255,255,255,0.6)' },
  closeBtn: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  closeBtnText: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },
  pollQuestion: { fontSize: 18, fontWeight: '700', color: colors.white },
  totalVotes: { fontSize: 13, color: 'rgba(255,255,255,0.5)' },
  resultRow: { backgroundColor: '#1E1E3F', borderRadius: 14, padding: 14, gap: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  resultRowVoted: { borderColor: colors.primary },
  resultBar: { height: 36, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8, justifyContent: 'center', paddingHorizontal: 10, overflow: 'hidden' },
  resultFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: 'rgba(91,46,255,0.3)', borderRadius: 8 },
  resultLabel: { color: colors.white, fontSize: 13, fontWeight: '600', zIndex: 1 },
  resultStats: { flexDirection: 'row', justifyContent: 'space-between' },
  resultPercent: { color: colors.primaryLight, fontWeight: '700', fontSize: 14 },
  resultVotes: { color: 'rgba(255,255,255,0.5)', fontSize: 13 },
  voteHint: { color: 'rgba(255,255,255,0.4)', fontSize: 12, textAlign: 'center', marginTop: 4 },
});