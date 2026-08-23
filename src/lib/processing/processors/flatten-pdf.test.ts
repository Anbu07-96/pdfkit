// @vitest-environment node
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRef,
  StandardFonts,
  degrees,
} from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type { ProcessingInputFile } from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { flattenPdfProcessor } from "@/lib/processing/processors/flatten-pdf";
import { runProcessingJob } from "@/lib/processing/service";
import {
  makeBrokenPdf,
  makeFormPdf,
  makeNumberedPdf,
  makeSignedFormPdf,
} from "@/test/pdf-fixtures";

async function input(name: string, bytes: Uint8Array): Promise<ProcessingInputFile> {
  return {
    id: "input-1",
    name,
    size: bytes.length,
    mimeType: "application/pdf",
    bytes,
  };
}

async function flatten(name: string, bytes: Uint8Array) {
  return flattenPdfProcessor.process({
    toolId: "flatten-pdf",
    files: [await input(name, bytes)],
  });
}

async function expectFailure(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProcessingError);
    expect((error as ProcessingError).code).toBe(code);
    return error as ProcessingError;
  }
  throw new Error(`Expected a ${code} ProcessingError, but the call succeeded.`);
}

async function extractText(bytes: Uint8Array, pageIndex = 0): Promise<string> {
  const { PDFiumLibrary } = await import("@hyzyla/pdfium");
  const library = await PDFiumLibrary.init();
  const pdf = await library.loadDocument(bytes);
  const text = pdf.getPage(pageIndex).getText();
  pdf.destroy();
  return text;
}

/** Count entries in a page's /Annots and how many of them resolve. */
function annotationFacts(document: PDFDocument, pageIndex: number) {
  const annots = document.getPage(pageIndex).node.lookup(PDFName.of("Annots"));
  if (!(annots instanceof PDFArray)) return { entries: 0, resolvable: 0, links: 0 };
  let resolvable = 0;
  let links = 0;
  for (let index = 0; index < annots.size(); index += 1) {
    const entry = annots.get(index);
    const resolved =
      entry instanceof PDFRef ? document.context.lookup(entry) : entry;
    if (resolved === undefined) continue;
    resolvable += 1;
    const subtype =
      resolved instanceof Object && "lookup" in resolved
        ? (resolved as { lookup: (name: unknown) => unknown }).lookup(
            PDFName.of("Subtype"),
          )
        : undefined;
    if (subtype === PDFName.of("Link")) links += 1;
  }
  return { entries: annots.size(), resolvable, links };
}

