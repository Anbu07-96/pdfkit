import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReorderPdfPagesWorkspace } from "@/components/tools/workspaces/reorder-pdf-pages-workspace";
import { ToastProvider } from "@/components/ui/toast";

const LIMITS = { maxFileSize: 25 * 1024 * 1024, thumbnailMaxPages: 60 };

/** 1x1 transparent PNG — enough for an <img src>; identity is tested server-side. */
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function pdfFile(name = "document.pdf", size = 4096) {
  const file = new File(["%PDF-1.7"], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

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

const inspectResponse = (pageCount: number) =>
  fakeResponse({
    headers: { "content-type": "application/json" },
    json: { fileName: "document.pdf", size: 4096, pageCount },
  });

const thumbnailResponse = (pageCount: number) =>
  fakeResponse({
    headers: { "content-type": "application/json" },
    json: {
      pageCount,
      thumbnails: Array.from({ length: pageCount }, (_, index) => ({
        pageNumber: index + 1,
        width: 220,
        height: 300,
        dataUrl: PIXEL,
      })),
    },
  });

const pdfResponse = (fileName: string, outputPages: number) =>
  fakeResponse({
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${fileName}"`,
      "x-pdfkit-artifacts": "1",
      "x-pdfkit-output-pages": String(outputPages),
    },
    blob: new Blob(["%PDF-1.7 result"], { type: "application/pdf" }),
  });

const errorResponse = (status: number, code: string, message: string) =>
  fakeResponse({
    ok: false,
    status,
    headers: { "content-type": "application/json" },
    json: { error: { code, message } },
  });

let fetchMock: ReturnType<typeof vi.fn>;

function routeFetch(handlers: {
  inspect?: () => Response;
  thumbnails?: () => Response;
  reorder?: () => Response;
}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/api/documents/inspect")) {
      return handlers.inspect?.() ?? inspectResponse(5);
    }
    if (url.includes("/api/documents/thumbnails")) {
      return handlers.thumbnails?.() ?? thumbnailResponse(5);
    }
    return handlers.reorder?.() ?? pdfResponse("document-reordered.pdf", 5);
  });
}

function renderWorkspace(limits = LIMITS) {
  return render(
    <ToastProvider>
      <ReorderPdfPagesWorkspace limits={limits} />
    </ToastProvider>,
  );
}

async function uploadPdf(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText(/upload a pdf/i), pdfFile());
}

