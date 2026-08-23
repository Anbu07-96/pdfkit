import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CropWorkspace } from "@/components/tools/workspaces/crop-workspace";
import { ToastProvider } from "@/components/ui/toast";

const LIMITS = { maxFileSize: 25 * 1024 * 1024 };

function pdfFile(name = "document.pdf", size = 4096) {
  const file = new File(["%PDF-1.7"], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function renderWorkspace() {
  return render(
    <ToastProvider>
      <CropWorkspace limits={LIMITS} />
    </ToastProvider>,
  );
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

const croppedResponse = (cropped: number, pages: number) =>
  fakeResponse({
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="crop.pdf"',
      "x-pdfkit-pages": String(pages),
      "x-pdfkit-output-pages": String(pages),
      "x-pdfkit-cropped-pages": String(cropped),
      "x-pdfkit-artifacts": "1",
    },
    blob: new Blob(["%PDF-"], { type: "application/pdf" }),
  });

let fetchMock: ReturnType<typeof vi.fn>;

function cropCalls() {
  return fetchMock.mock.calls.filter((call) => call[0] === "/api/tools/crop");
}

async function upload(user: ReturnType<typeof userEvent.setup>) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/api/documents/inspect")) return inspectResponse(6);
    return croppedResponse(6, 6);
  });
  await user.upload(screen.getByLabelText(/upload a pdf/i), pdfFile());
  await screen.findByText(/choose the crop/i);
}

