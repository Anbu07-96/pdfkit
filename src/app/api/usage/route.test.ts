// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/usage/route";
import { POST as postPdfToWord } from "@/app/api/tools/pdf-to-word/route";
import { PDFDocument, StandardFonts } from "pdf-lib";

/**
 * GET /api/usage returns the caller's daily quota snapshot (anonymous
 * fallback when no session exists) so the bulk workspace can preflight a
 * batch. Read-only; every other method is rejected.
 */
describe("GET /api/usage", () => {
  it("returns a usage summary for the anonymous fallback identity", async () => {
    const response = await GET(
      new Request("http://localhost/api/usage", { method: "GET" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");

    const body = (await response.json()) as {
      tier: string;
      jobsUsed: number;
      dailyJobLimit: number;
      jobsRemaining: number;
      bytesUsed: number;
      dailyByteLimit: number;
      bytesRemaining: number;
    };
    expect(body.tier).toBe("anonymous");
    expect(body.dailyJobLimit).toBeGreaterThan(0);
    expect(body.dailyByteLimit).toBeGreaterThan(0);
    expect(body.jobsRemaining).toBe(body.dailyJobLimit - body.jobsUsed);
    expect(body.bytesRemaining).toBe(body.dailyByteLimit - body.bytesUsed);
  });
});

describe("POST /api/usage", () => {
  it("returns 405 Method Not Allowed", () => {
    expect(POST().status).toBe(405);
  });
});

describe("usage metering end to end", () => {
  it("records the real input byte total after a successful job", async () => {
    // Regression (Phase 61 audit): the service's in-memory cleanup empties the
    // files array in a `finally` block, and the HTTP adapter used to compute
    // `totalProcessedBytes` AFTER that — so every job recorded 0 bytes and the
    // daily byte quota never accumulated. The total is now captured first.
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([300, 200]);
    page.drawText("meter me", { x: 40, y: 100, size: 12, font });
    const pdfBytes = await doc.save();

    const form = new FormData();
    form.append(
      "files",
      new File([pdfBytes as BlobPart], "metered.pdf", { type: "application/pdf" }),
    );
    const job = await postPdfToWord(
      new Request("http://localhost/api/tools/pdf-to-word", {
        method: "POST",
        body: form,
      }),
    );
    expect(job.status).toBe(200);

    const summaryResponse = await GET(
      new Request("http://localhost/api/usage", { method: "GET" }),
    );
    const summary = (await summaryResponse.json()) as {
      jobsUsed: number;
      bytesUsed: number;
    };
    expect(summary.jobsUsed).toBeGreaterThanOrEqual(1);
    expect(summary.bytesUsed).toBeGreaterThanOrEqual(pdfBytes.length);
  });
});
