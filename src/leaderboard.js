// Leaderboard: submit match results via edge function, fetch from the view.
// All functions no-op gracefully when Supabase is not configured.
import { isEnabled, getClient } from './supabase.js';

// Map from the public metric name to the DB column name.
const METRIC_COLUMN = {
  wins:      'wins',
  kd:        'kd',
  roundWins: 'round_wins',
  rating:    'rating',
};

// Submit a finished-match payload to the submit-match edge function.
// payload shape: { region, map, roundCount, players:[{userId,username,kills,deaths,roundWins,won}] }
// Only authenticated players (userId != null) are submitted. No-ops when Supabase is
// off, no authenticated players exist, or no authenticated player won the match.
//
// Known limitation: when the match winner is a guest or bot (userId==null), the
// entire result — including the K/D and round-wins of authenticated losers — is
// discarded.  This is intentional: the edge function's ELO algorithm requires a
// ranked winner to compute deltas; recording only loser-side stats would produce
// one-sided, unbalanced rating changes.  Mixed-lobby results where a guest/bot
// wins are silently skipped.
export async function submitMatchResult(payload) {
  if (!isEnabled()) return null;
  const authenticated = (payload?.players || []).filter((p) => p.userId);
  if (!authenticated.length) return null;
  // Edge function requires exactly one won=true among ALL players; skip submission
  // when no authenticated player holds the win (guest/bot winner).
  const hasWinner = authenticated.some((p) => p.won);
  if (!hasWinner) return null;
  try {
    // Transform camelCase app payload to the snake_case shape the edge function expects.
    const body = {
      region:      payload.region,
      map:         payload.map,
      round_count: payload.roundCount,
      players:     authenticated.map((p) => ({
        user_id:    p.userId,
        username:   p.username,
        kills:      p.kills,
        deaths:     p.deaths,
        round_wins: p.roundWins,
        won:        p.won,
      })),
    };
    const { data, error } = await getClient().functions.invoke('submit-match', { body });
    if (error) throw error;
    return data;
  } catch {
    return null;
  }
}

// Fetch leaderboard rows from the leaderboard view.
// metric: 'wins' | 'kd' | 'roundWins' | 'rating'
// region: string or null for global
// limit: default 100
export async function fetchLeaderboard({ region = null, metric = 'wins', limit = 100 } = {}) {
  if (!isEnabled()) return [];
  try {
    const col = METRIC_COLUMN[metric] || 'wins';
    let query = getClient()
      .from('leaderboard')
      .select('*')
      .order(col, { ascending: false })
      .limit(limit);
    if (region) query = query.eq('region', region);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch {
    return [];
  }
}
