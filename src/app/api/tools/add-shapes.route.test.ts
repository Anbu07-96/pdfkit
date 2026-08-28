// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { GET, POST } from "@/app/api/tools/add-shapes/route";
import { makeBrokenPdf, makeNumberedPdf } from "@/test/pdf-fixtures";

async function call(files: File[], fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return POST(
    new Request("http://localhost/api/tools/add-shapes", {
      method: "POST",
      body: form,
    }),
  );
}

async function errorBody(response: Response) {
  return (await response.json()) as {
    error: { code: string; message: string; details?: string[] };
  };
}

describe("POST /api/tools/add-shapes", () => {
  it("returns the edited PDF with standard headers and added shape", async () => {
    const plain = new File(
      [await makeNumberedPdf(2) as BlobPart],
      "invoice.pdf",
      { type: "application/pdf" },
    );

    const response = await call([plain], {
      shape: "rectangle",
      placement: "center",
      width: "120",
      height: "80",
      strokeWidth: "2",
      strokeColor: "#000000",
      fillColor: "#ff0000",
      pages: "all",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="invoice-shapes-added.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-pdfkit-pages")).toBe("2");
    expect(response.headers.get("x-pdfkit-output-pages")).toBe("2");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Number(response.headers.get("content-length"))).toBe(bytes.length);

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
  });

  it("rejects an invalid option with 400", async () => {
    const plain = new File(
      [await makeNumberedPdf(1) as BlobPart],
      "invoice.pdf",
      { type: "application/pdf" },
    );

    const response = await call([plain], {
      shape: "invalid-shape",
      placement: "center",
      pages: "all",
    });

    expect(response.status).toBe(400);
    const body = await errorBody(response);
    expect(body.error.code).toBe("INVALID_SHAPE_CONFIGURATION");
  });

  it("reports broken PDF with 422", async () => {
    const broken = new File([makeBrokenPdf() as BlobPart], "broken.pdf", {
      type: "application/pdf",
    });
    const response = await call([broken], {
      shape: "rectangle",
      placement: "center",
      pages: "all",
    });

    expect(response.status).toBe(422);
    expect((await errorBody(response)).error.code).toBe("INVALID_PDF");
  });
});

describe("GET /api/tools/add-shapes", () => {
  it("explains that only POST exists", () => {
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});
