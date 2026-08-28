// @vitest-environment node
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/tools/redact-information/route";
import { makeNumberedPdf } from "@/test/pdf-fixtures";

describe("POST /api/tools/redact-information", () => {
  it("processes redaction request successfully", async () => {
    const bytes = await makeNumberedPdf(2);
    const file = new File([bytes as BlobPart], "document.pdf", {
      type: "application/pdf",
    });

    const form = new FormData();
    form.append("files", file, file.name);
    form.append("pages", "1");
    form.append("fillColor", "#000000");

    const req = new Request("http://localhost:3000/api/tools/redact-information", {
      method: "POST",
      body: form,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
  });
});
