-- 0002_rls.sql
-- Voxel Warlock Brawl Arena — Row Level Security
-- Idempotent: policies use CREATE POLICY IF NOT EXISTS where available
-- (Postgres 15+); for older PG the pattern is DROP IF EXISTS + CREATE.

-- ---------------------------------------------------------------------------
-- Helper: drop a policy if it exists (keeps the file re-runnable)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- We use the helper inline below rather than as a standalone function
  -- to avoid pollution of the public schema.
  NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_public" ON public.profiles;
CREATE POLICY "profiles_select_public"
  ON public.profiles
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Users can update their own profile (username, region)
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING  (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- The handle_new_user trigger runs as SECURITY DEFINER so it bypasses RLS;
-- we intentionally do NOT add an INSERT policy here — the trigger is the
-- only allowed path for row creation.

-- ---------------------------------------------------------------------------
-- open_rooms
-- ---------------------------------------------------------------------------
ALTER TABLE public.open_rooms ENABLE ROW LEVEL SECURITY;

-- Anyone (anon or authenticated) may read open rooms
DROP POLICY IF EXISTS "open_rooms_select_public" ON public.open_rooms;
CREATE POLICY "open_rooms_select_public"
  ON public.open_rooms
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Authenticated hosts own their rooms (host_user_id = auth.uid())
DROP POLICY IF EXISTS "open_rooms_insert_authenticated" ON public.open_rooms;
CREATE POLICY "open_rooms_insert_authenticated"
  ON public.open_rooms
  FOR INSERT
  TO authenticated
  WITH CHECK (host_user_id = auth.uid());

DROP POLICY IF EXISTS "open_rooms_update_authenticated" ON public.open_rooms;
CREATE POLICY "open_rooms_update_authenticated"
  ON public.open_rooms
  FOR UPDATE
  TO authenticated
  USING  (host_user_id = auth.uid())
  WITH CHECK (host_user_id = auth.uid());

DROP POLICY IF EXISTS "open_rooms_delete_authenticated" ON public.open_rooms;
CREATE POLICY "open_rooms_delete_authenticated"
  ON public.open_rooms
  FOR DELETE
  TO authenticated
  USING (host_user_id = auth.uid());

-- Guest hosts: host_user_id IS NULL — anon role may INSERT/UPDATE/DELETE
-- such rows.  NOTE: there is no per-row ownership predicate for anon users;
-- any anonymous client can update or delete any guest room.  This is an
-- accepted trade-off for guest sessions (no auth token to scope rows by
-- identity).  Authenticated-host rooms are correctly scoped by
-- host_user_id = auth.uid().  The 30 s staleness filter in filterFresh()
-- and the short-lived nature of game lobbies bound the practical impact.
-- See README for the trust model.
DROP POLICY IF EXISTS "open_rooms_insert_guest" ON public.open_rooms;
CREATE POLICY "open_rooms_insert_guest"
  ON public.open_rooms
  FOR INSERT
  TO anon
  WITH CHECK (host_user_id IS NULL);

DROP POLICY IF EXISTS "open_rooms_update_guest" ON public.open_rooms;
CREATE POLICY "open_rooms_update_guest"
  ON public.open_rooms
  FOR UPDATE
  TO anon
  USING  (host_user_id IS NULL)
  WITH CHECK (host_user_id IS NULL);

DROP POLICY IF EXISTS "open_rooms_delete_guest" ON public.open_rooms;
CREATE POLICY "open_rooms_delete_guest"
  ON public.open_rooms
  FOR DELETE
  TO anon
  USING (host_user_id IS NULL);

-- ---------------------------------------------------------------------------
-- matches  — read-only for clients; service role bypasses RLS for writes
-- ---------------------------------------------------------------------------
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "matches_select_public" ON public.matches;
CREATE POLICY "matches_select_public"
  ON public.matches
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Explicit DENY: anon and authenticated cannot INSERT/UPDATE/DELETE directly.
-- (No INSERT/UPDATE/DELETE policy = denied by default once RLS is enabled.)

-- ---------------------------------------------------------------------------
-- match_players  — read-only for clients; service role bypasses RLS for writes
-- ---------------------------------------------------------------------------
ALTER TABLE public.match_players ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "match_players_select_public" ON public.match_players;
CREATE POLICY "match_players_select_public"
  ON public.match_players
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policy for anon/authenticated = denied.

-- ---------------------------------------------------------------------------
-- leaderboard view  — grant SELECT so anon/authenticated can query it
-- The view's underlying tables are already RLS-protected;
-- the view itself does not carry RLS but the grants here make it readable.
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.leaderboard TO anon;
GRANT SELECT ON public.leaderboard TO authenticated;

-- Also ensure base-table grants exist (Supabase usually handles these, but
-- explicit is safer on fresh projects).
GRANT SELECT ON public.profiles     TO anon, authenticated;
GRANT SELECT ON public.matches      TO anon, authenticated;
GRANT SELECT ON public.match_players TO anon, authenticated;
GRANT SELECT ON public.open_rooms   TO anon, authenticated;

-- INSERT/UPDATE/DELETE on open_rooms (policies guard the actual rows)
GRANT INSERT, UPDATE, DELETE ON public.open_rooms TO anon, authenticated;

-- profiles UPDATE (own row only, guarded by policy above)
GRANT UPDATE ON public.profiles TO authenticated;
