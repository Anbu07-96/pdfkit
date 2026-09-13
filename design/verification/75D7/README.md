# Phase 75D.7 — Spatial Document Engine: Visual Review

Isolated design-lab experiment at `/design-lab/pdf-to-word/spatial`.
Production PDF → Word remains the 75D.5 baseline — nothing here is live.

The central idea: **the document itself becomes the interface.** One persistent
PDF object owns the stage — it responds to the pointer, attracts dragged files,
decomposes into its real structures (text / images / tables / layout), and those
structures travel and rebuild as a Word document that settles and offers itself
for download.

## Desktop 1440×900 — Empty

The staged PDF object with layered page depth and a barely-there tonal field.

![Desktop Empty](spatial/1440-empty.png)

## Desktop — Drag-over

The document magnetizes toward the drag point; pages fan open, surface illuminates.

![Desktop Drag-over](spatial/1440-dragover.png)

## Desktop — Selected

The document at rest with its file plate, Convert and Remove actions.

![Desktop Selected](spatial/1440-selected.png)

## Desktop — Processing, early (~1s)

The stage widens: PDF takes the left position, a blank Word surface fades in on the right.

![Desktop Processing Early](spatial/1440-processing-1-early.png)

## Desktop — Processing, decomposition (~2s)

An elegant exploded technical drawing: text, images, tables and layout lift out
in 3D with technical-drawing captions and counts.

![Desktop Processing Decomposition](spatial/1440-processing-2-decomposition.png)

## Desktop — Processing, reconstruction (~5s)

Structures travel to the Word document; text flows into paragraphs, images place
into frames, the table rebuilds as cells.

![Desktop Processing Reconstruction](spatial/1440-processing-3-reconstruction.png)

## Desktop — Completed

The Word document recenters (~0.7s transition), the PDF recedes, Download becomes primary.

![Desktop Completed](spatial/1440-completed.png)

## Desktop — Error

The document settles back; an inline, document-centered explanation — no red banner.

![Desktop Error](spatial/1440-error.png)

## Desktop — Processing, dark mode

Paper-light documents on the dark stage; the forming Word surface carries a faint cool tint.

![Desktop Processing Dark](spatial/1440-processing-dark.png)

## Mobile 390×844 — Empty

First-class vertical composition: flatter perspective, on-plane labels.

![Mobile Empty](spatial/390-empty.png)

## Mobile — Processing

PDF top, Word forming below — decomposition and rebuild in one column.

![Mobile Processing](spatial/390-processing.png)

## Mobile — Completed

Full-width Download action with result meta.

![Mobile Completed](spatial/390-completed.png)

---

Research + technology decision: [`design/DESIGN-RESEARCH-75D7.md`](../../DESIGN-RESEARCH-75D7.md) ·
Prior directions: [`design/verification/75D6R/`](../75D6R/README.md)

All states mocked in the design lab (state switcher on the page); no production
code, conversion logic, or APIs involved.
