// @vitest-environment node
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/tools/pdf-to-excel/route";
import { makeNumberedPdf } from "@/test/pdf-fixtures";

describe("POST /api/tools/pdf-to-excel", () => {
  it("processes PDF to Excel conversion request successfully", async () => {
    const bytes = await makeNumberedPdf(2);
    const file = new File([bytes as BlobPart], "statement.pdf", {
      type: "application/pdf",
    });

    const form = new FormData();
    form.append("files", file, file.name);

    const req = new Request("http://localhost:3000/api/tools/pdf-to-excel", {
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
