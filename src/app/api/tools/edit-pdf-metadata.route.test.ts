// @vitest-environment node
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/tools/edit-pdf-metadata/route";
import { readDocumentMetadata } from "@/lib/processing/inspect";
import { makeBrokenPdf, pageWidths } from "@/test/pdf-fixtures";

async function call(
  options: {
    files?: File[];
    fields?: Record<string, string>;
  } = {},
) {
  const form = new FormData();
  for (const file of options.files ?? []) form.append("files", file, file.name);
  for (const [key, value] of Object.entries(options.fields ?? {})) {
    form.append(key, value);
  }
  return POST(
    new Request("http://localhost/api/tools/edit-pdf-metadata", {
      method: "POST",
      body: form,
    }),
  );
}

async function pdfFile(
  name: string,
  pages: number,
  metadata: { title?: string; author?: string } = {},
): Promise<File> {
  const document = await PDFDocument.create();
  for (let page = 1; page <= pages; page += 1) document.addPage([300 + page, 200]);
  if (metadata.title !== undefined) document.setTitle(metadata.title);
  if (metadata.author !== undefined) document.setAuthor(metadata.author);
  const bytes = await document.save();
  return new File([bytes as BlobPart], name, { type: "application/pdf" });
}

async function errorBody(response: Response) {
  return (await response.json()) as {
    error: { code: string; message: string; details?: string[] };
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/tools/edit-pdf-metadata", () => {
  it("edits metadata and returns the standard PDF headers", async () => {
    const response = await call({
      files: [await pdfFile("invoice.pdf", 4)],
      fields: { title: "New Title", author: "New Author", keywords: "a, b" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="invoice-metadata.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-pdfkit-pages")).toBe("4");
    expect(response.headers.get("x-pdfkit-output-pages")).toBe("4");
    expect(response.headers.get("x-pdfkit-artifacts")).toBe("1");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(4);
    expect(pageWidths(reloaded)).toEqual([301, 302, 303, 304]);

    const metadata = readDocumentMetadata(reloaded);
    expect(metadata.title).toBe("New Title");
    expect(metadata.author).toBe("New Author");
    expect(metadata.keywords).toEqual(["a", "b"]);
  });

  it("clears fields sent as empty strings", async () => {
    const response = await call({
      files: [await pdfFile("doc.pdf", 2, { title: "Keep?", author: "Me" })],
      fields: { title: "", author: "" },
    });
    const metadata = readDocumentMetadata(
      await PDFDocument.load(new Uint8Array(await response.arrayBuffer())),
    );
    expect(metadata.title).toBeNull();
    expect(metadata.author).toBeNull();
  });

  it("leaves absent fields unchanged", async () => {
    const response = await call({
      files: [await pdfFile("doc.pdf", 2, { title: "Original" })],
      fields: { subject: "New Subject" },
    });
    const metadata = readDocumentMetadata(
      await PDFDocument.load(new Uint8Array(await response.arrayBuffer())),
    );
    expect(metadata.title).toBe("Original");
    expect(metadata.subject).toBe("New Subject");
  });

  it("rejects an invalid field value with 400", async () => {
    const response = await call({
      files: [await pdfFile("a.pdf", 1)],
      fields: { title: "x".repeat(2001) },
    });
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects zero files", async () => {
    const response = await call({ fields: { title: "x" } });
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects two files", async () => {
    const response = await call({
      files: [await pdfFile("a.pdf", 1), await pdfFile("b.pdf", 1)],
    });
    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe("TOO_MANY_FILES");
  });

  it("rejects a malformed PDF", async () => {
    const broken = new File([makeBrokenPdf() as BlobPart], "broken.pdf", {
      type: "application/pdf",
    });
    const response = await call({ files: [broken] });
    expect(response.status).toBe(422);
    expect((await errorBody(response)).error.code).toBe("INVALID_PDF");
  });

  it("rejects a disguised non-PDF", async () => {
    const fake = new File(
      [new TextEncoder().encode("GIF89a nope") as BlobPart],
      "doc.pdf",
      { type: "application/pdf" },
    );
    const response = await call({ files: [fake] });
    expect(response.status).toBe(422);
    expect((await errorBody(response)).error.code).toBe("INVALID_PDF");
  });

  it("sanitises hostile filenames in the disposition header", async () => {
    const file = await pdfFile("../../final report.pdf", 1);
    const response = await call({ files: [file], fields: { title: "x" } });
    expect(response.status).toBe(200);
    const disposition = response.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("metadata.pdf");
    expect(disposition).not.toMatch(/\.\.|\/|\\\\/);
  });

  it("never leaks internals in errors", async () => {
    const broken = new File([makeBrokenPdf() as BlobPart], "b.pdf", {
      type: "application/pdf",
    });
    const response = await call({ files: [broken] });
    const text = JSON.stringify(await errorBody(response));
    expect(text).not.toMatch(/stack|at Object|node_modules|pdf-lib|\/home\//i);
  });

  it("rejects GET", () => {
    expect(GET().status).toBe(405);
  });
});
