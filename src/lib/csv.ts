/**
 * CSV generation for report exports.
 *
 * Pure and separate from the route so the escaping rules are testable — they
 * are the whole substance of the format, and getting them wrong corrupts a
 * spreadsheet quietly rather than failing.
 */

/**
 * Cells that a spreadsheet would execute rather than display.
 *
 * Excel and Sheets treat a leading =, +, - or @ as a formula. Work-log notes
 * are free text written by people, so a note beginning "=> shipped the nav"
 * becomes a formula on open — and in the general case that is how a CSV export
 * turns into code execution on the machine of whoever opens it. Prefixing with
 * an apostrophe is the standard defusal: the spreadsheet shows the text and
 * does not evaluate it.
 */
function defuse(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = defuse(String(value));
  // Quote whenever the value could otherwise break the row or the column, and
  // double any embedded quote — RFC 4180.
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export function toCsv(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
): string {
  const lines = [headers.map(cell).join(",")];
  for (const row of rows) lines.push(row.map(cell).join(","));
  // CRLF, which is what RFC 4180 specifies and what Excel expects.
  return lines.join("\r\n") + "\r\n";
}
