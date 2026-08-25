// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/tools/add-images/route";
import { makeNumberedPdf } from "@/test/pdf-fixtures";

const TINY_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0,
  0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156,
  99, 96, 248, 15, 0, 1, 5, 1, 2, 26, 10, 188, 225, 0, 0, 0, 0, 73, 69, 78, 68,
  174, 66, 96, 130,
]);

async function call(pdf: File, img: File, fields: Record<string, string> = {}) {
  const form = new FormData();
  form.append("files", pdf, pdf.name);
  form.append("files", img, img.name);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return POST(
    new Request("http://localhost/api/tools/add-images", {
      method: "POST",
      body: form,
    }),
  );
}

describe("POST /api/tools/add-images", () => {
  it("returns modified PDF on success", async () => {
    const pdf = new File([await makeNumberedPdf(2) as BlobPart], "doc.pdf", { type: "application/pdf" });
    const img = new File([TINY_PNG as BlobPart], "logo.png", { type: "image/png" });

    const response = await call(pdf, img, {
      placement: "center",
      width: "100",
      height: "100",
      pages: "all",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
  });
});

describe("GET /api/tools/add-images", () => {
  it("returns 405 Method Not Allowed", () => {
    const response = GET();
    expect(response.status).toBe(405);
  });
});
