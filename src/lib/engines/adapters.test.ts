// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  CURRENT_ENGINES,
  currentEngineAdapter,
} from "@/lib/engines/adapters/current";
import type { EngineDescriptor } from "@/lib/engines/types";
import type { ToolProcessor } from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { DEFAULT_PROCESSING_LIMITS } from "@/lib/processing/limits";
import { makePdf } from "@/test/pdf-fixtures";

const DESCRIPTOR: EngineDescriptor = {
  id: "test-engine",
  name: "Test engine",
  conversionType: "pdf-to-word",
  toolId: "pdf-to-word",
  capabilities: ["text-extraction"],
  executionClass: "in-process",
  costClass: "local",
  license: "test-only",
  version: "0",
  available: true,
};

function fakeProcessor() {
  const processMock = vi.fn();
  const processor: ToolProcessor<Record<string, unknown>> = {
    toolId: "pdf-to-word",
    input: {
      minFiles: 1,
      extensions: [".pdf"],
      mimeTypes: ["application/pdf"],
    },
    process: processMock,
  };
  return { processor, processMock };
}

const CONTEXT = { limits: DEFAULT_PROCESSING_LIMITS };

describe("current engine adapters", () => {
  it("borrows the input rules and descriptor as-is", () => {
    const { processor } = fakeProcessor();
    const engine = currentEngineAdapter({ descriptor: DESCRIPTOR, processor });

    expect(engine.descriptor).toBe(DESCRIPTOR);
    expect(engine.input).toBe(processor.input);
  });

  it("delegates to the underlying processor with the very same objects", async () => {
    const { processor, processMock } = fakeProcessor();
    processMock.mockResolvedValue({
      status: "succeeded",
      artifacts: [
        {
          name: "out.docx",
          mimeType: "application/x",
          size: 3,
          bytes: new Uint8Array([1, 2, 3]),
        },
      ],
      meta: { pages: 1 },
    });
    const engine = currentEngineAdapter({ descriptor: DESCRIPTOR, processor });

    const request = { toolId: "pdf-to-word", files: [] };
    const result = await engine.run(request, CONTEXT);

    expect(processMock).toHaveBeenCalledTimes(1);
    // Identity: the adapter forwards the untouched request and context.
    expect(processMock).toHaveBeenCalledWith(request, CONTEXT);
    // The underlying success is propagated, not rebuilt.
    expect(result.artifacts).toEqual([
      {
        name: "out.docx",
        mimeType: "application/x",
        size: 3,
        bytes: new Uint8Array([1, 2, 3]),
      },
    ]);
    expect(result.meta).toEqual({ pages: 1 });
    // Engine-layer facts are additive and honest for Stage 1.
    expect(result.engineId).toBe("test-engine");
    expect(result.attempt).toBe(1);
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.warnings).toEqual([]);
    expect(result.validation).toEqual({ status: "not-evaluated" });
  });

  it("propagates typed errors untouched — no wrapping, no classification", async () => {
    const { processor, processMock } = fakeProcessor();
    const thrown = new ProcessingError("INVALID_PDF", "A PDF could not be opened.");
    processMock.mockRejectedValue(thrown);
    const engine = currentEngineAdapter({ descriptor: DESCRIPTOR, processor });

    const request = { toolId: "pdf-to-word", files: [] };
    // The very same error instance surfaces: the adapter neither catches nor
    // converts it, so failure semantics are byte-identical.
    await expect(engine.run(request, CONTEXT)).rejects.toBe(thrown);
  });

  it("describes every current engine honestly", () => {
    for (const engine of CURRENT_ENGINES) {
      const descriptor = engine.descriptor;
      expect(descriptor.available, descriptor.id).toBe(true);
      expect(descriptor.executionClass, descriptor.id).toBe("in-process");
      expect(descriptor.costClass, descriptor.id).toBe("local");
      expect(descriptor.version, descriptor.id).toMatch(/^\d+\.\d+\.\d+$/);
      expect(descriptor.license.length, descriptor.id).toBeGreaterThan(0);
      expect(descriptor.capabilities.length, descriptor.id).toBeGreaterThan(0);
      expect(descriptor.name.length, descriptor.id).toBeGreaterThan(0);
    }
  });

  it("runs a real current adapter end to end without leaking internals", async () => {
    const engine = CURRENT_ENGINES.find(
      (candidate) => candidate.descriptor.id === "current-pdfium-docx",
    );
    expect(engine).toBeDefined();
    if (!engine) return;

    const bytes = await makePdf(["Hello adapter"]);
    const result = await engine.run(
      {
        toolId: "pdf-to-word",
        files: [
          {
            id: "f1",
            name: "doc.pdf",
            size: bytes.length,
            mimeType: "application/pdf",
            bytes,
          },
        ],
      },
      CONTEXT,
    );

    expect(result.engineId).toBe("current-pdfium-docx");
    expect(result.attempt).toBe(1);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].name).toBe("doc.docx");
    expect(result.artifacts[0].size).toBeGreaterThan(0);

    // No server internals escape: the serialisable result must not carry
    // filesystem paths, module paths or anything beyond the artifact facts.
    const serialised = JSON.stringify({
      ...result,
      artifacts: result.artifacts.map((artifact) => ({
        ...artifact,
        bytes: undefined,
      })),
    });
    expect(serialised).not.toContain("/home/");
    expect(serialised).not.toContain("node_modules");
    expect(serialised).not.toMatch(/\\\\/);
  });
});
