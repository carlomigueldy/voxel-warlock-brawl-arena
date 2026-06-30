// supabase/functions/submit-match/index.ts
// Deno edge function — validates + persists match results and updates ratings.
//
// Security: uses the SERVICE_ROLE_KEY from env to bypass RLS; clients cannot
// write to matches/match_players directly. Results are host-trusted (the host
// submits; cheating via packet modification is possible — see README).
//
// ---------------------------------------------------------------------------
// Request (POST, JSON body)
// ---------------------------------------------------------------------------
// {
//   "region":      "sea",           // required; one of sea/us-east/us-west/eu/sa/oce
//   "map":         "circle",        // required
//   "round_count": 5,               // required; 1-99
//   "players": [                    // required; 2-8 entries
//     {
//       "user_id":  "uuid" | null,  // null for guests
//       "username": "WarlocK42",    // required; max 32 chars
//       "kills":    10,             // >= 0
//       "deaths":   3,              // >= 0
//       "round_wins": 3,            // >= 0
//       "won":      true            // exactly one player must have won=true
//     }
//   ]
// }
//
// ---------------------------------------------------------------------------
// Response — success 200
// ---------------------------------------------------------------------------
// { "ok": true, "matchId": "uuid" }
//
// ---------------------------------------------------------------------------
// Response — error 400 / 500
// ---------------------------------------------------------------------------
// { "ok": false, "error": "human-readable reason" }
//
// ---------------------------------------------------------------------------
// ELO algorithm (placement-based, multiplayer)
// ---------------------------------------------------------------------------
// K = 32. Winner placed first (score=1 vs each opponent); others placed by
// round_wins desc then kills desc (score=0 vs winner). Expected score = 1 /
// (1 + 10^((opponentRating - playerRating) / 400)). Each participant's delta
// is the sum of K*(actual-expected) across all pairwise matchups.

import { serve }           from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient }    from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PlayerInput {
  user_id:    string | null;
  username:   string;
  kills:      number;
  deaths:     number;
  round_wins: number;
  won:        boolean;
}

interface MatchInput {
  region:      string;
  map:         string;
  round_count: number;
  players:     PlayerInput[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const VALID_REGIONS = new Set(["sea", "us-east", "us-west", "eu", "sa", "oce"]);

function validate(body: unknown): { ok: true; data: MatchInput } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Body must be a JSON object." };
  }
  const b = body as Record<string, unknown>;

  if (!VALID_REGIONS.has(String(b.region ?? ""))) {
    return { ok: false, error: `Invalid region. Must be one of: ${[...VALID_REGIONS].join(", ")}.` };
  }
  if (typeof b.map !== "string" || b.map.trim().length === 0) {
    return { ok: false, error: "map is required." };
  }
  const rc = Number(b.round_count);
  if (!Number.isInteger(rc) || rc < 1 || rc > 99) {
    return { ok: false, error: "round_count must be an integer between 1 and 99." };
  }
  if (!Array.isArray(b.players) || b.players.length < 2 || b.players.length > 8) {
    return { ok: false, error: "players must be an array of 2–8 entries." };
  }

  let winnerCount = 0;
  for (let i = 0; i < b.players.length; i++) {
    const p = b.players[i] as Record<string, unknown>;
    if (typeof p.username !== "string" || p.username.trim().length === 0 || p.username.length > 32) {
      return { ok: false, error: `players[${i}].username is required and must be <= 32 characters.` };
    }
    for (const stat of ["kills", "deaths", "round_wins"] as const) {
      const v = Number(p[stat]);
      if (!Number.isInteger(v) || v < 0) {
        return { ok: false, error: `players[${i}].${stat} must be a non-negative integer.` };
      }
    }
    if (typeof p.won !== "boolean") {
      return { ok: false, error: `players[${i}].won must be a boolean.` };
    }
    if (p.won) winnerCount++;
  }
  if (winnerCount !== 1) {
    return { ok: false, error: "Exactly one player must have won=true." };
  }

