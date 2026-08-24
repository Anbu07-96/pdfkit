import Link from "next/link";
import { cn } from "@/lib/utils/cn";

/** PDFKit wordmark. The mark is decorative; the name carries the meaning. */
export function Logo({
  className,
  href = "/",
}: {
  className?: string;
  href?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg text-base font-semibold tracking-tight text-foreground",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-8 items-center justify-center rounded-lg bg-primary text-[13px] font-bold text-primary-foreground"
      >
        PK
      </span>
      <span>
        PDF<span className="text-primary">Kit</span>
      </span>
    </Link>
  );
}
