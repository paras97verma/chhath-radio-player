/**
 * Dynamic Piped / Stream Instance Discovery & Health Service
 *
 * Discovers and monitors available public stream extraction instances using:
 * 1. Cached instances in localStorage (12h TTL)
 * 2. Official live markdown table from TeamPiped documentation repo
 * 3. Verified high-availability bootstrap instances
 */

import type { PipedInstance } from "../audio/types";

const CACHE_KEY = "chhath_radio_piped_instances_v3";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const COOLDOWN_DURATION_MS = 10 * 60 * 1000; // 10 minutes cooldown for failed instances

export const BOOTSTRAP_INSTANCES: PipedInstance[] = [
  { name: "Chocolatemoo (USA - Verified Active)", apiUrl: "https://yt.chocolatemoo53.com" },
  { name: "Tiekoetter (Germany)", apiUrl: "https://invidious.tiekoetter.com" },
  { name: "NerdVPN (Canada)", apiUrl: "https://invidious.nerdvpn.de" },
  { name: "Nadeko (Chile)", apiUrl: "https://inv.nadeko.net" },
  { name: "Private Coffee", apiUrl: "https://api.piped.private.coffee" },
  { name: "Ducks Party", apiUrl: "https://pipedapi.ducks.party" },
  { name: "Adminforge", apiUrl: "https://pipedapi.adminforge.de" },
];

// In-memory cooldown tracking: apiUrl -> cooldown expire timestamp
const failedInstanceCooldowns = new Map<string, number>();

/**
 * Normalizes an API URL: strips trailing slash, ensures HTTPS.
 */
export function normalizeApiUrl(url: string): string {
  let cleaned = url.trim();
  if (cleaned.endsWith("/")) {
    cleaned = cleaned.slice(0, -1);
  }
  if (cleaned.startsWith("http://")) {
    cleaned = "https://" + cleaned.slice(7);
  }
  return cleaned;
}

/**
 * Parses markdown table content from documentation repository
 */
export function parseInstancesMarkdown(markdown: string): PipedInstance[] {
  const instances: PipedInstance[] = [];
  const lines = markdown.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith("|") && !line.includes("|")) continue;
    // Skip header and separator rows
    if (line.includes("---") || /\|\s*Instance Name\s*\|/i.test(line) || /\|\s*Name\s*\|/i.test(line)) continue;

    const parts = line
      .split("|")
      .map((p) => p.trim())
      .filter(Boolean);

    if (parts.length >= 2) {
      const name = parts[0];
      const apiUrlRaw = parts[1];
      const urlMatch = apiUrlRaw.match(/https?:\/\/[^\s)\],]+/i);
      if (urlMatch) {
        const apiUrl = normalizeApiUrl(urlMatch[0]);
        if (apiUrl.startsWith("https://")) {
          instances.push({
            name,
            apiUrl,
            locations: parts[2] || undefined,
            cdn: parts[3] ? /yes|true/i.test(parts[3]) : undefined,
          });
        }
      }
    }
  }

  return instances;
}

/**
 * Read instances from localStorage cache
 */
function getCachedInstances(): PipedInstance[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.instances) && typeof parsed.timestamp === "number") {
      if (Date.now() - parsed.timestamp < CACHE_TTL_MS && parsed.instances.length > 0) {
        return parsed.instances;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Save instances to localStorage cache
 */
function setCachedInstances(instances: PipedInstance[]): void {
  if (typeof window === "undefined" || instances.length === 0) return;
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        timestamp: Date.now(),
        instances,
      })
    );
  } catch {
    /* ignore */
  }
}

/**
 * Safe fetch with timeout that never throws unhandled abort errors
 */
async function safeFetchWithTimeout(url: string, ms = 3000): Promise<Response | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    try {
      controller.abort();
    } catch {
      /* ignore */
    }
  }, ms);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json, text/plain, */*" },
    });
    clearTimeout(timeoutId);
    return res;
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

/**
 * Fetches instances dynamically from documentation repo, falling back to bootstrap list.
 */
export async function discoverPipedInstances(): Promise<PipedInstance[]> {
  const cached = getCachedInstances();
  if (cached && cached.length > 0) {
    return cached;
  }

  // 1. Try official TeamPiped documentation repo public instances table
  try {
    const res = await safeFetchWithTimeout(
      "https://raw.githubusercontent.com/TeamPiped/documentation/refs/heads/main/content/docs/public-instances/index.md",
      3500
    );

    if (res && res.ok) {
      const text = await res.text();
      const parsed = parseInstancesMarkdown(text);
      if (parsed.length > 0) {
        // Merge bootstrap at top for maximum reliability
        const merged = [...BOOTSTRAP_INSTANCES, ...parsed.filter((p) => !BOOTSTRAP_INSTANCES.some((b) => b.apiUrl === p.apiUrl))];
        setCachedInstances(merged);
        return merged;
      }
    }
  } catch {
    /* ignore network errors */
  }

  // 2. Fallback to bootstrap list
  setCachedInstances(BOOTSTRAP_INSTANCES);
  return BOOTSTRAP_INSTANCES;
}

/**
 * Record a failure for an instance API URL to place it in cooldown
 */
export function markInstanceFailed(apiUrl: string): void {
  const normalized = normalizeApiUrl(apiUrl);
  failedInstanceCooldowns.set(normalized, Date.now() + COOLDOWN_DURATION_MS);
}

/**
 * Record a success for an instance API URL
 */
export function markInstanceSuccess(apiUrl: string): void {
  const normalized = normalizeApiUrl(apiUrl);
  failedInstanceCooldowns.delete(normalized);
}

/**
 * Filter available instances, excluding those currently in cooldown.
 */
export async function getHealthyInstances(): Promise<PipedInstance[]> {
  const allInstances = await discoverPipedInstances();
  const now = Date.now();

  // Prune expired cooldowns
  for (const [url, expiry] of failedInstanceCooldowns.entries()) {
    if (now > expiry) {
      failedInstanceCooldowns.delete(url);
    }
  }

  const healthy = allInstances.filter((inst) => {
    const expiry = failedInstanceCooldowns.get(inst.apiUrl);
    return !expiry || now > expiry;
  });

  if (healthy.length > 0) {
    return healthy;
  }

  // If all instances in cooldown, reset cooldowns
  failedInstanceCooldowns.clear();
  return BOOTSTRAP_INSTANCES;
}
