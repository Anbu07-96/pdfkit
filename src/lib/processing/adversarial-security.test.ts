import { describe, expect, it } from "vitest";
import { parseCropOptions } from "@/lib/processing/crop";
import { parseWatermarkOptions } from "@/lib/processing/watermark";
import { parsePageNumberOptions } from "@/lib/processing/page-numbers";
import { parseAddTextOptions } from "@/lib/processing/add-text";
import { parseAddShapesOptions } from "@/lib/processing/add-shapes";
import { parseAndValidatePageRanges, expandPageRanges } from "@/lib/processing/pages";
import { sanitizeCellText, createCsvString } from "@/lib/processing/tables";
import { validateAndNormalizeEmail, validatePassword } from "@/lib/auth/validation";
import { baseDocumentName } from "@/lib/processing/file-names";

describe("Phase 52 — Adversarial Input Security & Reliability Tests", () => {
  describe("Spreadsheet & Formula Injection Protection", () => {
    it("escapes formula injection cells starting with =, +, -, @", () => {
      expect(sanitizeCellText("=SUM(1,2)")).toBe("'=SUM(1,2)");
      expect(sanitizeCellText("+100")).toBe("'+100");
      expect(sanitizeCellText("-CMD('calc')")).toBe("'-CMD('calc')");
      expect(sanitizeCellText("@SUM(A1:A10)")).toBe("'@SUM(A1:A10)");
      expect(sanitizeCellText("Normal Cell Value")).toBe("Normal Cell Value");
    });

    it("escapes formula injection cells when producing CSV strings", () => {
      const csv = createCsvString([
        {
          pageNumber: 1,
          rows: [
            ["Safe Header", "Formula Header"],
            ["Data", "=SUM(A1:A10)"],
          ],
        },
      ]);

      expect(csv).toContain('"Safe Header","Formula Header"');
      expect(csv).toContain('"Data","\'=SUM(A1:A10)"');
    });
  });

  describe("Path Traversal & Filename Sanitization", () => {
    it("strips path traversal sequences and control characters from document names", () => {
      expect(baseDocumentName("../../etc/passwd")).toBe("passwd");
      expect(baseDocumentName("C:\\Windows\\System32\\cmd.exe")).toBe("cmd.exe");
      expect(baseDocumentName("document\r\nHeader: Injection")).toBe("documentHeader_ Injection");
      expect(baseDocumentName("")).toBe("document");
    });
  });

  describe("Numeric Bounds & NaN / Infinity Injection in Tool Options", () => {
    it("crop option parser rejects NaN, Infinity, negative dimensions", () => {
      expect(
        parseCropOptions({ mode: "rectangle", x: NaN, y: 10, width: 100, height: 100 }).ok,
      ).toBe(false);

      expect(
        parseCropOptions({ mode: "rectangle", x: 0, y: 0, width: Infinity, height: 100 }).ok,
      ).toBe(false);

      expect(
        parseCropOptions({ mode: "rectangle", x: -10, y: 0, width: 100, height: 100 }).ok,
      ).toBe(false);

      expect(
        parseCropOptions({ mode: "margins", top: -5, right: 10, bottom: 10, left: 10 }).ok,
      ).toBe(false);
    });

    it("watermark option parser rejects invalid opacity and rotation values", () => {
      expect(
        parseWatermarkOptions({ text: "DRAFT", opacity: 999, rotation: 45, placement: "center", pages: "all" }).ok,
      ).toBe(false);

      expect(
        parseWatermarkOptions({ text: "DRAFT", opacity: 25, rotation: 360, placement: "center", pages: "all" }).ok,
      ).toBe(false);
    });

    it("page-numbers option parser rejects non-integer, negative, or huge start numbers", () => {
      expect(
        parsePageNumberOptions({ position: "bottom-center", start: -5, size: 12, format: "number", pages: "all" }).ok,
      ).toBe(false);

      expect(
        parsePageNumberOptions({ position: "bottom-center", start: 1000000, size: 12, format: "number", pages: "all" }).ok,
      ).toBe(false);

      expect(
        parsePageNumberOptions({ position: "bottom-center", start: 1, size: 999, format: "number", pages: "all" }).ok,
      ).toBe(false);
    });

    it("add-text option parser rejects empty text, huge text, or unsupported font sizes", () => {
      expect(
        parseAddTextOptions({ text: "", placement: "center", size: 12, pages: "all" }).ok,
      ).toBe(false);

      expect(
        parseAddTextOptions({ text: "Text", placement: "center", size: 999, pages: "all" }).ok,
      ).toBe(false);
    });

    it("add-shapes option parser rejects non-finite, negative, or huge stroke/dimensions", () => {
      expect(
        parseAddShapesOptions({ shape: "rectangle", placement: "center", width: NaN, height: 100 }).ok,
      ).toBe(false);

      expect(
        parseAddShapesOptions({ shape: "rectangle", placement: "center", width: 100, height: 100, strokeWidth: 999 }).ok,
      ).toBe(false);
    });
  });

  describe("Page Range & Selection Safety", () => {
    it("rejects out-of-range, negative, and invalid page selection inputs", () => {
      const totalPages = 5;
      expect(parseAndValidatePageRanges("0", totalPages).ok).toBe(false);
      expect(parseAndValidatePageRanges("-1", totalPages).ok).toBe(false);
      expect(parseAndValidatePageRanges("10", totalPages).ok).toBe(false);
      expect(parseAndValidatePageRanges("1-10", totalPages).ok).toBe(false);
      expect(parseAndValidatePageRanges("abc", totalPages).ok).toBe(false);
    });

    it("accepts valid, bounded page selection inputs", () => {
      const totalPages = 10;
      const res = parseAndValidatePageRanges("1-3, 5, 8-10", totalPages, { allowOverlap: true });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(expandPageRanges(res.ranges)).toEqual([1, 2, 3, 5, 8, 9, 10]);
      }
    });
  });

  describe("Account Security & Validation Hardening", () => {
    it("rejects disposable email domains", () => {
      expect(validateAndNormalizeEmail("test@mailinator.com").isValid).toBe(false);
      expect(validateAndNormalizeEmail("user@tempmail.com").isValid).toBe(false);
    });

    it("normalizes uppercase and whitespace in email addresses", () => {
      const res = validateAndNormalizeEmail("  John.Doe@Gmail.Com  ");
      expect(res.isValid).toBe(true);
      expect(res.normalizedEmail).toBe("john.doe@gmail.com");
    });

    it("rejects weak, short, or common passwords", () => {
      expect(validatePassword("short1").isValid).toBe(false); // < 8 chars
      expect(validatePassword("password123").isValid).toBe(false); // Common password
      expect(validatePassword("onlyletters").isValid).toBe(false); // No number
      expect(validatePassword("1234567890").isValid).toBe(false); // No letter
    });

    it("accepts strong alphanumeric passwords", () => {
      expect(validatePassword("StrongPass2026").isValid).toBe(true);
    });
  });
});
