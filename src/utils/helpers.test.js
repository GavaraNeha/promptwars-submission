import { describe, it, expect } from 'vitest';
import { generateTrackingId, parseMarkdownLine, parseMarkdown } from './helpers';

// ─── generateTrackingId ───────────────────────────────────────────────────────

describe('generateTrackingId', () => {
  it('returns a string starting with "SB-"', () => {
    const id = generateTrackingId();
    expect(id).toMatch(/^SB-/);
  });

  it('has exactly 9 characters total (SB- + 6 alphanumeric chars)', () => {
    const id = generateTrackingId();
    expect(id).toHaveLength(9);
  });

  it('only uses uppercase letters and digits after the prefix', () => {
    const suffix = generateTrackingId().slice(3);
    expect(suffix).toMatch(/^[A-Z0-9]{6}$/);
  });

  it('generates unique IDs on repeated calls', () => {
    const ids = new Set(Array.from({ length: 100 }, generateTrackingId));
    // With 36^6 ≈ 2.2 billion combinations, 100 calls should always be unique
    expect(ids.size).toBe(100);
  });
});

// ─── parseMarkdownLine ────────────────────────────────────────────────────────

describe('parseMarkdownLine — plain text', () => {
  it('returns type "paragraph" for plain text', () => {
    const result = parseMarkdownLine('Hello world');
    expect(result.type).toBe('paragraph');
  });

  it('returns a single non-bold segment for plain text', () => {
    const result = parseMarkdownLine('Hello world');
    expect(result.segments).toEqual([{ bold: false, text: 'Hello world' }]);
  });

  it('returns an empty-text paragraph for a blank line', () => {
    const result = parseMarkdownLine('');
    expect(result.type).toBe('paragraph');
    expect(result.segments[0].text).toBe('');
  });
});

describe('parseMarkdownLine — bold text', () => {
  it('parses **bold** into a bold segment', () => {
    const result = parseMarkdownLine('This is **important**.');
    expect(result.segments).toEqual([
      { bold: false, text: 'This is ' },
      { bold: true,  text: 'important' },
      { bold: false, text: '.' },
    ]);
  });

  it('parses multiple bold spans in one line', () => {
    const result = parseMarkdownLine('**A** and **B**');
    const boldTexts = result.segments.filter(s => s.bold).map(s => s.text);
    expect(boldTexts).toEqual(['A', 'B']);
  });

  it('returns a single bold segment when the entire line is bold', () => {
    const result = parseMarkdownLine('**Required Documents:**');
    expect(result.segments).toEqual([{ bold: true, text: 'Required Documents:' }]);
  });
});

describe('parseMarkdownLine — bullet lists', () => {
  it('detects "- item" as type "bullet"', () => {
    expect(parseMarkdownLine('- Passport').type).toBe('bullet');
  });

  it('detects "* item" as type "bullet"', () => {
    expect(parseMarkdownLine('* Voter ID').type).toBe('bullet');
  });

  it('detects "+ item" as type "bullet"', () => {
    expect(parseMarkdownLine('+ Aadhaar Card').type).toBe('bullet');
  });

  it('extracts the item text correctly from a bullet line', () => {
    const result = parseMarkdownLine('- Proof of Identity (PAN, Passport)');
    expect(result.segments[0].text).toBe('Proof of Identity (PAN, Passport)');
  });

  it('handles bold text inside a bullet item', () => {
    const result = parseMarkdownLine('- **Aadhaar Card** of all members');
    const boldSeg = result.segments.find(s => s.bold);
    expect(boldSeg?.text).toBe('Aadhaar Card');
  });

  it('records correct indent level for nested bullets', () => {
    const result = parseMarkdownLine('  - Nested item');
    expect(result.indent).toBe(2);
  });
});

describe('parseMarkdownLine — numbered lists', () => {
  it('detects "1. item" as type "numbered"', () => {
    expect(parseMarkdownLine('1. First step').type).toBe('numbered');
  });

  it('extracts the numeric prefix correctly', () => {
    expect(parseMarkdownLine('3. Third step').numPrefix).toBe('3.');
  });

  it('extracts the item text for a numbered line', () => {
    const result = parseMarkdownLine('2. Visit the Aadhaar Centre');
    expect(result.segments[0].text).toBe('Visit the Aadhaar Centre');
  });
});

// ─── parseMarkdown (multi-line) ───────────────────────────────────────────────

describe('parseMarkdown', () => {
  it('returns an empty array for null/undefined input', () => {
    expect(parseMarkdown(null)).toEqual([]);
    expect(parseMarkdown(undefined)).toEqual([]);
    expect(parseMarkdown('')).toEqual([]);
  });

  it('splits a multi-line string into one result per line', () => {
    const text = 'Line one\nLine two\nLine three';
    expect(parseMarkdown(text)).toHaveLength(3);
  });

  it('correctly identifies mixed content in a real Gemini-style response', () => {
    const response = [
      'To update your Aadhaar card:',
      '',
      '**Required Documents:**',
      '- Proof of Identity (PAN, Passport)',
      '- Proof of Address (Electricity Bill)',
    ].join('\n');

    const parsed = parseMarkdown(response);

    expect(parsed[0].type).toBe('paragraph');
    expect(parsed[1].type).toBe('paragraph');       // blank line
    expect(parsed[2].segments[0].bold).toBe(true);  // **Required Documents:**
    expect(parsed[3].type).toBe('bullet');
    expect(parsed[4].type).toBe('bullet');
  });
});
