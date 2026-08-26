// @vitest-environment node
import { describe, expect, it } from "vitest";
import { compareDocumentsProcessor } from "@/lib/processing/processors/compare-documents";
import { getProcessingLimits } from "@/lib/processing/limits";
import { makeNumberedPdf } from "@/test/pdf-fixtures";

describe("CompareDocumentsProcessor", () => {
  it("compares two PDFs and returns comparison report", async () => {
    const bytesA = await makeNumberedPdf(2);
    const bytesB = await makeNumberedPdf(2);

    const result = await compareDocumentsProcessor.process(
      {
        toolId: "compare-documents",
        files: [
          { id: "1", name: "docA.pdf", size: bytesA.length, mimeType: "application/pdf", bytes: bytesA },
          { id: "2", name: "docB.pdf", size: bytesB.length, mimeType: "application/pdf", bytes: bytesB },
        ],
        options: {},
      },
      { limits: getProcessingLimits() },
    );

    expect(result.status).toBe("succeeded");
    expect(result.artifacts.length).toBe(1);
    expect(result.artifacts[0].name).toBe("document-comparison-report.txt");
  });
});
