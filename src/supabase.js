// Supabase client wrapper. Lazily initialised so the module is safe to import
// even when no credentials are configured (isEnabled() returns false).
// The '@supabase/supabase-js' specifier resolves via the import map in index.html.
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config.js';

// Returns true only when both credentials are non-empty strings.
export function isEnabled() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

let _client = null;

// Returns the shared Supabase client, or null when not configured.
export function getClient() {
  if (!isEnabled()) return null;
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _client;
}
