import { describe, expect, it } from "vitest";
import { parseOrganizePdfOptions } from "@/lib/processing/organize-pdf";

describe("parseOrganizePdfOptions", () => {
  it("parses valid reorder, deletion, and rotation options", () => {
    const res = parseOrganizePdfOptions(
      {
        order: "3, 1",
        rotations: JSON.stringify({ "1": 90, "3": 180 }),
      },
      3,
    );

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.options.order).toEqual([3, 1]);
      expect(res.options.rotations).toEqual({ 1: 90, 3: 180 });
    }
  });

  it("defaults to full identity order if order is empty", () => {
    const res = parseOrganizePdfOptions({}, 4);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.options.order).toEqual([1, 2, 3, 4]);
    }
  });

  it("rejects out-of-range page numbers", () => {
    const res = parseOrganizePdfOptions({ order: "1, 5" }, 3);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issue.code).toBe("PAGE_OUT_OF_RANGE");
    }
  });

  it("rejects duplicate page numbers", () => {
    const res = parseOrganizePdfOptions({ order: "1, 2, 1" }, 3);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issue.code).toBe("INVALID_PAGE_ORDER");
    }
  });

  it("rejects invalid rotation angle", () => {
    const res = parseOrganizePdfOptions(
      {
        order: "1, 2",
        rotations: JSON.stringify({ "1": 45 }),
      },
      2,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issue.code).toBe("INVALID_PAGE_ROTATION");
    }
  });
});
