import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PdfToWordWorkspace } from "@/components/tools/workspaces/pdf-to-word-workspace";
import { ToastProvider } from "@/components/ui/toast";

const LIMITS = { maxFileSize: 25 * 1024 * 1024, maxPages: 50 };

function pdfFile(name = "document.pdf", size = 4096) {
  const file = new File(["%PDF-1.7"], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function renderWorkspace(limits = LIMITS) {
  return render(
    <ToastProvider>
      <PdfToWordWorkspace limits={limits} />
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

function docxResponse({
  pages = 6,
  characters = 5432,
  paragraphs = 88,
} = {}) {
  return fakeResponse({
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": 'attachment; filename="document.docx"',
      "x-pdfkit-pages": String(pages),
      "x-pdfkit-artifacts": "1",
      "x-pdfkit-characters": String(characters),
      "x-pdfkit-paragraphs": String(paragraphs),
      "x-pdfkit-mode": "text-only",
    },
    blob: new Blob(["PK"], { type: "application/octet-stream" }),
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

function convertCalls() {
  return fetchMock.mock.calls.filter(
    (call) => call[0] === "/api/tools/pdf-to-word",
  );
}

async function uploadPdf(
  user: ReturnType<typeof userEvent.setup>,
  name = "document.pdf",
) {
  routeFetch();
  await user.upload(screen.getByLabelText(/upload a pdf/i), pdfFile(name));
  await screen.findByText(/Text only — read this first/i);
}

function routeFetch(handlers: {
  inspect?: () => Response;
  convert?: () => Response;
} = {}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/api/documents/inspect")) {
      return handlers.inspect?.() ?? inspectResponse(6);
    }
    if (url.includes("/api/tools/pdf-to-word")) {
      return handlers.convert?.() ?? docxResponse();
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PdfToWordWorkspace", () => {
  it("starts with an upload prompt and a disabled action", () => {
    renderWorkspace();
    expect(screen.getByLabelText(/upload a pdf/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^convert to word$/i }),
    ).toBeDisabled();
    expect(screen.getByText(/upload a pdf to get started/i)).toBeInTheDocument();
  });

  it("shows the server page count and the honest text-only warning", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user, "report.pdf");

    expect(screen.getByText("report.pdf", { selector: "span" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /text only — read this first/i }),
    ).toBeInTheDocument();
    // The warning names the page count from the server and what is lost.
    expect(screen.getAllByText(/6 pages/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/not preserved/i)).toBeInTheDocument();
    expect(screen.getByText(/does not rebuild the document/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^convert to word$/i }),
    ).toBeEnabled();
  });

  it("declines documents above the page limit before converting", async () => {
    const user = userEvent.setup();
    routeFetch({ inspect: () => inspectResponse(120) });
    renderWorkspace({ ...LIMITS, maxPages: 50 });
    await user.upload(screen.getByLabelText(/upload a pdf/i), pdfFile("long.pdf"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /too many pages to convert/i,
    );
    expect(
      screen.getByRole("button", { name: /^convert to word$/i }),
    ).toBeDisabled();
  });

  it("shows an honest indeterminate processing state", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user);

    let resolveConvert: (response: Response) => void;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse(6);
      return new Promise<Response>((resolve) => (resolveConvert = resolve));
    });

    await user.click(screen.getByRole("button", { name: /^convert to word$/i }));
    expect(
      (await screen.findAllByText(/converting to word…/i)).length,
    ).toBeGreaterThanOrEqual(1);
    expect(document.querySelector("progress")).toBeNull();
    expect(screen.queryByText(/%\s*complete/i)).not.toBeInTheDocument();

    resolveConvert!(docxResponse());
    await screen.findByRole("heading", { name: /word document ready/i });
  });

  it("cancels the browser request via AbortController", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user);

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse(6);
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }) as unknown as Promise<Response>;
    });

    await user.click(screen.getByRole("button", { name: /^convert to word$/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    const init = convertCalls()[0][1] as RequestInit & { signal?: AbortSignal };
    expect(init.signal?.aborted).toBe(true);
    expect(
      await screen.findByRole("button", { name: /^convert to word$/i }),
    ).toBeEnabled();
  });

  it("renders the server-measured success state", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user);

    await user.click(screen.getByRole("button", { name: /^convert to word$/i }));

    expect(
      await screen.findByRole("heading", { name: /word document ready/i }),
    ).toBeInTheDocument();
    // Facts from the server headers, not client guesses.
    expect(screen.getAllByText(/5,432 characters/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/88 paragraphs/i)).toBeInTheDocument();
    expect(screen.getAllByText(/6 pages/i).length).toBeGreaterThanOrEqual(1);
    // The text-only warning is repeated in the result.
    expect(
      screen.getAllByText(/not preserved/i).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByRole("link", { name: /download word document/i }),
    ).toHaveAttribute("href");
    expect(
      screen.getByRole("button", { name: /convert another pdf/i }),
    ).toBeEnabled();
  });

  it("shows the no-text state when the server finds no characters", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user);
    routeFetch({ convert: () => docxResponse({ characters: 0, paragraphs: 0 }) });

    await user.click(screen.getByRole("button", { name: /^convert to word$/i }));

    expect(
      await screen.findByRole("heading", {
        name: /word document created — no text found/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no extractable text/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download word document/i })).toBeInTheDocument();
  });

  it("surfaces a server error as an alert", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse(6);
      return fakeResponse({
        ok: false,
        status: 413,
        json: {
          error: {
            code: "TOO_MANY_OUTPUTS",
            message: "This PDF has 90 pages; the limit for Word export is 50.",
          },
        },
      });
    });

    await user.click(screen.getByRole("button", { name: /^convert to word$/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/limit for word export/i);
  });

  it("distinguishes network failure from processing failure", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse(6);
      throw new TypeError("Failed to fetch");
    });

    await user.click(screen.getByRole("button", { name: /^convert to word$/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/check your connection/i);
  });

  it("reports a PDF that cannot be read instead of guessing", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    routeFetch({
      inspect: () =>
        fakeResponse({
          ok: false,
          status: 422,
          json: { error: { code: "INVALID_PDF", message: "A PDF could not be opened." } },
        }),
    });
    await user.upload(screen.getByLabelText(/upload a pdf/i), pdfFile("bad.pdf"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not be opened/i,
    );
    expect(
      screen.getByRole("button", { name: /^convert to word$/i }),
    ).toBeDisabled();
  });

  it("resets everything with start over", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user, "keep.pdf");
    await user.click(screen.getByRole("button", { name: /^convert to word$/i }));
    await screen.findByRole("heading", { name: /word document ready/i });

    await user.click(screen.getByRole("button", { name: /start over/i }));
    expect(screen.getByText(/upload a pdf to get started/i)).toBeInTheDocument();
    expect(screen.queryByText(/text only — read this first/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^convert to word$/i }),
    ).toBeDisabled();
  });

  it("converts a second document after a successful one", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user, "first.pdf");
    await user.click(screen.getByRole("button", { name: /^convert to word$/i }));
    await screen.findByRole("heading", { name: /word document ready/i });

    await user.click(screen.getByRole("button", { name: /convert another pdf/i }));
    await uploadPdf(user, "second.pdf");
    await user.click(screen.getByRole("button", { name: /^convert to word$/i }));

    await waitFor(() => expect(convertCalls()).toHaveLength(2));
    expect(await screen.findByRole("heading", { name: /word document ready/i }));
  });

  it("announces states politely for screen readers", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user);

    expect(screen.getByRole("status")).toHaveTextContent(/loaded with 6 pages/i);

    await user.click(screen.getByRole("button", { name: /^convert to word$/i }));
    await screen.findByRole("heading", { name: /word document ready/i });
    expect(screen.getByRole("status")).toHaveTextContent(/characters extracted/i);
  });
});
