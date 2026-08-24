import { Container } from "@/components/layout/container";
import { LoadingState } from "@/components/ui/states";

export default function Loading() {
  return (
    <Container className="py-20">
      <LoadingState label="Loading PDFKit…" />
    </Container>
  );
}
