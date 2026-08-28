// @vitest-environment node
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/tools/extract-tables/route";
import { makeNumberedPdf } from "@/test/pdf-fixtures";

describe("POST /api/tools/extract-tables", () => {
  it("processes table extraction request successfully", async () => {
    const bytes = await makeNumberedPdf(2);
    const file = new File([bytes as BlobPart], "document.pdf", {
      type: "application/pdf",
    });

    const form = new FormData();
    form.append("files", file, file.name);
    form.append("format", "xlsx");

    const req = new Request("http://localhost:3000/api/tools/extract-tables", {
      method: "POST",
      body: form,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });
});
