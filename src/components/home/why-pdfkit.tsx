import { Lock, Smartphone, Sparkles, Zap } from "lucide-react";
import { Container } from "@/components/layout/container";
import { SectionHeader } from "@/components/ui/section-header";

const BENEFITS = [
  {
    icon: Zap,
    title: "Fast",
    description: "Designed for efficient document workflows, with a light interface that loads quickly.",
  },
  {
    icon: Sparkles,
    title: "Simple",
    description: "Common document operations without unnecessary complexity, steps or sign-up walls.",
  },
  {
    icon: Lock,
    title: "Private",
    description: "Privacy is treated as a core product requirement rather than an afterthought.",
  },
  {
    icon: Smartphone,
    title: "Everywhere",
    description: "Designed for desktop, tablet and mobile, from 320px screens upwards.",
  },
];

export function WhyPdfkit() {
  return (
    <section aria-labelledby="why-title" className="bg-surface-muted/30 py-14 sm:py-16">
      <Container>
        <SectionHeader
          id="why-title"
          title="Why PDFKit"
          description="Four principles the product is being measured against as it is built."
        />

        <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BENEFITS.map((benefit) => (
            <li
              key={benefit.title}
              className="rounded-xl border border-border bg-surface p-5 shadow-xs"
            >
              <span
                aria-hidden="true"
                className="flex size-10 items-center justify-center rounded-lg bg-surface-muted text-foreground"
              >
                <benefit.icon className="size-5" />
              </span>
              <h3 className="mt-4 text-base font-semibold text-foreground">
                {benefit.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                {benefit.description}
              </p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
