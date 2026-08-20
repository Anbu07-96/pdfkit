import { describe, expect, it } from "vitest";
import {
  buildAcceptAttribute,
  getFileExtension,
  isFileTypeAllowed,
  validateFiles,
  type FileLike,
} from "@/lib/upload/file-validation";

function file(name: string, size = 1024, type = "application/pdf"): FileLike {
  return { name, size, type };
}

describe("getFileExtension", () => {
  it("returns the lower-case extension", () => {
    expect(getFileExtension("Report.FINAL.PDF")).toBe(".pdf");
    expect(getFileExtension("photo.JPG")).toBe(".jpg");
  });

  it("returns an empty string when there is no extension", () => {
    expect(getFileExtension("README")).toBe("");
    expect(getFileExtension(".gitignore")).toBe("");
    expect(getFileExtension("trailing.")).toBe("");
  });
});

describe("isFileTypeAllowed", () => {
  const constraints = { extensions: [".pdf"], mimeTypes: ["application/pdf"] };

  it("accepts a matching extension or mime type", () => {
    expect(isFileTypeAllowed(file("a.pdf", 10, ""), constraints)).toBe(true);
    expect(isFileTypeAllowed(file("a", 10, "application/pdf"), constraints)).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isFileTypeAllowed(file("a.docx", 10, "application/msword"), constraints)).toBe(
      false,
    );
  });

  it("accepts anything when no rules are configured", () => {
    expect(isFileTypeAllowed(file("a.exe", 10, ""), {})).toBe(true);
  });
});

describe("validateFiles", () => {
  const constraints = {
    extensions: [".pdf"],
    mimeTypes: ["application/pdf"],
    maxFileSize: 1000,
    maxFiles: 2,
  };

  it("accepts valid files", () => {
    const { accepted, rejected } = validateFiles([file("a.pdf", 500)], constraints);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("rejects unsupported types", () => {
    const { rejected } = validateFiles([file("a.png", 100, "image/png")], constraints);
    expect(rejected[0]?.reason).toBe("unsupported-type");
  });

  it("rejects files that are too large", () => {
    const { rejected } = validateFiles([file("a.pdf", 5000)], constraints);
    expect(rejected[0]?.reason).toBe("too-large");
  });

  it("rejects empty files", () => {
    const { rejected } = validateFiles([file("a.pdf", 0)], constraints);
    expect(rejected[0]?.reason).toBe("empty-file");
  });

  it("rejects duplicates of already selected files", () => {
    const existing = [file("a.pdf", 500)];
    const { accepted, rejected } = validateFiles(
      [file("a.pdf", 500)],
      constraints,
      existing,
    );
    expect(accepted).toHaveLength(0);
    expect(rejected[0]?.reason).toBe("duplicate");
  });

  it("enforces the maximum number of files", () => {
    const { accepted, rejected } = validateFiles(
      [file("a.pdf", 10), file("b.pdf", 10), file("c.pdf", 10)],
      constraints,
    );
    expect(accepted.map((entry) => entry.name)).toEqual(["a.pdf", "b.pdf"]);
    expect(rejected[0]?.reason).toBe("too-many-files");
  });
});

describe("buildAcceptAttribute", () => {
  it("combines mime types and extensions", () => {
    expect(
      buildAcceptAttribute({ extensions: [".pdf"], mimeTypes: ["application/pdf"] }),
    ).toBe("application/pdf,.pdf");
  });

  it("returns an empty string without constraints", () => {
    expect(buildAcceptAttribute({})).toBe("");
  });
});
