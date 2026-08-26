import { describe, expect, it } from "vitest";
import {
  createCsvString,
  createExcelWorkbookBuffer,
  parseTextToTableRows,
} from "@/lib/processing/tables";

describe("Tables Parser & Excel Generator", () => {
  it("parses lines with multi-space separators into table cells", () => {
    const text = "Item   Quantity   Price\nApple   10   $5.00";
    const rows = parseTextToTableRows(text);
    expect(rows.length).toBe(2);
    expect(rows[0]).toEqual(["Item", "Quantity", "Price"]);
    expect(rows[1]).toEqual(["Apple", "10", "$5.00"]);
  });

  it("generates valid XLSX buffer using exceljs", async () => {
    const tables = [
      {
        pageNumber: 1,
        rows: [
          ["Header 1", "Header 2"],
          ["Value 1", "Value 2"],
        ],
      },
    ];

    const bytes = await createExcelWorkbookBuffer(tables);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("generates formatted CSV string", () => {
    const tables = [
      {
        pageNumber: 1,
        rows: [
          ["Item", "Price"],
          ["Widget", "$10"],
        ],
      },
    ];

    const csv = createCsvString(tables);
    expect(csv).toContain('"Item","Price"');
    expect(csv).toContain('"Widget","$10"');
  });
});
