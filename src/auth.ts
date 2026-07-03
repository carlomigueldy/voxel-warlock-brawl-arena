// Authentication module. Wraps Supabase auth with graceful no-ops when
// Supabase is not configured so guest + private play works with zero credentials.
import { isEnabled, getClient } from './supabase.js';
import type { AppUser } from './types';

declare global {
  interface Window {
    ethereum?: {
      request(args: { method: string; params?: unknown[] }): Promise<unknown>;
      [key: string]: unknown;
    };
    solana?: {
      connect(args?: { onlyIfTrusted?: boolean }): Promise<unknown>;
      [key: string]: unknown;
    };
  }
}

// Raw Supabase user object shape we read from — deliberately loose since we
// only touch a handful of optional, nested fields.
interface SupabaseUserLike {
  id: string;
  email?: string | null;
  is_anonymous?: boolean;
  user_metadata?: {
    address?: string;
    username?: string;
    custom_claims?: { address?: string };
    [key: string]: unknown;
  };
  identities?: { identity_data?: { address?: string } }[];
}

let _user: AppUser | null = null;
const _listeners = new Set<(user: AppUser | null) => void>();

// Derive a wallet address from wherever Supabase may surface it on the user object.
function _extractWalletAddress(supabaseUser: SupabaseUserLike): string | null {
  if (supabaseUser.user_metadata?.address) return supabaseUser.user_metadata.address;
  if (supabaseUser.user_metadata?.custom_claims?.address)
    return supabaseUser.user_metadata.custom_claims.address;
  const identities = supabaseUser.identities;
  if (Array.isArray(identities)) {
    for (const identity of identities) {
      if (identity.identity_data?.address) return identity.identity_data.address;
    }
  }
  return null;
}

// Shorten a wallet address for display: first 6 chars + ellipsis + last 4 chars.
function _shortenAddress(addr: string | null | undefined): string | null {
  if (!addr || typeof addr !== 'string') return null;
  if (addr.length <= 12) return addr;
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

// Map a raw Supabase user object to the app's user shape.
// Handles web3 users where email is null; username falls back to
// user_metadata.username, then a shortened wallet address, then 'Warlock'.
// Never throws.
function mapUser(supabaseUser: SupabaseUserLike | null | undefined): AppUser | null {
  if (!supabaseUser) return null;
  try {
    const walletAddr = _extractWalletAddress(supabaseUser);
    const shortAddr  = walletAddr ? _shortenAddress(walletAddr) : null;
    return {
      id:       supabaseUser.id,
      email:    supabaseUser.email || null,
      username: supabaseUser.user_metadata?.username || shortAddr || 'Warlock',
      isGuest:  !!supabaseUser.is_anonymous,
    };
  } catch {
    return {
      id:       supabaseUser.id,
      email:    supabaseUser.email || null,
      username: 'Warlock',
      isGuest:  !!supabaseUser.is_anonymous,
    };
  }
}

// Best-effort: write a shortened wallet address as the profile username when
// the profile row has no username yet. Ignores all errors (RLS / network).
async function _maybeSetWalletUsername(supabaseUser: SupabaseUserLike): Promise<void> {
  try {
    if (supabaseUser.user_metadata?.username) return;
    const addr = _extractWalletAddress(supabaseUser);
    if (!addr) return;
    const short = _shortenAddress(addr);
    if (!short) return;
    await getClient()!
      .from('profiles')
      .update({ username: short })
      .eq('id', supabaseUser.id)
      .is('username', null);
    if (_user) _user.username = short;
  } catch {
    // Intentionally silenced — profile username is cosmetic, not critical.
  }
}

// Restore the current session and wire the auth-state listener.
// Call once at app start. Returns the current user or null.
export async function initAuth(): Promise<AppUser | null> {
  if (!isEnabled()) return null;
  try {
    const client = getClient()!;
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
export function getUser(): AppUser | null {
  return _user;
}

// Register/sign-up with email + password. Passes username and region as
// user_metadata so the DB trigger can create the profile row.
export async function signUpEmail({ email, password, username }: { email: string; password: string; username: string }): Promise<AppUser | null> {
  if (!isEnabled()) throw new Error('Supabase not configured');
  const client = getClient()!;
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
export async function signInEmail({ email, password }: { email: string; password: string }): Promise<AppUser | null> {
  if (!isEnabled()) throw new Error('Supabase not configured');
  const client = getClient()!;
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  _user = data.user ? mapUser(data.user) : null;
  return _user;
}

// Sign in with an Ethereum wallet (EIP-1193 provider at window.ethereum).
// Requires MetaMask or a compatible browser extension.
export async function signInWithEthereum(): Promise<AppUser | null> {
  if (!isEnabled()) throw new Error('Supabase not configured');
  if (!window.ethereum) {
    throw new Error('No Ethereum wallet found. Install MetaMask or another Ethereum wallet extension.');
  }
  const client = getClient()!;
  const { data, error } = await client.auth.signInWithWeb3({
    chain: 'ethereum',
    statement: 'Sign in to Voxel Warlock Brawl Arena',
  });
  if (error) throw error;
  _user = data.user ? mapUser(data.user) : null;
  if (data.user) await _maybeSetWalletUsername(data.user);
  return _user;
}

// Sign in with a Solana wallet (window.solana, e.g. Phantom).
export async function signInWithSolana(): Promise<AppUser | null> {
  if (!isEnabled()) throw new Error('Supabase not configured');
  if (!window.solana) {
    throw new Error('No Solana wallet found. Install Phantom or another Solana wallet extension.');
  }
  const client = getClient()!;
  const { data, error } = await client.auth.signInWithWeb3({
    chain: 'solana',
    statement: 'Sign in to Voxel Warlock Brawl Arena',
  });
  if (error) throw error;
  _user = data.user ? mapUser(data.user) : null;
  if (data.user) await _maybeSetWalletUsername(data.user);
  return _user;
}

// Create an anonymous session (Supabase anonymous sign-in).
export async function signInAsGuest(): Promise<AppUser | null> {
  if (!isEnabled()) throw new Error('Supabase not configured');
  const client = getClient()!;
  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  _user = data.user ? mapUser(data.user) : null;
  return _user;
}

// Upgrade an anonymous account to a real account by linking email + password.
export async function upgradeGuest({ email, password, username }: { email: string; password: string; username: string }): Promise<AppUser | null> {
  if (!isEnabled()) throw new Error('Supabase not configured');
  const client = getClient()!;
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
export async function signOut(): Promise<null> {
  if (!isEnabled()) return null;
  try {
    await getClient()!.auth.signOut();
    _user = null;
  } catch {
    // Ignore network errors on sign-out.
  }
  return null;
}

// Subscribe to auth state changes. Returns an unsubscribe function.
export function onAuthChange(cb: (user: AppUser | null) => void): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
