import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RotatePdfWorkspace } from "@/components/tools/workspaces/rotate-pdf-workspace";
import { ToastProvider } from "@/components/ui/toast";

const LIMITS = { maxFileSize: 25 * 1024 * 1024, thumbnailMaxPages: 60 };

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

/** Echoes back the requested pages and rotations, like the real endpoint. */
function thumbnailResponse(request: FormData, pageCount: number) {
  const pages = String(request.get("pages") ?? "")
    .split(",")
    .filter(Boolean)
    .map(Number);
  const rotations = JSON.parse(String(request.get("rotations") ?? "{}")) as Record<
    string,
    number
  >;

  return fakeResponse({
    headers: { "content-type": "application/json" },
    json: {
      pageCount,
      thumbnails: (pages.length ? pages : [1]).map((page) => {
        const rotation = rotations[String(page)] ?? 0;
        const portrait = rotation === 0 || rotation === 180;
        return {
          pageNumber: page,
          rotation,
          width: portrait ? 220 : 300,
          height: portrait ? 300 : 220,
          dataUrl: PIXEL,
        };
      }),
    },
  });
}

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

function routeFetch({
  pageCount = 3,
  thumbnails,
  rotate,
  inspect,
}: {
  pageCount?: number;
  inspect?: () => Response;
  thumbnails?: (form: FormData) => Response;
  rotate?: () => Response;
} = {}) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes("/api/documents/inspect")) {
      return inspect?.() ?? inspectResponse(pageCount);
    }
    if (url.includes("/api/documents/thumbnails")) {
      const form = init?.body as FormData;
      return thumbnails?.(form) ?? thumbnailResponse(form, pageCount);
    }
    return rotate?.() ?? pdfResponse("document-rotated.pdf", pageCount);
  });
}

function renderWorkspace(limits = LIMITS) {
  return render(
    <ToastProvider>
      <RotatePdfWorkspace limits={limits} />
    </ToastProvider>,
  );
}

async function uploadPdf(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText(/upload a pdf/i), pdfFile());
}

/** Rotation currently shown for each page card, in order. */
function rotationState(): Record<number, number> {
  const grid = screen.getByTestId("rotate-page-grid");
  return Object.fromEntries(
    Array.from(grid.querySelectorAll("li")).map((item) => [
      Number(item.getAttribute("data-page")),
      Number(item.getAttribute("data-rotation")),
    ]),
  );
}

