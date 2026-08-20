"use client";

import { Info, Search, Trash2 } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState, ErrorState, LoadingState, Skeleton } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { FileCard } from "@/components/upload/file-card";
import { UploadZone } from "@/components/upload/upload-zone";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * Internal reference for the design system. It is not a product feature and is
 * not linked from the primary navigation; it exists so component states can be
 * reviewed in both themes.
 */
export function StyleguideClient() {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const { showToast } = useToast();

  return (
    <div>
      <Block title="Colours">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Background", "bg-background"],
            ["Surface", "bg-surface"],
            ["Surface muted", "bg-surface-muted"],
            ["Primary", "bg-primary"],
            ["Primary soft", "bg-primary-soft"],
            ["Success", "bg-success"],
            ["Warning", "bg-warning"],
            ["Danger", "bg-danger"],
          ].map(([label, className]) => (
            <div key={label} className="rounded-lg border border-border p-3">
              <div className={`h-12 rounded-md border border-border ${className}`} />
              <p className="mt-2 text-xs text-muted">{label}</p>
            </div>
          ))}
        </div>
      </Block>

      <Block title="Typography">
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Display / page title
          </p>
          <p className="mt-3 text-2xl font-semibold text-foreground">Section title</p>
          <p className="mt-3 text-base text-foreground">
            Body text at the default size, used for most reading content.
          </p>
          <p className="mt-2 text-sm text-muted">Muted supporting text.</p>
          <p className="mt-2 text-xs text-subtle">Subtle metadata text.</p>
        </div>
      </Block>

      <Block title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="subtle">Subtle</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="link">Link</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <IconButton label="Delete example" variant="secondary">
            <Trash2 className="size-4" />
          </IconButton>
          <Tooltip content="Tooltips appear on hover and on keyboard focus.">
            <Button variant="secondary">
              <Info className="size-4" /> With tooltip
            </Button>
          </Tooltip>
        </div>
      </Block>

      <Block title="Badges">
        <div className="flex flex-wrap gap-2">
          <Badge>Neutral</Badge>
          <Badge tone="primary">Primary</Badge>
          <Badge tone="success">Success</Badge>
          <Badge tone="warning">Warning</Badge>
          <Badge tone="danger">Danger</Badge>
          <Badge tone="info">Info</Badge>
        </div>
      </Block>

      <Block title="Inputs">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Default input" placeholder="Placeholder text" />
          <Input label="With hint" hint="Helper text under the field." placeholder="Optional" />
          <Input label="With error" error="This field is required." placeholder="Required" />
          <Input label="Disabled" disabled placeholder="Unavailable" />
          <Input label="With icon" leadingIcon={<Search />} placeholder="Search" />
          <SearchInput label="Search input" value={search} onValueChange={setSearch} showLabel placeholder="Type to search…" />
        </div>
      </Block>

      <Block title="Cards">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Card title</CardTitle>
              <CardDescription>Short supporting description.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted">Card body content.</p>
            </CardContent>
          </Card>
          <Card interactive>
            <CardHeader>
              <CardTitle>Interactive card</CardTitle>
              <CardDescription>Hover to see the elevation change.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted">Used for tool and category cards.</p>
            </CardContent>
          </Card>
        </div>
      </Block>

      <Block title="Feedback states">
        <div className="grid gap-4">
          <EmptyState
            icon={<Search />}
            title="Empty state"
            description="Shown when there is nothing to display yet."
            action={<Button variant="secondary">Primary action</Button>}
          />
          <ErrorState description="Shown when something failed. Always explains what to do next." />
          <LoadingState />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      </Block>

      <Block title="Overlays">
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>
            Open dialog
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              showToast({
                tone: "success",
                title: "Toast notification",
                description: "Announced politely to screen readers.",
              })
            }
          >
            Show toast
          </Button>
        </div>
        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title="Example dialog"
          description="Built on the native dialog element for focus trapping."
          footer={
            <>
              <Button variant="secondary" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => setDialogOpen(false)}>Confirm</Button>
            </>
          }
        >
          Press Escape or click outside the panel to close.
        </Dialog>
      </Block>

      <Block title="File card">
        <div className="grid gap-3 sm:grid-cols-2">
          <FileCard name="quarterly-report.pdf" size={2_411_724} type="application/pdf" onRemove={() => {}} />
          <FileCard
            name="scan-page-01.jpg"
            size={83_912_000}
            type="image/jpeg"
            error="Larger than the 50 MB limit"
            onRemove={() => {}}
          />
        </div>
      </Block>

      <Block title="Upload zone — enabled">
        <p className="mb-3 text-sm text-muted">
          Selection only. Files stay in the browser: nothing is uploaded, converted or
          processed anywhere in this version.
        </p>
        <UploadZone
          label="Upload your PDF files"
          extensions={[".pdf"]}
          mimeTypes={["application/pdf"]}
          maxFileSize={50 * 1024 * 1024}
          maxFiles={5}
        />
      </Block>

      <Block title="Upload zone — disabled (coming soon)">
        <UploadZone
          label="Upload your PDF files"
          extensions={[".pdf"]}
          disabled
          disabledBadge="Coming soon"
          disabledReason="Processing for this tool has not been built, so file selection is turned off."
        />
      </Block>
    </div>
  );
}
