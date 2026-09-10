// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { encryptPDF } from "@pdfsmaller/pdf-encrypt-lite";
import {
  buildDocumentProfile,
  createLazyDocumentProfile,
  describeInputFile,
  detectDocumentKind,
  PROFILE_VERSION,
} from "@/lib/engines/profile";
import { extractPdfPageTexts } from "@/lib/thumbnails/renderer";
import {
  makeBrokenPdf,
  makeJpeg,
  makeNonPdf,
  makePdf,
  makePng,
  makeScannedPdf,
} from "@/test/pdf-fixtures";

// The lazy-profile test needs to observe pdfium work, so the text-extraction
// entry point is wrapped in a spy that still delegates to the real one.
vi.mock("@/lib/thumbnails/renderer", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/thumbnails/renderer")>();
  return { ...actual, extractPdfPageTexts: vi.fn(actual.extractPdfPageTexts) };
});

function inputFile(
  bytes: Uint8Array,
  mimeType = "application/pdf",
): { mimeType: string; size: number; bytes: Uint8Array } {
  return { mimeType, size: bytes.length, bytes };
}

/** A PDF whose page 1 is blank (no operators) and page 2 has text. */
async function makeBlankAndTextPdf(): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([300, 300]); // page 1: truly blank
  const page2 = document.addPage([300, 300]);
  page2.drawText("real text", { x: 20, y: 150, size: 24, font });
  return document.save();
}

/** A PDF with one text page and one image-only page. */
async function makeMixedPdf(): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page1 = document.addPage([300, 300]);
  page1.drawText("text page", { x: 20, y: 150, size: 24, font });
  const image = await document.embedJpg(await makeJpeg(24, 24));
  const page2 = document.addPage([300, 300]);
  page2.drawImage(image, { x: 0, y: 0, width: 300, height: 300 });
  return document.save();
}

describe("DocumentProfile — signature tier (describeInputFile)", () => {
  it("describes a PDF from its signature, size and MIME only", async () => {
    const bytes = await makePdf(["Hello"]);
    const profile = describeInputFile(inputFile(bytes));

    expect(profile).toEqual({
      profileVersion: PROFILE_VERSION,
      documentKind: "pdf",
      fileSizeBytes: bytes.length,
      inputMimeType: "application/pdf",
      analysisState: "signature-only",
    });
  });

  it("recognises JPEG and PNG inputs by their real bytes", async () => {
    const jpeg = await makeJpeg(10, 10);
    const png = await makePng(10, 10);
    expect(describeInputFile(inputFile(jpeg, "image/jpeg"))?.documentKind).toBe("jpeg");
    expect(describeInputFile(inputFile(png, "image/png"))?.documentKind).toBe("png");
  });

  it("reports unknown for bytes that are neither PDF nor JPEG/PNG", () => {
    expect(describeInputFile(inputFile(makeNonPdf()))?.documentKind).toBe("unknown");
    expect(describeInputFile(inputFile(new Uint8Array()))?.documentKind).toBe("unknown");
  });

  it("returns undefined when there is no file at all", () => {
    expect(describeInputFile(undefined)).toBeUndefined();
  });

  it("performs no parsing: a broken PDF is still classified by signature", () => {
    // A full parse of these bytes fails; the signature tier must not care.
    const profile = describeInputFile(inputFile(makeBrokenPdf()));
    expect(profile?.documentKind).toBe("pdf");
    expect(profile?.analysisState).toBe("signature-only");
  });

  it("detects kinds by bytes, whatever the client claims", () => {
    expect(detectDocumentKind(makeNonPdf())).toBe("unknown");
    expect(detectDocumentKind(new TextEncoder().encode("PK not a pdf"))).toBe("unknown");
  });
});

