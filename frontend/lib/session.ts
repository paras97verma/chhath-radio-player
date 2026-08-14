/**
 * Shared session ID utility for Chhath Radio.
 *
 * Uses localStorage so the same session_id is reused across all tabs
 * of the same browser origin. This ensures:
 *   - Multiple tabs do NOT inflate the listener count.
 *   - All SSE connections (ListenerCount, LiveChatDrawer) share one session.
 *   - The backend's ZADD NX correctly deduplicates the session.
 *
 * Key: "chhath_radio_session_id"
 * Format: UUID v4
 */

const SESSION_KEY = "chhath_radio_session_id";

/**
 * Returns the existing session ID from localStorage, or creates and stores
 * a new UUID v4 if none exists. Safe to call multiple times — always returns
 * the same value within a browser session.
 *
 * Must only be called in a browser context (not during SSR).
 */
export function getOrCreateSessionId(): string {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}