describe("FlattenPdfProcessor", () => {
  it("declares the tool id and single-file input rules", () => {
    expect(flattenPdfProcessor.toolId).toBe("flatten-pdf");
    expect(flattenPdfProcessor.input.minFiles).toBe(1);
    expect(flattenPdfProcessor.input.maxFiles).toBe(1);
    expect(flattenPdfProcessor.input.extensions).toEqual([".pdf"]);
  });

  it("flattens text field, checkbox, radio group, dropdown and option list", async () => {
    const result = await flatten("form.pdf", await makeFormPdf());

    const artifact = result.artifacts[0];
    expect(artifact.name).toBe("flattened.pdf"); // fixed name, no source filename
    expect(artifact.mimeType).toBe("application/pdf");
    expect(new TextDecoder().decode(artifact.bytes.slice(0, 5))).toBe("%PDF-");
    // 5 fields per page: text, checkbox, radio group, dropdown, option list.
    expect(result.meta).toMatchObject({
      pages: 1,
      outputPages: 1,
      flattenedFields: 5,
    });

    const output = await PDFDocument.load(artifact.bytes);
    expect(output.getPageCount()).toBe(1);
    // No form remains: the AcroForm dictionary is gone entirely.
    expect(output.catalog.get(PDFName.of("AcroForm"))).toBeUndefined();
  });

  it("makes field values extractable, static page content", async () => {
    const result = await flatten(
      "form.pdf",
      await makeFormPdf({ textValue: "Alice Example" }),
    );
    const text = await extractText(result.artifacts[0].bytes);

    // The text field's value and the dropdown/option list selections are now
    // ordinary page text — selectable and extractable, not rasterised.
    expect(text).toContain("Alice Example");
    expect(text).toContain("Paris");
    expect(text).toContain("dog");
    // Static page content survives untouched.
    expect(text).toContain("STATIC-1");
  });

  it("supports Unicode field values", async () => {
    const result = await flatten(
      "u.pdf",
      await makeFormPdf({ textValue: "café Ünïcode" }),
    );
    expect(await extractText(result.artifacts[0].bytes)).toContain("café Ünïcode");
  });

  it("flattens empty fields without inventing content", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const page = document.addPage([300, 300]);
    page.drawText("KEEP-ME", { x: 20, y: 260, size: 12, font });
    const form = document.getForm();
    const text = form.createTextField("empty");
    text.addToPage(page, { x: 20, y: 100, width: 150, height: 20, font });
    const checkbox = form.createCheckBox("unchecked");
    checkbox.addToPage(page, { x: 20, y: 60, width: 18, height: 18 });

    const result = await flatten("empty.pdf", await document.save());
    expect(result.meta).toMatchObject({ flattenedFields: 2 });

    const output = await PDFDocument.load(result.artifacts[0].bytes);
    expect(output.catalog.get(PDFName.of("AcroForm"))).toBeUndefined();
    expect(await extractText(result.artifacts[0].bytes)).toContain("KEEP-ME");
  });

  it("flattens fields across multiple pages and keeps count and order", async () => {
    const result = await flatten("multi.pdf", await makeFormPdf({ pages: 3 }));
    expect(result.meta).toMatchObject({
      pages: 3,
      outputPages: 3,
      flattenedFields: 15,
    });

    const output = await PDFDocument.load(result.artifacts[0].bytes);
    expect(output.getPageCount()).toBe(3);
    // Page order preserved: the per-page static markers are still in order.
    for (let index = 0; index < 3; index += 1) {
      expect(await extractText(result.artifacts[0].bytes, index)).toContain(
        `STATIC-${index + 1}`,
      );
    }
  });

  it("preserves page rotation and flattens fields on rotated pages", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const page = document.addPage([300, 400]);
    page.setRotation(degrees(90));
    const form = document.getForm();
    const field = form.createTextField("rot");
    field.setText("Rotated value");
    field.addToPage(page, { x: 20, y: 200, width: 150, height: 20, font });

    const result = await flatten("rot.pdf", await document.save());
    const output = await PDFDocument.load(result.artifacts[0].bytes);
    expect(output.getPage(0).getRotation().angle).toBe(90);
    expect(output.getPage(0).getMediaBox()).toEqual({ x: 0, y: 0, width: 300, height: 400 });
    expect(await extractText(result.artifacts[0].bytes)).toContain("Rotated value");
  });

  it("preserves valid link annotations while removing dangling widget refs", async () => {
    const result = await flatten("form.pdf", await makeFormPdf());
    const output = await PDFDocument.load(result.artifacts[0].bytes);

    const facts = annotationFacts(output, 0);
    // The link survives; every remaining entry resolves — no dangling refs.
    expect(facts.links).toBe(1);
    expect(facts.resolvable).toBe(facts.entries);
    expect(facts.entries).toBeGreaterThan(0);
  });

  it("CLEANUP PROOF: pdf-lib's stale widget references are really removed", async () => {
    // Reproduce the raw pdf-lib behaviour first, so this test fails loudly if
    // a future pdf-lib version changes and the cleanup becomes wrong.
    const bytes = await makeFormPdf();
    const raw = await PDFDocument.load(bytes);
    raw.getForm().flatten();
    const rawFacts = annotationFacts(raw, 0);
    expect(rawFacts.entries).toBeGreaterThan(rawFacts.resolvable); // the bug

    // The processor's output has no such stale references.
    const result = await flatten("form.pdf", bytes);
    const output = await PDFDocument.load(result.artifacts[0].bytes);
    const cleanFacts = annotationFacts(output, 0);
    expect(cleanFacts.entries).toBe(cleanFacts.resolvable);
    expect(cleanFacts.links).toBe(1);
  });

  it("drops the /Annots key entirely when only stale widgets remain", async () => {
    // A single text field and no other annotations: after cleanup the page
    // must not carry an empty (or dangling) /Annots array.
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const page = document.addPage([300, 300]);
    const field = document.getForm().createTextField("only");
    field.setText("value");
    field.addToPage(page, { x: 20, y: 100, width: 150, height: 20, font });

    const result = await flatten("one.pdf", await document.save());
    const output = await PDFDocument.load(result.artifacts[0].bytes);
    expect(output.getPage(0).node.lookup(PDFName.of("Annots"))).toBeUndefined();
  });

  it("removes the empty AcroForm dictionary from a form-free result", async () => {
    const result = await flatten("form.pdf", await makeFormPdf());
    const output = await PDFDocument.load(result.artifacts[0].bytes);
    expect(output.catalog.get(PDFName.of("AcroForm"))).toBeUndefined();
  });

  it("passes a PDF without any form through with zero flattened fields", async () => {
    const bytes = await makeNumberedPdf(2);
    const result = await flatten("plain.pdf", bytes);
    expect(result.meta).toMatchObject({
      pages: 2,
      outputPages: 2,
      flattenedFields: 0,
    });
    // No AcroForm is fabricated for form-free documents.
    const output = await PDFDocument.load(result.artifacts[0].bytes);
    expect(output.catalog.get(PDFName.of("AcroForm"))).toBeUndefined();
  });

  it("rejects signed PDFs with SIGNED_PDF before mutating anything", async () => {
    const error = await expectFailure(
      flatten("signed.pdf", await makeSignedFormPdf()),
      "SIGNED_PDF",
    );
    expect(error.status).toBe(422);
    expect(error.message).toMatch(/signature/i);
    expect(error.details?.join(" ")).toMatch(/invalidate/i);
  });

  it("rejects documents whose AcroForm SigFlags declare signatures", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const page = document.addPage([300, 300]);
    const field = document.getForm().createTextField("name");
    field.setText("x");
    field.addToPage(page, { x: 20, y: 100, width: 100, height: 20, font });
    // SigFlags bit 1: "the document contains at least one signature field".
    document.getForm().acroForm.dict.set(
      PDFName.of("SigFlags"),
      document.context.obj(1),
    );

    await expectFailure(flatten("sigflags.pdf", await document.save()), "SIGNED_PDF");
  });

  it("HONESTY PROOF: document-level JavaScript survives flattening", async () => {
    // Flattening removes form fields only. Document scripts (OpenAction /
    // JavaScript) are NOT removed — the tool states this everywhere, and this
    // test pins the behaviour so the claim stays true.
    const { PDFString } = await import("pdf-lib");
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const page = document.addPage([300, 300]);
    const field = document.getForm().createTextField("name");
    field.setText("value");
    field.addToPage(page, { x: 20, y: 100, width: 150, height: 20, font });
    const action = document.context.register(
      document.context.obj({
        Type: "Action",
        S: "JavaScript",
        JS: PDFString.of("app.alert('still here')"),
      }),
    );
    document.catalog.set(PDFName.of("OpenAction"), action);

    const result = await flatten("js.pdf", await document.save());
    expect(result.meta).toMatchObject({ flattenedFields: 1 });

    const output = await PDFDocument.load(result.artifacts[0].bytes);
    // Fields are gone…
    expect(output.catalog.get(PDFName.of("AcroForm"))).toBeUndefined();
    // …but the document-level script is still there, exactly as documented.
    const openAction = output.catalog.lookup(PDFName.of("OpenAction"));
    expect(openAction).toBeDefined();
  });

  it("rejects malformed PDFs", async () => {
    await expectFailure(flatten("broken.pdf", makeBrokenPdf()), "INVALID_PDF");
  });

  it("rejects encrypted PDFs", async () => {
    const { EncryptedPDFError } = await import("pdf-lib");
    const spy = vi
      .spyOn(PDFDocument, "load")
      .mockRejectedValueOnce(new EncryptedPDFError());
    try {
      await expectFailure(
        flatten("locked.pdf", await makeFormPdf()),
        "ENCRYPTED_PDF",
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("uses the fixed output name even for hostile source filenames", async () => {
    const result = await flatten('../..\\evil" Ő.pdf', await makeFormPdf());
    expect(result.artifacts[0].name).toBe("flattened.pdf");
  });

  it("never mutates the input bytes", async () => {
    const bytes = await makeFormPdf();
    const copy = bytes.slice();
    await flatten("form.pdf", bytes);
    expect(bytes).toEqual(copy);
  });

  it("rejects multiple files at the service layer", async () => {
    const bytes = await makeFormPdf();
    const result = await runProcessingJob({
      toolId: "flatten-pdf",
      files: [await input("a.pdf", bytes), await input("b.pdf", bytes.slice())],
    });
    expect(result).toMatchObject({
      status: "failed",
      error: { code: "TOO_MANY_FILES" },
    });
  });

  it("runs end-to-end through the processing service", async () => {
    const result = await runProcessingJob({
      toolId: "flatten-pdf",
      files: [await input("form.pdf", await makeFormPdf())],
    });
    expect(result.status).toBe("succeeded");
    if (result.status === "succeeded") {
      expect(result.meta).toMatchObject({ flattenedFields: 5 });
    }
  });
});
