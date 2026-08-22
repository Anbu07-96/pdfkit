import { describe, expect, it } from "vitest";
import {
  formatKeywords,
  formatMetadataDate,
  parseKeywordsInput,
  validateMetadataField,
  EDITABLE_METADATA_FIELDS,
  MAX_KEYWORDS,
  MAX_METADATA_FIELD_LENGTH,
} from "@/lib/processing/metadata";

describe("metadata model", () => {
  it("lists exactly the five editable fields", () => {
    expect(EDITABLE_METADATA_FIELDS).toEqual([
      "title",
      "author",
      "subject",
      "keywords",
      "creator",
    ]);
  });

  it("parses keyword input, dropping empties and trimming", () => {
    expect(parseKeywordsInput("finance, 2026, report")).toEqual([
      "finance",
      "2026",
      "report",
    ]);
    expect(parseKeywordsInput(" a ,, b ,")).toEqual(["a", "b"]);
    expect(parseKeywordsInput("")).toEqual([]);
    expect(parseKeywordsInput("solo")).toEqual(["solo"]);
  });

  it("round-trips keywords through format and parse", () => {
    const keywords = ["finance", "2026"];
    expect(parseKeywordsInput(formatKeywords(keywords))).toEqual(keywords);
    expect(formatKeywords(null)).toBe("");
  });

  it("formats dates for display or shows a dash", () => {
    expect(formatMetadataDate("2026-08-21T23:24:50.000Z")).toBe(
      "2026-08-21 23:24 UTC",
    );
    expect(formatMetadataDate(null)).toBe("—");
    expect(formatMetadataDate("not a date")).toBe("—");
  });
});

describe("validateMetadataField", () => {
  it("accepts ordinary values", () => {
    expect(validateMetadataField("title", "Quarterly report")).toBeNull();
    expect(validateMetadataField("keywords", "a, b, c")).toBeNull();
    expect(validateMetadataField("author", "")).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(validateMetadataField("title", 42)).toEqual({
      field: "title",
      message: "The title must be text.",
    });
// Absent fields are skipped by the caller before validation, so any value
    // that reaches the validator must be a string.
    expect(validateMetadataField("author", undefined)?.message).toBe(
      "The author must be text.",
    );
    expect(validateMetadataField("author", { nested: true }) as unknown).not.toBeNull();
  });

  it("rejects values above the length budget", () => {
    const issue = validateMetadataField("title", "a".repeat(MAX_METADATA_FIELD_LENGTH + 1));
    expect(issue?.message).toContain(`${MAX_METADATA_FIELD_LENGTH} characters or fewer`);
  });

  it("bounds keyword count and per-keyword length", () => {
    const many = Array.from({ length: MAX_KEYWORDS + 1 }, (_, i) => `k${i}`).join(", ");
    expect(validateMetadataField("keywords", many)?.message).toContain(
      `No more than ${MAX_KEYWORDS} keywords`,
    );

    const longKeyword = `a, ${"x".repeat(201)}`;
    expect(validateMetadataField("keywords", longKeyword)?.message).toContain(
      "Each keyword must be",
    );
  });

  it("accepts unicode values within budget", () => {
    expect(validateMetadataField("title", "Årśvær — über naïve 中文 📄")).toBeNull();
  });
});