/** The page numbers currently rendered, in visual order. */
function visibleOrder(): number[] {
  const grid = screen.getByTestId("page-order-grid");
  return Array.from(grid.querySelectorAll("li")).map((item) =>
    Number(item.getAttribute("data-page")),
  );
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ReorderPdfPagesWorkspace", () => {
  it("starts with an upload prompt and a disabled action", () => {
    renderWorkspace();

    expect(screen.getByLabelText(/upload a pdf/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /browse files/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reorder pdf$/i })).toBeDisabled();
    expect(screen.getByText(/upload a pdf to get started/i)).toBeInTheDocument();
  });

  it("shows the server page count and then real previews", async () => {
    const user = userEvent.setup();
    routeFetch({ inspect: () => inspectResponse(5) });
    renderWorkspace();

    await uploadPdf(user);

    expect(await screen.findByText("5 pages")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/documents/inspect");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/documents/thumbnails");

    const images = await screen.findAllByRole("img");
    expect(images).toHaveLength(5);
    expect(images[0]).toHaveAttribute("alt", "Preview of page 1");
    expect(images[0].getAttribute("src")).toBe(PIXEL);
  });

  it("lists the pages in document order with position labels", async () => {
    const user = userEvent.setup();
    routeFetch({});
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");

    expect(visibleOrder()).toEqual([1, 2, 3, 4, 5]);
    expect(screen.getByText("Page 1")).toBeInTheDocument();
    expect(screen.getByText("Position 1")).toBeInTheDocument();
  });

  it("moves the first page later and the last page earlier", async () => {
    const user = userEvent.setup();
    routeFetch({});
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");

    await user.click(screen.getByRole("button", { name: /move page 1 later/i }));
    expect(visibleOrder()).toEqual([2, 1, 3, 4, 5]);

    await user.click(screen.getByRole("button", { name: /move page 5 earlier/i }));
    expect(visibleOrder()).toEqual([2, 1, 3, 5, 4]);
  });

  it("disables the movement controls at the ends", async () => {
    const user = userEvent.setup();
    routeFetch({});
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");

    expect(
      screen.getByRole("button", { name: /page 1 is already first/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /page 5 is already last/i }),
    ).toBeDisabled();
  });

  it("announces every move to screen readers", async () => {
    const user = userEvent.setup();
    routeFetch({});
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");

    await user.click(screen.getByRole("button", { name: /move page 3 earlier/i }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        /page 3 moved to position 2 of 5/i,
      ),
    );
  });

  it("can be reordered entirely with the keyboard", async () => {
    const user = userEvent.setup();
    routeFetch({});
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");

    const moveLater = screen.getByRole("button", { name: /move page 1 later/i });
    moveLater.focus();
    expect(moveLater).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(visibleOrder()).toEqual([2, 1, 3, 4, 5]);
  });

  it("resets the order back to the document order", async () => {
    const user = userEvent.setup();
    routeFetch({});
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");

    await user.click(screen.getByRole("button", { name: /move page 1 later/i }));
    expect(visibleOrder()).toEqual([2, 1, 3, 4, 5]);

    await user.click(screen.getByRole("button", { name: /reset order/i }));
    expect(visibleOrder()).toEqual([1, 2, 3, 4, 5]);
  });

  it("submits the complete explicit order", async () => {
    const user = userEvent.setup();
    routeFetch({});
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");

    await user.click(screen.getByRole("button", { name: /move page 5 earlier/i }));
    await user.click(screen.getByRole("button", { name: /move page 5 earlier/i }));
    expect(visibleOrder()).toEqual([1, 2, 5, 3, 4]);

    await user.click(screen.getByRole("button", { name: /^reorder pdf$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const [url, init] = fetchMock.mock.calls[2];
    expect(url).toBe("/api/tools/reorder-pdf-pages");
    // The whole order is sent, not just what changed.
    expect((init.body as FormData).get("order")).toBe("1,2,5,3,4");
    expect(((init.body as FormData).getAll("files")[0] as File).name).toBe(
      "document.pdf",
    );
  });

  it("shows the success state with a real download", async () => {
    const user = userEvent.setup();
    routeFetch({});
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");
    await user.click(screen.getByRole("button", { name: /^reorder pdf$/i }));

    expect(
      await screen.findByRole("heading", { name: /your reordered pdf is ready/i }),
    ).toBeInTheDocument();

    const link = screen.getByRole("link", { name: /download pdf/i });
    expect(link).toHaveAttribute("download", "document-reordered.pdf");
    expect(link.getAttribute("href")).toMatch(/^blob:/);
  });

  it("allows an unchanged order but says so", async () => {
    const user = userEvent.setup();
    routeFetch({});
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");

    expect(screen.getByText(/nothing has been moved yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reorder pdf$/i })).toBeEnabled();
  });

  it("keeps reordering disabled while previews are loading", async () => {
    const user = userEvent.setup();
    let releaseThumbnails: () => void = () => {};
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("inspect")) return inspectResponse(3);
      if (url.includes("thumbnails")) {
        await new Promise<void>((resolve) => {
          releaseThumbnails = resolve;
        });
        return thumbnailResponse(3);
      }
      return pdfResponse("x.pdf", 3);
    });

    renderWorkspace();
    await uploadPdf(user);

    // The visible status and the screen-reader live region both say this.
    expect((await screen.findAllByText(/generating page previews/i)).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /^reorder pdf$/i })).toBeDisabled();

    releaseThumbnails();
    await screen.findAllByRole("img");
    expect(screen.getByRole("button", { name: /^reorder pdf$/i })).toBeEnabled();
  });

  it("reports a preview failure and refuses to reorder without previews", async () => {
    const user = userEvent.setup();
    routeFetch({
      thumbnails: () =>
        errorResponse(500, "PROCESSING_ERROR", "A page preview could not be generated."),
    });
    renderWorkspace();

    await uploadPdf(user);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/page previews couldn’t be generated/i);
    expect(screen.getByRole("button", { name: /^reorder pdf$/i })).toBeDisabled();
    // No fake page images are shown in place of the real previews.
    expect(screen.queryAllByRole("img")).toHaveLength(0);
    expect(screen.getAllByText(/preview unavailable/i).length).toBeGreaterThan(0);
  });

  it("can retry failed previews", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("inspect")) return inspectResponse(2);
      if (url.includes("thumbnails")) {
        attempt += 1;
        return attempt === 1
          ? errorResponse(500, "PROCESSING_ERROR", "Preview failed.")
          : thumbnailResponse(2);
      }
      return pdfResponse("x.pdf", 2);
    });

    renderWorkspace();
    await uploadPdf(user);
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findAllByRole("img")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /^reorder pdf$/i })).toBeEnabled();
  });

  it("reports an inspection failure", async () => {
    const user = userEvent.setup();
    routeFetch({
      inspect: () => errorResponse(422, "INVALID_PDF", "A PDF could not be opened."),
    });
    renderWorkspace();

    await uploadPdf(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be opened/i);
    expect(screen.getByRole("button", { name: /^reorder pdf$/i })).toBeDisabled();
  });

  it("surfaces a server error from the reorder request", async () => {
    const user = userEvent.setup();
    routeFetch({
      reorder: () =>
        errorResponse(400, "INVALID_PAGE_ORDER", "Page 3 appears more than once."),
    });
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");
    await user.click(screen.getByRole("button", { name: /^reorder pdf$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/more than once/i);
    expect(screen.queryByRole("link", { name: /download/i })).not.toBeInTheDocument();
  });

  it("reports a network failure without pretending to succeed", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("inspect")) return inspectResponse(3);
      if (url.includes("thumbnails")) return thumbnailResponse(3);
      throw new TypeError("Failed to fetch");
    });
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");
    await user.click(screen.getByRole("button", { name: /^reorder pdf$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not be sent|could not be reordered/i,
    );
  });

  it("resets everything when starting over", async () => {
    const user = userEvent.setup();
    routeFetch({});
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");
    await user.click(screen.getByRole("button", { name: /^reorder pdf$/i }));
    await screen.findByRole("link", { name: /download pdf/i });

    await user.click(screen.getByRole("button", { name: /reorder another pdf/i }));

    expect(screen.queryByRole("link", { name: /download pdf/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("page-order-grid")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reorder pdf$/i })).toBeDisabled();
  });

  it("explains that long documents cannot be reordered yet", async () => {
    const user = userEvent.setup();
    routeFetch({ inspect: () => inspectResponse(80), thumbnails: () => thumbnailResponse(2) });
    renderWorkspace({ maxFileSize: LIMITS.maxFileSize, thumbnailMaxPages: 60 });

    await uploadPdf(user);

    expect(
      await screen.findByText(/previews are shown for the first 60 pages/i),
    ).toBeInTheDocument();
  });

  it("keeps page identity separate from position", async () => {
    const user = userEvent.setup();
    routeFetch({});
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");

    await user.click(screen.getByRole("button", { name: /move page 5 earlier/i }));

    const grid = screen.getByTestId("page-order-grid");
    const items = Array.from(grid.querySelectorAll("li"));
    const moved = items[3];

    // Page 5 is now at position 4 but is still labelled page 5.
    expect(moved.getAttribute("data-page")).toBe("5");
    expect(moved.getAttribute("data-position")).toBe("4");
    expect(within(moved as HTMLElement).getByText("Page 5")).toBeInTheDocument();
    expect(within(moved as HTMLElement).getByText("Position 4")).toBeInTheDocument();
  });
});
