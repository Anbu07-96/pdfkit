/**
 * Output file naming.
 *
 * One sanitiser, used by every processor, so a document name can never carry a
 * path, a control character or anything else unsafe into a file name or a
 * `Content-Disposition` header.
 */

/** `../Q3 report.pdf` → `Q3 report`. Falls back to `document`.
 *
 * The accented range is Latin-1 only (`\u00c0-\u00ff`): artifact names travel
 * into `Content-Disposition` headers, whose values must be ByteStrings, so a
 * character above U+00FF (Ő U+0150, ǉ U+01C9, …) would make the header — and
 * with it the whole response — throw. Extended-Latin characters are replaced
 * with `_` like any other unsupported character.
 */
export function baseDocumentName(fileName: string): string {
  const withoutPath = fileName.split(/[/\\]/).pop() ?? fileName;
  const withoutExtension = withoutPath.replace(/\.pdf$/i, "");
  const cleaned = withoutExtension
    // Strip C0 control characters.
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^A-Za-z0-9._()\- \u00c0-\u00ff]/g, "_")
    .trim()
    .slice(0, 80)
    .trim();
  return cleaned.length > 0 ? cleaned : "document";
}

/** `report.pdf` + `extracted` → `report-extracted.pdf`. */
export function derivedDocumentName(fileName: string, suffix: string): string {
  return `${baseDocumentName(fileName)}-${suffix}.pdf`;
}
