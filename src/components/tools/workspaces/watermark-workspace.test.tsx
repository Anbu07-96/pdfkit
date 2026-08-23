import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WatermarkWorkspace } from "@/components/tools/workspaces/watermark-workspace";
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
      <WatermarkWorkspace limits={LIMITS} />
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

function inspectResponse(pageCount: number) {
  return fakeResponse({
    headers: { "content-type": "application/json" },
    json: { fileName: "document.pdf", size: 4096, pageCount },
  });
}

function watermarkedResponse(stamped: number, pages: number) {
  return fakeResponse({
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="document-watermarked.pdf"',
      "x-pdfkit-pages": String(pages),
      "x-pdfkit-output-pages": String(pages),
      "x-pdfkit-watermarked-pages": String(stamped),
      "x-pdfkit-artifacts": "1",
    },
    blob: new Blob(["%PDF-"], { type: "application/pdf" }),
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

function watermarkCalls() {
  return fetchMock.mock.calls.filter(
    (call) => call[0] === "/api/tools/watermark",
  );
}

async function upload(
  user: ReturnType<typeof userEvent.setup>,
  name = "document.pdf",
) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/api/documents/inspect")) return inspectResponse(6);
    return watermarkedResponse(6, 6);
  });
  await user.upload(screen.getByLabelText(/upload a pdf/i), pdfFile(name));
  await screen.findByText(/enter the watermark text/i);
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WatermarkWorkspace", () => {
  it("starts with an upload prompt, a disabled action and no options", () => {
    renderWorkspace();
    expect(screen.getByLabelText(/upload a pdf/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^add watermark$/i }),
    ).toBeDisabled();
    // Options appear only after a document is chosen.
    expect(screen.queryByLabelText(/watermark text/i)).not.toBeInTheDocument();
  });

  it("shows the page count, all option groups with defaults, and the warning", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user, "report.pdf");

    expect(screen.getByText("report.pdf", { selector: "span" })).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === "6 pages"),
    ).toBeInTheDocument();

    // Defaults: 50% opacity, 45° rotation, center, all pages.
    expect(screen.getByRole("radio", { name: /50%/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^45°/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^Center/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^All pages/i })).toBeChecked();

    // The deterrence warning is visible before conversion.
    expect(
      screen.getByRole("heading", { name: /deterrent, not protection/i }),
    ).toBeInTheDocument();

    // No text yet → still disabled.
    expect(
      screen.getByRole("button", { name: /^add watermark$/i }),
    ).toBeDisabled();
  });

  it("enables the action once text is entered and switches options", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    await user.type(screen.getByLabelText(/watermark text/i), "DRAFT");
    expect(
      screen.getByRole("button", { name: /^add watermark$/i }),
    ).toBeEnabled();

    await user.click(screen.getByRole("radio", { name: /75%/i }));
    await user.click(screen.getByRole("radio", { name: /^-45°/i }));
    await user.click(screen.getByRole("radio", { name: /^Corner/i }));
    await user.click(screen.getByRole("radio", { name: /^Last page/i }));
    expect(screen.getByRole("radio", { name: /75%/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^-45°/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^Corner/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^Last page/i })).toBeChecked();
  });

  it("sends every option to the server", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    await user.type(screen.getByLabelText(/watermark text/i), "CONFIDENTIAL");
    await user.click(screen.getByRole("radio", { name: /25%/i }));
    await user.click(screen.getByRole("radio", { name: /^Corner/i }));
    await user.click(screen.getByRole("radio", { name: /^First page/i }));
    await user.click(screen.getByRole("button", { name: /^add watermark$/i }));

    await waitFor(() => expect(watermarkCalls()).toHaveLength(1));
    const form = watermarkCalls()[0][1].body as FormData;
    expect(form.get("text")).toBe("CONFIDENTIAL");
    expect(form.get("opacity")).toBe("25");
    expect(form.get("rotation")).toBe("45");
    expect(form.get("placement")).toBe("corner");
    expect(form.get("pages")).toBe("first");
    expect(form.getAll("files")).toHaveLength(1);
  });

  it("shows an honest indeterminate processing state and cancels via AbortController", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);
    await user.type(screen.getByLabelText(/watermark text/i), "X");

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

    await user.click(screen.getByRole("button", { name: /^add watermark$/i }));
    expect(
      (await screen.findAllByText(/adding your watermark…/i)).length,
    ).toBeGreaterThanOrEqual(1);
    expect(document.querySelector("progress")).toBeNull();
    expect(screen.queryByText(/%\s*complete/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    const init = watermarkCalls()[0][1] as RequestInit & { signal?: AbortSignal };
    expect(init.signal?.aborted).toBe(true);
    expect(
      await screen.findByRole("button", { name: /^add watermark$/i }),
    ).toBeEnabled();
  });

  it("renders the server-confirmed success state with the deterrent note", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse(6);
      return watermarkedResponse(1, 6);
    });

    await user.type(screen.getByLabelText(/watermark text/i), "DRAFT");
    await user.click(screen.getByRole("radio", { name: /^Last page/i }));
    await user.click(screen.getByRole("button", { name: /^add watermark$/i }));

    expect(
      await screen.findByRole("heading", { name: /watermark added/i }),
    ).toBeInTheDocument();
    // Server-confirmed counts, not client guesses.
    expect(screen.getByText(/1 of 6/i)).toBeInTheDocument();
    expect(screen.getByText(/6 pages,/i)).toBeInTheDocument();
    expect(screen.getAllByText(/deterrent, not protection/i).length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByRole("link", { name: /download watermarked pdf/i }),
    ).toHaveAttribute("href");
    expect(
      screen.getByRole("button", { name: /watermark another pdf/i }),
    ).toBeEnabled();
  });

  it("surfaces a server error as an alert and keeps the draft", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);
    await user.type(screen.getByLabelText(/watermark text/i), "机密");
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse(6);
      return fakeResponse({
        ok: false,
        status: 400,
        json: {
          error: {
            code: "INVALID_WATERMARK_CONFIGURATION",
            message:
              "The watermark text contains characters the watermark font cannot display. Use standard Latin characters.",
          },
        },
      });
    });

    await user.click(screen.getByRole("button", { name: /^add watermark$/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/cannot display/i);
    expect(screen.getByLabelText(/watermark text/i)).toHaveValue("机密");
  });

  it("distinguishes network failure from processing failure", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);
    await user.type(screen.getByLabelText(/watermark text/i), "X");
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse(6);
      throw new TypeError("Failed to fetch");
    });

    await user.click(screen.getByRole("button", { name: /^add watermark$/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/check your connection/i);
  });

  it("reports a PDF that cannot be read instead of guessing", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) {
        return fakeResponse({
          ok: false,
          status: 422,
          json: { error: { code: "INVALID_PDF", message: "A PDF could not be opened." } },
        });
      }
      throw new Error("unexpected");
    });
    await user.upload(screen.getByLabelText(/upload a pdf/i), pdfFile("bad.pdf"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be opened/i);
    expect(
      screen.getByRole("button", { name: /^add watermark$/i }),
    ).toBeDisabled();
  });

  it("resets everything with start over", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user, "keep.pdf");
    await user.type(screen.getByLabelText(/watermark text/i), "X");
    await user.click(screen.getByRole("button", { name: /^add watermark$/i }));
    await screen.findByRole("heading", { name: /watermark added/i });

    await user.click(screen.getByRole("button", { name: /start over/i }));
    expect(screen.getByText(/upload a pdf to get started/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/watermark text/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^add watermark$/i }),
    ).toBeDisabled();
  });

  it("watermarks a second document after a successful one", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user, "first.pdf");
    await user.type(screen.getByLabelText(/watermark text/i), "X");
    await user.click(screen.getByRole("button", { name: /^add watermark$/i }));
    await screen.findByRole("heading", { name: /watermark added/i });

    await user.click(screen.getByRole("button", { name: /watermark another pdf/i }));
    await upload(user, "second.pdf");
    await user.type(screen.getByLabelText(/watermark text/i), "Y");
    await user.click(screen.getByRole("button", { name: /^add watermark$/i }));

    await waitFor(() => expect(watermarkCalls()).toHaveLength(2));
    expect(await screen.findByRole("heading", { name: /watermark added/i }));
  });

  it("announces states politely for screen readers", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);

    expect(screen.getByRole("status")).toHaveTextContent(/loaded with 6 pages/i);

    await user.type(screen.getByLabelText(/watermark text/i), "X");
    await user.click(screen.getByRole("button", { name: /^add watermark$/i }));
    await screen.findByRole("heading", { name: /watermark added/i });
    expect(screen.getByRole("status")).toHaveTextContent(/ready to download/i);
  });

  it("marks the text field invalid via aria-invalid when over budget", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await upload(user);
    const field = screen.getByLabelText(/watermark text/i);
    expect(field).toHaveAttribute("aria-invalid", "true"); // empty

    await user.type(field, "OK");
    expect(field).toHaveAttribute("aria-invalid", "false");
  });
});
