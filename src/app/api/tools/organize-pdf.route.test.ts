// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/tools/organize-pdf/route";
import { makeNumberedPdf } from "@/test/pdf-fixtures";

async function call(pdf: File, fields: Record<string, string> = {}) {
  const form = new FormData();
  form.append("files", pdf, pdf.name);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return POST(
    new Request("http://localhost/api/tools/organize-pdf", {
      method: "POST",
      body: form,
    }),
  );
}

describe("POST /api/tools/organize-pdf", () => {
  it("organizes PDF pages on success", async () => {
    const pdf = new File([await makeNumberedPdf(3) as BlobPart], "doc.pdf", {
      type: "application/pdf",
    });

    const response = await call(pdf, {
      order: "3, 1",
      rotations: JSON.stringify({ "1": 90 }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("x-pdfkit-pages")).toBe("3");
    expect(response.headers.get("x-pdfkit-output-pages")).toBe("2");
  });
});

describe("GET /api/tools/organize-pdf", () => {
  it("returns 405 Method Not Allowed", () => {
    const response = GET();
    expect(response.status).toBe(405);
  });
});
