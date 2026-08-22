import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImagesToPdfWorkspace } from "@/components/tools/workspaces/images-to-pdf-workspace";
import { ToastProvider } from "@/components/ui/toast";

const LIMITS = { maxFiles: 20, maxFileSize: 25 * 1024 * 1024 };

function imageFile(name = "photo.jpg") {
  return new File(["\u{FF}\u{D8}\u{FF}fake"], name, { type: "image/jpeg" });
}

function renderWorkspace(limits = LIMITS) {
  return render(
    <ToastProvider>
      <ImagesToPdfWorkspace limits={limits} />
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
      "content-disposition": 'attachment; filename="images-to-pdf.pdf"',
      "x-pdfkit-pages": String(pages),
      "x-pdfkit-artifacts": "1",
    },
    blob: new Blob(["%PDF-"], { type: "application/pdf" }),
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function convertCalls() {
  return fetchMock.mock.calls.filter(
    (call) => call[0] === "/api/tools/images-to-pdf",
  );
}

describe("ImagesToPdfWorkspace", () => {
  it("starts with an upload prompt and a disabled action", () => {
    renderWorkspace();

    expect(screen.getByLabelText(/upload images/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^convert to pdf$/i })).toBeDisabled();
    expect(screen.getByText(/upload one or more jpg or png images/i)).toBeInTheDocument();
    // No page prediction before any file exists.
    expect(screen.queryByText(/will become/i)).not.toBeInTheDocument();
  });

  it("announces the page prediction for the uploaded images", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.upload(screen.getByLabelText(/upload images/i), [
      imageFile("a.jpg"),
      imageFile("b.png"),
      imageFile("c.jpg"),
    ]);

    expect(await screen.findByText("3 images")).toBeInTheDocument();
    expect(screen.getByText(/will become a 3-page pdf/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^convert to pdf$/i })).toBeEnabled();
  });

  it("rejects an invalid upload and disables the action", () => {
    renderWorkspace();
    const bad = new File(["nope"], "notes.txt", { type: "text/plain" });
    // fireEvent bypasses the accept filter, like a drag-and-drop would.
    fireEvent.change(screen.getByLabelText(/upload images/i), {
      target: { files: [bad] },
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/notes\.txt is not a supported file type/i);
    expect(screen.getByRole("button", { name: /^convert to pdf$/i })).toBeDisabled();
  });

  it("sends the images in the displayed order", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(pdfResponse(2));
    renderWorkspace();
    await user.upload(screen.getByLabelText(/upload images/i), [
      imageFile("first.jpg"),
      imageFile("second.jpg"),
    ]);
    await screen.findByText(/2 images/i);

    await user.click(screen.getByRole("button", { name: /^convert to pdf$/i }));

    await waitFor(() => expect(convertCalls()).toHaveLength(1));
    const form = convertCalls()[0][1].body as FormData;
    const sent = form.getAll("files") as File[];
    expect(sent.map((file) => file.name)).toEqual(["first.jpg", "second.jpg"]);
  });

  it("reorders images with the move controls before converting", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(pdfResponse(2));
    renderWorkspace();
    await user.upload(screen.getByLabelText(/upload images/i), [
      imageFile("one.jpg"),
      imageFile("two.jpg"),
    ]);
    await screen.findByText(/2 images/i);

    await user.click(
      screen.getByRole("button", { name: /move one\.jpg down/i }),
    );

    await user.click(screen.getByRole("button", { name: /^convert to pdf$/i }));
    await waitFor(() => expect(convertCalls()).toHaveLength(1));
    const form = convertCalls()[0][1].body as FormData;
    expect((form.getAll("files") as File[]).map((file) => file.name)).toEqual([
      "two.jpg",
      "one.jpg",
    ]);
  });

  it("shows an honest indeterminate processing state", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.upload(screen.getByLabelText(/upload images/i), imageFile("a.jpg"));
    await screen.findByText(/1 image/i);

    let resolveConvert: (response: Response) => void;
    fetchMock.mockImplementation(
      (url: string) =>
        url.includes("/api/tools/images-to-pdf")
          ? new Promise<Response>((resolve) => (resolveConvert = resolve))
          : undefined,
    );

    await user.click(screen.getByRole("button", { name: /^convert to pdf$/i }));
    expect(
      (await screen.findAllByText(/creating your pdf…/i)).length,
    ).toBeGreaterThanOrEqual(1);
    expect(document.querySelector("progress")).toBeNull();
    expect(screen.queryByText(/%\s*complete/i)).not.toBeInTheDocument();

    resolveConvert!(pdfResponse(1));
    await screen.findByText(/pdf created successfully/i);
  });

  it("cancels the browser request via AbortController", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.upload(screen.getByLabelText(/upload images/i), imageFile("a.jpg"));
    await screen.findByText(/1 image/i);

    fetchMock.mockImplementation(
      (url: string, init?: RequestInit) =>
        url.includes("/api/tools/images-to-pdf")
          ? new Promise<Response>((_, reject) =>
              init?.signal?.addEventListener("abort", () =>
                reject(new DOMException("aborted", "AbortError")),
              ),
            )
          : undefined,
    );

    await user.click(screen.getByRole("button", { name: /^convert to pdf$/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    const init = convertCalls()[0][1] as RequestInit & { signal?: AbortSignal };
    expect(init.signal?.aborted).toBe(true);
    expect(
      await screen.findByRole("button", { name: /^convert to pdf$/i }),
    ).toBeEnabled();
  });

  it("renders the server result with the real page count", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(pdfResponse(3));
    renderWorkspace();
    await user.upload(screen.getByLabelText(/upload images/i), [
      imageFile("a.jpg"),
      imageFile("b.jpg"),
      imageFile("c.jpg"),
    ]);
    await screen.findByText(/3 images/i);

    await user.click(screen.getByRole("button", { name: /^convert to pdf$/i }));

    expect(await screen.findByText(/pdf created successfully/i)).toBeInTheDocument();
    // The count comes from the server's X-PDFKit-Pages header.
    expect(screen.getByText((content, element) =>
      element?.tagName === "SPAN" && /3 pages/.test(content),
    )).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /download pdf/i }),
    ).toHaveAttribute("href");
    expect(
      screen.getByRole("button", { name: /convert another/i }),
    ).toBeEnabled();
  });

  it("surfaces a server error as an alert", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.upload(screen.getByLabelText(/upload images/i), imageFile("a.jpg"));
    await screen.findByText(/1 image/i);
    fetchMock.mockResolvedValue(
      fakeResponse({
        ok: false,
        status: 422,
        json: { error: { code: "INVALID_IMAGE", message: "Not a JPEG or PNG." } },
      }),
    );

    await user.click(screen.getByRole("button", { name: /^convert to pdf$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/not a jpeg or png/i);
    expect(alert).toHaveTextContent(/conversion failed/i);
  });

  it("distinguishes network failure from processing failure", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.upload(screen.getByLabelText(/upload images/i), imageFile("a.jpg"));
    await screen.findByText(/1 image/i);
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await user.click(screen.getByRole("button", { name: /^convert to pdf$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/check your connection/i);
  });

  it("resets with clear images", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.upload(screen.getByLabelText(/upload images/i), imageFile("keep.jpg"));
    await screen.findByText(/1 image/i);

    await user.click(screen.getByRole("button", { name: /clear images/i }));
    expect(screen.getByText(/upload one or more jpg or png/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^convert to pdf$/i })).toBeDisabled();
  });

  it("converts a second batch after a successful one", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(pdfResponse(1));
    renderWorkspace();
    await user.upload(screen.getByLabelText(/upload images/i), imageFile("a.jpg"));
    await screen.findByText(/1 image/i);
    await user.click(screen.getByRole("button", { name: /^convert to pdf$/i }));
    await screen.findByText(/pdf created successfully/i);

    await user.click(screen.getByRole("button", { name: /convert another/i }));
    await user.upload(screen.getByLabelText(/upload images/i), imageFile("b.jpg"));
    await screen.findByText(/will become a 1-page pdf/i);
    await user.click(screen.getByRole("button", { name: /^convert to pdf$/i }));

    await waitFor(() => expect(convertCalls()).toHaveLength(2));
    expect(await screen.findByText(/pdf created successfully/i)).toBeInTheDocument();
  });

  it("announces results politely for screen readers", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(pdfResponse(2));
    renderWorkspace();
    await user.upload(screen.getByLabelText(/upload images/i), [
      imageFile("a.jpg"),
      imageFile("b.jpg"),
    ]);
    await screen.findByText(/2 images/i);
    await user.click(screen.getByRole("button", { name: /^convert to pdf$/i }));
    await screen.findByText(/pdf created successfully/i);

    expect(screen.getByRole("status")).toHaveTextContent(/pdf ready/i);
  });
});
