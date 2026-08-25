// @vitest-environment node
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/tools/add-text/route";
import { extractPdfPageTexts } from "@/lib/thumbnails/renderer";
import { makeBrokenPdf, makeNumberedPdf } from "@/test/pdf-fixtures";

async function call(
  files: File[],
  fields: Record<string, string> = {
    text: "Checked 25 August",
    placement: "bottom-center",
    size: "12",
    pages: "all",
  },
) {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return POST(
    new Request("http://localhost/api/tools/add-text", {
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

describe("POST /api/tools/add-text", () => {
  it("returns the edited PDF with the standard headers and real text", async () => {
    const response = await call([await pdfFile("form.pdf", 2)]);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="form-text-added.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-pdfkit-pages")).toBe("2");
    expect(response.headers.get("x-pdfkit-output-pages")).toBe("2");
    expect(response.headers.get("x-pdfkit-text-pages")).toBe("2");
    expect(response.headers.get("x-pdfkit-artifacts")).toBe("1");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBe(2);
    // Byte count is honest.
    expect(Number(response.headers.get("content-length"))).toBe(bytes.length);

    // The text is really on the pages, as extractable vector text.
    const { texts } = await extractPdfPageTexts(bytes, { maxPages: 50 });
    for (const pageText of texts) {
      expect(pageText).toContain("Checked 25 August");
    }
  });

  it("reports the stamped count for page-limited requests", async () => {
    const response = await call([await pdfFile("doc.pdf", 5)], {
      text: "COPY",
      placement: "center",
      size: "24",
      pages: "first",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-pdfkit-text-pages")).toBe("1");
    expect(response.headers.get("x-pdfkit-pages")).toBe("5");
  });

  it("rejects an invalid option with 400", async () => {
    const response = await call([await pdfFile("doc.pdf", 1)], {
      text: "",
      placement: "center",
      size: "12",
      pages: "all",
    });
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe(
      "INVALID_TEXT_CONFIGURATION",
    );
  });

  it("rejects text the standard font cannot encode with a clear message", async () => {
    const response = await call([await pdfFile("doc.pdf", 1)], {
      text: "机密",
      placement: "center",
      size: "12",
      pages: "all",
    });
    expect(response.status).toBe(400);
    const body = await errorBody(response);
    expect(body.error.code).toBe("INVALID_TEXT_CONFIGURATION");
    expect(body.error.message).toMatch(/standard Latin characters/i);
  });

  it("reports a broken PDF with 422", async () => {
    const broken = new File([makeBrokenPdf() as BlobPart], "broken.pdf", {
      type: "application/pdf",
    });
    const response = await call([broken]);
    expect(response.status).toBe(422);
    expect((await errorBody(response)).error.code).toBe("INVALID_PDF");
  });
});

describe("GET /api/tools/add-text", () => {
  it("explains that only POST exists", () => {
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});
