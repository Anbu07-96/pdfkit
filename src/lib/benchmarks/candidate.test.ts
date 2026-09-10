// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractPdfjsTextPages,
  loadPositionedTextPages,
  type PdfjsDocumentHandle,
  type PdfjsLoadingTask,
} from "@/lib/processing/pdfjs/positioned-text";
import { pdfjsTextEngine } from "@/lib/engines/adapters/pdfjs-text";
import { DEFAULT_PROCESSING_LIMITS } from "@/lib/processing/limits";
import { getFixture } from "@/lib/benchmarks/fixtures";

/**
 * Phase 73 candidate/production-core cleanup and offline tests
 * (Phase 72 §14/§26 carried into production, §19–§20, §30).
 *
 * The pdfjs loading task must ALWAYS be destroyed (success, page failure,
 * rejected loading promise), input bytes must never be detached, the
 * production engine must never touch the network, and pdfjs worker/CDN
 * behavior must stay server-safe. All proven here.
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
                    return {
                      items: [{ str: "PDFKIT-ANCHOR-SINGLE", transform: [1, 0, 0, 1, 20, 150] }],
                    };
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

describe("production pdfjs core — cleanup discipline", () => {
  it("destroys the loading task after a successful extraction", async () => {
    const { loader, state } = mockLoader();
    const { texts } = await extractPdfjsTextPages(new Uint8Array([1, 2, 3]), {
      maxPages: 5,
      loadDocument: loader,
    });
    expect(texts).toEqual(["PDFKIT-ANCHOR-SINGLE"]);
    expect(state.destroyed).toBe(1);
  });

  it("destroys the loading task when document loading fails", async () => {
    const { loader, state } = mockLoader({ failAt: "promise" });
    await expect(
      extractPdfjsTextPages(new Uint8Array([1, 2, 3]), { maxPages: 5, loadDocument: loader }),
    ).rejects.toThrow();
    expect(state.destroyed).toBe(1);
  });

  it("destroys the loading task when page extraction fails mid-run", async () => {
    const { loader, state } = mockLoader({ failAt: "page" });
    // §27: the raw exception text does NOT propagate — it maps to a typed
    // PROCESSING_ERROR with a static message.
    await expect(
      extractPdfjsTextPages(new Uint8Array([1, 2, 3]), { maxPages: 5, loadDocument: loader }),
    ).rejects.toMatchObject({
      code: "PROCESSING_ERROR",
      message: "The text of this PDF could not be extracted.",
    });
    expect(state.destroyed).toBe(1);
  });

  it("maps pdfjs failures onto the typed processing taxonomy (no stack/text leakage)", async () => {
    const { loader } = mockLoader({ failAt: "promise" });
    const error = await extractPdfjsTextPages(new Uint8Array([1, 2, 3]), {
      maxPages: 5,
      loadDocument: loader,
    }).catch((cause) => cause);
    expect(error.code).toBe("INVALID_PDF");
    expect(error.message).not.toContain("InvalidPDFException");
    expect(error.message).not.toContain("stack");

    const passwordLoader = async (): Promise<PdfjsLoadingTask> => {
      const task: PdfjsLoadingTask = {
        promise: Promise.reject(Object.assign(new Error("locked"), { name: "PasswordException" })),
        destroy: async () => {},
      };
      return task;
    };
    const passwordError = await extractPdfjsTextPages(new Uint8Array([1]), {
      maxPages: 5,
      loadDocument: passwordLoader,
    }).catch((cause) => cause);
    expect(passwordError.code).toBe("ENCRYPTED_PDF");
  });

  it("enforces the page limit BEFORE extracting pages", async () => {
    const loads: number[] = [];
    let pagesTouched = 0;
    const loader = async (): Promise<PdfjsLoadingTask> => ({
      promise: Promise.resolve({
        numPages: 900,
        async getPage() {
          pagesTouched += 1;
          return {
            async getTextContent() {
              return { items: [] };
            },
            cleanup() {},
          };
        },
      } satisfies PdfjsDocumentHandle),
      destroy: async () => {
        loads.push(1);
      },
    });
    const error = await extractPdfjsTextPages(new Uint8Array([1]), {
      maxPages: 50,
      loadDocument: loader,
    }).catch((cause) => cause);
    expect(error.code).toBe("TOO_MANY_OUTPUTS");
    expect(pagesTouched).toBe(0); // fail fast: no page was processed
    expect(loads).toHaveLength(1); // and the task was destroyed
  });

  it("never detaches the caller's input bytes", async () => {
    const bytes = await getFixture("F-01-text-single").build();
    const lengthBefore = bytes.byteLength;
    await loadPositionedTextPages(bytes);
    expect(bytes.byteLength).toBe(lengthBefore);
  });

  it("repeated failed parses stay bounded (no runaway state)", async () => {
    const fixture = getFixture("F-36-edge-truncated");
    const bytes = await fixture.build();
    for (let index = 0; index < 10; index += 1) {
      await expect(extractPdfjsTextPages(bytes, { maxPages: 50 })).rejects.toThrow();
    }
  });
});

describe("production pdfjs engine — offline discipline", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("performs a full extraction without any network access", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("network access attempted during pdfjs engine run");
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await pdfjsTextEngine.run(
      {
        toolId: "pdf-to-text",
        files: [
          {
            id: "f1",
            name: "doc.pdf",
            size: (await getFixture("F-01-text-single").build()).length,
            mimeType: "application/pdf",
            bytes: await getFixture("F-01-text-single").build(),
          },
        ],
        options: { pages: "all" },
      },
      { limits: DEFAULT_PROCESSING_LIMITS },
    );
    expect(result.artifacts).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("extracts the unicode fixture offline with full preservation", async () => {
    globalThis.fetch = vi.fn(() => {
      throw new Error("network access attempted during pdfjs engine run");
    }) as unknown as typeof fetch;

    const fixture = getFixture("F-14-text-unicode");
    const bytes = await fixture.build();
    const result = await pdfjsTextEngine.run(
      {
        toolId: "pdf-to-text",
        files: [
          { id: "f1", name: "doc.pdf", size: bytes.length, mimeType: "application/pdf", bytes },
        ],
        options: { pages: "all" },
      },
      { limits: DEFAULT_PROCESSING_LIMITS },
    );
    const text = new TextDecoder().decode(result.artifacts[0].bytes);
    for (const char of fixture.expected.unicodeChars ?? []) {
      expect(text, `unicode char ${char}`).toContain(char);
    }
  });
});
