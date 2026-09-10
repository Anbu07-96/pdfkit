// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPdfjsTextCandidate,
  parsePdfTextPages,
  type PdfjsDocumentHandle,
  type PdfjsLoadingTask,
} from "@/lib/benchmarks/engines/pdfjs-candidate";
import { getFixture } from "@/lib/benchmarks/fixtures";

/**
 * Phase 72 candidate cleanup and offline tests (§14, §26).
 *
 * The PDF.js loading task must ALWAYS be destroyed (success and failure),
 * input bytes must never be detached, and the candidate must never touch
 * the network — proven here with an injectable loader and a poisoned fetch.
 */

/** A mock loading task that records destroy() calls. */
function mockLoader(options: { failAt?: "promise" | "page" } = {}) {
  const state = { destroyed: 0, loads: 0 };
  const loader = async (): Promise<PdfjsLoadingTask> => {
    state.loads += 1;
    const task: PdfjsLoadingTask = {
      promise:
        options.failAt === "promise"
          ? Promise.reject(Object.assign(new Error("invalid"), { name: "InvalidPDFException" }))
          : Promise.resolve({
              numPages: 1,
              async getPage() {
                if (options.failAt === "page") throw new Error("page boom");
                return {
                  async getTextContent() {
                    return { items: [{ str: "PDFKIT-ANCHOR-SINGLE", transform: [1, 0, 0, 1, 20, 150] }] };
                  },
                  cleanup() {},
                };
              },
            } satisfies PdfjsDocumentHandle),
      destroy: async () => {
        state.destroyed += 1;
      },
    };
    return task;
  };
  return { loader, state };
}

describe("candidate cleanup discipline", () => {
  it("destroys the loading task after a successful run", async () => {
    const { loader, state } = mockLoader();
    const engine = createPdfjsTextCandidate({ loadDocument: loader });
    const run = await engine.run({ name: "x.pdf", bytes: new Uint8Array([1, 2, 3]) });
    expect(run.artifacts).toHaveLength(1);
    expect(state.destroyed).toBe(1);
  });

  it("destroys the loading task when document loading fails", async () => {
    const { loader, state } = mockLoader({ failAt: "promise" });
    const engine = createPdfjsTextCandidate({ loadDocument: loader });
    await expect(
      engine.run({ name: "x.pdf", bytes: new Uint8Array([1, 2, 3]) }),
    ).rejects.toThrow();
    expect(state.destroyed).toBe(1);
  });

  it("destroys the loading task when page extraction fails mid-run", async () => {
    const { loader, state } = mockLoader({ failAt: "page" });
    const engine = createPdfjsTextCandidate({ loadDocument: loader });
    await expect(
      engine.run({ name: "x.pdf", bytes: new Uint8Array([1, 2, 3]) }),
    ).rejects.toThrow("page boom");
    expect(state.destroyed).toBe(1);
  });

  it("never detaches the caller's input bytes", async () => {
    const bytes = await getFixture("F-01-text-single").build();
    const lengthBefore = bytes.byteLength;
    await parsePdfTextPages(bytes);
    expect(bytes.byteLength).toBe(lengthBefore);
  });

  it("repeated failed parses stay bounded (no runaway state)", async () => {
    const fixture = getFixture("F-36-edge-truncated");
    const bytes = await fixture.build();
    for (let index = 0; index < 10; index += 1) {
      await expect(parsePdfTextPages(bytes)).rejects.toThrow();
    }
  });
});

describe("candidate offline discipline", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("performs a full extraction without any network access", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("network access attempted during benchmark run");
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const engine = createPdfjsTextCandidate();
    const run = await engine.run({
      name: "x.pdf",
      bytes: await getFixture("F-01-text-single").build(),
    });
    expect(run.artifacts).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("parses the unicode fixture offline with full preservation", async () => {
    globalThis.fetch = vi.fn(() => {
      throw new Error("network access attempted during benchmark run");
    }) as unknown as typeof fetch;

    const engine = createPdfjsTextCandidate();
    const run = await engine.run({
      name: "x.pdf",
      bytes: await getFixture("F-14-text-unicode").build(),
    });
    const text = new TextDecoder().decode(run.artifacts[0].bytes);
    for (const char of getFixture("F-14-text-unicode").expected.unicodeChars ?? []) {
      expect(text, `unicode char ${char}`).toContain(char);
    }
  });
});