describe("DocumentProfile — full tier (buildDocumentProfile)", () => {
  it("profiles a text PDF completely", async () => {
    const bytes = await makePdf(["Alpha", "Beta"]);
    const profile = await buildDocumentProfile(inputFile(bytes));

    expect(profile.analysisState).toBe("complete");
    expect(profile.encrypted).toBe(false);
    expect(profile.pageCount).toBe(2);
    expect(profile.textPageCount).toBe(2);
    expect(profile.emptyTextPageCount).toBe(0);
    expect(profile.textCharacterCount).toBeGreaterThan(0);
    expect(profile.textYieldRatio).toBe(1);
    expect(profile.imageObjectCount).toBe(0);
    expect(profile.imageBearingPageCount).toBe(0);
    expect(profile.likelyScannedPageCount).toBe(0);
    expect(profile.likelyScannedRatio).toBe(0);
  });

  it("measures a mixed text/image document page by page", async () => {
    const profile = await buildDocumentProfile(inputFile(await makeMixedPdf()));

    expect(profile.pageCount).toBe(2);
    expect(profile.textPageCount).toBe(1);
    expect(profile.emptyTextPageCount).toBe(1);
    expect(profile.textYieldRatio).toBe(0.5);
    expect(profile.imageObjectCount).toBe(1);
    expect(profile.imageBearingPageCount).toBe(1);
    // The image page has no text AND an image object — "likely scanned".
    expect(profile.likelyScannedPageCount).toBe(1);
    expect(profile.likelyScannedRatio).toBe(0.5);
  });

  it("treats a scanned-style document as likely scanned on every page", async () => {
    const profile = await buildDocumentProfile(
      inputFile(await makeScannedPdf(2)),
    );

    expect(profile.textPageCount).toBe(0);
    expect(profile.emptyTextPageCount).toBe(2);
    expect(profile.textYieldRatio).toBe(0);
    expect(profile.imageObjectCount).toBeGreaterThanOrEqual(2);
    expect(profile.likelyScannedPageCount).toBe(2);
    expect(profile.likelyScannedRatio).toBe(1);
  });

  it("does NOT call a blank page scanned: no text without images is not evidence", async () => {
    const profile = await buildDocumentProfile(
      inputFile(await makeBlankAndTextPdf()),
    );

    expect(profile.emptyTextPageCount).toBe(1);
    expect(profile.imageObjectCount).toBe(0);
    expect(profile.likelyScannedPageCount).toBe(0);
    expect(profile.likelyScannedRatio).toBe(0);
  });

  it("reads dimensions for image inputs", async () => {
    const jpeg = await makeJpeg(32, 20);
    const profile = await buildDocumentProfile(inputFile(jpeg, "image/jpeg"));
    expect(profile).toMatchObject({
      documentKind: "jpeg",
      analysisState: "complete",
      imageWidth: 32,
      imageHeight: 20,
    });
  });

  it("reports an encrypted PDF as encrypted, without content signals", async () => {
    const encrypted = await encryptPDF(await makePdf(["locked"]), "secret");
    const profile = await buildDocumentProfile(inputFile(encrypted));

    expect(profile.analysisState).toBe("encrypted-input");
    expect(profile.encrypted).toBe(true);
    expect(profile.pageCount).toBeUndefined();
    expect(profile.textPageCount).toBeUndefined();
  });

  it("reports unreadable for bytes that claim to be a PDF but are not", async () => {
    const profile = await buildDocumentProfile(inputFile(makeBrokenPdf()));
    expect(profile.analysisState).toBe("unreadable-input");
    expect(profile.pageCount).toBeUndefined();
  });

  it("stays at signature-only depth for non-document bytes", async () => {
    const profile = await buildDocumentProfile(inputFile(makeNonPdf()));
    expect(profile).toMatchObject({
      documentKind: "unknown",
      analysisState: "signature-only",
    });
  });

  it("marks text signals as text-limited above the profiling page cap", async () => {
    const bytes = await makePdf(["one", "two", "three"]);
    const profile = await buildDocumentProfile(inputFile(bytes), {
      maxTextPages: 2,
    });

    expect(profile.analysisState).toBe("text-limited");
    expect(profile.pageCount).toBe(3); // still known from the structural pass
    expect(profile.textPageCount).toBeUndefined();
    expect(profile.textYieldRatio).toBeUndefined();
  });

  it("can skip the text pass entirely", async () => {
    const profile = await buildDocumentProfile(
      inputFile(await makePdf(["Alpha"])),
      { includeTextSignals: false },
    );

    expect(profile.analysisState).toBe("complete");
    expect(profile.pageCount).toBe(1);
    expect(profile.textPageCount).toBeUndefined();
    expect(profile.likelyScannedPageCount).toBeUndefined();
  });
});

describe("DocumentProfile — lazy resolution", () => {
  it("does no pdfium work until resolve() is called, then exactly once", async () => {
    const spy = vi.mocked(extractPdfPageTexts);
    spy.mockClear();

    const bytes = await makePdf(["lazy"]);
    const lazy = createLazyDocumentProfile(inputFile(bytes));
    expect(lazy.isRequested()).toBe(false);
    expect(spy).not.toHaveBeenCalled();

    const first = await lazy.resolve();
    expect(lazy.isRequested()).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(first.analysisState).toBe("complete");

    // Second resolve: memoized — the pdfium pass must not run again.
    const second = await lazy.resolve();
    expect(second).toBe(first);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("DocumentProfile — privacy", () => {
  it("carries counts and ratios only, never document content", async () => {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const page = document.addPage([300, 300]);
    page.drawText("John Smith, 123 Main Street, invoice #42", {
      x: 20,
      y: 150,
      size: 12,
      font,
    });

    const full = await buildDocumentProfile(inputFile(await document.save()));
    const serialised = JSON.stringify({ ...full, ...describeInputFile(inputFile(await document.save())) });

    expect(serialised).not.toContain("John Smith");
    expect(serialised).not.toContain("Main Street");
    expect(serialised).not.toContain("invoice");
    expect(full.textCharacterCount).toBeGreaterThan(0);
  });
});
