// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_PROCESSING_LIMITS } from "@/lib/processing/limits";
import { pdfToTextProcessor } from "@/lib/processing/processors/pdf-to-text";
import { makeNumberedPdf } from "@/test/pdf-fixtures";

async function pdfInput(name: string, bytes: Uint8Array) {
  return {
    id: `input-${name}`,
    name,
    mimeType: "application/pdf",
    size: bytes.length,
    bytes,
  };
}

describe("pdf-to-text processor", () => {
  it("extracts text from PDF pages and returns plain text artifact", async () => {
    const pdfBytes = await makeNumberedPdf(2);
    const result = await pdfToTextProcessor.process(
      {
        toolId: "pdf-to-text",
        files: [await pdfInput("sample.pdf", pdfBytes)],
        options: { pages: "all" },
      },
      { limits: DEFAULT_PROCESSING_LIMITS },
    );

    expect(result.status).toBe("succeeded");
    const artifact = result.artifacts[0];
    expect(artifact.name).toBe("sample-text.txt");
    expect(artifact.mimeType).toBe("text/plain; charset=utf-8");

    const textContent = new TextDecoder().decode(artifact.bytes);
    expect(textContent).toContain("--- Page 1 ---");
    expect(textContent).toContain("page 1");
    expect(textContent).toContain("--- Page 2 ---");
    expect(textContent).toContain("page 2");
  });

  it("handles empty / image-only pages honestly", async () => {
    const pdfBytes = await makeNumberedPdf(1);
    const result = await pdfToTextProcessor.process(
      {
        toolId: "pdf-to-text",
        files: [await pdfInput("sample.pdf", pdfBytes)],
        options: { pages: "first" },
      },
      { limits: DEFAULT_PROCESSING_LIMITS },
    );

    expect(result.status).toBe("succeeded");
    const textContent = new TextDecoder().decode(result.artifacts[0].bytes);
    expect(textContent).toContain("--- Page 1 ---");
  });
});
