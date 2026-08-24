import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeletePdfPagesWorkspace } from "@/components/tools/workspaces/delete-pdf-pages-workspace";
import { ExtractPdfPagesWorkspace } from "@/components/tools/workspaces/extract-pdf-pages-workspace";
import { ToastProvider } from "@/components/ui/toast";

const LIMITS = { maxFileSize: 25 * 1024 * 1024, thumbnailMaxPages: 60 };

function pdfFile(name = "document.pdf", size = 4096) {
  const file = new File(["%PDF-1.7"], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: size });
  return file;
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

function thumbnailResponse(pageCount: number) {
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

function pdfResponse(fileName: string, outputPages: number) {
  return fakeResponse({
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${fileName}"`,
      "x-pdfkit-artifacts": "1",
      "x-pdfkit-output-pages": String(outputPages),
    },
    blob: new Blob(["%PDF-1.7 result"], { type: "application/pdf" }),
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

function routeFetch(handlers: {
  inspect?: () => Response;
  thumbnails?: () => Response;
  run?: () => Response;
}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/api/documents/inspect")) {
      return handlers.inspect?.() ?? inspectResponse(10);
    }
    if (url.includes("/api/documents/thumbnails")) {
      return handlers.thumbnails?.() ?? thumbnailResponse(10);
    }
    return handlers.run?.() ?? pdfResponse("document-extracted.pdf", 3);
  });
}

/** Calls made to a tool endpoint (i.e. actual processing requests). */
function toolCalls(endpoint: string) {
  return fetchMock.mock.calls.filter((call) => call[0] === endpoint);
}

async function uploadPdf(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText(/upload a pdf/i), pdfFile());
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* Extract                                                                    */
/* -------------------------------------------------------------------------- */
function renderExtract() {
  return render(
    <ToastProvider>
      <ExtractPdfPagesWorkspace limits={LIMITS} />
    </ToastProvider>,
  );
}

