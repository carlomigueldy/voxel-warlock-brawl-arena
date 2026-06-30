# Supabase Backend — Voxel Warlock Brawl Arena

This directory contains the full Supabase backend for region-based matchmaking,
user profiles, and persistent leaderboards. Guest / LAN play continues to work
with zero creds — every client module checks `isEnabled()` and no-ops gracefully.

---

## Setup

### 1. Create a Supabase project

Go to [supabase.com](https://supabase.com), create a new project, then copy
your **Project URL** and **anon public key** from *Settings → API*.

### 2. Wire credentials into the game

Create `src/supabase-config.js` (not committed — add to `.gitignore`):

```js
// src/supabase-config.js
export const SUPABASE_URL = "https://<your-project-ref>.supabase.co";
export const SUPABASE_ANON_KEY = "<your-anon-public-key>";
```

`src/supabase.js` reads this file; if it is missing or the values are empty
placeholder strings, `isEnabled()` returns `false` and every feature silently
no-ops so offline / LAN play still works.

### 3. Apply the database migrations

Install the Supabase CLI (<https://supabase.com/docs/guides/cli>) then run:

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

This runs `0001_init.sql` (schema + trigger) then `0002_rls.sql` (policies)
against your hosted project. Both files are idempotent and safe to re-run.

### 4. Deploy the edge functions

```bash
# Geo-IP resolver — no secrets needed
supabase functions deploy geo

# Match-result submitter — needs the service role key at runtime
supabase functions deploy submit-match \
  --no-verify-jwt \
  --set-secrets SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
```

The `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment variables are
injected automatically by the Supabase runtime for every edge function, but you
must set `SUPABASE_SERVICE_ROLE_KEY` explicitly because it is not included in
the default injection.

### 5. Enable auth providers in the Supabase dashboard

*Authentication → Providers*:

- **Email** — enabled by default; disable "Confirm email" for fast dev onboarding
  (enable in production).
- **Google OAuth** — add your OAuth client ID and secret; set the redirect URL
  to `https://<your-project-ref>.supabase.co/auth/v1/callback`.
- **Anonymous sign-ins** — toggle *Allow anonymous sign-ins* (required for
  `signInAsGuest()` in `src/auth.js`).

---

## Schema overview

| Table / View      | Purpose                                                  |
|-------------------|----------------------------------------------------------|
| `profiles`        | One row per auth user; holds username and home region.   |
| `open_rooms`      | Live lobby advertisements; hosts INSERT, Realtime pushes to subscribers. |
| `matches`         | Immutable completed-match records; service role only.    |
| `match_players`   | Per-player stats + ELO rating snapshot; service role only. |
| `leaderboard`     | Aggregated view; SELECT is public; filter by `region` or `match_region`. |

---

## Edge functions

### `GET /functions/v1/geo`

Returns the caller's coarse region id based on IP geolocation.

**Response**
```json
{ "region": "sea" }
```

Possible values: `sea` `us-east` `us-west` `eu` `sa` `oce`.
Falls back to `sea` on timeout or lookup failure.

---

### `POST /functions/v1/submit-match`

Validates and persists match results. Computes placement-based ELO deltas
(K=32, pairwise, winner ranked first).

**Request body**
```json
{
  "region":      "sea",
  "map":         "circle",
  "round_count": 5,
  "players": [
    {
      "user_id":    "550e8400-e29b-41d4-a716-446655440000",
      "username":   "WarlocK42",
      "kills":      10,
      "deaths":     3,
      "round_wins": 3,
      "won":        true
    },
    {
      "user_id":    null,
      "username":   "GuestPlayer",
      "kills":      4,
      "deaths":     7,
      "round_wins": 2,
      "won":        false
    }
  ]
}
```

Field constraints:

| Field                    | Type             | Constraint                                |
|--------------------------|------------------|-------------------------------------------|
| `region`                 | string           | One of `sea us-east us-west eu sa oce`    |
| `map`                    | string           | Non-empty                                 |
| `round_count`            | integer          | 1–99                                      |
| `players`                | array            | 2–8 entries                               |
| `players[].user_id`      | uuid string or null | null for guests (no rating update)     |
| `players[].username`     | string           | Non-empty, max 32 chars                   |
| `players[].kills`        | integer          | >= 0                                      |
| `players[].deaths`       | integer          | >= 0                                      |
| `players[].round_wins`   | integer          | >= 0                                      |
| `players[].won`          | boolean          | Exactly one player must have `true`       |

**Success response (200)**
```json
{ "ok": true, "matchId": "550e8400-e29b-41d4-a716-446655440001" }
```

**Error response (400 / 500)**
```json
{ "ok": false, "error": "Exactly one player must have won=true." }
```

---

## ELO rating details

- Default / starting rating: **1000**
- K-factor: **32**
- Algorithm: pairwise placement-based. The winner is placed rank 1; remaining
  players are ranked by `round_wins DESC`, then `kills DESC`. Each player's delta
  is the sum of `K * (actual_score - expected_score)` across all one-vs-one
  matchups where `actual_score = 1` if this player outranks the opponent, else 0.
- Guests (`user_id = null`) receive `rating_delta = 0` and `rating_after = 1000`
  (their rows are stored for stats but never affect the ladder).
- Minimum rating is clamped to 0.

---

## Security and trust model

**Match results are host-trusted.** The host client calls `submit-match`; the
function does not independently verify kills, deaths, or round wins against a
game server replay. A malicious host can inflate their own stats.

Mitigations to add later:
- Require all players to independently sign a result payload (multi-party
  attestation before submission).
- Run a server-authoritative simulation that produces the canonical result.

This is documented here so the limitation is explicit; it does not block
functional multiplayer for the current scope.

---

## Local development

```bash
supabase start          # starts Postgres + Auth + Realtime locally on Docker
supabase db reset       # re-applies all migrations from scratch
supabase functions serve geo submit-match   # hot-reload edge functions locally
```

The local API runs at `http://localhost:54321`. Update `src/supabase-config.js`
to point at it during local dev:

```js
export const SUPABASE_URL    = "http://localhost:54321";
export const SUPABASE_ANON_KEY = "eyJ...local-anon-key...";   // printed by `supabase start`
```
