// supabase/functions/geo/index.ts
// Deno edge function: resolve a coarse region id from the caller's IP.
//
// Region map (matches CFG.REGIONS in src/config.js):
//   sea      — Southeast Asia + Oceania (default / fallback)
//   us-east  — North America East
//   us-west  — North America West
//   eu       — Europe
//   sa       — South America
//   oce      — Oceania (AU/NZ)
//
// Strategy:
//   1. Read the Supabase-injected x-forwarded-for header (first IP in list).
//   2. Call ip-api.com (free, no key, 1000 req/min) with a short timeout.
//   3. Map the returned country-code to a region id.
//   4. On any failure fall back to 'sea'.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// ---------------------------------------------------------------------------
// CORS headers — allow the game origin in production and localhost in dev
// ---------------------------------------------------------------------------
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ---------------------------------------------------------------------------
// Country-code → region mapping
// Unmapped countries fall through to the default.
// ---------------------------------------------------------------------------
const COUNTRY_REGION: Record<string, string> = {
  // Southeast Asia
  SG: "sea", MY: "sea", TH: "sea", PH: "sea", ID: "sea", VN: "sea",
  MM: "sea", KH: "sea", LA: "sea", BN: "sea",
  // East Asia (route to sea — closest cluster)
  JP: "sea", KR: "sea", TW: "sea", HK: "sea", CN: "sea",
  // South Asia
  IN: "sea", PK: "sea", BD: "sea", LK: "sea",
  // Oceania
  AU: "oce", NZ: "oce", FJ: "oce", PG: "oce", WS: "oce",
  // Europe
  GB: "eu", DE: "eu", FR: "eu", NL: "eu", ES: "eu", IT: "eu",
  SE: "eu", NO: "eu", DK: "eu", FI: "eu", PL: "eu", RU: "eu",
  CH: "eu", AT: "eu", BE: "eu", PT: "eu", CZ: "eu", HU: "eu",
  GR: "eu", RO: "eu", UA: "eu", TR: "eu",
  // North America East (eastern states heuristic — same cluster)
  US: "us-east",  // refined below using timezone offset from ip-api
  CA: "us-east",
  // South America
  BR: "sa", AR: "sa", CL: "sa", CO: "sa", PE: "sa", VE: "sa",
  EC: "sa", BO: "sa", PY: "sa", UY: "sa",
  // Middle East / Africa — default cluster (sea)
};

// US and CA can also fall in us-west depending on the reported timezone offset
// (longitude proxy). ip-api returns `lon` so we use that.
function resolveUsRegion(lon: number): string {
  // Rough split: west of -100° → us-west
  return lon <= -100 ? "us-west" : "us-east";
}

// ---------------------------------------------------------------------------
// Geo lookup via ip-api.com (no key required, HTTP only on free tier)
// ---------------------------------------------------------------------------
interface IpApiResponse {
  status:      string;
  countryCode: string;
  lon:         number;
}

const DEFAULT_REGION = "sea";
const IP_API_TIMEOUT_MS = 3000;

async function resolveRegion(ip: string): Promise<string> {
  if (!ip || ip === "127.0.0.1" || ip === "::1") return DEFAULT_REGION;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IP_API_TIMEOUT_MS);

    const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,countryCode,lon`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) return DEFAULT_REGION;

    const data: IpApiResponse = await res.json();
    if (data.status !== "success" || !data.countryCode) return DEFAULT_REGION;

    const cc = data.countryCode.toUpperCase();

    if (cc === "US" || cc === "CA") {
      return resolveUsRegion(data.lon ?? -80);
    }

    return COUNTRY_REGION[cc] ?? DEFAULT_REGION;
  } catch {
    return DEFAULT_REGION;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
serve(async (req: Request): Promise<Response> => {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // supabase-js functions.invoke() defaults to POST; this endpoint is read-only
  // and takes no body, so accept both GET and POST.
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  // Extract client IP from x-forwarded-for (Supabase injects this)
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const clientIp = xff.split(",")[0].trim();

  const region = await resolveRegion(clientIp);

  return new Response(
    JSON.stringify({ region }),
    {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    },
  );
});
