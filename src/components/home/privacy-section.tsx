import { Clock, EyeOff, ServerCog, ShieldCheck } from "lucide-react";
import { Container } from "@/components/layout/container";
import { SectionHeader } from "@/components/ui/section-header";

const POINTS = [
  {
    icon: ShieldCheck,
    title: "Privacy-conscious by design",
    description:
      "Document tools should not need to know who you are. PDFKit is being built without accounts, tracking or advertising as a requirement for basic use.",
  },
  {
    icon: Clock,
    title: "Temporary file handling",
    description:
      "Files sent to a working tool are processed in memory for the length of that request only. Nothing is written to disk and nothing is kept afterwards.",
  },
  {
    icon: EyeOff,
    title: "No unnecessary retention",
    description:
      "Documents will not be stored, indexed or reused for anything you did not ask for. Optional storage would always be an explicit choice.",
  },
  {
    icon: ServerCog,
    title: "Honest about the current state",
    description:
      "Only Merge PDF processes documents so far. Every other tool says plainly that it is not built yet, instead of implying capabilities we do not have.",
  },
];

export function PrivacySection() {
  return (
    <section aria-labelledby="privacy-title">
      <Container className="py-14 sm:py-16">
        <SectionHeader
          id="privacy-title"
          eyebrow="Privacy"
          title="Privacy is a product requirement, not a marketing line"
          description="PDFKit does not claim certifications or compliance it does not have. What follows is the philosophy the product is being built on."
        />

        <ul className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          {POINTS.map((point) => (
            <li
              key={point.title}
              className="flex gap-4 rounded-xl border border-border bg-surface p-5 shadow-xs"
            >
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"
              >
                <point.icon className="size-5" />
              </span>
              <div>
                <h3 className="text-base font-semibold text-foreground">{point.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">
                  {point.description}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
