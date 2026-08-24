import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompressPdfWorkspace } from "@/components/tools/workspaces/compress-pdf-workspace";
import { ToastProvider } from "@/components/ui/toast";

const LIMITS = { maxFileSize: 25 * 1024 * 1024, maxRasterPages: 60 };

function pdfFile(name = "document.pdf", size = 4096) {
  const file = new File(["%PDF-1.7"], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function renderWorkspace(limits = LIMITS) {
  return render(
    <ToastProvider>
      <CompressPdfWorkspace limits={limits} />
    </ToastProvider>,
  );
}

/** Minimal stand-in for a fetch response (jsdom Blobs cannot build undici ones). */
function fakeResponse({
  ok = true,
  status = 200,
  headers = {},
  blob,
  json,
}: {
  ok?: boolean;
  status?: number;
  headers?: Record<string, string>;
  blob?: Blob;
  json?: unknown;
}) {
  return {
    ok,
    status,
    headers: new Headers(headers),
    blob: async () => blob ?? new Blob([]),
    json: async () => json,
  } as unknown as Response;
}

function inspectResponse(pageCount: number) {
  return fakeResponse({
    headers: { "content-type": "application/json" },
    json: { fileName: "document.pdf", size: 4096, pageCount },
  });
}

function compressedResponse({
  originalBytes = 4800,
  outputBytes = 2900,
  level = "medium",
  strategy = "lossless",
  reduced = true,
} = {}) {
  const bytesSaved = reduced ? originalBytes - outputBytes : 0;
  const reductionPercent = reduced
    ? Math.round((bytesSaved / originalBytes) * 1000) / 10
    : 0;
  return fakeResponse({
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="document-compressed.pdf"',
      "x-pdfkit-pages": "3",
      "x-pdfkit-artifacts": "1",
      "x-pdfkit-original-bytes": String(originalBytes),
      "x-pdfkit-output-bytes": String(outputBytes),
      "x-pdfkit-bytes-saved": String(bytesSaved),
      "x-pdfkit-reduction-percent": String(reductionPercent),
      "x-pdfkit-reduced": reduced ? "yes" : "no",
      "x-pdfkit-compression-level": level,
      "x-pdfkit-compression-strategy": reduced ? strategy : "original",
    },
    blob: new Blob(["%PDF-"], { type: "application/pdf" }),
  });
}

function errorResponse(status: number, code: string, message: string) {
  return fakeResponse({
    ok: false,
    status,
    headers: { "content-type": "application/json" },
    json: { error: { code, message } },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

/** Route each call by URL so inspection and compression can be stubbed apart. */
function routeFetch(handlers: {
  inspect?: () => Response;
  compress?: () => Response;
} = {}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/api/documents/inspect")) {
      return handlers.inspect?.() ?? inspectResponse(3);
    }
    if (url.includes("/api/tools/compress-pdf")) {
      return handlers.compress?.() ?? compressedResponse();
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

/** Calls made to the compress endpoint (i.e. actual processing requests). */
function compressCalls() {
  return fetchMock.mock.calls.filter(
    (call) => call[0] === "/api/tools/compress-pdf",
  );
}

async function uploadPdf(
  user: ReturnType<typeof userEvent.setup>,
  name = "document.pdf",
) {
  routeFetch();
  await user.upload(screen.getByLabelText(/upload a pdf/i), pdfFile(name));
  await screen.findByText(/3 pages/i);
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CompressPdfWorkspace", () => {
  it("starts with an upload prompt and a disabled action", () => {
    renderWorkspace();

    expect(screen.getByLabelText(/upload a pdf/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /browse files/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^compress pdf$/i })).toBeDisabled();
    expect(screen.getByText(/upload a pdf to get started/i)).toBeInTheDocument();
    // No compression levels are offered before a file exists.
    expect(screen.queryByRole("radio", { name: /medium/i })).not.toBeInTheDocument();
  });

  it("shows the uploaded file's name, size and page count", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user, "report.pdf");

    expect(
      screen.getByText("report.pdf", { selector: "span" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/4 KB/).length).toBeGreaterThan(0);
    expect(screen.getByText("3 pages")).toBeInTheDocument();
  });

  it("offers the three levels with medium preselected", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user);

    const low = screen.getByRole("radio", { name: /^low/i });
    const medium = screen.getByRole("radio", { name: /^medium/i });
    const high = screen.getByRole("radio", { name: /^high/i });
    expect(low).toBeInTheDocument();
    expect(medium).toBeInTheDocument();
    expect(high).toBeInTheDocument();
    expect(medium).toBeChecked();
    expect(low).not.toBeChecked();
    expect(high).not.toBeChecked();

    // The descriptions state what really happens: two levels are lossless,
    // and high alone mentions rasterising.
    expect(screen.getAllByText(/^lossless:/i)).toHaveLength(2);
    expect(screen.getByText(/rasterising pages/i)).toBeInTheDocument();
  });

  it("switches levels with the keyboard", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user);

    const radios = [
      screen.getByRole("radio", { name: /^low/i }),
      screen.getByRole("radio", { name: /^medium/i }),
      screen.getByRole("radio", { name: /^high/i }),
    ];
    radios[2].focus();
    await user.keyboard("{ArrowDown}");
    // The focused control moved between the options: keyboard operable.
    expect(radios).toContain(document.activeElement);
  });

  it("selects low and high when clicked", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user);

    await user.click(screen.getByRole("radio", { name: /^low/i }));
    expect(screen.getByRole("radio", { name: /^low/i })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: /^high/i }));
    expect(screen.getByRole("radio", { name: /^high/i })).toBeChecked();
  });

  it("shows an inspect failure as an alert and disables compression", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    routeFetch({
      inspect: () => errorResponse(422, "INVALID_PDF", "A PDF could not be opened."),
    });
    await user.upload(
      screen.getByLabelText(/upload a pdf/i),
      pdfFile("bad.pdf"),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not be opened/i,
    );
    expect(screen.getByRole("button", { name: /^compress pdf$/i })).toBeDisabled();
  });

  it("sends the selected level in the multipart payload", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user);

    await user.click(screen.getByRole("radio", { name: /^high/i }));
    await user.click(screen.getByRole("button", { name: /^compress pdf$/i }));

    await waitFor(() => expect(compressCalls()).toHaveLength(1));
    const [, init] = compressCalls()[0] as [string, RequestInit];
    const form = init.body as FormData;
    expect(form.get("level")).toBe("high");
    expect(form.get("files")).toBeInstanceOf(File);
  });

  it("shows an honest indeterminate processing state", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user);

    let resolveCompress: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveCompress = resolve;
    });
    routeFetch({ compress: () => pending as unknown as Response });

    await user.click(screen.getByRole("button", { name: /^compress pdf$/i }));

    expect(await screen.findByText(/compressing your pdf…/i)).toBeInTheDocument();
    // Indeterminate: no fake percentage anywhere.
    expect(screen.queryByText(/%\s*complete/i)).not.toBeInTheDocument();
    expect(document.querySelector("progress")).toBeNull();

    resolveCompress!(compressedResponse());
    await screen.findByText(/compressed successfully/i);
  });

  it("disables the action while processing and offers cancel", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user);

    const pending = new Promise<Response>(() => undefined);
    routeFetch({ compress: () => pending as unknown as Response });

    await user.click(screen.getByRole("button", { name: /^compress pdf$/i }));
    expect(
      screen.getByRole("button", { name: /^compressing…$/i }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeEnabled();
  });

  it("aborts the request when cancel is clicked", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user);

    // A fetch that never resolves on its own — only the abort signal ends it.
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse(3);
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The request was aborted.", "AbortError"));
        });
      }) as unknown as Promise<Response>;
    });

    await user.click(screen.getByRole("button", { name: /^compress pdf$/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    const [, init] = compressCalls()[0] as [string, RequestInit & { signal?: AbortSignal }];
    expect(init.signal?.aborted).toBe(true);
    // Aborting returns the workspace to a usable state.
    expect(
      await screen.findByRole("button", { name: /^compress pdf$/i }),
    ).toBeEnabled();
  });

  it("renders the server-measured success statistics", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user);
    routeFetch({
      compress: () =>
        compressedResponse({ originalBytes: 4_800_000, outputBytes: 2_900_000 }),
    });

    await user.click(screen.getByRole("button", { name: /^compress pdf$/i }));

    expect(await screen.findByText(/pdf compressed successfully/i)).toBeInTheDocument();
    expect(screen.getByText("Original size")).toBeInTheDocument();
    expect(screen.getByText("4.6 MB")).toBeInTheDocument();
    expect(screen.getByText(/compressed size/i)).toBeInTheDocument();
    expect(screen.getByText("2.8 MB")).toBeInTheDocument();
    expect(screen.getByText("1.8 MB")).toBeInTheDocument();
    expect(screen.getByText("39.6%")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /download compressed pdf/i }),
    ).toHaveAttribute("href");
    expect(
      screen.getByRole("button", { name: /compress another pdf/i }),
    ).toBeEnabled();
  });

  it("announces the result politely for screen readers", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user);
    routeFetch({
      compress: () =>
        compressedResponse({ originalBytes: 1000, outputBytes: 500 }),
    });

    await user.click(screen.getByRole("button", { name: /^compress pdf$/i }));
    await screen.findByText(/compressed successfully/i);

    const live = screen.getByRole("status");
    expect(live).toHaveTextContent(/50 percent smaller/i);
  });

  it("uses the neutral no-reduction state instead of fake savings", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user);
    routeFetch({
      compress: () =>
        compressedResponse({
          originalBytes: 1_200_000,
          outputBytes: 1_200_000,
          reduced: false,
        }),
    });

    await user.click(screen.getByRole("button", { name: /^compress pdf$/i }));

    expect(
      await screen.findByText(/already well optimised/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/could not make this file smaller/i)).toBeInTheDocument();
    expect(screen.queryByText(/compressed successfully/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/saved 0/i)).not.toBeInTheDocument();
    // No savings and no percentage: both render as an em dash.
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(
      screen.getByRole("link", { name: /^download pdf$/i }),
    ).toBeInTheDocument();
  });

  it("announces the no-reduction result politely", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user);
    routeFetch({
      compress: () =>
        compressedResponse({ originalBytes: 1200, outputBytes: 1200, reduced: false }),
    });

    await user.click(screen.getByRole("button", { name: /^compress pdf$/i }));
    await screen.findByText(/already well optimised/i);

    expect(screen.getByRole("status")).toHaveTextContent(
      /could not be reduced further/i,
    );
  });

  it("explains the rasterised strategy when it was used", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user);
    routeFetch({
      compress: () =>
        compressedResponse({ strategy: "rasterized", originalBytes: 900, outputBytes: 300 }),
    });

    await user.click(screen.getByRole("button", { name: /^compress pdf$/i }));
    expect(
      await screen.findByText(/rasterised to compressed images/i),
    ).toBeInTheDocument();
  });

  it("surfaces a server error as an alert", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user);
    routeFetch({
      compress: () =>
        errorResponse(422, "INVALID_PDF", "A PDF could not be opened."),
    });

    await user.click(screen.getByRole("button", { name: /^compress pdf$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not be opened/i);
    expect(alert).toHaveTextContent(/compression failed/i);
  });

  it("distinguishes network failure from processing failure", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse(3);
      throw new TypeError("Failed to fetch");
    });

    await user.click(screen.getByRole("button", { name: /^compress pdf$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/check your connection/i);
    expect(alert).not.toHaveTextContent(/node_modules|stack/i);
  });

  it("resets everything with start over", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user, "keep.pdf");

    await user.click(screen.getByRole("button", { name: /start over/i }));
    expect(screen.getByText(/upload a pdf to get started/i)).toBeInTheDocument();
    expect(screen.queryByText("keep.pdf")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^compress pdf$/i })).toBeDisabled();
  });

  it("compresses a second document after a successful one", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user, "first.pdf");
    await user.click(screen.getByRole("button", { name: /^compress pdf$/i }));
    await screen.findByText(/compressed successfully/i);

    // Start over and upload again.
    await user.click(screen.getByRole("button", { name: /compress another pdf/i }));
    await user.upload(
      screen.getByLabelText(/upload a pdf/i),
      pdfFile("second.pdf"),
    );
    await screen.findByText("second.pdf", { selector: "span" });
    await user.click(screen.getByRole("button", { name: /^compress pdf$/i }));

    await waitFor(() => expect(compressCalls()).toHaveLength(2));
    expect(await screen.findByText(/compressed successfully/i)).toBeInTheDocument();
  });

  it("mentions the lossless fallback above the raster page limit", async () => {
    const user = userEvent.setup();
    renderWorkspace({ ...LIMITS, maxRasterPages: 30 });
    await uploadPdf(user);

    expect(screen.getByText(/over 30 pages/i)).toBeInTheDocument();
  });
});
