import { render, screen, waitFor, within } from "@testing-library/react";
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
  // The compact layout: the premium file row appears and the server's page
  // count lands in it.
  const row = await screen.findByTestId("selected-file-row");
  await within(row).findByText(/pages/i);
  return row;
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
    // Compact layout: the primary action appears only once it is useful;
    // while empty, the upload zone's browse action is the primary action.
    expect(
      screen.queryByRole("button", { name: /^convert to word$/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Upload a PDF")).toBeInTheDocument();
  });

  it("shows the server page count and the honest text-only caveat in a compact strip", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user, "report.pdf");

    expect(
      within(screen.getByTestId("selected-file-row")).getByText("report.pdf"),
    ).toBeInTheDocument();
    // The material limitation is always visible in the compact strip…
    expect(screen.getByText(/Text extraction/i)).toBeInTheDocument();
    expect(screen.getByText(/may not be preserved/i)).toBeInTheDocument();
    // …and the full explanation stays available through the disclosure.
    expect(screen.getByRole("group")).toBeInTheDocument();
    expect(screen.getByText(/Details/i)).toBeInTheDocument();
    expect(screen.getAllByText(/6 pages/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/does not rebuild the document/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^convert to word$/i }),
    ).toBeEnabled();
  });

  it("collapses the upload zone and shows the file exactly once when selected", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user, "once.pdf");

    // The tall drop box collapsed into a slim replace strip…
    const zone = screen.getByTestId("upload-zone");
    expect(zone).toHaveAttribute("data-state", "selected");
    expect(zone).toHaveAttribute("data-collapsed", "true");
    expect(zone).toHaveTextContent(/replace/i);
    // …the premium file row carries the name, size and server page count…
    const row = screen.getByTestId("selected-file-row");
    expect(within(row).getByText("once.pdf")).toBeInTheDocument();
    expect(within(row).getByText(/4 KB/i)).toBeInTheDocument();
    expect(within(row).getByText(/6 pages/i)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /remove/i })).toBeInTheDocument();
    // …and the filename appears exactly once in the whole workspace.
    expect(screen.getAllByText("once.pdf")).toHaveLength(1);
  });

  it("removing the selected file returns to the spacious empty state", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user, "gone.pdf");

    await user.click(
      within(screen.getByTestId("selected-file-row")).getByRole("button", {
        name: /remove/i,
      }),
    );
    expect(
      screen.queryByTestId("selected-file-row"),
    ).not.toBeInTheDocument();
    const zone = screen.getByTestId("upload-zone");
    expect(zone).toHaveAttribute("data-state", "empty");
    expect(zone).not.toHaveAttribute("data-collapsed");
    expect(
      screen.queryByRole("button", { name: /^convert to word$/i }),
    ).not.toBeInTheDocument();
  });

  it("retries after a failed conversion without re-uploading", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user);

    let attempt = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse(6);
      attempt += 1;
      return attempt === 1
        ? fakeResponse({
            ok: false,
            status: 500,
            json: {
              error: { code: "INTERNAL", message: "Conversion failed on the server." },
            },
          })
        : docxResponse();
    });

    await user.click(screen.getByRole("button", { name: /^convert to word$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/failed/i);
    // The primary action is replaced by an inline retry in the error panel.
    expect(
      screen.queryByRole("button", { name: /^convert to word$/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /try again/i }));
    await screen.findByRole("heading", { name: /word document ready/i });
    expect(attempt).toBe(2);
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
      (await screen.findAllByText(/converting to word/i)).length,
    ).toBeGreaterThanOrEqual(1);
    // Secondary status is honest and indeterminate — no fake percentages.
    expect(screen.getByText(/analyzing document structure/i)).toBeInTheDocument();
    expect(document.querySelector("progress")).toBeNull();
    expect(screen.queryByText(/%\s*complete/i)).not.toBeInTheDocument();

    resolveConvert!(docxResponse());
    await screen.findByRole("heading", { name: /word document ready/i });
  });

  it("shows the processing visual while converting, removed on completion", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user);

    let resolveConvert: (response: Response) => void;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse(6);
      return new Promise<Response>((resolve) => (resolveConvert = resolve));
    });

    await user.click(screen.getByRole("button", { name: /^convert to word$/i }));
    // The decorative motion layer appears next to the honest text status…
    const visual = await screen.findByTestId("job-visual");
    expect(visual.getAttribute("aria-hidden")).toBe("true");
    expect(visual.textContent).toBe("");

    resolveConvert!(docxResponse());
    await screen.findByRole("heading", { name: /word document ready/i });
    expect(screen.queryByTestId("job-visual")).not.toBeInTheDocument();
  });

  it("plays a short success settle beat before the result panel takes over", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user);

    let resolveConvert!: (response: Response) => void;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse(6);
      return new Promise<Response>((resolve) => (resolveConvert = resolve));
    });

    await user.click(screen.getByRole("button", { name: /^convert to word$/i }));
    resolveConvert!(docxResponse());

    // The processing panel lingers briefly with the success visual…
    expect(await screen.findByText(/finishing up…/i)).toBeInTheDocument();
    const scene = screen
      .getByTestId("job-visual")
      .querySelector(".job-visual-scene");
    expect(scene?.getAttribute("data-status")).toBe("success");
    // …the setup UI collapses during the beat (the button stays inert)…
    expect(
      screen.queryByRole("button", { name: /^convert to word$/i }),
    ).not.toBeInTheDocument();

    // …then the existing result UI takes over.
    await screen.findByRole("heading", { name: /word document ready/i });
    expect(screen.queryByText(/finishing up…/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("job-visual")).not.toBeInTheDocument();
  });

  it("removes the processing visual when the conversion fails", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user);

    let respond!: (response: Response) => void;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse(6);
      return new Promise<Response>((resolve) => (respond = resolve));
    });

    await user.click(screen.getByRole("button", { name: /^convert to word$/i }));
    expect(await screen.findByTestId("job-visual")).toBeInTheDocument();

    respond!(
      fakeResponse({
        ok: false,
        status: 500,
        json: {
          error: { code: "INTERNAL", message: "Conversion failed on the server." },
        },
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/failed/i);
    expect(screen.queryByTestId("job-visual")).not.toBeInTheDocument();
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
    expect(screen.getAllByText(/not preserved/i).length).toBeGreaterThanOrEqual(1);
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
      screen.queryByRole("button", { name: /^convert to word$/i }),
    ).not.toBeInTheDocument();
  });

  it("resets everything with start over", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await uploadPdf(user, "keep.pdf");
    await user.click(screen.getByRole("button", { name: /^convert to word$/i }));
    await screen.findByRole("heading", { name: /word document ready/i });

    await user.click(screen.getByRole("button", { name: /start over/i }));
    expect(screen.getByTestId("upload-zone")).toHaveAttribute("data-state", "empty");
    expect(screen.queryByTestId("selected-file-row")).not.toBeInTheDocument();
    expect(screen.queryByText(/Text extraction/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^convert to word$/i }),
    ).not.toBeInTheDocument();
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
