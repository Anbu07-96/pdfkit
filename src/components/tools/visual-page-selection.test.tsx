import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeletePdfPagesWorkspace } from "@/components/tools/workspaces/delete-pdf-pages-workspace";
import { ExtractPdfPagesWorkspace } from "@/components/tools/workspaces/extract-pdf-pages-workspace";
import { SplitPdfWorkspace } from "@/components/tools/workspaces/split-pdf-workspace";
import { ToastProvider } from "@/components/ui/toast";

/**
 * Visual page selection (Phase 6).
 *
 * The page-range field remains the single source of truth: clicking a page
 * rewrites it, and editing it re-derives the highlighted pages. These tests
 * check that synchronisation in both directions, and that the grid degrades
 * honestly when previews are unavailable.
 */

const LIMITS = { maxFileSize: 25 * 1024 * 1024, thumbnailMaxPages: 60 };
const SPLIT_LIMITS = { ...LIMITS, maxOutputs: 50 };

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
        rotation: 0,
        width: 220,
        height: 300,
        dataUrl: PIXEL,
      })),
    },
  });

const errorResponse = (status: number, code: string, message: string) =>
  fakeResponse({
    ok: false,
    status,
    headers: { "content-type": "application/json" },
    json: { error: { code, message } },
  });

let fetchMock: ReturnType<typeof vi.fn>;

function routeFetch({
  pageCount = 5,
  thumbnails,
}: { pageCount?: number; thumbnails?: () => Response } = {}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/api/documents/inspect")) return inspectResponse(pageCount);
    if (url.includes("/api/documents/thumbnails")) {
      return thumbnails?.() ?? thumbnailResponse(pageCount);
    }
    return fakeResponse({
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'attachment; filename="out.pdf"',
        "x-pdfkit-output-pages": "1",
      },
      blob: new Blob(["%PDF"], { type: "application/pdf" }),
    });
  });
}

async function uploadPdf(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText(/upload a pdf/i), pdfFile());
}

