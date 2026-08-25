// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { GET, POST } from "@/app/api/tools/extract-images/route";

const TINY_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0,
  0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156,
  99, 96, 248, 15, 0, 1, 5, 1, 2, 26, 10, 188, 225, 0, 0, 0, 0, 73, 69, 78, 68,
  174, 66, 96, 130,
]);

async function call(pdf: File, fields: Record<string, string> = {}) {
  const form = new FormData();
  form.append("files", pdf, pdf.name);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return POST(
    new Request("http://localhost/api/tools/extract-images", {
      method: "POST",
      body: form,
    }),
  );
}

describe("POST /api/tools/extract-images", () => {
  it("extracts images on success", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([500, 500]);
    const img = await doc.embedPng(TINY_PNG);
    page.drawImage(img, { x: 50, y: 50, width: 100, height: 100 });
    const pdfBytes = await doc.save();

    const pdfFile = new File([pdfBytes as BlobPart], "doc.pdf", {
      type: "application/pdf",
    });

    const response = await call(pdfFile, { pages: "all" });
    expect(response.status).toBe(200);
  });
});

describe("GET /api/tools/extract-images", () => {
  it("returns 405 Method Not Allowed", () => {
    const response = GET();
    expect(response.status).toBe(405);
  });
});
