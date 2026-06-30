// Authentication module. Wraps Supabase auth with graceful no-ops when
// Supabase is not configured so guest + LAN play works with zero credentials.
import { isEnabled, getClient } from './supabase.js';

let _user = null;
const _listeners = new Set();

// Map a raw Supabase user object to the app's user shape.
function mapUser(supabaseUser) {
  if (!supabaseUser) return null;
  return {
    id:       supabaseUser.id,
    email:    supabaseUser.email || null,
    username: supabaseUser.user_metadata?.username || null,
    isGuest:  !!supabaseUser.is_anonymous,
  };
}

// Restore the current session and wire the auth-state listener.
// Call once at app start. Returns the current user or null.
export async function initAuth() {
  if (!isEnabled()) return null;
  try {
    const client = getClient();
    const { data: { session } } = await client.auth.getSession();
    _user = session ? mapUser(session.user) : null;
    client.auth.onAuthStateChange((_event, session) => {
      _user = session ? mapUser(session.user) : null;
      for (const cb of _listeners) cb(_user);
    });
    return _user;
  } catch {
    return null;
  }
}

// Returns the currently signed-in user or null.
export function getUser() {
  return _user;
}

// Register/sign-up with email + password. Passes username and region as
// user_metadata so the DB trigger can create the profile row.
export async function signUpEmail({ email, password, username }) {
  if (!isEnabled()) throw new Error('Supabase not configured');
  const client = getClient();
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { data: { username, region: null } },
  });
  if (error) throw error;
  _user = data.user ? mapUser(data.user) : null;
  return _user;
}

// Sign in with email + password.
export async function signInEmail({ email, password }) {
  if (!isEnabled()) throw new Error('Supabase not configured');
  const client = getClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  _user = data.user ? mapUser(data.user) : null;
  return _user;
}

// Kick off Google OAuth flow (redirects; result handled via onAuthStateChange).
export async function signInWithGoogle() {
  if (!isEnabled()) throw new Error('Supabase not configured');
  const client = getClient();
  const { error } = await client.auth.signInWithOAuth({ provider: 'google' });
  if (error) throw error;
}

// Create an anonymous session (Supabase anonymous sign-in).
export async function signInAsGuest() {
  if (!isEnabled()) throw new Error('Supabase not configured');
  const client = getClient();
  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  _user = data.user ? mapUser(data.user) : null;
  return _user;
}

// Upgrade an anonymous account to a real account by linking email + password.
export async function upgradeGuest({ email, password, username }) {
  if (!isEnabled()) throw new Error('Supabase not configured');
  const client = getClient();
  const { data, error } = await client.auth.updateUser({
    email,
    password,
    data: { username },
  });
  if (error) throw error;
  _user = data.user ? mapUser(data.user) : null;
  return _user;
}

// Sign out the current user.
export async function signOut() {
  if (!isEnabled()) return null;
  try {
    await getClient().auth.signOut();
    _user = null;
  } catch {
    // Ignore network errors on sign-out.
  }
  return null;
}

// Subscribe to auth state changes. Returns an unsubscribe function.
export function onAuthChange(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
