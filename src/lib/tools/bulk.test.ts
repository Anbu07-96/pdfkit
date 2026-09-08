import { describe, expect, it } from "vitest";
import {
  BULK_OPERATIONS,
  BULK_UNAVAILABLE_CONVERSIONS,
  resolveBulkBatchCaps,
  getBulkOperation,
} from "@/lib/tools/bulk";
import { getTool, isToolUsable } from "@/lib/tools";

describe("bulk operations catalog", () => {
  it("has unique ids", () => {
    const ids = BULK_OPERATIONS.map((operation) => operation.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("derives every route and endpoint from the id", () => {
    for (const operation of BULK_OPERATIONS) {
      expect(operation.route).toBe(`/bulk/${operation.id}`);
      expect(operation.endpoint).toBe(`/api/tools/${operation.id}`);
    }
  });

  it("only offers bulk operations over genuinely implemented single-file tools", () => {
    // Catalog honesty for bulk: an operation may only exist when the
    // underlying single-file tool is AVAILABLE (has a registered processor).
    for (const operation of BULK_OPERATIONS) {
      const tool = getTool(operation.id);
      expect(tool, operation.id).toBeDefined();
      expect(isToolUsable(tool!), operation.id).toBe(true);
    }
  });

  it("gives every operation a name, description, icon and file types", () => {
    for (const operation of BULK_OPERATIONS) {
      expect(operation.name.length).toBeGreaterThan(0);
      expect(operation.description.length).toBeGreaterThan(0);
      expect(operation.icon.length).toBeGreaterThan(0);
      expect(operation.supportedFileTypes.length).toBeGreaterThan(0);
      expect(operation.acceptedMimeTypes.length).toBeGreaterThan(0);
      expect(operation.howItWorks.length).toBeGreaterThan(0);
    }
  });

  it("does not offer bulk operations for tools that are not implemented", () => {
    const offered = new Set(BULK_OPERATIONS.map((operation) => operation.id));
    for (const unavailable of BULK_UNAVAILABLE_CONVERSIONS) {
      expect(offered.has(unavailable.id as never)).toBe(false);
      const tool = getTool(unavailable.id);
      expect(tool ? isToolUsable(tool) : false).toBe(false);
    }
  });

  it("resolves operations by id and rejects unknown ids", () => {
    expect(getBulkOperation("pdf-to-word")?.name).toBe("Bulk PDF to Word");
    expect(getBulkOperation("word-to-pdf")).toBeUndefined();
  });
});

describe("resolveBulkBatchCaps", () => {
  it("caps a batch at the daily quota when the quota is lower than the ceiling", () => {
    // Anonymous: 10 jobs/day quota is the binding constraint, not the ceiling.
    const caps = resolveBulkBatchCaps("anonymous", 10, 50 * 1024 * 1024);
    expect(caps.maxFilesPerBatch).toBe(10);
    expect(caps.maxTotalInputBytes).toBe(50 * 1024 * 1024);
  });

  it("caps a batch at the tier ceiling when the quota is higher", () => {
    // Pro: 500 jobs/day, but the browser-safe ceiling is the constraint.
    const caps = resolveBulkBatchCaps("pro", 500, 2 * 1024 * 1024 * 1024);
    expect(caps.maxFilesPerBatch).toBe(100);
    expect(caps.maxTotalInputBytes).toBe(250 * 1024 * 1024);
  });

  it("keeps shared budgets identical across tiers", () => {
    const anon = resolveBulkBatchCaps("anonymous", 10, 50 * 1024 * 1024);
    const business = resolveBulkBatchCaps("business", 5000, 20 * 1024 * 1024 * 1024);
    expect(anon.maxPagesPerBatch).toBe(business.maxPagesPerBatch);
    expect(anon.maxOutputBytesPerBatch).toBe(business.maxOutputBytesPerBatch);
    expect(anon.maxExtractedImagesPerBatch).toBe(
      business.maxExtractedImagesPerBatch,
    );
  });

  it("never returns zero caps even for degenerate quota input", () => {
    const caps = resolveBulkBatchCaps("free", 1, 1);
    expect(caps.maxFilesPerBatch).toBeGreaterThanOrEqual(1);
    expect(caps.maxTotalInputBytes).toBeGreaterThanOrEqual(1);
  });

  it("is monotonic: a bigger quota never shrinks the caps", () => {
    const small = resolveBulkBatchCaps("free", 10, 50 * 1024 * 1024);
    const large = resolveBulkBatchCaps("free", 100, 500 * 1024 * 1024);
    expect(large.maxFilesPerBatch).toBeGreaterThanOrEqual(small.maxFilesPerBatch);
    expect(large.maxTotalInputBytes).toBeGreaterThanOrEqual(
      small.maxTotalInputBytes,
    );
  });
});
