import { Layers } from "lucide-react";
import { Container } from "@/components/layout/container";
import { BulkOperationCard } from "@/components/bulk/bulk-operation-card";
import { ButtonLink } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { BULK_OPERATIONS } from "@/lib/tools/bulk";

/**
 * Bulk Tools section on the homepage (Phase 61).
 *
 * Shows every bulk operation with its own card so the section is discoverable
 * from the first screen of the site, plus a link to the section landing page.
 */
export function BulkTools() {
  return (
    <section
      aria-labelledby="bulk-tools-title"
      className="border-y border-border bg-surface-muted/30 py-14 sm:py-16"
    >
      <Container>
        <SectionHeader
          id="bulk-tools-title"
          title="Bulk tools"
          description="Convert many files at once — per-file status, retry failed files, and download everything as one ZIP. Each file counts as one job against your daily quota."
          action={
            <ButtonLink href="/bulk" variant="secondary">
              <Layers aria-hidden="true" className="size-4" />
              All bulk tools
            </ButtonLink>
          }
        />

        <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BULK_OPERATIONS.map((operation) => (
            <BulkOperationCard key={operation.id} operation={operation} />
          ))}
        </ul>
      </Container>
    </section>
  );
}
