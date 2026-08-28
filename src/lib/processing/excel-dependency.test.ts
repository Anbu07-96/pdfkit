import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { createExcelWorkbookBuffer } from "@/lib/processing/tables";

describe("ExcelJS Dependency & Resolution Integrity", () => {
  it("imports and instantiates ExcelJS Workbook successfully", () => {
    const workbook = new ExcelJS.Workbook();
    expect(workbook).toBeDefined();
    expect(typeof workbook.addWorksheet).toBe("function");
  });

  it("generates a valid XLSX buffer using createExcelWorkbookBuffer", async () => {
    const buffer = await createExcelWorkbookBuffer([
      {
        pageNumber: 1,
        rows: [
          ["Header A", "Header B"],
          ["Cell 1", "Cell 2"],
        ],
      },
    ]);
    expect(buffer).toBeInstanceOf(Uint8Array);
    expect(buffer.length).toBeGreaterThan(100);
  });
});
