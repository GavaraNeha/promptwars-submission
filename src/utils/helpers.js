/**
 * Generates a random civic complaint tracking ID in the format SB-XXXXXX
 * where X is an alphanumeric character (A-Z, 0-9).
 *
 * @returns {string} e.g. "SB-8A2D7P"
 */
export function generateTrackingId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `SB-${result}`;
}

/**
 * Parses a single line of Markdown-like text into a structured object
 * that describes how it should be rendered.
 *
 * Supported formats:
 *  - Bullet lists:   "- item", "* item", "+ item"
 *  - Numbered lists: "1. item", "2. item", etc.
 *  - Bold spans:     "**bold text**"
 *  - Plain text
 *
 * @param {string} line - Raw text line to parse
 * @returns {{ type: 'bullet'|'numbered'|'paragraph', indent: number, numPrefix: string, segments: Array<{bold: boolean, text: string}> }}
 */
export function parseMarkdownLine(line) {
  const bulletMatch = line.match(/^(\s*)[-*+]\s+(.*)/);
  const numberedMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/);

  let type = 'paragraph';
  let content = line;
  let indent = 0;
  let numPrefix = '';

  if (bulletMatch) {
    type = 'bullet';
    indent = bulletMatch[1].length;
    content = bulletMatch[2];
  } else if (numberedMatch) {
    type = 'numbered';
    indent = numberedMatch[1].length;
    numPrefix = numberedMatch[2] + '.';
    content = numberedMatch[3];
  }

  // Parse bold segments: **text**
  const segments = [];
  let lastIndex = 0;
  const boldRegex = /\*\*(.*?)\*\*/g;
  let match;

  while ((match = boldRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ bold: false, text: content.substring(lastIndex, match.index) });
    }
    segments.push({ bold: true, text: match[1] });
    lastIndex = boldRegex.lastIndex;
  }

  if (lastIndex < content.length) {
    segments.push({ bold: false, text: content.substring(lastIndex) });
  }

  // If no bold markers were found, treat the entire content as a plain segment
  if (segments.length === 0) {
    segments.push({ bold: false, text: content });
  }

  return { type, indent, numPrefix, segments };
}

/**
 * Parses a full multi-line markdown string into an array of structured line objects.
 *
 * @param {string} text - Full message string to parse
 * @returns {Array<ReturnType<parseMarkdownLine>>}
 */
export function parseMarkdown(text) {
  if (!text) return [];
  return text.split('\n').map(parseMarkdownLine);
}
