// @vitest-environment node
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/tools/compare-documents/route";
import { makeNumberedPdf } from "@/test/pdf-fixtures";

describe("POST /api/tools/compare-documents", () => {
  it("processes document comparison request successfully", async () => {
    const bytesA = await makeNumberedPdf(2);
    const bytesB = await makeNumberedPdf(2);

    const fileA = new File([bytesA as BlobPart], "docA.pdf", { type: "application/pdf" });
    const fileB = new File([bytesB as BlobPart], "docB.pdf", { type: "application/pdf" });

    const form = new FormData();
    form.append("files", fileA, fileA.name);
    form.append("files", fileB, fileB.name);

    const req = new Request("http://localhost:3000/api/tools/compare-documents", {
      method: "POST",
      body: form,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
  });
});
