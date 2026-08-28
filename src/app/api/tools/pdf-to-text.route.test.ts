// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/tools/pdf-to-text/route";
import { makeNumberedPdf } from "@/test/pdf-fixtures";

async function call(pdf: File, fields: Record<string, string> = {}) {
  const form = new FormData();
  form.append("files", pdf, pdf.name);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return POST(
    new Request("http://localhost/api/tools/pdf-to-text", {
      method: "POST",
      body: form,
    }),
  );
}

describe("POST /api/tools/pdf-to-text", () => {
  it("extracts plain text on success", async () => {
    const pdf = new File([await makeNumberedPdf(2) as BlobPart], "doc.pdf", {
      type: "application/pdf",
    });

    const response = await call(pdf, { pages: "all" });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });
});

describe("GET /api/tools/pdf-to-text", () => {
  it("returns 405 Method Not Allowed", () => {
    const response = GET();
    expect(response.status).toBe(405);
  });
});