/** Fill all four margin fields with valid values. */
async function fillMargins(
  user: ReturnType<typeof userEvent.setup>,
  value = "10",
) {
  for (const label of [/^top$/i, /^right$/i, /^bottom$/i, /^left$/i]) {
    await user.type(screen.getByLabelText(label), value);
  }
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CropWorkspace", () => {
  it("starts with an upload prompt, a disabled action and no options", () => {
    renderWorkspace();
    expect(screen.getByLabelText(/upload a pdf/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^crop pdf$/i })).toBeDisabled();
    expect(screen.queryByLabelText(/^top$/i)).not.toBeInTheDocument();
  });

  it("shows the page count, defaults, units and the prominent privacy warning", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    expect(screen.getByText("document.pdf", { selector: "span" })).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === "6 pages"),
    ).toBeInTheDocument();

    // Default mode: margins.
    expect(screen.getByRole("radio", { name: /^Margins/i })).toBeChecked();
    expect(screen.getByLabelText(/^top$/i)).toBeInTheDocument();

    // The warning is prominent, specific, and names both consequences.
    expect(
      screen.getByRole("heading", {
        name: /Cropping hides content from view — it does not remove it/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/recovered with a PDF editor or text extractor/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Do not use Crop PDF as a security/i)).toBeInTheDocument();

    // Units and coordinate explanation (hints render once errors clear).
    for (const label of [/^top$/i, /^right$/i, /^bottom$/i, /^left$/i]) {
      await user.type(screen.getByLabelText(label), "10");
    }
    expect(screen.getAllByText(/points \(pt\)/i).length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText(/bottom-left origin/i)).toBeInTheDocument();

  });

  it("switches to rectangle mode with the four numeric fields", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    await user.click(screen.getByRole("radio", { name: /^Rectangle/i }));
    expect(screen.getByRole("radio", { name: /^Rectangle/i })).toBeChecked();
    expect(screen.getByLabelText(/^X$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Y$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Width$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Height$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^top$/i)).not.toBeInTheDocument();
  });

  it("flags invalid numeric input with inline errors and aria-invalid", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    // Fill three valid margins; the fourth drives the states under test.
    for (const label of [/^right$/i, /^bottom$/i, /^left$/i]) {
      await user.type(screen.getByLabelText(label), "10");
    }
    const top = screen.getByLabelText(/^top$/i);
    await user.type(top, "-25");
    expect(top).toHaveAttribute("aria-invalid", "false"); // finite number…
    expect(screen.getByRole("button", { name: /^crop pdf$/i })).toBeEnabled();

    await user.clear(top);
    await user.type(top, "abc");
    expect(top).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: /^crop pdf$/i })).toBeDisabled();
    expect(screen.getAllByText(/finite number/i).length).toBeGreaterThanOrEqual(1);

    await user.clear(top);
    await user.type(top, "10");
    expect(screen.getByRole("button", { name: /^crop pdf$/i })).toBeEnabled();
  });

  it("sends the rectangle payload with page ranges", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    await user.click(screen.getByRole("radio", { name: /^Rectangle/i }));
    await user.type(screen.getByLabelText(/^X$/i), "10");
    await user.type(screen.getByLabelText(/^Y$/i), "20");
    await user.type(screen.getByLabelText(/^Width$/i), "300");
    await user.type(screen.getByLabelText(/^Height$/i), "400");
    await user.type(screen.getByLabelText(/pages to crop/i), "1-2, 5");
    await user.click(screen.getByRole("button", { name: /^crop pdf$/i }));

    await waitFor(() => expect(cropCalls()).toHaveLength(1));
    const form = cropCalls()[0][1].body as FormData;
    expect(form.get("mode")).toBe("rectangle");
    expect(form.get("x")).toBe("10");
    expect(form.get("y")).toBe("20");
    expect(form.get("width")).toBe("300");
    expect(form.get("height")).toBe("400");
    expect(form.get("ranges")).toBe("1-2, 5");
    expect(form.getAll("files")).toHaveLength(1);
  });

  it("sends the margins payload and omits empty ranges", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    await user.type(screen.getByLabelText(/^top$/i), "20");
    await user.type(screen.getByLabelText(/^right$/i), "10");
    await user.type(screen.getByLabelText(/^bottom$/i), "5");
    await user.type(screen.getByLabelText(/^left$/i), "15");
    await user.click(screen.getByRole("button", { name: /^crop pdf$/i }));

    await waitFor(() => expect(cropCalls()).toHaveLength(1));
    const form = cropCalls()[0][1].body as FormData;
    expect(form.get("mode")).toBe("margins");
    expect(form.get("top")).toBe("20");
    expect(form.get("right")).toBe("10");
    expect(form.get("bottom")).toBe("5");
    expect(form.get("left")).toBe("15");
    expect(form.get("ranges")).toBeNull(); // all pages by default
  });

  it("validates the page ranges locally with the shared model", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    await fillMargins(user);
    const field = screen.getByLabelText(/pages to crop/i);
    await user.type(field, "9");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: /^crop pdf$/i })).toBeDisabled();

    await user.clear(field);
    await user.type(field, "1-2");
    expect(screen.getByRole("button", { name: /^crop pdf$/i })).toBeEnabled();
  });

  it("shows an honest indeterminate processing state and cancels via AbortController", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    fetchMock.mockImplementation(
      (url: string, init?: RequestInit) =>
        url.includes("/api/documents/inspect")
          ? inspectResponse(6)
          : new Promise<Response>((_, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(new DOMException("aborted", "AbortError")),
              );
            }),
    );

    await fillMargins(user);
    await user.click(screen.getByRole("button", { name: /^crop pdf$/i }));
    expect(
      (await screen.findAllByText(/Cropping your PDF…/i)).length,
    ).toBeGreaterThanOrEqual(1);
    expect(document.querySelector("progress")).toBeNull();
    expect(screen.queryByText(/%\s*complete/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    const init = cropCalls()[0][1] as RequestInit & { signal?: AbortSignal };
    expect(init.signal?.aborted).toBe(true);
    expect(
      await screen.findByRole("button", { name: /^crop pdf$/i }),
    ).toBeEnabled();
  });

  it("renders the server-confirmed success state with the warning repeated", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse(6);
      return croppedResponse(2, 6);
    });

    await fillMargins(user);
    await user.type(screen.getByLabelText(/pages to crop/i), "1-2");
    await user.click(screen.getByRole("button", { name: /^crop pdf$/i }));

    expect(
      await screen.findByRole("heading", { name: /pages cropped/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 of 6/i)).toBeInTheDocument();
    expect(screen.getByText(/not redaction/i)).toBeInTheDocument();
    expect(
      screen.getAllByText((_, element) =>
        Boolean(element?.textContent?.includes("only the visible area changed")),
      ).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByRole("link", { name: /download cropped pdf/i }),
    ).toHaveAttribute("href");
    expect(
      screen.getByRole("button", { name: /crop another pdf/i }),
    ).toBeEnabled();
  });

  it("surfaces a server geometry error as an alert with its page detail", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse(6);
      return fakeResponse({
        ok: false,
        status: 400,
        json: {
          error: {
            code: "INVALID_CROP_CONFIGURATION",
            message:
              "The rectangle (x 0, y 0, 500 × 50 pt) does not fit inside this page's MediaBox (101 × 200 pt).",
            details: ["It does not fit page 3."],
          },
        },
      });
    });

    await fillMargins(user);
    await user.click(screen.getByRole("button", { name: /^crop pdf$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/does not fit/i);
    expect(alert).toHaveTextContent(/page 3/i);
  });

  it("distinguishes network failure from processing failure", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse(6);
      throw new TypeError("Failed to fetch");
    });

    await fillMargins(user);
    await user.click(screen.getByRole("button", { name: /^crop pdf$/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/check your connection/i);
  });

  it("resets everything with start over", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);
    await fillMargins(user);
    await user.click(screen.getByRole("button", { name: /^crop pdf$/i }));
    await screen.findByRole("heading", { name: /pages cropped/i });

    await user.click(screen.getByRole("button", { name: /start over/i }));
    expect(screen.getByText(/upload a pdf to get started/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^top$/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^crop pdf$/i })).toBeDisabled();
  });

  it("crops a second document after a successful one", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);
    await fillMargins(user);
    await user.click(screen.getByRole("button", { name: /^crop pdf$/i }));
    await screen.findByRole("heading", { name: /pages cropped/i });

    await user.click(screen.getByRole("button", { name: /crop another pdf/i }));
    await upload(user);
    await fillMargins(user);
    await user.click(screen.getByRole("button", { name: /^crop pdf$/i }));

    await waitFor(() => expect(cropCalls()).toHaveLength(2));
    expect(await screen.findByRole("heading", { name: /pages cropped/i }));
  });

  it("announces states politely for screen readers", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    expect(screen.getByRole("status")).toHaveTextContent(/loaded with 6 pages/i);

    await fillMargins(user);
    await user.click(screen.getByRole("button", { name: /^crop pdf$/i }));
    await screen.findByRole("heading", { name: /pages cropped/i });
    expect(screen.getByRole("status")).toHaveTextContent(/ready to download/i);
  });
});
