import { describe, it, expect } from 'vitest';
import {
  stripHtml,
  stripControlChars,
  sanitizeQuery,
  sanitizeTrackingId,
  sanitizeForFirestore,
  MAX_QUERY_LENGTH,
  TRACKING_ID_REGEX,
} from './sanitize';

// ─── stripHtml ────────────────────────────────────────────────────────────────

describe('stripHtml', () => {
  it('removes <script> tags', () => {
    expect(stripHtml('Hello <script>alert("xss")</script> world')).toBe('Hello alert("xss") world');
  });

  it('removes <img> tags with event handlers', () => {
    expect(stripHtml('<img onerror="alert(1)" src=x>')).toBe('');
  });

  it('leaves plain text untouched', () => {
    expect(stripHtml('Normal text')).toBe('Normal text');
  });

  it('returns empty string for non-string input', () => {
    expect(stripHtml(null)).toBe('');
    expect(stripHtml(undefined)).toBe('');
    expect(stripHtml(42)).toBe('');
  });
});

// ─── stripControlChars ────────────────────────────────────────────────────────

describe('stripControlChars', () => {
  it('removes null bytes', () => {
    expect(stripControlChars('abc\x00def')).toBe('abcdef');
  });

  it('preserves newlines, tabs, and carriage returns', () => {
    expect(stripControlChars('line1\nline2\ttab\rreturn')).toBe('line1\nline2\ttab\rreturn');
  });

  it('removes other C0 control chars', () => {
    expect(stripControlChars('abc\x01\x02\x03def')).toBe('abcdef');
  });
});

// ─── sanitizeQuery ────────────────────────────────────────────────────────────

describe('sanitizeQuery', () => {
  it('accepts a normal text query', () => {
    const result = sanitizeQuery('How to update my Aadhaar card?');
    expect(result.valid).toBe(true);
    expect(result.sanitized).toBe('How to update my Aadhaar card?');
    expect(result.error).toBeNull();
  });

  it('accepts Hindi text', () => {
    const result = sanitizeQuery('आधार कार्ड कैसे अपडेट करें?');
    expect(result.valid).toBe(true);
    expect(result.sanitized).toBe('आधार कार्ड कैसे अपडेट करें?');
  });

  it('strips HTML tags from the query', () => {
    const result = sanitizeQuery('Hello <b>world</b>');
    expect(result.valid).toBe(true);
    expect(result.sanitized).toBe('Hello world');
  });

  it('rejects empty strings', () => {
    expect(sanitizeQuery('').valid).toBe(false);
    expect(sanitizeQuery('   ').valid).toBe(false);
  });

  it('rejects null/undefined', () => {
    expect(sanitizeQuery(null).valid).toBe(false);
    expect(sanitizeQuery(undefined).valid).toBe(false);
  });

  it('rejects messages exceeding MAX_QUERY_LENGTH', () => {
    const longMsg = 'a'.repeat(MAX_QUERY_LENGTH + 1);
    const result = sanitizeQuery(longMsg);
    expect(result.valid).toBe(false);
    expect(result.error).toContain(`${MAX_QUERY_LENGTH}`);
  });

  it('accepts messages at exactly MAX_QUERY_LENGTH', () => {
    const exactMsg = 'a'.repeat(MAX_QUERY_LENGTH);
    expect(sanitizeQuery(exactMsg).valid).toBe(true);
  });
});

// ─── sanitizeTrackingId ───────────────────────────────────────────────────────

describe('sanitizeTrackingId', () => {
  it('accepts a valid tracking ID', () => {
    const result = sanitizeTrackingId('SB-8A2D7P');
    expect(result.valid).toBe(true);
    expect(result.trackingId).toBe('SB-8A2D7P');
  });

  it('normalizes lowercase to uppercase', () => {
    const result = sanitizeTrackingId('sb-8a2d7p');
    expect(result.valid).toBe(true);
    expect(result.trackingId).toBe('SB-8A2D7P');
  });

  it('rejects IDs without the SB- prefix', () => {
    expect(sanitizeTrackingId('XX-123456').valid).toBe(false);
  });

  it('rejects IDs that are too short', () => {
    expect(sanitizeTrackingId('SB-123').valid).toBe(false);
  });

  it('rejects IDs that are too long', () => {
    expect(sanitizeTrackingId('SB-1234567').valid).toBe(false);
  });

  it('rejects IDs with special characters', () => {
    expect(sanitizeTrackingId('SB-12!@#$').valid).toBe(false);
  });

  it('rejects empty input', () => {
    expect(sanitizeTrackingId('').valid).toBe(false);
    expect(sanitizeTrackingId('   ').valid).toBe(false);
  });

  it('rejects null/undefined', () => {
    expect(sanitizeTrackingId(null).valid).toBe(false);
    expect(sanitizeTrackingId(undefined).valid).toBe(false);
  });
});

// ─── sanitizeForFirestore ─────────────────────────────────────────────────────

describe('sanitizeForFirestore', () => {
  it('strips HTML and trims whitespace', () => {
    expect(sanitizeForFirestore('  <b>Hello</b>  ')).toBe('Hello');
  });

  it('enforces the default 500-char limit', () => {
    const long = 'x'.repeat(600);
    expect(sanitizeForFirestore(long).length).toBe(500);
  });

  it('enforces a custom max length', () => {
    const long = 'y'.repeat(300);
    expect(sanitizeForFirestore(long, 200).length).toBe(200);
  });

  it('returns empty string for non-string input', () => {
    expect(sanitizeForFirestore(null)).toBe('');
    expect(sanitizeForFirestore(123)).toBe('');
  });

  it('removes control characters', () => {
    expect(sanitizeForFirestore('abc\x00\x01def')).toBe('abcdef');
  });
});

// ─── TRACKING_ID_REGEX ────────────────────────────────────────────────────────

describe('TRACKING_ID_REGEX', () => {
  it('matches valid tracking IDs', () => {
    expect(TRACKING_ID_REGEX.test('SB-ABC123')).toBe(true);
    expect(TRACKING_ID_REGEX.test('SB-000000')).toBe(true);
    expect(TRACKING_ID_REGEX.test('SB-ZZZZZZ')).toBe(true);
  });

  it('rejects invalid formats', () => {
    expect(TRACKING_ID_REGEX.test('SB-abc123')).toBe(false); // lowercase
    expect(TRACKING_ID_REGEX.test('SB-12345')).toBe(false);  // too short
    expect(TRACKING_ID_REGEX.test('SB-1234567')).toBe(false); // too long
    expect(TRACKING_ID_REGEX.test('AB-123456')).toBe(false);  // wrong prefix
    expect(TRACKING_ID_REGEX.test('SB123456')).toBe(false);   // no dash
  });
});
