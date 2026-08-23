import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PngToPdfWorkspace } from "@/components/tools/workspaces/png-to-pdf-workspace";
import { ToastProvider } from "@/components/ui/toast";

const LIMITS = { maxFiles: 20, maxFileSize: 25 * 1024 * 1024 };

function pngFile(name = "shot.png") {
  return new File(["\u{89}PNGfake"], name, { type: "image/png" });
}

function renderWorkspace() {
  return render(
    <ToastProvider>
      <PngToPdfWorkspace limits={LIMITS} />
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

function pdfResponse(pages: number) {
  return fakeResponse({
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="png-to-pdf.pdf"',
      "x-pdfkit-pages": String(pages),
      "x-pdfkit-artifacts": "1",
    },
    blob: new Blob(["%PDF-"], { type: "application/pdf" }),
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

function convertCalls() {
  return fetchMock.mock.calls.filter(
    (call) => call[0] === "/api/tools/png-to-pdf",
  );
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(pdfResponse(2));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PngToPdfWorkspace", () => {
  it("starts with a PNG-only upload prompt and a disabled action", () => {
    renderWorkspace();

    expect(screen.getByLabelText(/upload png images/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^convert to pdf$/i })).toBeDisabled();
    expect(screen.getByText(/upload one or more png images/i)).toBeInTheDocument();
  });

  it("shows the selected images and the page prediction", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.upload(screen.getByLabelText(/upload png images/i), [
      pngFile("one.png"),
      pngFile("two.png"),
    ]);

    expect(await screen.findByText("2 images")).toBeInTheDocument();
    expect(screen.getByText(/will become a 2-page pdf/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^convert to pdf$/i })).toBeEnabled();
  });

  it("rejects a non-PNG upload", () => {
    renderWorkspace();
    const bad = new File(["nope"], "notes.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText(/upload png images/i), {
      target: { files: [bad] },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      /notes\.txt is not a supported file type/i,
    );
    expect(screen.getByRole("button", { name: /^convert to pdf$/i })).toBeDisabled();
  });

  it("sends the images in the displayed order to the PNG endpoint", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.upload(screen.getByLabelText(/upload png images/i), [
      pngFile("first.png"),
      pngFile("second.png"),
    ]);
    await screen.findByText("2 images");
    await screen.findByText(/will become a 2-page pdf/i);

    await user.click(screen.getByRole("button", { name: /^convert to pdf$/i }));

    await waitFor(() => expect(convertCalls()).toHaveLength(1));
    const form = convertCalls()[0][1].body as FormData;
    expect((form.getAll("files") as File[]).map((file) => file.name)).toEqual([
      "first.png",
      "second.png",
    ]);
  });

  it("reorders images with the move controls before converting", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.upload(screen.getByLabelText(/upload png images/i), [
      pngFile("one.png"),
      pngFile("two.png"),
    ]);
    await screen.findByText("2 images");

    await user.click(
      screen.getByRole("button", { name: /move one\.png down/i }),
    );

    await user.click(screen.getByRole("button", { name: /^convert to pdf$/i }));
    await waitFor(() => expect(convertCalls()).toHaveLength(1));
    const form = convertCalls()[0][1].body as FormData;
    expect((form.getAll("files") as File[]).map((file) => file.name)).toEqual([
      "two.png",
      "one.png",
    ]);
  });

  it("shows an honest indeterminate processing state and cancels via AbortController", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.upload(screen.getByLabelText(/upload png images/i), pngFile("a.png"));
    await screen.findByText("1 image");
    await screen.findByText(/will become a 1-page pdf/i);

    fetchMock.mockImplementation(
      (url: string, init?: RequestInit) =>
        url.includes("/api/tools/png-to-pdf")
          ? new Promise<Response>((_, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(new DOMException("aborted", "AbortError")),
              );
            })
          : undefined,
    );

    await user.click(screen.getByRole("button", { name: /^convert to pdf$/i }));
    expect(
      (await screen.findAllByText(/creating your pdf…/i)).length,
    ).toBeGreaterThanOrEqual(1);
    expect(document.querySelector("progress")).toBeNull();
    expect(screen.queryByText(/%\s*complete/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    const init = convertCalls()[0][1] as RequestInit & { signal?: AbortSignal };
    expect(init.signal?.aborted).toBe(true);
    expect(
      await screen.findByRole("button", { name: /^convert to pdf$/i }),
    ).toBeEnabled();
  });

  it("renders the server-confirmed success state and resets", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.upload(screen.getByLabelText(/upload png images/i), [
      pngFile("a.png"),
      pngFile("b.png"),
    ]);
    await screen.findByText("2 images");

    await user.click(screen.getByRole("button", { name: /^convert to pdf$/i }));

    expect(
      await screen.findByRole("heading", { name: /pdf created successfully/i }),
    ).toBeInTheDocument();
    // Page count comes from the server's X-PDFKit-Pages header (the success
    // panel renders it as separate spans).
    expect(screen.getAllByText(/2/).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("link", { name: /download pdf/i }),
    ).toHaveAttribute("href");

    await user.click(screen.getByRole("button", { name: /clear images/i }));
    expect(screen.getByText(/upload one or more png images/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^convert to pdf$/i })).toBeDisabled();
  });

  it("surfaces a server error as an alert", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.upload(screen.getByLabelText(/upload png images/i), pngFile("sneaky.png"));
    await screen.findByText("1 image");
    fetchMock.mockResolvedValue(
      fakeResponse({
        ok: false,
        status: 422,
        json: {
          error: { code: "INVALID_IMAGE", message: "sneaky.png is not a PNG image." },
        },
      }),
    );

    await user.click(screen.getByRole("button", { name: /^convert to pdf$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/not a png image/i);
  });

  it("distinguishes network failure from processing failure", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.upload(screen.getByLabelText(/upload png images/i), pngFile("a.png"));
    await screen.findByText("1 image");
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await user.click(screen.getByRole("button", { name: /^convert to pdf$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/check your connection/i);
  });

  it("announces states politely for screen readers", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.upload(screen.getByLabelText(/upload png images/i), [
      pngFile("a.png"),
      pngFile("b.png"),
    ]);
    await screen.findByText("2 images");
    await user.click(screen.getByRole("button", { name: /^convert to pdf$/i }));
    await screen.findByRole("heading", { name: /pdf created successfully/i });

    expect(screen.getByRole("status")).toHaveTextContent(/pdf ready/i);
  });
});
