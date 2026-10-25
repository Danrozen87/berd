const DRAFTS_STORAGE_KEY = "goose:chat-drafts";

export function loadCachedDrafts(strict = false): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const stored = window.localStorage.getItem(DRAFTS_STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch (error) {
    if (strict) throw error;
    return {};
  }
}

export function persistDrafts(
  drafts: Record<string, string>,
  strict = false,
): void {
  if (typeof window === "undefined") return;
  try {
    const nonEmpty = Object.fromEntries(
      Object.entries(drafts).filter(
        ([, v]) => typeof v === "string" && v.length > 0,
      ),
    );
    if (Object.keys(nonEmpty).length === 0) {
      window.localStorage.removeItem(DRAFTS_STORAGE_KEY);
    } else {
      window.localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(nonEmpty));
    }
  } catch (error) {
    if (strict) throw error;
    // localStorage may be unavailable
  }
}

export function forgetPersistedDraft(sessionId: string): void {
  const drafts = loadCachedDrafts(true);
  delete drafts[sessionId];
  persistDrafts(drafts, true);
}
