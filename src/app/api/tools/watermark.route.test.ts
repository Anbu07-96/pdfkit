// @vitest-environment node
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi, afterEach } from "vitest";
import { GET, POST } from "@/app/api/tools/watermark/route";
import { makeBrokenPdf, makeNumberedPdf } from "@/test/pdf-fixtures";

async function call(
  files: File[],
  fields: Record<string, string> = {
    text: "CONFIDENTIAL",
    opacity: "50",
    rotation: "45",
    placement: "center",
    pages: "all",
  },
) {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return POST(
    new Request("http://localhost/api/tools/watermark", {
      method: "POST",
      body: form,
    }),
  );
}

async function pdfFile(name: string, pages: number): Promise<File> {
  const bytes = await makeNumberedPdf(pages);
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

describe("POST /api/tools/watermark", () => {
  it("returns the watermarked PDF with the standard headers", async () => {
    const response = await call([await pdfFile("invoice.pdf", 3)]);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="invoice-watermarked.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-pdfkit-pages")).toBe("3");
    expect(response.headers.get("x-pdfkit-output-pages")).toBe("3");
    expect(response.headers.get("x-pdfkit-watermarked-pages")).toBe("3");
    expect(response.headers.get("x-pdfkit-artifacts")).toBe("1");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBe(3);
    // Byte count is honest.
    expect(Number(response.headers.get("content-length"))).toBe(bytes.length);
  });

  it("reports the stamped count for page-limited stamps", async () => {
    const response = await call([await pdfFile("doc.pdf", 5)], {
      text: "DRAFT",
      opacity: "25",
      rotation: "-45",
      placement: "diagonal-tiled",
      pages: "last",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-pdfkit-watermarked-pages")).toBe("1");
    expect(response.headers.get("x-pdfkit-pages")).toBe("5");
  });

  it("rejects an invalid option with 400", async () => {
    const response = await call([await pdfFile("a.pdf", 1)], {
      text: "X", opacity: "33", rotation: "45", placement: "center", pages: "all",
    });
    expect(response.status).toBe(400);
    const body = await errorBody(response);
    expect(body.error.code).toBe("INVALID_WATERMARK_CONFIGURATION");
    expect(body.error.message).toMatch(/opacity/i);
  });

  it("rejects empty text", async () => {
    const response = await call([await pdfFile("a.pdf", 1)], {
      text: "", opacity: "50", rotation: "45", placement: "center", pages: "all",
    });
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe(
      "INVALID_WATERMARK_CONFIGURATION",
    );
  });

  it("rejects zero and multiple files", async () => {
    const none = await call([]);
    expect(none.status).toBe(400);
    expect((await errorBody(none)).error.code).toBe("VALIDATION_ERROR");

    const two = await call([await pdfFile("a.pdf", 1), await pdfFile("b.pdf", 1)]);
    expect(two.status).toBe(413);
    expect((await errorBody(two)).error.code).toBe("TOO_MANY_FILES");
  });

  it("rejects malformed and disguised PDFs", async () => {
    const broken = new File([makeBrokenPdf() as BlobPart], "broken.pdf", {
      type: "application/pdf",
    });
    const malformed = await call([broken]);
    expect(malformed.status).toBe(422);
    expect((await errorBody(malformed)).error.code).toBe("INVALID_PDF");

    const fake = new File(
      [new TextEncoder().encode("GIF89a no") as BlobPart],
      "doc.pdf",
      { type: "application/pdf" },
    );
    const disguised = await call([fake]);
    expect(disguised.status).toBe(422);
    expect((await errorBody(disguised)).error.code).toBe("INVALID_PDF");
  });

  it("sanitises hostile filenames in the disposition header", async () => {
    const bytes = await makeNumberedPdf(1);
    const hostile = new File([bytes as BlobPart], "..\\..\\payroll Ő.pdf", {
      type: "application/pdf",
    });
    const response = await call([hostile]);
    expect(response.status).toBe(200);
    const disposition = response.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("watermarked.pdf");
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

  it("rejects GET", () => {
    expect(GET().status).toBe(405);
  });
});
