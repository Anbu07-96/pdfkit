import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SplitPdfWorkspace } from "@/components/tools/workspaces/split-pdf-workspace";
import { ToastProvider } from "@/components/ui/toast";

const LIMITS = { maxFileSize: 25 * 1024 * 1024, maxOutputs: 50, thumbnailMaxPages: 60 };

function pdfFile(name = "document.pdf", size = 4096) {
  const file = new File(["%PDF-1.7"], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function renderWorkspace(limits = LIMITS) {
  return render(
    <ToastProvider>
      <SplitPdfWorkspace limits={limits} />
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

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function thumbnailListResponse(pageCount: number) {
  return fakeResponse({
    headers: { "content-type": "application/json" },
    json: {
      pageCount,
      thumbnails: Array.from({ length: pageCount }, (_, index) => ({
        pageNumber: index + 1,
        rotation: 0,
        width: 220,
        height: 300,
        dataUrl: PIXEL,
      })),
    },
  });
}

function inspectResponse(pageCount: number) {
  return fakeResponse({
    headers: { "content-type": "application/json" },
    json: { fileName: "document.pdf", size: 4096, pageCount },
  });
}

function zipResponse(artifacts: number) {
  return fakeResponse({
    headers: {
      "content-type": "application/zip",
      "content-disposition": 'attachment; filename="document-split.zip"',
      "x-pdfkit-artifacts": String(artifacts),
    },
    blob: new Blob(["PK"], { type: "application/zip" }),
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

/** Route each call by URL so inspection and splitting can be stubbed apart. */
function routeFetch(handlers: {
  inspect?: () => Response;
  thumbnails?: () => Response;
  split?: () => Response;
}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/api/documents/inspect")) {
      return handlers.inspect?.() ?? inspectResponse(10);
    }
    if (url.includes("/api/documents/thumbnails")) {
      return handlers.thumbnails?.() ?? thumbnailListResponse(10);
    }
    return handlers.split?.() ?? zipResponse(10);
  });
}

/** Calls made to the split endpoint (i.e. actual processing requests). */
function splitCalls() {
  return fetchMock.mock.calls.filter(
    (call) => call[0] === "/api/tools/split-pdf",
  );
}

async function uploadPdf(
  user: ReturnType<typeof userEvent.setup>,
  name = "document.pdf",
) {
  await user.upload(screen.getByLabelText(/upload a pdf/i), pdfFile(name));
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SplitPdfWorkspace", () => {
  it("starts with an upload prompt and a disabled action", () => {
    renderWorkspace();

    expect(screen.getByLabelText(/upload a pdf/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /browse files/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^split pdf$/i })).toBeDisabled();
    expect(screen.getByText(/upload a pdf to get started/i)).toBeInTheDocument();
  });

  it("shows the page count reported by the server", async () => {
    const user = userEvent.setup();
    routeFetch({ inspect: () => inspectResponse(24) });
    renderWorkspace();

    await uploadPdf(user);

    expect(await screen.findByText("24 pages")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/documents/inspect");
    expect(screen.getByRole("button", { name: /^split pdf$/i })).toBeEnabled();
  });

  it("reports a PDF that cannot be read instead of guessing", async () => {
    const user = userEvent.setup();
    routeFetch({
      inspect: () => errorResponse(422, "INVALID_PDF", "A PDF could not be opened."),
    });
    renderWorkspace();

    await uploadPdf(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be opened/i);
    expect(screen.getByRole("button", { name: /^split pdf$/i })).toBeDisabled();
  });

  it("explains the every-page mode using the real page count", async () => {
    const user = userEvent.setup();
    routeFetch({ inspect: () => inspectResponse(7) });
    renderWorkspace();

    await uploadPdf(user);
    await screen.findByText("7 pages");

    expect(screen.getByRole("radio", { name: /split every page/i })).toBeChecked();
    expect(screen.getByText(/will produce/i)).toHaveTextContent("7 PDFs");
    expect(screen.getByText(/maximum 50 output files/i)).toBeInTheDocument();
  });

  it("switches to range mode and validates before sending anything", async () => {
    const user = userEvent.setup();
    routeFetch({ inspect: () => inspectResponse(10) });
    renderWorkspace();

    await uploadPdf(user);
    await screen.findByText("10 pages");

    await user.click(screen.getByRole("radio", { name: /split by page ranges/i }));
    const input = screen.getByRole("textbox", { name: /page ranges/i });
    expect(screen.getByRole("button", { name: /^split pdf$/i })).toBeDisabled();

    await user.type(input, "1-99");
    expect(await screen.findByText(/page 99 does not exist/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^split pdf$/i })).toBeDisabled();

    await user.clear(input);
    await user.type(input, "5-2");
    expect(await screen.findByText(/is not valid/i)).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "1-5, 4-8");
    expect(await screen.findByText(/overlapping ranges are not supported/i)).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "1-3, 4-6");
    expect(await screen.findByText(/2 PDFs will be created/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^split pdf$/i })).toBeEnabled();

    // Invalid input never reached the processing endpoint.
    expect(splitCalls()).toHaveLength(0);
  });

  it("sends the chosen mode and ranges to the API", async () => {
    const user = userEvent.setup();
    routeFetch({ inspect: () => inspectResponse(10), split: () => zipResponse(3) });
    renderWorkspace();

    await uploadPdf(user);
    await screen.findByText("10 pages");

    await user.click(screen.getByRole("radio", { name: /split by page ranges/i }));
    await user.type(
      screen.getByRole("textbox", { name: /page ranges/i }),
      "1-3, 4-7, 8-10",
    );
    await user.click(screen.getByRole("button", { name: /^split pdf$/i }));

    await waitFor(() => expect(splitCalls()).toHaveLength(1));

    const [, init] = splitCalls()[0];
    const body = init.body as FormData;
    expect(body.get("mode")).toBe("ranges");
    expect(body.get("ranges")).toBe("1-3, 4-7, 8-10");
    expect((body.getAll("files")[0] as File).name).toBe("document.pdf");
  });

  it("shows the success state with a real download link", async () => {
    const user = userEvent.setup();
    routeFetch({ inspect: () => inspectResponse(5), split: () => zipResponse(5) });
    renderWorkspace();

    await uploadPdf(user);
    await screen.findByText("5 pages");
    await user.click(screen.getByRole("button", { name: /^split pdf$/i }));

    expect(
      await screen.findByText(/successfully created 5 pdfs/i),
    ).toBeInTheDocument();

    const link = screen.getByRole("link", { name: /download all \(zip\)/i });
    expect(link).toHaveAttribute("download", "document-split.zip");
    expect(link.getAttribute("href")).toMatch(/^blob:/);
  });

  it("surfaces a server error without offering a download", async () => {
    const user = userEvent.setup();
    routeFetch({
      inspect: () => inspectResponse(80),
      split: () =>
        errorResponse(
          413,
          "TOO_MANY_OUTPUTS",
          "This would create 80 PDFs, above the limit of 50.",
        ),
    });
    renderWorkspace();

    await uploadPdf(user);
    await screen.findByText("80 pages");

    // The client already warns, so switch to a valid-looking configuration.
    await user.click(screen.getByRole("radio", { name: /split by page ranges/i }));
    await user.type(screen.getByRole("textbox", { name: /page ranges/i }), "1-10");
    await user.click(screen.getByRole("button", { name: /^split pdf$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/above the limit of 50/i);
    expect(screen.queryByRole("link", { name: /download/i })).not.toBeInTheDocument();
  });

  it("blocks every-page mode when it would exceed the output limit", async () => {
    const user = userEvent.setup();
    routeFetch({ inspect: () => inspectResponse(12) });
    renderWorkspace({ ...LIMITS, maxOutputs: 5 });

    await uploadPdf(user);
    await screen.findByText("12 pages");

    expect(screen.getByText(/too many output files/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^split pdf$/i })).toBeDisabled();
    expect(splitCalls()).toHaveLength(0);
  });

  it("resets everything when starting over", async () => {
    const user = userEvent.setup();
    routeFetch({ inspect: () => inspectResponse(5), split: () => zipResponse(5) });
    renderWorkspace();

    await uploadPdf(user);
    await screen.findByText("5 pages");
    await user.click(screen.getByRole("button", { name: /^split pdf$/i }));
    await screen.findByRole("link", { name: /download all \(zip\)/i });

    await user.click(screen.getByRole("button", { name: /split another pdf/i }));

    expect(screen.queryByRole("link", { name: /download/i })).not.toBeInTheDocument();
    expect(screen.queryByText("5 pages")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^split pdf$/i })).toBeDisabled();
  });

  it("announces progress and results to screen readers", async () => {
    const user = userEvent.setup();
    routeFetch({ inspect: () => inspectResponse(3), split: () => zipResponse(3) });
    renderWorkspace();

    await uploadPdf(user);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/pdf loaded with 3 pages/i),
    );

    await user.click(screen.getByRole("button", { name: /^split pdf$/i }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/split complete/i),
    );
  });
});
