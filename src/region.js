// Region detection and persistence.
// Priority: localStorage override -> geo edge function -> default.
import { CFG } from './config.js';
import { isEnabled, getClient } from './supabase.js';

// Re-export the region list so consumers only need to import from this module.
export const REGIONS = CFG.REGIONS;

const STORAGE_KEY = 'vwb-region';

// Returns the active region id. Never throws.
export async function getRegion() {
  // 1. LocalStorage override takes precedence.
  try {
    const override = localStorage.getItem(STORAGE_KEY);
    if (override) return override;
  } catch {
    // localStorage unavailable (e.g. Node test environment) — continue.
  }

  // 2. Ask the Supabase geo edge function for the closest region.
  if (isEnabled()) {
    try {
      const client = getClient();
      const { data } = await client.functions.invoke('geo');
      if (data && typeof data.region === 'string') return data.region;
    } catch {
      // Network error or function not deployed — fall through to default.
    }
  }

  // 3. Hard default.
  return CFG.DEFAULT_REGION;
}

// Persist a region override to localStorage.
export function setRegion(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Ignore storage errors (private browsing, Node, etc.).
  }
}

// Returns the human-readable label for a region id, or the id itself as fallback.
export function getRegionLabel(id) {
  const region = CFG.REGIONS.find((r) => r.id === id);
  return region ? region.label : id;
}
