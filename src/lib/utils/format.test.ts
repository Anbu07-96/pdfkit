import { describe, expect, it } from "vitest";
import { formatBytes, formatExtensionList, formatList } from "@/lib/utils/format";

describe("formatBytes", () => {
  it("formats byte values", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(50 * 1024 * 1024, 0)).toBe("50 MB");
  });

  it("handles invalid input", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });
});

describe("formatExtensionList", () => {
  it("renders extensions without dots in upper case", () => {
    expect(formatExtensionList([".jpg", ".jpeg"])).toBe("JPG, JPEG");
  });
});

describe("formatList", () => {
  it("joins items with a conjunction", () => {
    expect(formatList([])).toBe("");
    expect(formatList(["one"])).toBe("one");
    expect(formatList(["one", "two"])).toBe("one and two");
    expect(formatList(["one", "two", "three"])).toBe("one, two and three");
  });
});
