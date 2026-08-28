// @vitest-environment node
import { describe, expect, it } from "vitest";
import { pdfToExcelProcessor } from "@/lib/processing/processors/pdf-to-excel";
import { getProcessingLimits } from "@/lib/processing/limits";
import { makeNumberedPdf } from "@/test/pdf-fixtures";

describe("PdfToExcelProcessor", () => {
  it("converts PDF into Excel spreadsheet artifact", async () => {
    const bytes = await makeNumberedPdf(2);
    const result = await pdfToExcelProcessor.process(
      {
        toolId: "pdf-to-excel",
        files: [
          {
            id: "1",
            name: "statement.pdf",
            size: bytes.length,
            mimeType: "application/pdf",
            bytes,
          },
        ],
        options: {},
      },
      { limits: getProcessingLimits() },
    );

    expect(result.status).toBe("succeeded");
    expect(result.artifacts.length).toBe(1);
    expect(result.artifacts[0].name).toBe("statement.xlsx");
    expect(result.artifacts[0].mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });
});
