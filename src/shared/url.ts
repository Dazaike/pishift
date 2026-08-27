const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * Returns true if the given URL string is a safe external link (http, https, mailto).
 * Rejects pseudo-schemes like about:blank, javascript:, file:, data:, or malformed inputs.
 */
export function isSafeExternalUrl(rawUrl: string): boolean {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return false;
  try {
    const parsed = new URL(rawUrl.trim());
    return ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol.toLowerCase());
  } catch {
    return false;
  }
}
