import {
  ArrowUpDown,
  CalendarClock,
  Combine,
  Crop,
  EyeOff,
  FileOutput,
  FileSpreadsheet,
  FileText,
  FileType,
  GitCompare,
  Hash,
  Highlighter,
  Image as ImageIcon,
  Languages,
  ListChecks,
  Lock,
  LockOpen,
  MessageSquare,
  MessagesSquare,
  Minimize2,
  NotebookPen,
  PenTool,
  Presentation,
  RotateCw,
  ScanText,
  Scissors,
  Shapes,
  Signature,
  Sparkles,
  Stamp,
  Table,
  Tags,
  Trash2,
  Type,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { ToolIconName } from "@/lib/tools";

/**
 * Presentation-layer registry that maps catalog icon keys to concrete icon
 * components, so the catalog itself stays plain serializable data.
 */
const ICONS: Record<ToolIconName, LucideIcon> = {
  "ai-compare": GitCompare,
  "ai-notes": NotebookPen,
  "ai-summarize": Sparkles,
  annotate: MessageSquare,
  ask: MessagesSquare,
  calendar: CalendarClock,
  compress: Minimize2,
  crop: Crop,
  draw: PenTool,
  excel: FileSpreadsheet,
  extract: FileOutput,
  highlight: Highlighter,
  image: ImageIcon,
  "key-points": Tags,
  "list-checks": ListChecks,
  lock: Lock,
  merge: Combine,
  metadata: EyeOff,
  "page-numbers": Hash,
  pdf: FileText,
  powerpoint: Presentation,
  redact: EyeOff,
  reorder: ArrowUpDown,
  rotate: RotateCw,
  scan: ScanText,
  shapes: Shapes,
  signature: Signature,
  split: Scissors,
  table: Table,
  text: Type,
  translate: Languages,
  trash: Trash2,
  unlock: LockOpen,
  watermark: Stamp,
  word: FileType,
};

export interface ToolIconProps {
  name: ToolIconName;
  className?: string;
}

/** Icons are decorative: the tool name is always rendered next to them. */
export function ToolIcon({ name, className }: ToolIconProps) {
  const Icon = ICONS[name] ?? FileText;
  return <Icon aria-hidden="true" className={cn("size-5", className)} />;
}