describe("ExtractPdfPagesWorkspace", () => {
  it("starts with an upload prompt and a disabled action", () => {
    renderExtract();
    expect(screen.getByLabelText(/upload a pdf/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /extract pages/i })).toBeDisabled();
    expect(screen.getByText(/upload a pdf to get started/i)).toBeInTheDocument();
  });

  it("shows the page count reported by the server", async () => {
    const user = userEvent.setup();
    routeFetch({ inspect: () => inspectResponse(24) });
    renderExtract();

    await uploadPdf(user);

    expect(await screen.findByText("24 pages")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/documents/inspect");
  });

  it("reports a PDF that cannot be read", async () => {
    const user = userEvent.setup();
    routeFetch({
      inspect: () => errorResponse(422, "INVALID_PDF", "A PDF could not be opened."),
    });
    renderExtract();

    await uploadPdf(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be opened/i);
    expect(screen.getByRole("button", { name: /extract pages/i })).toBeDisabled();
  });

  it("validates the selection as the user types", async () => {
    const user = userEvent.setup();
    routeFetch({ inspect: () => inspectResponse(10) });
    renderExtract();

    await uploadPdf(user);
    await screen.findByText("10 pages");

    const input = screen.getByRole("textbox", { name: /pages to extract/i });
    expect(screen.getByRole("button", { name: /extract pages/i })).toBeDisabled();

    await user.type(input, "abc");
    expect(await screen.findByText(/is not a valid page range/i)).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "25");
    expect(await screen.findByText(/page 25 does not exist/i)).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "1-5, 4-8");
    expect(
      await screen.findByText(/overlapping ranges are not supported/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /extract pages/i })).toBeDisabled();

    await user.clear(input);
    await user.type(input, "1-3, 5");
    expect(await screen.findByText(/will be extracted into one PDF/i)).toBeInTheDocument();
    expect(screen.getByText("4 pages")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /extract pages/i })).toBeEnabled();

    // Nothing invalid ever reached the processing endpoint.
    expect(toolCalls("/api/tools/extract-pdf-pages")).toHaveLength(0);
  });

  it("sends the selection and offers a real download", async () => {
    const user = userEvent.setup();
    routeFetch({
      inspect: () => inspectResponse(10),
      run: () => pdfResponse("document-extracted.pdf", 6),
    });
    renderExtract();

    await uploadPdf(user);
    await screen.findByText("10 pages");
    await user.type(
      screen.getByRole("textbox", { name: /pages to extract/i }),
      "1-2, 5, 8-10",
    );
    await user.click(screen.getByRole("button", { name: /extract pages/i }));

    await waitFor(() =>
      expect(toolCalls("/api/tools/extract-pdf-pages")).toHaveLength(1),
    );
    const [, init] = toolCalls("/api/tools/extract-pdf-pages")[0];
    expect((init.body as FormData).get("ranges")).toBe("1-2, 5, 8-10");

    expect(
      await screen.findByRole("heading", { name: /successfully extracted 6 pages/i }),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /download pdf/i });
    expect(link).toHaveAttribute("download", "document-extracted.pdf");
    expect(link.getAttribute("href")).toMatch(/^blob:/);
  });

  it("surfaces a server error and offers no download", async () => {
    const user = userEvent.setup();
    routeFetch({
      inspect: () => inspectResponse(10),
      run: () => errorResponse(422, "INVALID_PDF", "A PDF could not be opened."),
    });
    renderExtract();

    await uploadPdf(user);
    await screen.findByText("10 pages");
    await user.type(screen.getByRole("textbox", { name: /pages to extract/i }), "1");
    await user.click(screen.getByRole("button", { name: /extract pages/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be opened/i);
    expect(screen.queryByRole("link", { name: /download/i })).not.toBeInTheDocument();
  });

  it("reports a network failure without pretending to succeed", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("inspect")) return inspectResponse(5);
      throw new TypeError("Failed to fetch");
    });
    renderExtract();

    await uploadPdf(user);
    await screen.findByText("5 pages");
    await user.type(screen.getByRole("textbox", { name: /pages to extract/i }), "1");
    await user.click(screen.getByRole("button", { name: /extract pages/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not be sent|could not be processed/i,
    );
  });

  it("resets back to the upload state", async () => {
    const user = userEvent.setup();
    routeFetch({ inspect: () => inspectResponse(5), run: () => pdfResponse("d.pdf", 1) });
    renderExtract();

    await uploadPdf(user);
    await screen.findByText("5 pages");
    await user.type(screen.getByRole("textbox", { name: /pages to extract/i }), "1");
    await user.click(screen.getByRole("button", { name: /extract pages/i }));
    await screen.findByRole("link", { name: /download pdf/i });

    await user.click(screen.getByRole("button", { name: /extract another pdf/i }));

    expect(screen.queryByRole("link", { name: /download pdf/i })).not.toBeInTheDocument();
    expect(screen.queryByText("5 pages")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /extract pages/i })).toBeDisabled();
  });

  it("announces progress and results", async () => {
    const user = userEvent.setup();
    routeFetch({ inspect: () => inspectResponse(3), run: () => pdfResponse("d.pdf", 2) });
    renderExtract();

    await uploadPdf(user);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/pdf loaded with 3 pages/i),
    );

    await user.type(screen.getByRole("textbox", { name: /pages to extract/i }), "1-2");
    await user.click(screen.getByRole("button", { name: /extract pages/i }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        /successfully extracted 2 pages/i,
      ),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Delete                                                                     */
/* -------------------------------------------------------------------------- */
function renderDelete() {
  return render(
    <ToastProvider>
      <DeletePdfPagesWorkspace limits={LIMITS} />
    </ToastProvider>,
  );
}

describe("DeletePdfPagesWorkspace", () => {
  it("starts with an upload prompt and a disabled action", () => {
    renderDelete();
    expect(screen.getByLabelText(/upload a pdf/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete pages/i })).toBeDisabled();
  });

  it("shows the server page count", async () => {
    const user = userEvent.setup();
    routeFetch({ inspect: () => inspectResponse(12) });
    renderDelete();

    await uploadPdf(user);
    expect(await screen.findByText("12 pages")).toBeInTheDocument();
  });

  it("summarises how many pages are removed and remain", async () => {
    const user = userEvent.setup();
    routeFetch({ inspect: () => inspectResponse(10) });
    renderDelete();

    await uploadPdf(user);
    await screen.findByText("10 pages");

    await user.type(screen.getByRole("textbox", { name: /pages to delete/i }), "2, 4, 7");

    expect(await screen.findByText(/will be removed/i)).toBeInTheDocument();
    expect(screen.getByText("3 pages")).toBeInTheDocument();
    expect(screen.getByText("7 pages")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete pages/i })).toBeEnabled();
  });

  it("blocks deleting every page before contacting the server", async () => {
    const user = userEvent.setup();
    routeFetch({ inspect: () => inspectResponse(10) });
    renderDelete();

    await uploadPdf(user);
    await screen.findByText("10 pages");

    await user.type(screen.getByRole("textbox", { name: /pages to delete/i }), "1-10");

    expect(await screen.findByText(/must keep at least one page/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete pages/i })).toBeDisabled();
    expect(toolCalls("/api/tools/delete-pdf-pages")).toHaveLength(0);
  });

  it("validates syntax, bounds and overlap", async () => {
    const user = userEvent.setup();
    routeFetch({ inspect: () => inspectResponse(8) });
    renderDelete();

    await uploadPdf(user);
    await screen.findByText("8 pages");
    const input = screen.getByRole("textbox", { name: /pages to delete/i });

    await user.type(input, "xyz");
    expect(await screen.findByText(/is not a valid page range/i)).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "12");
    expect(await screen.findByText(/page 12 does not exist/i)).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "1-4, 3-5");
    expect(
      await screen.findByText(/overlapping ranges are not supported/i),
    ).toBeInTheDocument();
  });

  it("sends the pages to remove and offers a real download", async () => {
    const user = userEvent.setup();
    routeFetch({
      inspect: () => inspectResponse(10),
      run: () => pdfResponse("document-pages-removed.pdf", 7),
    });
    renderDelete();

    await uploadPdf(user);
    await screen.findByText("10 pages");
    await user.type(screen.getByRole("textbox", { name: /pages to delete/i }), "2, 4, 7");
    await user.click(screen.getByRole("button", { name: /delete pages/i }));

    await waitFor(() =>
      expect(toolCalls("/api/tools/delete-pdf-pages")).toHaveLength(1),
    );
    const [, init] = toolCalls("/api/tools/delete-pdf-pages")[0];
    expect((init.body as FormData).get("ranges")).toBe("2, 4, 7");

    expect(
      await screen.findByRole("heading", { name: /7 pages remain/i }),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /download pdf/i });
    expect(link).toHaveAttribute("download", "document-pages-removed.pdf");
  });

  it("shows the server error when deletion is refused", async () => {
    const user = userEvent.setup();
    routeFetch({
      inspect: () => inspectResponse(5),
      run: () =>
        errorResponse(400, "NO_PAGES_REMAIN", "You must keep at least one page."),
    });
    renderDelete();

    await uploadPdf(user);
    await screen.findByText("5 pages");
    await user.type(screen.getByRole("textbox", { name: /pages to delete/i }), "1-4");
    await user.click(screen.getByRole("button", { name: /delete pages/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/at least one page/i);
    expect(screen.queryByRole("link", { name: /download/i })).not.toBeInTheDocument();
  });

  it("resets back to the upload state", async () => {
    const user = userEvent.setup();
    routeFetch({ inspect: () => inspectResponse(5), run: () => pdfResponse("d.pdf", 4) });
    renderDelete();

    await uploadPdf(user);
    await screen.findByText("5 pages");
    await user.type(screen.getByRole("textbox", { name: /pages to delete/i }), "3");
    await user.click(screen.getByRole("button", { name: /delete pages/i }));
    await screen.findByRole("link", { name: /download pdf/i });

    await user.click(
      screen.getByRole("button", { name: /delete pages from another pdf/i }),
    );

    expect(screen.queryByRole("link", { name: /download pdf/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete pages/i })).toBeDisabled();
  });
});
