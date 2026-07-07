/**
 * Input sanitization utilities for Smart Bharat.
 *
 * All user-provided text passes through these functions before
 * being sent to the Gemini API or written to Firestore.
 */

/** Maximum allowed length for a chat query (in characters). */
export const MAX_QUERY_LENGTH = 1000;

/** Maximum allowed length for a tracking ID search input. */
export const MAX_TRACKING_ID_LENGTH = 12;

/** Allowed tracking-ID pattern (SB- followed by exactly 6 alphanumeric chars). */
export const TRACKING_ID_REGEX = /^SB-[A-Z0-9]{6}$/;

/**
 * Strip HTML/script tags to prevent stored-XSS if content is ever
 * rendered as innerHTML elsewhere (defense in depth).
 *
 * @param {string} input
 * @returns {string}
 */
export function stripHtml(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/<[^>]*>/g, '');
}

/**
 * Remove control characters (U+0000–U+001F except \n \r \t) that
 * could cause issues in Firestore or confuse the LLM.
 *
 * @param {string} input
 * @returns {string}
 */
export function stripControlChars(input) {
  if (typeof input !== 'string') return '';
  // Keep newlines (\n = 0x0A), carriage returns (\r = 0x0D), and tabs (\t = 0x09)
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Full sanitization pipeline for a user chat query.
 * Returns the cleaned string, or null if the input is invalid.
 *
 * @param {string} raw
 * @returns {{ valid: boolean, sanitized: string, error: string|null }}
 */
export function sanitizeQuery(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { valid: false, sanitized: '', error: 'Please enter a message.' };
  }

  let cleaned = stripHtml(raw);
  cleaned = stripControlChars(cleaned);
  cleaned = cleaned.trim();

  if (cleaned.length === 0) {
    return { valid: false, sanitized: '', error: 'Your message contained no valid text after cleaning.' };
  }

  if (cleaned.length > MAX_QUERY_LENGTH) {
    return {
      valid: false,
      sanitized: '',
      error: `Your message exceeds the ${MAX_QUERY_LENGTH}-character limit. Please shorten it and try again.`
    };
  }

  return { valid: true, sanitized: cleaned, error: null };
}

/**
 * Validate and normalize a complaint tracking ID for search.
 *
 * @param {string} raw
 * @returns {{ valid: boolean, trackingId: string, error: string|null }}
 */
export function sanitizeTrackingId(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { valid: false, trackingId: '', error: 'Please enter a Tracking ID.' };
  }

  const cleaned = raw.trim().toUpperCase();

  if (cleaned.length > MAX_TRACKING_ID_LENGTH) {
    return { valid: false, trackingId: '', error: 'Tracking ID is too long. Expected format: SB-XXXXXX.' };
  }

  if (!TRACKING_ID_REGEX.test(cleaned)) {
    return {
      valid: false,
      trackingId: '',
      error: 'Invalid Tracking ID format. Expected: SB- followed by 6 letters/numbers (e.g. SB-8A2D7P).'
    };
  }

  return { valid: true, trackingId: cleaned, error: null };
}

/**
 * Sanitize a string value before writing it to Firestore.
 * Strips HTML, control characters, and enforces a length cap.
 *
 * @param {string} input
 * @param {number} [maxLen=500]
 * @returns {string}
 */
export function sanitizeForFirestore(input, maxLen = 500) {
  if (typeof input !== 'string') return '';
  let cleaned = stripHtml(input);
  cleaned = stripControlChars(cleaned);
  cleaned = cleaned.trim();
  return cleaned.slice(0, maxLen);
}
