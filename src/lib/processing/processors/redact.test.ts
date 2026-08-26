// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { redactProcessor } from "@/lib/processing/processors/redact";
import { getProcessingLimits } from "@/lib/processing/limits";
import { makeNumberedPdf } from "@/test/pdf-fixtures";

describe("RedactProcessor", () => {
  it("draws redaction overlays on specified pages", async () => {
    const bytes = await makeNumberedPdf(2);
    const result = await redactProcessor.process(
      {
        toolId: "redact-information",
        files: [
          {
            id: "1",
            name: "test.pdf",
            size: bytes.length,
            mimeType: "application/pdf",
            bytes,
          },
        ],
        options: {
          pages: "1",
          areas: [{ x: 50, y: 100, width: 200, height: 40 }],
          fillColor: "#000000",
        },
      },
      { limits: getProcessingLimits() },
    );

    expect(result.status).toBe("succeeded");
    expect(result.artifacts.length).toBe(1);
    expect(result.artifacts[0].name).toBe("test-redacted.pdf");

    const output = await PDFDocument.load(result.artifacts[0].bytes);
    expect(output.getPageCount()).toBe(2);
  });
});
