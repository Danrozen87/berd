const UNREAD_SESSIONS_STORAGE_KEY = "goose:unread-sessions";

export function loadCachedUnreadSessionIds(strict = false): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(UNREAD_SESSIONS_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
  } catch (error) {
    if (strict) throw error;
    return [];
  }
}

export function persistUnreadSessionIds(
  sessionIds: Iterable<string>,
  strict = false,
): void {
  if (typeof window === "undefined") return;
  try {
    const uniqueSessionIds = Array.from(new Set(sessionIds)).filter(
      (id) => id.length > 0,
    );
    if (uniqueSessionIds.length === 0) {
      window.localStorage.removeItem(UNREAD_SESSIONS_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(
      UNREAD_SESSIONS_STORAGE_KEY,
      JSON.stringify(uniqueSessionIds),
    );
  } catch (error) {
    if (strict) throw error;
    // localStorage may be unavailable
  }
}

export function forgetPersistedUnreadSession(sessionId: string): void {
  persistUnreadSessionIds(
    loadCachedUnreadSessionIds(true).filter((id) => id !== sessionId),
    true,
  );
}