/** Pages currently highlighted in the visual grid. */
function selectedPages(): number[] {
  const grid = screen.getByTestId("page-preview-grid");
  return Array.from(grid.querySelectorAll("li"))
    .filter((item) => item.getAttribute("data-selected") === "true")
    .map((item) => Number(item.getAttribute("data-page")));
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Extract PDF Pages — visual selection", () => {
  function renderExtract() {
    return render(
      <ToastProvider>
        <ExtractPdfPagesWorkspace limits={LIMITS} />
      </ToastProvider>,
    );
  }

  it("shows a preview for every page after inspection", async () => {
    const user = userEvent.setup();
    routeFetch({ pageCount: 5 });
    renderExtract();

    await uploadPdf(user);

    const grid = await screen.findByTestId("page-preview-grid");
    expect(within(grid).getAllByRole("img")).toHaveLength(5);
    expect(selectedPages()).toEqual([]);
  });

  it("selects a single page and writes it to the range field", async () => {
    const user = userEvent.setup();
    routeFetch();
    renderExtract();

    await uploadPdf(user);
    await screen.findByTestId("page-preview-grid");

    await user.click(screen.getByRole("button", { name: /select page 3 to extract/i }));

    expect(screen.getByRole("textbox", { name: /pages to extract/i })).toHaveValue("3");
    expect(selectedPages()).toEqual([3]);
  });

  it("selects several pages and collapses runs into ranges", async () => {
    const user = userEvent.setup();
    routeFetch();
    renderExtract();

    await uploadPdf(user);
    await screen.findByTestId("page-preview-grid");

    await user.click(screen.getByRole("button", { name: /select page 1 to extract/i }));
    await user.click(screen.getByRole("button", { name: /select page 3 to extract/i }));
    await user.click(screen.getByRole("button", { name: /select page 5 to extract/i }));

    expect(screen.getByRole("textbox", { name: /pages to extract/i })).toHaveValue(
      "1, 3, 5",
    );
    expect(selectedPages()).toEqual([1, 3, 5]);

    // Adjacent pages become a range rather than a list.
    await user.click(screen.getByRole("button", { name: /select page 2 to extract/i }));
    expect(screen.getByRole("textbox", { name: /pages to extract/i })).toHaveValue(
      "1-3, 5",
    );
  });

  it("deselects a page that was already chosen", async () => {
    const user = userEvent.setup();
    routeFetch();
    renderExtract();

    await uploadPdf(user);
    await screen.findByTestId("page-preview-grid");

    await user.click(screen.getByRole("button", { name: /select page 2 to extract/i }));
    expect(selectedPages()).toEqual([2]);

    await user.click(
      screen.getByRole("button", { name: /page 2 is selected to extract/i }),
    );
    expect(selectedPages()).toEqual([]);
    expect(screen.getByRole("textbox", { name: /pages to extract/i })).toHaveValue("");
  });

  it("mirrors what the user types in the range field", async () => {
    const user = userEvent.setup();
    routeFetch();
    renderExtract();

    await uploadPdf(user);
    await screen.findByTestId("page-preview-grid");

    const input = screen.getByRole("textbox", { name: /pages to extract/i });
    await user.type(input, "2-4");

    expect(selectedPages()).toEqual([2, 3, 4]);

    await user.clear(input);
    await user.type(input, "1,5");
    expect(selectedPages()).toEqual([1, 5]);
  });

  it("selects every page when they are all chosen", async () => {
    const user = userEvent.setup();
    routeFetch({ pageCount: 3 });
    renderExtract();

    await uploadPdf(user);
    await screen.findByTestId("page-preview-grid");

    for (const page of [1, 2, 3]) {
      await user.click(
        screen.getByRole("button", { name: new RegExp(`select page ${page} to extract`, "i") }),
      );
    }

    expect(screen.getByRole("textbox", { name: /pages to extract/i })).toHaveValue("1-3");
    expect(selectedPages()).toEqual([1, 2, 3]);
  });

  it("exposes the selection state to assistive technology", async () => {
    const user = userEvent.setup();
    routeFetch();
    renderExtract();

    await uploadPdf(user);
    await screen.findByTestId("page-preview-grid");

    const button = screen.getByRole("button", { name: /select page 1 to extract/i });
    expect(button).toHaveAttribute("aria-pressed", "false");

    await user.click(button);
    expect(
      screen.getByRole("button", { name: /page 1 is selected to extract/i }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("falls back to the range field when previews fail", async () => {
    const user = userEvent.setup();
    routeFetch({
      thumbnails: () =>
        errorResponse(500, "PROCESSING_ERROR", "A page preview could not be generated."),
    });
    renderExtract();

    await uploadPdf(user);

    expect(
      await screen.findByText(/page previews couldn’t be generated/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("page-preview-grid")).not.toBeInTheDocument();

    // The tested text workflow still works.
    await userEvent.setup().type(
      screen.getByRole("textbox", { name: /pages to extract/i }),
      "1-2",
    );
    expect(screen.getByRole("button", { name: /extract pages/i })).toBeEnabled();
  });

  it("skips previews for documents above the limit, and says so", async () => {
    const user = userEvent.setup();
    routeFetch({ pageCount: 90 });
    render(
      <ToastProvider>
        <ExtractPdfPagesWorkspace
          limits={{ maxFileSize: LIMITS.maxFileSize, thumbnailMaxPages: 60 }}
        />
      </ToastProvider>,
    );

    await uploadPdf(user);
    await screen.findByText("90 pages");

    expect(
      screen.getByText(/more pages than the 60-page preview limit/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("page-preview-grid")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /pages to extract/i })).toBeInTheDocument();
  });
});

describe("Delete PDF Pages — visual selection", () => {
  function renderDelete() {
    return render(
      <ToastProvider>
        <DeletePdfPagesWorkspace limits={LIMITS} />
      </ToastProvider>,
    );
  }

  it("selects pages to remove and summarises the result", async () => {
    const user = userEvent.setup();
    routeFetch({ pageCount: 5 });
    renderDelete();

    await uploadPdf(user);
    await screen.findByTestId("page-preview-grid");

    await user.click(screen.getByRole("button", { name: /select page 2 to delete/i }));

    expect(screen.getByRole("textbox", { name: /pages to delete/i })).toHaveValue("2");
    expect(screen.getByText(/will be removed/i)).toBeInTheDocument();
    expect(screen.getByText("1 page")).toBeInTheDocument();
    expect(screen.getByText("4 pages")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /select page 4 to delete/i }));
    expect(screen.getByRole("textbox", { name: /pages to delete/i })).toHaveValue("2, 4");
    expect(screen.getByText("2 pages")).toBeInTheDocument();
    expect(screen.getByText("3 pages")).toBeInTheDocument();
  });

  it("mirrors the range field back into the grid", async () => {
    const user = userEvent.setup();
    routeFetch({ pageCount: 5 });
    renderDelete();

    await uploadPdf(user);
    await screen.findByTestId("page-preview-grid");

    await user.type(screen.getByRole("textbox", { name: /pages to delete/i }), "3-5");
    expect(selectedPages()).toEqual([3, 4, 5]);
  });

  it("keeps the zero-page protection when every page is selected", async () => {
    const user = userEvent.setup();
    routeFetch({ pageCount: 3 });
    renderDelete();

    await uploadPdf(user);
    await screen.findByTestId("page-preview-grid");

    for (const page of [1, 2, 3]) {
      await user.click(
        screen.getByRole("button", { name: new RegExp(`select page ${page} to delete`, "i") }),
      );
    }

    expect(await screen.findByText(/must keep at least one page/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete pages/i })).toBeDisabled();

    // Nothing was sent to the processing endpoint.
    const deleteCalls = fetchMock.mock.calls.filter(
      (call) => call[0] === "/api/tools/delete-pdf-pages",
    );
    expect(deleteCalls).toHaveLength(0);
  });
});

describe("Split PDF — preview context", () => {
  it("shows read-only previews alongside the existing range workflow", async () => {
    const user = userEvent.setup();
    routeFetch({ pageCount: 4 });
    render(
      <ToastProvider>
        <SplitPdfWorkspace limits={SPLIT_LIMITS} />
      </ToastProvider>,
    );

    await uploadPdf(user);

    const grid = await screen.findByTestId("page-preview-grid");
    expect(within(grid).getAllByRole("img")).toHaveLength(4);
    // Context only: pages are not clickable in Split.
    expect(within(grid).queryAllByRole("button")).toHaveLength(0);

    // The mode selector and range workflow are untouched.
    expect(screen.getByRole("radio", { name: /split every page/i })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: /split by page ranges/i }));
    await user.type(screen.getByRole("textbox", { name: /page ranges/i }), "1-2");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^split pdf$/i })).toBeEnabled(),
    );
  });
});
