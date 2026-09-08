// @vitest-environment node
import { describe, expect, it } from "vitest";
import { unzipSync, zipSync } from "fflate";
import {
  buildBatchEntries,
  buildBatchZipBlob,
  sanitizeBatchEntryName,
} from "@/lib/bulk/zip";

function zipBlob(files: Record<string, Uint8Array>): Blob {
  const archive = zipSync(files, { level: 0, mtime: new Date() });
  return new Blob([archive as unknown as BlobPart], { type: "application/zip" });
}

describe("sanitizeBatchEntryName", () => {
  it("strips path components and traversal sequences", () => {
    expect(sanitizeBatchEntryName("../../etc/passwd", "fallback")).toBe("passwd");
    expect(sanitizeBatchEntryName("a/b/c.jpg", "fallback")).toBe("c.jpg");
    expect(sanitizeBatchEntryName("C:\\server\\x.pdf", "fallback")).toBe("x.pdf");
  });

  it("strips control characters and leading dots", () => {
    expect(sanitizeBatchEntryName("..hidden", "fallback")).toBe("hidden");
    expect(sanitizeBatchEntryName("na\u0000me.jpg", "fallback")).toBe("name.jpg");
  });

  it("falls back for empty or dot-only names", () => {
    expect(sanitizeBatchEntryName("", "fallback.pdf")).toBe("fallback.pdf");
    expect(sanitizeBatchEntryName(".", "fallback.pdf")).toBe("fallback.pdf");
    expect(sanitizeBatchEntryName("..", "fallback.pdf")).toBe("fallback.pdf");
  });

  it("replaces unsafe characters and caps the length", () => {
    expect(sanitizeBatchEntryName("a;b.jpg", "fallback")).toBe("a_b.jpg");
    const long = "a".repeat(500);
    expect(sanitizeBatchEntryName(`${long}.pdf`, "fallback").length).toBeLessThanOrEqual(
      120,
    );
  });
});

describe("buildBatchEntries", () => {
  it("keeps single-file results as flat, deduplicated entries", async () => {
    const entries = await buildBatchEntries(
      [
        { sourceName: "report.pdf", resultName: "report.docx", blob: new Blob([new Uint8Array([1])]) },
        // Same server-provided name twice (two sources with equal names).
        { sourceName: "report.pdf", resultName: "report.docx", blob: new Blob([new Uint8Array([2])]) },
      ],
      false,
    );

    // ".sort()" orders "report-2.docx" before "report.docx" (hyphen < dot).
    expect(Object.keys(entries.files).sort()).toEqual(["report-2.docx", "report.docx"]);
  });

  it("flattens archive results into one folder per source file", async () => {
    const inner = zipBlob({
      "doc-p1-img1.jpg": new Uint8Array([1]),
      "doc-p2-img1.jpg": new Uint8Array([2]),
    });
    const entries = await buildBatchEntries(
      [{ sourceName: "doc.pdf", resultName: "doc-extracted-images.zip", blob: inner }],
      true,
    );

    expect(Object.keys(entries.files).sort()).toEqual([
      "doc/doc-p1-img1.jpg",
      "doc/doc-p2-img1.jpg",
    ]);
  });

  it("re-sanitises names that arrive inside a server-produced ZIP", async () => {
    // Even a malicious entry name inside the per-file ZIP cannot smuggle a
    // path into the batch archive.
    const inner = zipBlob({
      "../evil.jpg": new Uint8Array([1]),
      "ok.jpg": new Uint8Array([2]),
    });
    const entries = await buildBatchEntries(
      [{ sourceName: "doc.pdf", resultName: "doc.zip", blob: inner }],
      true,
    );

    const names = Object.keys(entries.files);
    expect(names.some((name) => name.includes(".."))).toBe(false);
    expect(names.some((name) => name.startsWith("/"))).toBe(false);
    expect(names).toContain("doc/evil.jpg");
    expect(names).toContain("doc/ok.jpg");
  });

  it("de-duplicates folders when two source files share a base name", async () => {
    const makeInner = (byte: number) =>
      zipBlob({ "page-1.jpg": new Uint8Array([byte]) });
    const entries = await buildBatchEntries(
      [
        { sourceName: "doc.pdf", resultName: "doc.zip", blob: makeInner(1) },
        { sourceName: "doc.pdf", resultName: "doc.zip", blob: makeInner(2) },
      ],
      true,
    );

    expect(Object.keys(entries.files).sort()).toEqual([
      "doc-2/page-1.jpg",
      "doc/page-1.jpg",
    ]);
  });

  it("falls back to a flat entry when an archive result cannot be unpacked", async () => {
    const notAZip = new Blob([new Uint8Array([1, 2, 3])]);
    const entries = await buildBatchEntries(
      [{ sourceName: "doc.pdf", resultName: "doc.jpg", blob: notAZip }],
      true,
    );

    expect(Object.keys(entries.files)).toEqual(["doc.jpg"]);
  });
});

