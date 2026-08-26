import { describe, expect, it } from "vitest";
import {
  createCsvString,
  createExcelWorkbookBuffer,
  parseTextToTableRows,
  sanitizeCellText,
} from "@/lib/processing/tables";

describe("Tables Parser & Excel Generator", () => {
  it("sanitizes cell text starting with formula trigger characters (=, +, -, @, \\t, \\r)", () => {
    expect(sanitizeCellText("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
    expect(sanitizeCellText("+100")).toBe("'+100");
    expect(sanitizeCellText("-CMD('calc')")).toBe("'-CMD('calc')");
    expect(sanitizeCellText("@SUM(1,2)")).toBe("'@SUM(1,2)");
    expect(sanitizeCellText("Normal Text")).toBe("Normal Text");
  });

  it("parses lines with multi-space separators into table cells", () => {
    const text = "Item   Quantity   Price\nApple   10   $5.00";
    const rows = parseTextToTableRows(text);
    expect(rows.length).toBe(2);
    expect(rows[0]).toEqual(["Item", "Quantity", "Price"]);
    expect(rows[1]).toEqual(["Apple", "10", "$5.00"]);
  });

  it("escapes formula injection cells when generating XLSX buffer", async () => {
    const tables = [
      {
        pageNumber: 1,
        rows: [
          ["Item", "Formula"],
          ["Test", "=1+2"],
        ],
      },
    ];

    const bytes = await createExcelWorkbookBuffer(tables);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("escapes formula injection cells in CSV string output", () => {
    const tables = [
      {
        pageNumber: 1,
        rows: [
          ["Item", "Price"],
          ["Widget", "=10+20"],
        ],
      },
    ];

    const csv = createCsvString(tables);
    expect(csv).toContain('"Item","Price"');
    expect(csv).toContain('"Widget","\'=10+20"');
  });
});
