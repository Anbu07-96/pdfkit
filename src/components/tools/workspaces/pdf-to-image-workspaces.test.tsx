import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PdfToImageWorkspace } from "@/components/tools/workspaces/pdf-to-image-workspace";
import { ToastProvider } from "@/components/ui/toast";

const LIMITS = { maxFileSize: 25 * 1024 * 1024, maxPages: 50 };

function pdfFile(name = "document.pdf", size = 4096) {
  const file = new File(["%PDF-1.7"], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function renderWorkspace(format: "jpg" | "png", limits = LIMITS) {
  return render(
    <ToastProvider>
      <PdfToImageWorkspace format={format} limits={limits} />
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

function imageResponse(artifacts: number, format: "jpg" | "png") {
  return fakeResponse({
    headers: {
      "content-type": artifacts > 1 ? "application/zip" : `image/${format}`,
      "content-disposition": `attachment; filename="document-page-1.${format}"`,
      "x-pdfkit-pages": String(artifacts),
      "x-pdfkit-artifacts": String(artifacts),
    },
    blob: new Blob(["x"], { type: "application/octet-stream" }),
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

function routeFetch(handlers: {
  inspect?: () => Response;
  convert?: () => Response;
} = {}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/api/documents/inspect")) {
      return handlers.inspect?.() ?? inspectResponse(10);
    }
    if (url.includes("/api/tools/pdf-to-")) {
      return handlers.convert?.() ?? imageResponse(10, "jpg");
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

function convertCalls(endpoint: string) {
  return fetchMock.mock.calls.filter((call) => call[0] === endpoint);
}

async function uploadPdf(
  user: ReturnType<typeof userEvent.setup>,
  name = "document.pdf",
) {
  // Default routing (inspect → 10 pages, convert → success) before uploading;
  // tests that need custom behaviour override the mock afterwards.
  routeFetch();
  await user.upload(screen.getByLabelText(/upload a pdf/i), pdfFile(name));
  // Wait until the server's page count has driven the prediction line.
  await screen.findByText(/will produce 10 (JPG|PNG) files/i);
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each([
  { format: "jpg" as const, endpoint: "/api/tools/pdf-to-jpg", label: "JPG" },
  { format: "png" as const, endpoint: "/api/tools/pdf-to-png", label: "PNG" },
])("PdfToImageWorkspace ($format)", ({ format, endpoint, label }) => {
  it("starts with an upload prompt and a disabled action", () => {
    renderWorkspace(format);

    expect(screen.getByLabelText(/upload a pdf/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: new RegExp(`^convert to ${label}$`, "i") }),
    ).toBeDisabled();
  });

  it("announces the output prediction from the real server page count", async () => {
    const user = userEvent.setup();
    routeFetch({ inspect: () => inspectResponse(10) });
    renderWorkspace(format);
    await user.upload(
      screen.getByLabelText(/upload a pdf/i),
      pdfFile("report.pdf"),
    );

    // The prediction line is driven by the server's real page count.
    expect(
      await screen.findByText(new RegExp(`will produce 10 ${label} files`, "i")),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: new RegExp(`^convert to ${label}$`, "i") }),
    ).toBeEnabled();
  });

  it("predicts a single file for a one-page PDF", async () => {
    const user = userEvent.setup();
    routeFetch({ inspect: () => inspectResponse(1) });
    renderWorkspace(format);
    await user.upload(screen.getByLabelText(/upload a pdf/i), pdfFile("one.pdf"));

    expect(
      await screen.findByText(new RegExp(`will produce one ${label} file`, "i")),
    ).toBeInTheDocument();
  });

  it("declines documents above the page limit before converting", async () => {
    const user = userEvent.setup();
    routeFetch({ inspect: () => inspectResponse(120) });
    renderWorkspace(format, { ...LIMITS, maxPages: 50 });
    await user.upload(screen.getByLabelText(/upload a pdf/i), pdfFile("long.pdf"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /too many pages to export/i,
    );
    expect(
      screen.getByRole("button", { name: new RegExp(`^convert to ${label}$`, "i") }),
    ).toBeDisabled();
  });

  it("shows an honest indeterminate rendering state", async () => {
    const user = userEvent.setup();
    renderWorkspace(format);
    await uploadPdf(user);

    let resolveConvert: (response: Response) => void;
    fetchMock.mockImplementation(
      (url: string) =>
        url.includes("/api/tools/pdf-to-")
          ? new Promise<Response>((resolve) => (resolveConvert = resolve))
          : inspectResponse(10),
    );

    await user.click(
      screen.getByRole("button", { name: new RegExp(`^convert to ${label}$`, "i") }),
    );
    expect(
      (await screen.findAllByText(/rendering your pdf…/i)).length,
    ).toBeGreaterThanOrEqual(1);
    expect(document.querySelector("progress")).toBeNull();
    expect(screen.queryByText(/%\s*complete/i)).not.toBeInTheDocument();

    resolveConvert!(imageResponse(10, format));
    await screen.findByText(new RegExp(`${label} files created`, "i"));
  });

  it("sends exactly one PDF to the right endpoint", async () => {
    const user = userEvent.setup();
    renderWorkspace(format);
    await uploadPdf(user, "doc.pdf");

    await user.click(
      screen.getByRole("button", { name: new RegExp(`^convert to ${label}$`, "i") }),
    );
    await waitFor(() => expect(convertCalls(endpoint)).toHaveLength(1));
    const form = convertCalls(endpoint)[0][1].body as FormData;
    expect(form.getAll("files")).toHaveLength(1);
  });

  it("renders the ZIP result for multi-page exports", async () => {
    const user = userEvent.setup();
    routeFetch({ convert: () => imageResponse(10, format) });
    renderWorkspace(format);
    await uploadPdf(user);

    await user.click(
      screen.getByRole("button", { name: new RegExp(`^convert to ${label}$`, "i") }),
    );

    expect(
      await screen.findByText(new RegExp(`10 ${label} files created`, "i")),
    ).toBeInTheDocument();
    expect(screen.getByText(/zip archive/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: new RegExp(`download all`, "i") }),
    ).toHaveAttribute("href");
  });

  it("renders the single-file result for one-page exports", async () => {
    const user = userEvent.setup();
    routeFetch({
      inspect: () => inspectResponse(1),
      convert: () => imageResponse(1, format),
    });
    renderWorkspace(format);
    await user.upload(screen.getByLabelText(/upload a pdf/i), pdfFile("one.pdf"));
    await screen.findByText(new RegExp(`will produce one ${label} file`, "i"));

    await user.click(
      screen.getByRole("button", { name: new RegExp(`^convert to ${label}$`, "i") }),
    );

    expect(
      await screen.findByText(new RegExp(`${label} file created`, "i")),
    ).toBeInTheDocument();
    expect(screen.queryByText(/zip archive/i)).not.toBeInTheDocument();
  });

  it("cancels the browser request via AbortController", async () => {
    const user = userEvent.setup();
    renderWorkspace(format);
    await uploadPdf(user);

    fetchMock.mockImplementation(
      (url: string, init?: RequestInit) =>
        url.includes("/api/tools/pdf-to-")
          ? new Promise<Response>((_, reject) =>
              init?.signal?.addEventListener("abort", () =>
                reject(new DOMException("aborted", "AbortError")),
              ),
            )
          : inspectResponse(10),
    );

    await user.click(
      screen.getByRole("button", { name: new RegExp(`^convert to ${label}$`, "i") }),
    );
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    const init = convertCalls(endpoint)[0][1] as RequestInit & {
      signal?: AbortSignal;
    };
    expect(init.signal?.aborted).toBe(true);
    expect(
      await screen.findByRole("button", {
        name: new RegExp(`^convert to ${label}$`, "i"),
      }),
    ).toBeEnabled();
  });

  it("surfaces a server error as an alert and allows reset", async () => {
    const user = userEvent.setup();
    renderWorkspace(format);
    await uploadPdf(user);
    // After the (successful) inspection, make the conversion itself fail.
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse(10);
      return fakeResponse({
        ok: false,
        status: 413,
        json: {
          error: { code: "TOO_MANY_OUTPUTS", message: "This PDF has 90 pages; the limit for image export is 50." },
        },
      });
    });

    await user.click(
      screen.getByRole("button", { name: new RegExp(`^convert to ${label}$`, "i") }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/limit for image export/i);

    await user.click(screen.getByRole("button", { name: /start over/i }));
    expect(screen.getByText(/upload a pdf to get started/i)).toBeInTheDocument();
  });

  it("distinguishes network failure from processing failure", async () => {
    const user = userEvent.setup();
    renderWorkspace(format);
    await uploadPdf(user);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/documents/inspect")) return inspectResponse(10);
      throw new TypeError("Failed to fetch");
    });

    await user.click(
      screen.getByRole("button", { name: new RegExp(`^convert to ${label}$`, "i") }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/check your connection/i);
  });

  it("announces results politely for screen readers", async () => {
    const user = userEvent.setup();
    routeFetch({ convert: () => imageResponse(10, format) });
    renderWorkspace(format);
    await uploadPdf(user);

    await user.click(
      screen.getByRole("button", { name: new RegExp(`^convert to ${label}$`, "i") }),
    );
    await screen.findByText(new RegExp(`${label} files created`, "i"));

    expect(screen.getByRole("status")).toHaveTextContent(/export ready/i);
  });
});
