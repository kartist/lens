// ============================================================
// Lens Runtime — built-in functions for generated TypeScript code
// ============================================================

/**
 * Trim whitespace from both ends of a string.
 */
export function __trim(s: string): string {
  return s.trim();
}

/**
 * Convert a string to Title Case.
 */
export function __titleCase(s: string): string {
  return s.toLowerCase().replace(/(?:^|\s)\S/g, (c) => c.toUpperCase());
}

/**
 * Convert to lowercase.
 */
export function __lowercase(s: string): string {
  return s.toLowerCase();
}

/**
 * Convert to uppercase.
 */
export function __uppercase(s: string): string {
  return s.toUpperCase();
}

/**
 * Normalize an email address (lowercase, trim).
 */
export function __normalizeEmail(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Normalize a city name (title case, trim).
 */
export function __normalizeCity(s: string): string {
  return __titleCase(s.trim());
}

/**
 * Parse a UUID string (validates format).
 */
export function __parseUuid(s: string): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(s.trim())) {
    throw new Error(`Invalid UUID format: "${s}"`);
  }
  return s.trim();
}

/**
 * Parse an integer from a string.
 */
export function __parseInt(s: string): number {
  const n = parseInt(s, 10);
  if (isNaN(n)) {
    throw new Error(`Cannot parse integer from: "${s}"`);
  }
  return n;
}

/**
 * Convert a number to a string.
 */
export function __toString(val: unknown): string {
  return String(val);
}

/**
 * Filter null/undefined values from an array.
 */
export function __filterNone<T>(arr: (T | null | undefined)[]): T[] {
  return arr.filter((x): x is T => x != null);
}

/**
 * Split a string on first space and return the first part.
 */
export function __splitFirst(s: string): string {
  const idx = s.indexOf(' ');
  return idx === -1 ? s : s.slice(0, idx);
}

/**
 * Split a string on last space and return the last part.
 */
export function __splitLast(s: string): string {
  const idx = s.lastIndexOf(' ');
  return idx === -1 ? s : s.slice(idx + 1);
}

/**
 * Get the current date/time.
 */
export function __now(): Date {
  return new Date();
}
