import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { supabase } from './src/lib/supabase';
import OfflineGate from './src/components/OfflineGate'; // adjust path if this lives elsewhere
import { withErrorBoundary } from './src/components/ErrorBoundary'; // adjust path if this lives elsewhere

import SplashScreen from './src/screens/auth/SplashScreen';
import SignUpScreen from './src/screens/auth/SignUpScreen';
import LoginScreen from './src/screens/auth/LoginScreen';
import GuestJoinScreen from './src/screens/auth/GuestJoinScreen';
import HostDashboard from './src/screens/host/HostDashboard';
import AttendeeDashboard from './src/screens/attendee/AttendeeDashboard';
import VerifyEmailScreen from './src/screens/auth/VerifyEmailScreen';
import CreateSession from './src/screens/host/CreateSession';
import Profile from './src/screens/host/Profile';
import BanManagement from './src/screens/host/BanManagement';
import SubmissionsInbox from './src/screens/host/SubmissionsInbox';
import SubmitFile from './src/screens/attendee/SubmitFile';
import LobbyScreen from './src/screens/session/LobbyScreen';
import SessionMain from './src/screens/session/SessionMain';
import AttendeeSession from './src/screens/session/AttendeeSession';
import ChatPanel from './src/screens/session/ChatPanel';
import BoardSelector from './src/screens/session/BoardSelector';
import Whiteboard from './src/screens/session/Whiteboard';
import Blackboard from './src/screens/session/Blackboard';
import GraphBoard from './src/screens/session/GraphBoard';
import PollScreen from './src/screens/session/PollScreen';
import AgendaPanel from './src/screens/session/AgendaPanel';
import TimerScreen from './src/screens/session/TimerScreen';
import EndSession from './src/screens/session/EndSession';
import ReactionsPanel from './src/screens/session/ReactionsPanel';
import CoHostManager from './src/screens/session/CoHostManager';
import SessionFull from './src/screens/session/SessionFull';
import BannedScreen from './src/screens/session/BannedScreen';
import WelcomeScreen from './src/screens/WelcomeScreen';

import CommunityScreen from './src/screens/community/CommunityScreen';
import CreateChannelScreen from './src/screens/community/CreateChannelScreen';
import ChannelChatScreen from './src/screens/community/ChannelChatScreen';
import ChannelRolesScreen from './src/screens/community/ChannelRolesScreen';
import WaitlistScreen from './src/screens/session/WaitlistScreen';


const Stack = createNativeStackNavigator();

// Screens opened mid-session as a quick utility panel (Chat, Reactions,
// Poll, Agenda, Timer, Co-host, Board Selector) — these read as a sheet
// popping up over whatever you were doing, not as "going deeper" into
// the app, so they get slide_from_bottom instead of the default
// slide_from_right push used everywhere else.
const PANEL_ANIMATION = { animation: 'slide_from_bottom' };

export default function App() {
  // Background cleanup only — never blocks rendering. Splash always mounts
  // first and does its own fresh session check after the animation plays.
  useEffect(() => {
    const cleanupStaleSession = async () => {
      try {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error || !user) {
          await supabase.auth.signOut();
        }
      } catch (e) {}
    };
    cleanupStaleSession();
  }, []);

  return (
    <OfflineGate>
      <NavigationContainer>
        <Stack.Navigator
          screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
          initialRouteName="Splash"
        >
          <Stack.Screen name="Welcome" component={WelcomeScreen} />
          <Stack.Screen name="Splash" component={SplashScreen} />
          <Stack.Screen name="SignUp" component={SignUpScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="GuestJoin" component={GuestJoinScreen} />
          <Stack.Screen name="HostDashboard" component={HostDashboard} />
          <Stack.Screen name="AttendeeDashboard" component={AttendeeDashboard} />
          <Stack.Screen name="CreateSession" component={CreateSession} />
          <Stack.Screen name="Profile" component={Profile} />
          <Stack.Screen name="BanManagement" component={BanManagement} />
          <Stack.Screen name="SubmissionsInbox" component={SubmissionsInbox} />
          <Stack.Screen name="SubmitFile" component={SubmitFile} />
          <Stack.Screen name="Lobby" component={LobbyScreen} />
          <Stack.Screen name="SessionMain" component={SessionMain} />
          <Stack.Screen name="AttendeeSession" component={AttendeeSession} />
          <Stack.Screen name="ChatPanel" component={withErrorBoundary(ChatPanel)} options={PANEL_ANIMATION} />
          <Stack.Screen name="BoardSelector" component={BoardSelector} options={PANEL_ANIMATION} />
          <Stack.Screen name="Whiteboard" component={Whiteboard} />
          <Stack.Screen name="Blackboard" component={Blackboard} />
          <Stack.Screen name="GraphBoard" component={GraphBoard} />
          <Stack.Screen name="PollScreen" component={PollScreen} options={PANEL_ANIMATION} />
          <Stack.Screen name="AgendaPanel" component={AgendaPanel} options={PANEL_ANIMATION} />
          <Stack.Screen name="TimerScreen" component={TimerScreen} options={PANEL_ANIMATION} />
          <Stack.Screen name="EndSession" component={EndSession} />
          <Stack.Screen name="VerifyEmail" component={VerifyEmailScreen} />
          <Stack.Screen name="ReactionsPanel" component={ReactionsPanel} options={PANEL_ANIMATION} />
          <Stack.Screen name="CoHostManager" component={CoHostManager} options={PANEL_ANIMATION} />
          <Stack.Screen name="SessionFull" component={SessionFull} />
          <Stack.Screen name="BannedScreen" component={BannedScreen} />
          <Stack.Screen name="Waitlist" component={WaitlistScreen} />


          {/* Community feature */}
          <Stack.Screen name="Community" component={CommunityScreen} />
          <Stack.Screen name="CreateChannel" component={CreateChannelScreen} options={PANEL_ANIMATION} />
          <Stack.Screen name="ChannelChat" component={ChannelChatScreen} />
          <Stack.Screen name="ChannelRoles" component={ChannelRolesScreen} options={PANEL_ANIMATION} />
        </Stack.Navigator>
      </NavigationContainer>
    </OfflineGate>
  );
}
