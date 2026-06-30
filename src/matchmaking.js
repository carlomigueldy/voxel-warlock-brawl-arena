// Matchmaking over the open_rooms Supabase table + Realtime.
// All functions no-op gracefully when Supabase is not configured.
import { isEnabled, getClient } from './supabase.js';

// A room row is considered stale if last_seen is more than STALE_MS ago.
const STALE_MS = 30_000;

// Normalise raw DB rows into the public room shape.
function toRoom(row) {
  return {
    code:        row.code,
    hostName:    row.host_name,
    region:      row.region,
    map:         row.map,
    playerCount: row.player_count,
    maxPlayers:  row.max_players,
    status:      row.status,
  };
}

// Filter rows to only fresh, open, joinable rooms.
function filterFresh(rows) {
  const cutoff = Date.now() - STALE_MS;
  return rows
    .filter((r) =>
      r.status === 'open' &&
      new Date(r.last_seen).getTime() >= cutoff &&
      r.player_count < r.max_players
    )
    .map(toRoom);
}

// Publish a new room row. Upserts so host restarts don't leave orphan rows.
export async function publishRoom({ code, hostName, region, map, maxPlayers }) {
  if (!isEnabled()) return null;
  try {
    const { error } = await getClient()
      .from('open_rooms')
      .upsert({
        code,
        host_name:    hostName,
        region,
        map,
        max_players:  maxPlayers,
        player_count: 1,
        status:       'open',
        last_seen:    new Date().toISOString(),
      }, { onConflict: 'code' });
    if (error) throw error;
  } catch {
    // Silently no-op — matchmaking is best-effort.
  }
  return null;
}

// Update the room's heartbeat timestamp, player count, and status.
// status: 'open' | 'in_progress'
export async function heartbeat({ code, playerCount, status }) {
  if (!isEnabled()) return null;
  try {
    const { error } = await getClient()
      .from('open_rooms')
      .update({
        player_count: playerCount,
        status,
        last_seen: new Date().toISOString(),
      })
      .eq('code', code);
    if (error) throw error;
  } catch {
    // Silently no-op.
  }
  return null;
}

// Remove the room row when the host closes.
export async function closeRoom(code) {
  if (!isEnabled()) return null;
  try {
    const { error } = await getClient()
      .from('open_rooms')
      .delete()
      .eq('code', code);
    if (error) throw error;
  } catch {
    // Silently no-op.
  }
  return null;
}

// Fetch fresh, open, joinable rooms for the given region.
export async function listRooms(region) {
  if (!isEnabled()) return [];
  try {
    const { data, error } = await getClient()
      .from('open_rooms')
      .select('*')
      .eq('region', region)
      .eq('status', 'open');
    if (error) throw error;
    return filterFresh(data || []);
  } catch {
    return [];
  }
}

// Subscribe to real-time room changes for a region.
// Calls cb(rooms[]) on every change. Returns an unsubscribe function.
export function subscribeRooms(region, cb) {
  if (!isEnabled()) return () => {};
  const client = getClient();
  const channel = client
    .channel(`open_rooms:region=${region}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'open_rooms', filter: `region=eq.${region}` },
      async () => {
        const rooms = await listRooms(region);
        cb(rooms);
      }
    )
    .subscribe();
  return () => client.removeChannel(channel);
}

// Find the best joinable room in the given region (fullest-but-not-full wins).
// Returns the room code or null if none are available.
export async function quickMatch(region) {
  const rooms = await listRooms(region);
  if (!rooms.length) return null;
  rooms.sort((a, b) => b.playerCount - a.playerCount);
  return rooms[0].code;
}
