/** Formatting helpers shared by the presentation layer. */

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * Human readable file size using binary units (1 KB = 1024 B).
 *
 * @example formatBytes(1536) // "1.5 KB"
 */
export function formatBytes(bytes: number, fractionDigits = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "0 B";

  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    UNITS.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  const rounded = exponent === 0 ? Math.round(value) : Number(value.toFixed(fractionDigits));

  return `${rounded} ${UNITS[exponent]}`;
}

/** `[".jpg", ".jpeg"]` → `"JPG, JPEG"`. */
export function formatExtensionList(extensions: readonly string[]): string {
  return extensions
    .map((extension) => extension.replace(/^\./, "").toUpperCase())
    .join(", ");
}

/** Join items with commas and a final conjunction. */
export function formatList(items: readonly string[], conjunction = "and"): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`;
}
