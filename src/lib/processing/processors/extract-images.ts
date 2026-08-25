import "server-only";

import { PDFDict, PDFName, PDFRawStream } from "pdf-lib";
import { decompressSync, unzlibSync } from "fflate";
import type {
  ProcessingArtifact,
  ProcessingRequest,
  ProcessingSuccess,
  ToolProcessor,
} from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import {
  loadPdfDocument,
  readPageCount,
} from "@/lib/processing/pdf-document";
import { EXTRACT_IMAGES_INPUT_RULES } from "@/lib/processing/rules";
import { encodePng } from "@/lib/thumbnails/png";
import {
  parseExtractImagesOptions,
  resolveExtractImagesPages,
} from "@/lib/processing/extract-images";

export class ExtractImagesProcessor implements ToolProcessor {
  readonly toolId = "extract-images";
  readonly input = EXTRACT_IMAGES_INPUT_RULES;

  async process(
    request: ProcessingRequest<Record<string, unknown>>,
  ): Promise<ProcessingSuccess> {
    const file = request.files[0];
    if (!file) {
      throw new ProcessingError("VALIDATION_ERROR", "No PDF was uploaded.");
    }

    const parsed = parseExtractImagesOptions(request.options ?? {});
    if (!parsed.ok) {
      throw new ProcessingError("VALIDATION_ERROR", parsed.issue.message);
    }
    const options = parsed.options;

    const source = await loadPdfDocument(file.name, file.bytes);
    const pageCount = readPageCount(source, file.name);

    const targetPages = resolveExtractImagesPages(options.pages, pageCount);
    const artifacts: ProcessingArtifact[] = [];

    const baseName = file.name.replace(/\.pdf$/i, "");

    for (const pageNumber of targetPages) {
      const page = source.getPage(pageNumber - 1);
      const resources = page.node.get(PDFName.of("Resources"));
      if (!resources) continue;

      const resDict = source.context.lookup(resources);
      if (!(resDict instanceof PDFDict)) continue;

      const xObject = resDict.get(PDFName.of("XObject"));
      if (!xObject) continue;

      const xObjectDict = source.context.lookup(xObject);
      if (!(xObjectDict instanceof PDFDict)) continue;

      let imageCountOnPage = 0;

      for (const key of xObjectDict.keys()) {
        const obj = source.context.lookup(xObjectDict.get(key));
        if (obj instanceof PDFRawStream) {
          const subtype = obj.dict.get(PDFName.of("Subtype"));
          if (subtype?.toString() === "/Image") {
            const rawContents = obj.getContents();
            if (rawContents.length === 0) continue;

            imageCountOnPage += 1;

            // Check if JPEG
            const isJpg =
              rawContents[0] === 0xff &&
              rawContents[1] === 0xd8 &&
              rawContents[2] === 0xff;

            if (isJpg) {
              artifacts.push({
                name: `${baseName}-p${pageNumber}-img${imageCountOnPage}.jpg`,
                mimeType: "image/jpeg",
                size: rawContents.length,
                bytes: rawContents,
              });
              continue;
            }

            // Check if PNG header
            const isPng =
              rawContents[0] === 0x89 &&
              rawContents[1] === 0x50 &&
              rawContents[2] === 0x4e &&
              rawContents[3] === 0x47;

            if (isPng) {
              artifacts.push({
                name: `${baseName}-p${pageNumber}-img${imageCountOnPage}.png`,
                mimeType: "image/png",
                size: rawContents.length,
                bytes: rawContents,
              });
              continue;
            }

            // Flate / raw pixels
            try {
              const width = Number(obj.dict.get(PDFName.of("Width"))?.toString() ?? "0");
              const height = Number(obj.dict.get(PDFName.of("Height"))?.toString() ?? "0");

              let decompressed: Uint8Array;
              try {
                decompressed = decompressSync(rawContents);
              } catch {
                decompressed = unzlibSync(rawContents);
              }

              if (width > 0 && height > 0) {
                let rgba: Uint8Array;
                if (decompressed.length === width * height * 4) {
                  rgba = decompressed;
                } else if (decompressed.length === width * height * 3) {
                  rgba = new Uint8Array(width * height * 4);
                  for (let i = 0, j = 0; i < decompressed.length; i += 3, j += 4) {
                    rgba[j] = decompressed[i]!;
                    rgba[j + 1] = decompressed[i + 1]!;
                    rgba[j + 2] = decompressed[i + 2]!;
                    rgba[j + 3] = 255;
                  }
                } else {
                  // Fallback: 1-byte grayscale or other
                  rgba = new Uint8Array(width * height * 4);
                  for (let i = 0, j = 0; i < decompressed.length && j < rgba.length; i += 1, j += 4) {
                    const val = decompressed[i]!;
                    rgba[j] = val;
                    rgba[j + 1] = val;
                    rgba[j + 2] = val;
                    rgba[j + 3] = 255;
                  }
                }

                const pngBytes = encodePng({ width, height, pixels: rgba });
                artifacts.push({
                  name: `${baseName}-p${pageNumber}-img${imageCountOnPage}.png`,
                  mimeType: "image/png",
                  size: pngBytes.length,
                  bytes: pngBytes,
                });
              } else {
                // Fallback raw bytes as PNG
                artifacts.push({
                  name: `${baseName}-p${pageNumber}-img${imageCountOnPage}.bin`,
                  mimeType: "application/octet-stream",
                  size: rawContents.length,
                  bytes: rawContents,
                });
              }
            } catch {
              // If decompress failed, push raw bytes
              artifacts.push({
                name: `${baseName}-p${pageNumber}-img${imageCountOnPage}.bin`,
                mimeType: "application/octet-stream",
                size: rawContents.length,
                bytes: rawContents,
              });
            }
          }
        }
      }
    }

    if (artifacts.length === 0) {
      throw new ProcessingError(
        "VALIDATION_ERROR",
        "No images were found in the selected pages of this PDF.",
      );
    }

    return {
      status: "succeeded",
      artifacts,
      bundleName: `${baseName}-extracted-images.zip`,
      meta: {
        pages: pageCount,
        outputPages: pageCount,
        extractedImagesCount: artifacts.length,
      },
    };
  }
}

export const extractImagesProcessor = new ExtractImagesProcessor();
