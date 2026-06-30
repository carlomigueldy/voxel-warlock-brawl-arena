-- 0001_init.sql
-- Voxel Warlock Brawl Arena — initial schema
-- Idempotent: uses IF NOT EXISTS / CREATE OR REPLACE throughout.

-- ---------------------------------------------------------------------------
-- Extension: pgcrypto (gen_random_uuid fallback; already present on Supabase)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- TABLE: profiles
-- Auto-created for every auth.users row via handle_new_user trigger.
-- username and region can be supplied via raw_user_meta_data at sign-up.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  username   text UNIQUE,
  region     text NOT NULL DEFAULT 'sea',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- TABLE: open_rooms
-- Hosts publish their lobby here; clients subscribe via Realtime.
-- guest hosts leave host_user_id NULL.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.open_rooms (
  code         text PRIMARY KEY,
  host_user_id uuid REFERENCES auth.users ON DELETE SET NULL,
  host_name    text NOT NULL DEFAULT 'Unknown',
  region       text NOT NULL DEFAULT 'sea',
  map          text NOT NULL DEFAULT 'circle',
  player_count int  NOT NULL DEFAULT 1  CHECK (player_count >= 0),
  max_players  int  NOT NULL DEFAULT 8  CHECK (max_players  >= 1),
  status       text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'in_progress', 'closed')),
  last_seen    timestamptz NOT NULL DEFAULT now()
);

-- Index for region-filtered room listings
CREATE INDEX IF NOT EXISTS open_rooms_region_idx ON public.open_rooms (region, last_seen DESC);
-- Index for stale-room cleanup (used by heartbeat/listRooms freshness filter)
CREATE INDEX IF NOT EXISTS open_rooms_last_seen_idx ON public.open_rooms (last_seen);

-- ---------------------------------------------------------------------------
-- TABLE: matches
-- One row per completed match; written only by the submit-match edge function
-- using the SERVICE ROLE key (RLS blocks direct inserts from clients).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.matches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region        text NOT NULL DEFAULT 'sea',
  map           text NOT NULL DEFAULT 'circle',
  round_count   int  NOT NULL DEFAULT 1 CHECK (round_count >= 1 AND round_count <= 99),
  winner_user_id uuid REFERENCES auth.users ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS matches_region_idx     ON public.matches (region, created_at DESC);
CREATE INDEX IF NOT EXISTS matches_created_at_idx ON public.matches (created_at DESC);

-- ---------------------------------------------------------------------------
-- TABLE: match_players
-- One row per player per match.
-- rating_after: the player's rating *after* this match (latest row = current).
-- Defaults to 1000 for unranked / first-match players.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.match_players (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id          uuid NOT NULL REFERENCES public.matches ON DELETE CASCADE,
  user_id           uuid REFERENCES auth.users ON DELETE SET NULL, -- NULL for guests
  username_snapshot text NOT NULL,
  kills             int  NOT NULL DEFAULT 0 CHECK (kills     >= 0),
  deaths            int  NOT NULL DEFAULT 0 CHECK (deaths    >= 0),
  round_wins        int  NOT NULL DEFAULT 0 CHECK (round_wins >= 0),
  won               boolean NOT NULL DEFAULT false,
  rating_delta      int  NOT NULL DEFAULT 0,
  rating_after      int  NOT NULL DEFAULT 1000 CHECK (rating_after >= 0)
);

CREATE INDEX IF NOT EXISTS match_players_match_id_idx ON public.match_players (match_id);
CREATE INDEX IF NOT EXISTS match_players_user_id_idx  ON public.match_players (user_id, match_id DESC);

-- ---------------------------------------------------------------------------
-- VIEW: leaderboard
-- Aggregates match_players per user, joined to profiles.
-- Callers may add WHERE region = $1 for per-region filtering.
-- kd: kills / NULLIF(deaths, 0) — avoids division-by-zero, NULL when 0 deaths.
-- rating: taken from the most recent match_players row for the user.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.leaderboard AS
SELECT
  p.id                                          AS user_id,
  p.username,
  p.region,
  count(mp.id)::int                             AS matches_played,
  count(mp.id) FILTER (WHERE mp.won)::int       AS wins,
  CASE
    WHEN count(mp.id) = 0 THEN 0.0
    ELSE round(
           count(mp.id) FILTER (WHERE mp.won)::numeric
           / count(mp.id)::numeric,
           4
         )
  END                                           AS win_rate,
  coalesce(sum(mp.kills)::int,  0)              AS kills,
  coalesce(sum(mp.deaths)::int, 0)              AS deaths,
  CASE
    WHEN coalesce(sum(mp.deaths), 0) = 0 THEN sum(mp.kills)::numeric
    ELSE round(sum(mp.kills)::numeric / sum(mp.deaths)::numeric, 2)
  END                                           AS kd,
  coalesce(sum(mp.round_wins)::int, 0)          AS round_wins,
  -- Current rating: rating_after from the user's most recent match row.
  -- Joined to matches to order by created_at (matches.id is a random UUID
  -- and has no chronological ordering guarantee).
  coalesce(
    ( SELECT mp2.rating_after
      FROM   public.match_players mp2
      JOIN   public.matches       m2 ON m2.id = mp2.match_id
      WHERE  mp2.user_id = p.id
      ORDER  BY m2.created_at DESC
      LIMIT  1
    ),
    1000
  )                                             AS rating
FROM       public.profiles          p
LEFT JOIN  public.match_players     mp ON mp.user_id = p.id
GROUP BY   p.id, p.username, p.region;

-- ---------------------------------------------------------------------------
-- TRIGGER: handle_new_user
-- Fires AFTER INSERT on auth.users; upserts a profiles row pulling
-- username + region from raw_user_meta_data when present.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, region)
  VALUES (
    NEW.id,
    NULLIF(TRIM(NEW.raw_user_meta_data->>'username'), ''),
    COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'region'), ''), 'sea')
  )
  ON CONFLICT (id) DO UPDATE
    SET
      username = COALESCE(
                   profiles.username,
                   NULLIF(TRIM(EXCLUDED.username), '')
                 ),
      region   = COALESCE(
                   NULLIF(TRIM(EXCLUDED.region), ''),
                   profiles.region,
                   'sea'
                 );
  RETURN NEW;
END;
$$;

-- Drop and recreate so the trigger body stays idempotent on re-runs
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
