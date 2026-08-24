// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  baseDocumentName,
  derivedDocumentName,
} from "@/lib/processing/file-names";

describe("baseDocumentName", () => {
  it("keeps ordinary names and strips the extension", () => {
    expect(baseDocumentName("report final.pdf")).toBe("report final");
    expect(baseDocumentName("Q3-2026.PDF")).toBe("Q3-2026");
  });

  it("drops path components from hostile names", () => {
    expect(baseDocumentName("../../etc/passwd.pdf")).toBe("passwd");
    expect(baseDocumentName("C:\\server\\docs\\invoice.pdf")).toBe("invoice");
    expect(baseDocumentName("/tmp/x.pdf")).toBe("x");
  });

  it("replaces unsupported characters and strips control bytes", () => {
    // Control bytes are removed entirely; unsupported visible characters
    // become underscores.
    expect(baseDocumentName("a\u0000b;c|.pdf")).toBe("ab_c_");
    // An emoji is a surrogate pair, so each half becomes its own underscore.
    expect(baseDocumentName("emoji 🎉.pdf")).toBe("emoji __");
  });

  it("keeps Latin-1 accented characters", () => {
    // café (é = U+00E9) survives: header values can carry Latin-1.
    expect(baseDocumentName("café.pdf")).toBe("café");
  });

  it("replaces characters above U+00FF that headers cannot carry", () => {
    // Regression (Phase 9): Ő (U+0150) and ȍ (U+0200) were previously allowed
    // by the \u00c0-\u024f range and made the Content-Disposition header —
    // and with it the whole Response — throw. They must be neutralised at the
    // source so artifact names are always header-safe.
    expect(baseDocumentName("Ő.pdf")).toBe("_");
    expect(baseDocumentName("Ȍ-document.pdf")).toBe("_-document");
    expect(baseDocumentName("ǉ.pdf")).toBe("_");
  });

  it("falls back to `document` for empty results", () => {
    expect(baseDocumentName("")).toBe("document");
    expect(baseDocumentName(".pdf")).toBe("document");
    expect(baseDocumentName("   .pdf")).toBe("document");
  });

  it("caps the length at 80 characters", () => {
    const long = "a".repeat(200);
    expect(baseDocumentName(`${long}.pdf`)).toHaveLength(80);
  });
});

describe("derivedDocumentName", () => {
  it("appends a suffix with the sanitised base", () => {
    expect(derivedDocumentName("invoice.pdf", "compressed")).toBe(
      "invoice-compressed.pdf",
    );
    expect(derivedDocumentName("../../Ő.pdf", "rotated")).toBe(
      "_-rotated.pdf",
    );
  });
});
