"use client";

import { Container } from "@/components/layout/container";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Container className="py-20">
      <div className="mx-auto max-w-xl">
        <ErrorState
          title="Something went wrong"
          description={
            <>
              The page could not be displayed. You can try again, and if it keeps
              happening the details below help with debugging.
              {error.digest ? (
                <span className="mt-2 block font-mono text-xs text-subtle">
                  Reference: {error.digest}
                </span>
              ) : null}
            </>
          }
          action={<Button onClick={reset}>Try again</Button>}
        />
      </div>
    </Container>
  );
}
