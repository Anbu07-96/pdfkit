// @vitest-environment node
import { PDFDocument, StandardFonts } from "pdf-lib";
import { unzipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/tools/pdf-to-word/route";
import {
  makeBrokenPdf,
  makeColouredPdf,
  makeNumberedPdf,
} from "@/test/pdf-fixtures";

const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function call(files: File[]) {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  return POST(
    new Request("http://localhost/api/tools/pdf-to-word", {
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

describe("POST /api/tools/pdf-to-word", () => {
  it("returns a valid text-only DOCX with the standard headers", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    document.addPage([595, 842]).drawText("Exported sentence", { x: 40, y: 780, size: 12, font });
    const bytes = await document.save();
    const response = await call([
      new File([bytes as BlobPart], "report.pdf", { type: "application/pdf" }),
    ]);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(DOCX_TYPE);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="report.docx"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-pdfkit-pages")).toBe("1");
    expect(response.headers.get("x-pdfkit-output-pages")).toBe("1");
    expect(response.headers.get("x-pdfkit-artifacts")).toBe("1");
    expect(response.headers.get("x-pdfkit-mode")).toBe("text-only");

    const characters = Number(response.headers.get("x-pdfkit-characters"));
    expect(characters).toBeGreaterThan(0);
    expect(Number(response.headers.get("x-pdfkit-paragraphs"))).toBe(1);

    const out = new Uint8Array(await response.arrayBuffer());
    expect(out[0]).toBe(0x50); // ZIP
    expect(out[1]).toBe(0x4b);
    const entries = unzipSync(out);
    expect(Object.keys(entries)).toContain("[Content_Types].xml");
    expect(new TextDecoder().decode(entries["word/document.xml"])).toContain(
      "Exported sentence",
    );
    // The reported byte count is the real response size.
    expect(Number(response.headers.get("content-length"))).toBe(out.length);
  });

  it("reports zero characters honestly for image-only PDFs", async () => {
    const bytes = await makeColouredPdf([[1, 2, 3]]);
    const response = await call([
      new File([bytes as BlobPart], "scan.pdf", { type: "application/pdf" }),
    ]);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-pdfkit-characters")).toBe("0");
  });

  it("rejects zero files", async () => {
    const response = await call([]);
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects two files", async () => {
    const response = await call([
      await pdfFile("a.pdf", 1),
      await pdfFile("b.pdf", 1),
    ]);
    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe("TOO_MANY_FILES");
  });

  it("rejects a malformed PDF", async () => {
    const response = await call([
      new File([makeBrokenPdf() as BlobPart], "broken.pdf", {
        type: "application/pdf",
      }),
    ]);
    expect(response.status).toBe(422);
    expect((await errorBody(response)).error.code).toBe("INVALID_PDF");
  });

  it("rejects a disguised non-PDF", async () => {
    const response = await call([
      new File(
        [new TextEncoder().encode("GIF89a no") as BlobPart],
        "doc.pdf",
        { type: "application/pdf" },
      ),
    ]);
    expect(response.status).toBe(422);
    expect((await errorBody(response)).error.code).toBe("INVALID_PDF");
  });

  it("rejects a PDF above the conversion page limit", async () => {
    vi.stubEnv("PDFKIT_CONVERSION_MAX_PAGES", "2");
    const response = await call([await pdfFile("long.pdf", 3)]);
    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe("TOO_MANY_OUTPUTS");
  });

  it("sanitises hostile filenames in the disposition header", async () => {
    const bytes = await makeNumberedPdf(1);
    const response = await call([
      new File([bytes as BlobPart], "..\\..\\payroll Ő.pdf", {
        type: "application/pdf",
      }),
    ]);
    expect(response.status).toBe(200);
    const disposition = response.headers.get("content-disposition") ?? "";
    expect(disposition).toContain(".docx");
    expect(disposition).not.toMatch(/\.\.|[^\u0000-\u00ff]/);
  });

  it("never leaks internals in errors", async () => {
    const response = await call([
      new File([makeBrokenPdf() as BlobPart], "b.pdf", {
        type: "application/pdf",
      }),
    ]);
    const text = JSON.stringify(await errorBody(response));
    expect(text).not.toMatch(/stack|at Object|node_modules|docx|\/home\//i);
  });

  it("rejects GET", () => {
    expect(GET().status).toBe(405);
  });
});
