/**
 * Organize PDF model.
 *
 * Shared by the browser (workspace controls) and the server (processor validates
 * options). Free of PDF libraries and `server-only`.
 *
 * Combines page reordering, page rotation, and page deletion into a single workflow.
 */

import {
  parsePageOrder,
  parsePageRotations,
  type PageOrder,
  type PageRotationMap,
} from "@/lib/processing/pages";

export interface OrganizePdfOptions {
  /** 1-based original page numbers in their final order. Omitted pages are deleted. */
  order: PageOrder;
  /** Rotations applied to original 1-based page numbers. */
  rotations: PageRotationMap;
}

export interface OrganizePdfOptionIssue {
  message: string;
  code?: string;
}

export type OrganizePdfParseResult =
  | { ok: true; options: OrganizePdfOptions }
  | { ok: false; issue: OrganizePdfOptionIssue };

export function parseOrganizePdfOptions(
  raw: { order?: unknown; rotations?: unknown },
  pageCount: number,
): OrganizePdfParseResult {
  const orderRaw = typeof raw.order === "string" ? raw.order : "";
  const rotationsRaw = typeof raw.rotations === "string" ? raw.rotations : "";

  let order: PageOrder;
  if (orderRaw.trim().length === 0) {
    order = Array.from({ length: pageCount }, (_, index) => index + 1);
  } else {
    const parsedOrder = parsePageOrder(orderRaw);
    if (!parsedOrder.ok) {
      return {
        ok: false,
        issue: { message: parsedOrder.issue.message, code: "INVALID_PAGE_ORDER" },
      };
    }
    order = parsedOrder.order;
  }

  if (order.length === 0) {
    return {
      ok: false,
      issue: {
        message: "At least one page must remain in the document.",
        code: "NO_PAGES_REMAIN",
      },
    };
  }

  const seen = new Set<number>();
  for (const page of order) {
    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
      return {
        ok: false,
        issue: {
          message: `Page ${page} does not exist. This PDF has ${pageCount} pages.`,
          code: "PAGE_OUT_OF_RANGE",
        },
      };
    }
    if (seen.has(page)) {
      return {
        ok: false,
        issue: {
          message: `Page ${page} appears more than once in the order.`,
          code: "INVALID_PAGE_ORDER",
        },
      };
    }
    seen.add(page);
  }

  const parsedRotations = parsePageRotations(rotationsRaw);
  if (!parsedRotations.ok) {
    return {
      ok: false,
      issue: {
        message: parsedRotations.issue.message,
        code: "INVALID_PAGE_ROTATION",
      },
    };
  }

  const rotations = parsedRotations.rotations;
  for (const [key] of Object.entries(rotations)) {
    const page = Number(key);
    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
      return {
        ok: false,
        issue: {
          message: `Page ${key} in rotations does not exist. This PDF has ${pageCount} pages.`,
          code: "PAGE_OUT_OF_RANGE",
        },
      };
    }
  }

  return {
    ok: true,
    options: {
      order,
      rotations,
    },
  };
}
