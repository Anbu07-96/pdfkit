"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface DropdownItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  /** Renders as `aria-checked` for single-choice menus (e.g. theme). */
  selected?: boolean;
  disabled?: boolean;
}

export interface DropdownProps {
  /** Render prop for the trigger. Receives the props it must spread. */
  trigger: (props: {
    "aria-expanded": boolean;
    "aria-haspopup": "menu";
    onClick: () => void;
    onKeyDown: (event: React.KeyboardEvent) => void;
    ref: React.Ref<HTMLButtonElement>;
  }) => React.ReactNode;
  items: DropdownItem[];
  label: string;
  align?: "start" | "end";
  className?: string;
}

/**
 * Small, dependency-free menu button implementing the WAI-ARIA menu pattern:
 * arrow-key navigation, Home/End, Escape to close and focus return.
 */
export function Dropdown({
  trigger,
  items,
  label,
  align = "end",
  className,
}: DropdownProps) {
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const itemRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const close = React.useCallback(
    (returnFocus = true) => {
      setOpen(false);
      if (returnFocus) triggerRef.current?.focus();
    },
    [],
  );

  React.useEffect(() => {
    if (!open) return;
    itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  React.useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function openMenu(index: number) {
    setActiveIndex(index);
    setOpen(true);
  }

  function onTriggerKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openMenu(0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openMenu(items.length - 1);
    }
  }

  function onMenuKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % items.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + items.length) % items.length);
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(items.length - 1);
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        break;
    }
  }

  return (
    <div className={cn("relative", className)}>
      {trigger({
        "aria-expanded": open,
        "aria-haspopup": "menu",
        onClick: () => (open ? close() : openMenu(0)),
        onKeyDown: onTriggerKeyDown,
        ref: triggerRef,
      })}

      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={cn(
            "absolute top-[calc(100%+0.5rem)] z-50 min-w-48 rounded-xl border border-border",
            "bg-surface-raised p-1.5 shadow-lg",
            align === "end" ? "end-0" : "start-0",
          )}
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={Boolean(item.selected)}
              disabled={item.disabled}
              tabIndex={index === activeIndex ? 0 : -1}
              onClick={() => {
                item.onSelect();
                close();
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-sm",
                "text-foreground transition-colors hover:bg-surface-muted",
                "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                "disabled:pointer-events-none disabled:opacity-55",
                item.selected && "font-medium text-primary",
              )}
            >
              {item.icon ? (
                <span aria-hidden="true" className="flex items-center [&_svg]:size-4">
                  {item.icon}
                </span>
              ) : null}
              <span className="flex-1">{item.label}</span>
              {item.selected ? (
                <span aria-hidden="true" className="text-primary">
                  ✓
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