  return {
    ok: true,
    data: {
      region:      String(b.region),
      map:         String(b.map).trim(),
      round_count: rc,
      players:     b.players.map((p: Record<string, unknown>) => ({
        user_id:    typeof p.user_id === "string" ? p.user_id : null,
        username:   String(p.username).trim(),
        kills:      Number(p.kills),
        deaths:     Number(p.deaths),
        round_wins: Number(p.round_wins),
        won:        Boolean(p.won),
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// ELO helpers
// ---------------------------------------------------------------------------
const ELO_K = 32;

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Compute ELO delta for each player.
 * Ranking: winner first, then by (round_wins DESC, kills DESC).
 * Each player's delta = sum of K*(actual - expected) vs every opponent.
 * actual = 1 if this player outranks opponent, else 0.
 */
function computeEloDeltas(
  players: PlayerInput[],
  currentRatings: number[],
): number[] {
  const n = players.length;

  // Build rank order: winner = rank 0, rest by round_wins desc then kills desc
  const ranked = players
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      if (a.p.won !== b.p.won) return a.p.won ? -1 : 1;
      if (b.p.round_wins !== a.p.round_wins) return b.p.round_wins - a.p.round_wins;
      return b.p.kills - a.p.kills;
    });

  const rankOf = new Array<number>(n);
  ranked.forEach(({ i }, rank) => { rankOf[i] = rank; });

  const deltas = new Array<number>(n).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const actual   = rankOf[i] < rankOf[j] ? 1 : 0;
      const expected = expectedScore(currentRatings[i], currentRatings[j]);
      deltas[i] += ELO_K * (actual - expected);
    }
  }

  // Round to integers
  return deltas.map(d => Math.round(d));
}

// ---------------------------------------------------------------------------
// Fetch current rating for authenticated users (latest match_players row)
// ---------------------------------------------------------------------------
async function fetchCurrentRating(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<number> {
  // Order by matches.created_at, not match_players.match_id: match_id is a
  // random UUID (gen_random_uuid) with no chronological ordering guarantee.
  const { data } = await supabase
    .from("match_players")
    .select("rating_after, matches!inner(created_at)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false, referencedTable: "matches" })
    .limit(1)
    .single();
  return (data as { rating_after?: number } | null)?.rating_after ?? 1000;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  // --- Parse body ---
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON body." }, 400);
  }

  // --- Validate ---
  const validation = validate(rawBody);
  if (!validation.ok) {
    return jsonResponse({ ok: false, error: validation.error }, 400);
  }
  const { region, map, round_count, players } = validation.data;

  // --- Build Supabase client with service role (bypasses RLS) ---
  const supabaseUrl     = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ ok: false, error: "Server configuration error." }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // --- Fetch current ratings for authenticated players ---
  const authenticatedUserIds = players
    .map(p => p.user_id)
    .filter((id): id is string => id !== null);

  const ratingMap = new Map<string, number>();
  await Promise.all(
    authenticatedUserIds.map(async uid => {
      ratingMap.set(uid, await fetchCurrentRating(supabase, uid));
    }),
  );

  // Build per-player current rating array (guests default to 1000)
  const currentRatings = players.map(p =>
    p.user_id !== null ? (ratingMap.get(p.user_id) ?? 1000) : 1000,
  );

  // --- Compute ELO deltas ---
  const deltas = computeEloDeltas(players, currentRatings);

  // --- Insert match row ---
  const winnerPlayer = players.find(p => p.won)!;
  const { data: matchRow, error: matchErr } = await supabase
    .from("matches")
    .insert({
      region,
      map,
      round_count,
      winner_user_id: winnerPlayer.user_id ?? null,
    })
    .select("id")
    .single();

  if (matchErr || !matchRow) {
    console.error("match insert error:", matchErr);
    return jsonResponse({ ok: false, error: "Failed to save match." }, 500);
  }

  const matchId: string = (matchRow as { id: string }).id;

  // --- Insert match_players rows ---
  const matchPlayerRows = players.map((p, i) => ({
    match_id:          matchId,
    user_id:           p.user_id,
    username_snapshot: p.username,
    kills:             p.kills,
    deaths:            p.deaths,
    round_wins:        p.round_wins,
    won:               p.won,
    rating_delta:      p.user_id !== null ? deltas[i] : 0,
    rating_after:      p.user_id !== null
                         ? Math.max(0, currentRatings[i] + deltas[i])
                         : 1000,
  }));

  const { error: mpErr } = await supabase
    .from("match_players")
    .insert(matchPlayerRows);

  if (mpErr) {
    console.error("match_players insert error:", mpErr);
    return jsonResponse({ ok: false, error: "Failed to save player results." }, 500);
  }

  return jsonResponse({ ok: true, matchId });
});
