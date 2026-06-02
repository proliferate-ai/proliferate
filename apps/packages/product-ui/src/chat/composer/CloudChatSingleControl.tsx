import { ChevronDown } from "lucide-react";
import { Input } from "@proliferate/ui/primitives/Input";
import { useMemo, useRef, useState } from "react";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import {
  composerControlOptionCount,
  filterComposerControlOptions,
  isControlDisabled,
  selectedComposerOption,
} from "./CloudChatComposerControlModel";
import {
  ComposerControlMenuRows,
  PendingComposerConfigIndicator,
  iconNodeForComposerControl,
} from "./CloudChatComposerControlParts";
import type { CloudChatComposerControlView } from "./CloudChatComposerView";
import { ComposerPopoverSurface } from "./ComposerPopoverSurface";
import { useDismissComposerPopover } from "./useDismissComposerPopover";

export function CloudChatSingleControl({
  control,
  composerDisabled = false,
}: {
  control: CloudChatComposerControlView;
  composerDisabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = useMemo(() => selectedComposerOption(control), [control]);
  const disabled = composerDisabled || isControlDisabled(control);
  const icon = iconNodeForComposerControl(selected?.icon ?? control.icon, "size-3.5");
  const displayLabel = selected?.label ?? control.label;
  const displayDetail = control.detail && control.detail !== displayLabel
    ? control.detail
    : null;
  const searchable = composerControlOptionCount(control) > 12;
  const visibleControl = searchable ? filterComposerControlOptions(control, search) : control;

  function closePopover() {
    setOpen(false);
    setSearch("");
  }

  useDismissComposerPopover(open, rootRef, closePopover);

  if (disabled) {
    return (
      <ComposerControlButton
        disabled
        tone={control.active ? "accent" : "quiet"}
        active={control.active}
        icon={icon}
        label={displayLabel}
        detail={displayDetail}
        trailing={<PendingComposerConfigIndicator pendingState={control.pendingState ?? null} />}
        className="max-w-[12rem]"
      />
    );
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <ComposerControlButton
        tone={control.active ? "accent" : "neutral"}
        icon={icon}
        label={displayLabel}
        detail={displayDetail}
        trailing={(
          <span className="flex items-center gap-1">
            <PendingComposerConfigIndicator pendingState={control.pendingState ?? null} />
            <ChevronDown
              size={12}
              className="shrink-0 text-[color:var(--color-composer-control-muted-foreground)]"
            />
          </span>
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${control.label}: ${displayLabel}${displayDetail ? `, ${displayDetail}` : ""}`}
        data-state={open ? "open" : "closed"}
        className="max-w-[12rem]"
        onClick={() => {
          setOpen((value) => {
            const nextOpen = !value;
            if (!nextOpen) {
              setSearch("");
            }
            return nextOpen;
          });
        }}
      />
      {open ? (
        <ComposerPopoverSurface className="absolute bottom-full left-0 z-30 mb-1 w-64 max-w-[calc(100vw-1rem)] p-1">
          {searchable ? (
            <div className="px-1 pb-1">
              <div className="flex h-7 items-center rounded-lg border border-border bg-surface-control px-2.5">
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={`Search ${control.label.toLowerCase()}`}
                  className="h-auto min-w-0 border-0 bg-transparent px-0 py-0 text-sm shadow-none focus:ring-0"
                  data-telemetry-mask
                />
              </div>
            </div>
          ) : null}
          <div className="max-h-[min(18rem,calc(100vh-8rem))] overflow-y-auto">
            {composerControlOptionCount(visibleControl) > 0 ? (
              <ComposerControlMenuRows
                control={visibleControl}
                onClose={() => {
                  setOpen(false);
                  setSearch("");
                }}
              />
            ) : (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                No matches
              </p>
            )}
          </div>
        </ComposerPopoverSurface>
      ) : null}
    </div>
  );
}
