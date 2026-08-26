/**
 * Neutralizes spreadsheet formula injection for exported admin data.
 * Customer-controlled strings (usernames, notes, rejection reasons) that
 * begin with =, +, -, @, TAB or CR are interpreted as formulas by Excel /
 * Google Sheets when a CSV is opened (=HYPERLINK, DDE payloads, etc.).
 */

/** CSV cell: formula-guard + RFC4180 quote escaping, always double-quoted. */
export function csvCell(value: unknown): string {
  const s = String(value ?? '');
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/**
 * ExcelJS treats string cells starting with "=" as formulas even in XLSX.
 * Prefix with an apostrophe (rendered inert, matches Excel convention).
 */
export function guardExcelString<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === 'string' && v.startsWith('=') ? `'${v}` : v;
  }
  return out as T;
}
