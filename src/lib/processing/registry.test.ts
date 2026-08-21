// @vitest-environment node
import { describe, expect, it, vi, afterEach } from "vitest";
import { ProcessingError } from "@/lib/processing/errors";
import {
  DEFAULT_PROCESSING_LIMITS,
  getProcessingLimits,
} from "@/lib/processing/limits";
import {
  getImplementedToolIds,
  getProcessor,
  hasProcessor,
} from "@/lib/processing/registry";
import { runProcessingJob } from "@/lib/processing/service";
import { TOOLS, getTool, isToolUsable } from "@/lib/tools";
import { makePdf } from "@/test/pdf-fixtures";

describe("processor registry", () => {
  it("exposes the implemented tools", () => {
    expect(getImplementedToolIds()).toEqual(["merge-pdf", "split-pdf"]);
    expect(hasProcessor("merge-pdf")).toBe(true);
    expect(hasProcessor("split-pdf")).toBe(true);
    expect(hasProcessor("compress-pdf")).toBe(false);
  });

  it("throws a safe error for tools that are not implemented", () => {
    try {
      getProcessor("compress-pdf");
      throw new Error("expected getProcessor to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProcessingError);
      expect((error as ProcessingError).code).toBe("TOOL_NOT_AVAILABLE");
      expect((error as ProcessingError).status).toBe(404);
    }
  });

  it("keeps the catalog and the registry in sync", () => {
    // Phase 3 adds split-pdf; nothing else may claim to work.
    expect(getImplementedToolIds()).toEqual(["merge-pdf", "split-pdf"]);

    // A tool may only claim to be usable if it really has an implementation…
    for (const tool of TOOLS) {
      expect(isToolUsable(tool)).toBe(hasProcessor(tool.id));
    }
    // …and every implementation must correspond to a catalog entry.
    for (const toolId of getImplementedToolIds()) {
      const tool = getTool(toolId);
      expect(tool, `${toolId} is missing from the catalog`).toBeDefined();
      expect(tool?.status).toBe("AVAILABLE");
    }
  });
});

describe("getProcessingLimits", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back to documented defaults", () => {
    expect(getProcessingLimits()).toEqual(DEFAULT_PROCESSING_LIMITS);
  });

  it("reads overrides from the environment", () => {
    vi.stubEnv("PDFKIT_MAX_FILES_PER_JOB", "3");
    vi.stubEnv("PDFKIT_MAX_UPLOAD_SIZE", "1024");
    vi.stubEnv("PDFKIT_MAX_TOTAL_UPLOAD_SIZE", "4096");

    vi.stubEnv("PDFKIT_MAX_SPLIT_OUTPUTS", "7");

    expect(getProcessingLimits()).toEqual({
      maxFiles: 3,
      maxFileSize: 1024,
      maxTotalSize: 4096,
      maxOutputs: 7,
    });
  });

  it("ignores invalid values", () => {
    vi.stubEnv("PDFKIT_MAX_FILES_PER_JOB", "not-a-number");
    vi.stubEnv("PDFKIT_MAX_UPLOAD_SIZE", "-5");
    expect(getProcessingLimits()).toEqual(DEFAULT_PROCESSING_LIMITS);
  });

  it("never allows a total smaller than a single file", () => {
    vi.stubEnv("PDFKIT_MAX_UPLOAD_SIZE", "2048");
    vi.stubEnv("PDFKIT_MAX_TOTAL_UPLOAD_SIZE", "1024");
    expect(getProcessingLimits().maxTotalSize).toBe(2048);
  });
});

describe("runProcessingJob", () => {
  async function pdfInput(id: string, pages: string[]) {
    const bytes = await makePdf(pages);
    return {
      id,
      name: `${id}.pdf`,
      mimeType: "application/pdf",
      size: bytes.length,
      bytes,
    };
  }

  it("validates before processing and returns a structured failure", async () => {
    const result = await runProcessingJob({
      toolId: "merge-pdf",
      files: [await pdfInput("only", ["A"])],
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect(result.error.message).toMatch(/at least 2 files/i);
    }
  });

  it("fails for a tool without an implementation", async () => {
    const result = await runProcessingJob({ toolId: "compress-pdf", files: [] });
    expect(result).toMatchObject({
      status: "failed",
      error: { code: "TOOL_NOT_AVAILABLE" },
    });
  });

  it("produces a real merged document on success", async () => {
    const result = await runProcessingJob({
      toolId: "merge-pdf",
      files: [await pdfInput("a", ["A"]), await pdfInput("b", ["B", "C"])],
    });

    expect(result.status).toBe("succeeded");
    if (result.status === "succeeded") {
      expect(result.artifacts[0].size).toBeGreaterThan(0);
      expect(result.meta).toMatchObject({ pages: 3 });
    }
  });

  it("releases the input buffers once the job is done", async () => {
    const request = {
      toolId: "merge-pdf",
      files: [await pdfInput("a", ["A"]), await pdfInput("b", ["B"])],
    };

    await runProcessingJob(request);
    expect(request.files).toHaveLength(0);
  });
});
