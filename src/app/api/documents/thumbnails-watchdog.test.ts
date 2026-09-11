// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as thumbnailsPost } from "@/app/api/documents/thumbnails/route";
import { activeJobCount } from "@/lib/hardening/guards";
import { makeNumberedPdf } from "@/test/pdf-fixtures";

/**
 * Phase 75B — the request watchdog covers the thumbnails endpoint.
 *
 * WHY THIS TEST LIVES IN ITS OWN FILE: the watchdog can only answer while
 * the guarded job sits between synchronous work blocks — Node cannot send
 * a 504 in the middle of a synchronous pdfium render (the production
 * watchdog has the same property, by design: the job is never aborted).
 * In a fresh process (this file gets one), the pdfium WASM module
 * initializes INSIDE the guarded job, giving the 1ms watchdog a real
 * multi-turn window — the same condition a genuinely slow production
 * request exhibits. In an already-warm process a fast render can
 * legitimately finish inside a single turn and win the race, so this
 * assertion would be flaky there.
 */
describe("thumbnails watchdog (fresh pdfium)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("answers 504 while the render keeps running privately and releases its slot when done", async () => {
    vi.stubEnv("PDFKIT_REQUEST_TIMEOUT_MS", "1");

    const bytes = await makeNumberedPdf(30);
    const form = new FormData();
    form.append(
      "files",
      new File([bytes as BlobPart], "big.pdf", { type: "application/pdf" }),
    );
    form.append("pages", Array.from({ length: 30 }, (_, i) => i + 1).join(","));

    const response = await thumbnailsPost(
      new Request("http://localhost/api/documents/thumbnails", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.90" },
        body: form,
      }),
    );

    expect(response.status).toBe(504);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("REQUEST_TIMEOUT");

    // The job is NOT aborted: it keeps rendering privately and releases
    // its concurrency slot exactly when the real work ends.
    await vi.waitFor(() => expect(activeJobCount()).toBe(0), { timeout: 10_000 });
  });
});
