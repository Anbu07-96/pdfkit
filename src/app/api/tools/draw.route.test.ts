// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/tools/draw/route";
import { makeNumberedPdf } from "@/test/pdf-fixtures";

async function call(pdf: File, fields: Record<string, string> = {}) {
  const form = new FormData();
  form.append("files", pdf, pdf.name);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return POST(
    new Request("http://localhost/api/tools/draw", {
      method: "POST",
      body: form,
    }),
  );
}

describe("POST /api/tools/draw", () => {
  it("returns drawn PDF on success", async () => {
    const pdf = new File([await makeNumberedPdf(2) as BlobPart], "doc.pdf", { type: "application/pdf" });

    const response = await call(pdf, {
      preset: "checkmark",
      placement: "bottom-right",
      width: "100",
      height: "60",
      strokeWidth: "3",
      strokeColor: "#000000",
      pages: "all",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
  });
});

describe("GET /api/tools/draw", () => {
  it("returns 405 Method Not Allowed", () => {
    const response = GET();
    expect(response.status).toBe(405);
  });
});
