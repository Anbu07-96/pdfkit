import { describe, expect, it } from "vitest";
import { parseRedactOptions } from "@/lib/processing/redact";

describe("Redact Options Parser", () => {
  it("parses valid redaction options with defaults", () => {
    const parsed = parseRedactOptions({}, 10);
    expect(parsed.ranges.length).toBeGreaterThan(0);
    expect(parsed.areas.length).toBeGreaterThan(0);
    expect(parsed.fillColor).toBe("#000000");
  });

  it("parses custom redaction areas and hex color", () => {
    const parsed = parseRedactOptions(
      {
        pages: "1-3",
        areas: [{ x: 10, y: 20, width: 100, height: 50 }],
        fillColor: "#ff0000",
      },
      10,
    );

    expect(parsed.areas[0]).toEqual({ x: 10, y: 20, width: 100, height: 50 });
    expect(parsed.fillColor).toBe("#ff0000");
  });
});
