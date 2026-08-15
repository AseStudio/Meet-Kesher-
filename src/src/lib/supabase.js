import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const SUPABASE_URL = 'https://jwlmgvpmijwauymrixtx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3bG1ndnBtaWp3YXV5bXJpeHR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0NDI1NzksImV4cCI6MjA5NjAxODU3OX0.HGzEBpjiGnkpFCF-A3wcQKGgYN7er9gNXyFFypB6I3I';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
    // PKCE (not the implicit flow) is what lets native OAuth (see
    // lib/oauth.js) exchange the ?code= Supabase redirects back with
    // for a session by hand, instead of relying on a browser to parse
    // a URL fragment the way detectSessionInUrl does on web.
    flowType: 'pkce',
  },
});