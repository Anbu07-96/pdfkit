// @vitest-environment node
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createZipArchive, sanitizeZipEntryName } from "@/lib/processing/zip";

const bytes = (value: string) => new TextEncoder().encode(value);

describe("sanitizeZipEntryName", () => {
  it("keeps ordinary names", () => {
    expect(sanitizeZipEntryName("report-1.pdf", "fallback.pdf")).toBe("report-1.pdf");
  });

  it("strips directories and traversal", () => {
    expect(sanitizeZipEntryName("../../etc/passwd", "f.pdf")).toBe("passwd");
    expect(sanitizeZipEntryName("../file.pdf", "f.pdf")).toBe("file.pdf");
    expect(sanitizeZipEntryName("a/b/c.pdf", "f.pdf")).toBe("c.pdf");
    expect(sanitizeZipEntryName("C:\\server\\file.pdf", "f.pdf")).toBe("file.pdf");
  });

  it("removes control characters and leading dots", () => {
    expect(sanitizeZipEntryName("bad\u0000name.pdf", "f.pdf")).toBe("badname.pdf");
    expect(sanitizeZipEntryName("...hidden.pdf", "f.pdf")).toBe("hidden.pdf");
  });

  it("falls back when nothing usable remains", () => {
    expect(sanitizeZipEntryName("", "fallback.pdf")).toBe("fallback.pdf");
    expect(sanitizeZipEntryName("..", "fallback.pdf")).toBe("fallback.pdf");
    expect(sanitizeZipEntryName("/", "fallback.pdf")).toBe("fallback.pdf");
  });
});

describe("createZipArchive", () => {
  it("produces an archive containing every entry", () => {
    const archive = createZipArchive([
      { name: "one.pdf", bytes: bytes("first") },
      { name: "two.pdf", bytes: bytes("second") },
    ]);

    const extracted = unzipSync(archive);
    expect(Object.keys(extracted).sort()).toEqual(["one.pdf", "two.pdf"]);
    expect(new TextDecoder().decode(extracted["one.pdf"])).toBe("first");
  });

  it("never writes a path into the archive", () => {
    const archive = createZipArchive([
      { name: "../../escape.pdf", bytes: bytes("x") },
      { name: "C:\\windows\\system.pdf", bytes: bytes("y") },
    ]);

    const names = Object.keys(unzipSync(archive));
    expect(names).toEqual(["escape.pdf", "system.pdf"]);
    for (const name of names) {
      expect(name).not.toContain("/");
      expect(name).not.toContain("\\");
      expect(name).not.toContain("..");
    }
  });

  it("de-duplicates entry names instead of overwriting", () => {
    const archive = createZipArchive([
      { name: "same.pdf", bytes: bytes("a") },
      { name: "same.pdf", bytes: bytes("b") },
      { name: "same.pdf", bytes: bytes("c") },
    ]);

    const extracted = unzipSync(archive);
    expect(Object.keys(extracted).sort()).toEqual(["same-2.pdf", "same-3.pdf", "same.pdf"]);
    expect(new TextDecoder().decode(extracted["same.pdf"])).toBe("a");
    expect(new TextDecoder().decode(extracted["same-2.pdf"])).toBe("b");
  });

  it("refuses to build an empty archive", () => {
    expect(() => createZipArchive([])).toThrowError(/No documents were produced/);
  });
});
