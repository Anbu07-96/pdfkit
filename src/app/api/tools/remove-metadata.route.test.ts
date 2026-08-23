// @vitest-environment node
import { PDFDocument, PDFName } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/tools/remove-metadata/route";
import {
  makeBrokenPdf,
  makeNumberedPdf,
  pageWidths,
} from "@/test/pdf-fixtures";

async function call(files: File[]) {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  return POST(
    new Request("http://localhost/api/tools/remove-metadata", {
      method: "POST",
      body: form,
    }),
  );
}

async function pdfFile(
  name: string,
  metadata: { title?: string; author?: string; xmp?: boolean } = {},
): Promise<File> {
  const document = await PDFDocument.create();
  for (let page = 1; page <= 3; page += 1) document.addPage([300 + page, 200]);
  if (metadata.title !== undefined) document.setTitle(metadata.title);
  if (metadata.author !== undefined) document.setAuthor(metadata.author);
  if (metadata.xmp) {
    const stream = document.context.stream(new TextEncoder().encode("<x/>"), {
      Type: "Metadata",
      Subtype: "XML",
    });
    document.catalog.set(PDFName.of("Metadata"), document.context.register(stream));
  }
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

describe("POST /api/tools/remove-metadata", () => {
  it("removes metadata, preserves pages and returns the standard headers", async () => {
    const response = await call([
      await pdfFile("private.pdf", {
        title: "Secret Title",
        author: "Whistleblower",
        xmp: true,
      }),
    ]);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="private-metadata-removed.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-pdfkit-pages")).toBe("3");
    expect(response.headers.get("x-pdfkit-output-pages")).toBe("3");
    expect(response.headers.get("x-pdfkit-artifacts")).toBe("1");
    expect(response.headers.get("x-pdfkit-removed-fields")).toBe("3");
    expect(response.headers.get("x-pdfkit-xmp-removed")).toBe("yes");
    expect(response.headers.get("x-pdfkit-verification")).toBe("verified");

    const bytes = new Uint8Array(await response.arrayBuffer());
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(3);
    expect(pageWidths(reloaded)).toEqual([301, 302, 303]);
    expect(reloaded.getTitle()).toBeUndefined();
    expect(reloaded.getAuthor()).toBeUndefined();
    expect(reloaded.catalog.get(PDFName.of("Metadata"))).toBeUndefined();
  });

  it("rejects zero files", async () => {
    const response = await call([]);
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects multiple files", async () => {
    const response = await call([
      await pdfFile("a.pdf"),
      await pdfFile("b.pdf"),
    ]);
    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe("TOO_MANY_FILES");
  });

  it("rejects a malformed PDF", async () => {
    const broken = new File([makeBrokenPdf() as BlobPart], "broken.pdf", {
      type: "application/pdf",
    });
    const response = await call([broken]);
    expect(response.status).toBe(422);
    expect((await errorBody(response)).error.code).toBe("INVALID_PDF");
  });

  it("rejects a disguised non-PDF", async () => {
    const fake = new File(
      [new TextEncoder().encode("GIF89a no") as BlobPart],
      "doc.pdf",
      { type: "application/pdf" },
    );
    const response = await call([fake]);
    expect(response.status).toBe(422);
    expect((await errorBody(response)).error.code).toBe("INVALID_PDF");
  });

  it("sanitises hostile filenames in the disposition header", async () => {
    const response = await call([await pdfFile("../..\\payroll Ő.pdf")]);
    expect(response.status).toBe(200);
    const disposition = response.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("metadata-removed.pdf");
    expect(disposition).not.toMatch(/\.\.|[^\u0000-\u00ff]/);
  });

  it("never leaks internals in errors", async () => {
    const broken = new File([makeBrokenPdf() as BlobPart], "b.pdf", {
      type: "application/pdf",
    });
    const response = await call([broken]);
    const text = JSON.stringify(await errorBody(response));
    expect(text).not.toMatch(/stack|at Object|node_modules|pdf-lib|\/home\//i);
  });

  it("works on a PDF with no metadata at all", async () => {
    // makeNumberedPdf carries only pdf-lib's default Info stamps.
    const bytes = await makeNumberedPdf(2);
    const file = new File([bytes as BlobPart], "plain.pdf", {
      type: "application/pdf",
    });
    const response = await call([file]);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-pdfkit-verification")).toBe("verified");
    expect(response.headers.get("x-pdfkit-xmp-removed")).toBe("not-present");
  });

  it("rejects GET", () => {
    expect(GET().status).toBe(405);
  });
});
