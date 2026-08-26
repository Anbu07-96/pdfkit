// @vitest-environment node
import { describe, expect, it } from "vitest";
import { extractTablesProcessor } from "@/lib/processing/processors/extract-tables";
import { getProcessingLimits } from "@/lib/processing/limits";
import { makeNumberedPdf } from "@/test/pdf-fixtures";

describe("ExtractTablesProcessor", () => {
  it("extracts tables into XLSX file", async () => {
    const bytes = await makeNumberedPdf(2);
    const result = await extractTablesProcessor.process(
      {
        toolId: "extract-tables",
        files: [
          {
            id: "1",
            name: "report.pdf",
            size: bytes.length,
            mimeType: "application/pdf",
            bytes,
          },
        ],
        options: { format: "xlsx" },
      },
      { limits: getProcessingLimits() },
    );

    expect(result.status).toBe("succeeded");
    expect(result.artifacts.length).toBe(1);
    expect(result.artifacts[0].name).toBe("report-tables.xlsx");
  });
});