describe("buildBatchZipBlob", () => {
  it("produces a real, readable ZIP archive", async () => {
    const inner = zipBlob({ "p1.jpg": new Uint8Array([7, 7, 7]) });
    const { blob, fileName } = await buildBatchZipBlob(
      [
        { sourceName: "a.pdf", resultName: "a.docx", blob: new Blob([new Uint8Array([1])]) },
        { sourceName: "b.pdf", resultName: "b.zip", blob: inner },
      ],
      { flattenArchives: true, name: "pdf-to-word-batch.zip" },
    );

    expect(fileName).toBe("pdf-to-word-batch.zip");
    expect(blob.size).toBeGreaterThan(0);

    const archive = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(archive).sort()).toEqual(["a.docx", "b/p1.jpg"]);
    expect([...archive["a.docx"]!]).toEqual([1]);
    expect([...archive["b/p1.jpg"]!]).toEqual([7, 7, 7]);
  });
});

describe("buildBatchEntries — Phase 62 security hardening", () => {
  it("handles Unicode filenames safely", () => {
    expect(sanitizeBatchEntryName("文档.pdf", "fallback")).toBe("文档.pdf");
    expect(sanitizeBatchEntryName("café-résumé.pdf", "fallback")).toBe(
      "café-résumé.pdf",
    );
    // CJK inside an archive entry is preserved end-to-end.
    expect(
      sanitizeBatchEntryName("第1页-图片.jpg", "fallback"),
    ).toBe("第1页-图片.jpg");
  });

  it("replaces unsafe characters and falls back only when nothing remains", () => {
    // Symbols and emoji are still neutralised…
    expect(sanitizeBatchEntryName("😀😀😀", "fallback.pdf")).toBe("___");
    expect(sanitizeBatchEntryName("***", "fallback.pdf")).toBe("___");
    // …and the fallback applies to names that sanitise to nothing usable.
    expect(sanitizeBatchEntryName("...", "fallback.pdf")).toBe("fallback.pdf");
  });

  it("caps the length of a huge filename", () => {
    const huge = `${"a".repeat(600)}.pdf`;
    const sanitized = sanitizeBatchEntryName(huge, "fallback");
    expect(sanitized.length).toBeLessThanOrEqual(120);
  });

  it("rejects archive results with an excessive number of entries", async () => {
    // A hostile/malformed archive response with 2,001 tiny entries must fail
    // loudly instead of being unpacked into the batch ZIP.
    const bomb: Record<string, Uint8Array> = {};
    for (let i = 0; i < 2_001; i += 1) {
      bomb[`entry-${i}.bin`] = new Uint8Array(1);
    }
    const inner = zipBlob(bomb);

    await expect(
      buildBatchEntries(
        [{ sourceName: "doc.pdf", resultName: "doc.zip", blob: inner }],
        true,
      ),
    ).rejects.toThrow(/too many entries/i);
  });

  it("accepts archive results within the per-archive entry cap", async () => {
    const many: Record<string, Uint8Array> = {};
    for (let i = 0; i < 200; i += 1) {
      many[`img-${i}.jpg`] = new Uint8Array(2);
    }
    const inner = zipBlob(many);

    const entries = await buildBatchEntries(
      [{ sourceName: "doc.pdf", resultName: "doc.zip", blob: inner }],
      true,
    );
    expect(Object.keys(entries.files)).toHaveLength(200);
  });

  it("rejects batches whose total entry count exceeds the batch cap", async () => {
    // 13 archives × 2,000 entries = 26,000 > 25,000 total cap.
    const makeInner = (n: number) => {
      const files: Record<string, Uint8Array> = {};
      for (let i = 0; i < n; i += 1) files[`img-${i}.jpg`] = new Uint8Array(1);
      return zipBlob(files);
    };
    const results = Array.from({ length: 13 }, (_, i) => ({
      sourceName: `doc-${i}.pdf`,
      resultName: `doc-${i}.zip`,
      blob: makeInner(2_000),
    }));

    await expect(buildBatchEntries(results, true)).rejects.toThrow(
      /too many result entries/i,
    );
  });
});
