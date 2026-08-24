import { FileQuestion } from "lucide-react";
import { Container } from "@/components/layout/container";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";

export default function NotFound() {
  return (
    <Container className="py-20">
      <div className="mx-auto max-w-xl">
        <EmptyState
          icon={<FileQuestion />}
          title="Page not found"
          description="That page does not exist. It may have been moved, or the tool you are looking for is not in the catalog."
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <ButtonLink href="/">Go to homepage</ButtonLink>
              <ButtonLink href="/tools" variant="secondary">
                Browse tools
              </ButtonLink>
            </div>
          }
        />
      </div>
    </Container>
  );
}