function rotateCalls() {
  return fetchMock.mock.calls.filter(
    (call) => call[0] === "/api/tools/rotate-pdf",
  );
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RotatePdfWorkspace", () => {
  it("starts with an upload prompt and a disabled action", () => {
    renderWorkspace();

    expect(screen.getByLabelText(/upload a pdf/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^rotate pdf$/i })).toBeDisabled();
    expect(screen.getByText(/upload a pdf to get started/i)).toBeInTheDocument();
  });

  it("shows the server page count and real previews", async () => {
    const user = userEvent.setup();
    routeFetch({ pageCount: 3 });
    renderWorkspace();

    await uploadPdf(user);

    expect(await screen.findByText("3 pages")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/documents/inspect");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/documents/thumbnails");

    const images = await screen.findAllByRole("img");
    expect(images).toHaveLength(3);
    expect(images[0]).toHaveAttribute("alt", "Preview of page 1");
  });

  it("shows every page as unrotated to begin with", async () => {
    const user = userEvent.setup();
    routeFetch();
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");

    expect(rotationState()).toEqual({ 1: 0, 2: 0, 3: 0 });
    expect(screen.getAllByText("Original")).toHaveLength(3);
    // Nothing has changed yet, so there is nothing to save.
    expect(screen.getByRole("button", { name: /^rotate pdf$/i })).toBeDisabled();
    expect(screen.getByText(/rotate at least one page to continue/i)).toBeInTheDocument();
  });

  it("rotates a single page clockwise through the full cycle", async () => {
    const user = userEvent.setup();
    routeFetch();
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");

    const clockwise = screen.getByRole("button", { name: /rotate page 1 clockwise/i });

    await user.click(clockwise);
    await waitFor(() => expect(rotationState()[1]).toBe(90));

    await user.click(clockwise);
    await waitFor(() => expect(rotationState()[1]).toBe(180));

    await user.click(clockwise);
    await waitFor(() => expect(rotationState()[1]).toBe(270));

    await user.click(clockwise);
    await waitFor(() => expect(rotationState()[1]).toBe(0));
  });

  it("rotates a single page counter-clockwise", async () => {
    const user = userEvent.setup();
    routeFetch();
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");

    await user.click(
      screen.getByRole("button", { name: /rotate page 2 counter-clockwise/i }),
    );
    await waitFor(() => expect(rotationState()[2]).toBe(270));
    // Other pages are untouched.
    expect(rotationState()[1]).toBe(0);
  });

  it("requests a rotated preview from the server", async () => {
    const user = userEvent.setup();
    routeFetch();
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");

    await user.click(screen.getByRole("button", { name: /rotate page 1 clockwise/i }));

    await waitFor(() => {
      const previewCalls = fetchMock.mock.calls.filter(
        (call) => call[0] === "/api/documents/thumbnails",
      );
      expect(previewCalls.length).toBeGreaterThan(1);
      const last = previewCalls[previewCalls.length - 1][1].body as FormData;
      expect(last.get("pages")).toBe("1");
      expect(JSON.parse(String(last.get("rotations")))).toMatchObject({ "1": 90 });
    });
  });

  it("reuses a cached preview instead of re-requesting it", async () => {
    const user = userEvent.setup();
    routeFetch();
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");

    const clockwise = screen.getByRole("button", { name: /rotate page 1 clockwise/i });
    const counter = screen.getByRole("button", {
      name: /rotate page 1 counter-clockwise/i,
    });

    await user.click(clockwise); // 90 — fetched
    await waitFor(() => expect(rotationState()[1]).toBe(90));
    const afterFirst = fetchMock.mock.calls.length;

    await user.click(counter); // back to 0 — already in cache
    await waitFor(() => expect(rotationState()[1]).toBe(0));

    expect(fetchMock.mock.calls.length).toBe(afterFirst);
  });

  it("rotates every page at once", async () => {
    const user = userEvent.setup();
    routeFetch();
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");

    await user.click(screen.getByRole("button", { name: /rotate all right/i }));
    await waitFor(() => expect(rotationState()).toEqual({ 1: 90, 2: 90, 3: 90 }));

    await user.click(screen.getByRole("button", { name: /rotate all left/i }));
    await waitFor(() => expect(rotationState()).toEqual({ 1: 0, 2: 0, 3: 0 }));
  });

  it("resets a single page and all pages", async () => {
    const user = userEvent.setup();
    routeFetch();
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");

    await user.click(screen.getByRole("button", { name: /rotate page 1 clockwise/i }));
    await waitFor(() => expect(rotationState()[1]).toBe(90));

    await user.click(
      screen.getByRole("button", { name: /reset rotation for page 1/i }),
    );
    await waitFor(() => expect(rotationState()[1]).toBe(0));

    await user.click(screen.getByRole("button", { name: /rotate all right/i }));
    await waitFor(() => expect(rotationState()[3]).toBe(90));

    await user.click(screen.getByRole("button", { name: /reset all/i }));
    await waitFor(() => expect(rotationState()).toEqual({ 1: 0, 2: 0, 3: 0 }));
  });

  it("disables the per-page reset until that page is rotated", async () => {
    const user = userEvent.setup();
    routeFetch();
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");

    expect(
      screen.getByRole("button", { name: /reset rotation for page 2/i }),
    ).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /rotate page 2 clockwise/i }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /reset rotation for page 2/i }),
      ).toBeEnabled(),
    );
  });

  it("announces rotation changes", async () => {
    const user = userEvent.setup();
    routeFetch();
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");

    await user.click(screen.getByRole("button", { name: /rotate page 3 clockwise/i }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        /page 3 rotated to 90 degrees/i,
      ),
    );

    await user.click(screen.getByRole("button", { name: /rotate all right/i }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        /all 3 pages rotated clockwise/i,
      ),
    );

    await user.click(screen.getByRole("button", { name: /reset all/i }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        /all page rotations reset/i,
      ),
    );
  });

  it("is operable with the keyboard", async () => {
    const user = userEvent.setup();
    routeFetch();
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");

    const button = screen.getByRole("button", { name: /rotate page 1 clockwise/i });
    button.focus();
    expect(button).toHaveFocus();

    await user.keyboard("{Enter}");
    await waitFor(() => expect(rotationState()[1]).toBe(90));
  });

  it("submits only the rotated pages and offers a real download", async () => {
    const user = userEvent.setup();
    routeFetch();
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");

    await user.click(screen.getByRole("button", { name: /rotate page 2 clockwise/i }));
    await waitFor(() => expect(rotationState()[2]).toBe(90));

    await user.click(screen.getByRole("button", { name: /^rotate pdf$/i }));

    await waitFor(() => expect(rotateCalls()).toHaveLength(1));
    const [, init] = rotateCalls()[0];
    expect(JSON.parse(String((init.body as FormData).get("rotations")))).toEqual({
      "2": 90,
    });

    expect(
      await screen.findByRole("heading", { name: /your rotated pdf is ready/i }),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /download pdf/i });
    expect(link).toHaveAttribute("download", "document-rotated.pdf");
    expect(link.getAttribute("href")).toMatch(/^blob:/);
  });

  it("surfaces a server error and offers no download", async () => {
    const user = userEvent.setup();
    routeFetch({
      rotate: () =>
        errorResponse(400, "INVALID_PAGE_ROTATION", "Page 1 has an unsupported rotation."),
    });
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");
    await user.click(screen.getByRole("button", { name: /rotate page 1 clockwise/i }));
    await waitFor(() => expect(rotationState()[1]).toBe(90));

    await user.click(screen.getByRole("button", { name: /^rotate pdf$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/unsupported rotation/i);
    expect(screen.queryByRole("link", { name: /download/i })).not.toBeInTheDocument();
  });

  it("reports a network failure without pretending to succeed", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("inspect")) return inspectResponse(2);
      if (url.includes("thumbnails")) {
        return thumbnailResponse(init?.body as FormData, 2);
      }
      throw new TypeError("Failed to fetch");
    });
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");
    await user.click(screen.getByRole("button", { name: /rotate page 1 clockwise/i }));
    await waitFor(() => expect(rotationState()[1]).toBe(90));

    await user.click(screen.getByRole("button", { name: /^rotate pdf$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not be sent|could not be rotated/i,
    );
  });

  it("reports a preview failure and keeps rotating disabled", async () => {
    const user = userEvent.setup();
    routeFetch({
      thumbnails: () =>
        errorResponse(500, "PROCESSING_ERROR", "A page preview could not be generated."),
    });
    renderWorkspace();

    await uploadPdf(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /page previews couldn’t be generated/i,
    );
    expect(screen.getByRole("button", { name: /^rotate pdf$/i })).toBeDisabled();
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("reports an inspection failure", async () => {
    const user = userEvent.setup();
    routeFetch({
      inspect: () => errorResponse(422, "INVALID_PDF", "A PDF could not be opened."),
    });
    renderWorkspace();

    await uploadPdf(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be opened/i);
    expect(screen.getByRole("button", { name: /^rotate pdf$/i })).toBeDisabled();
  });

  it("refuses documents longer than the preview limit, honestly", async () => {
    const user = userEvent.setup();
    routeFetch({ pageCount: 80 });
    renderWorkspace({ maxFileSize: LIMITS.maxFileSize, thumbnailMaxPages: 60 });

    await uploadPdf(user);

    expect(
      await screen.findByText(/more pages than the preview limit/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^rotate pdf$/i })).toBeDisabled();
    expect(screen.queryByTestId("rotate-page-grid")).not.toBeInTheDocument();
  });

  it("resets everything when starting over", async () => {
    const user = userEvent.setup();
    routeFetch();
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");
    await user.click(screen.getByRole("button", { name: /rotate page 1 clockwise/i }));
    await waitFor(() => expect(rotationState()[1]).toBe(90));
    await user.click(screen.getByRole("button", { name: /^rotate pdf$/i }));
    await screen.findByRole("link", { name: /download pdf/i });

    await user.click(screen.getByRole("button", { name: /rotate another pdf/i }));

    expect(screen.queryByRole("link", { name: /download pdf/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("rotate-page-grid")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^rotate pdf$/i })).toBeDisabled();
  });

  it("labels each page with its current rotation", async () => {
    const user = userEvent.setup();
    routeFetch();
    renderWorkspace();

    await uploadPdf(user);
    await screen.findAllByRole("img");

    await user.click(screen.getByRole("button", { name: /rotate page 2 clockwise/i }));

    const grid = screen.getByTestId("rotate-page-grid");
    const card = Array.from(grid.querySelectorAll("li")).find(
      (item) => item.getAttribute("data-page") === "2",
    )!;

    await waitFor(() =>
      expect(within(card as HTMLElement).getByText("90° clockwise")).toBeInTheDocument(),
    );
    expect(within(card as HTMLElement).getByText("Page 2")).toBeInTheDocument();
  });
});
