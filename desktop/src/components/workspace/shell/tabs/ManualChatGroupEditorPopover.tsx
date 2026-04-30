import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FixedPositionLayer } from "@/components/ui/layout/FixedPositionLayer";
import {
  MANUAL_CHAT_GROUP_COLOR_IDS,
  resolveManualChatGroupColor,
  type ManualChatGroupColorId,
} from "@/lib/domain/workspaces/tabs/manual-groups";

const POPOVER_WIDTH = 304;
const ESTIMATED_POPOVER_HEIGHT = 230;
const VIEWPORT_MARGIN = 8;
const ANCHOR_OFFSET = 8;

export interface ManualChatGroupEditorAnchorRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export function ManualChatGroupEditorPopover({
  title,
  anchorRect,
  initialLabel,
  initialColorId,
  onClose,
  onConfirm,
}: {
  title: string;
  anchorRect: ManualChatGroupEditorAnchorRect;
  initialLabel: string;
  initialColorId: ManualChatGroupColorId;
  onClose: () => void;
  onConfirm: (value: {
    label: string;
    colorId: ManualChatGroupColorId;
  }) => void;
}) {
  const [label, setLabel] = useState(initialLabel);
  const [colorId, setColorId] = useState(initialColorId);
  const inputRef = useRef<HTMLInputElement>(null);
  const position = useMemo(() => resolvePopoverPosition(anchorRect), [anchorRect]);
  const trimmedLabel = label.trim();

  useEffect(() => {
    setLabel(initialLabel);
    setColorId(initialColorId);
  }, [initialColorId, initialLabel]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const confirm = () => {
    if (trimmedLabel.length === 0) {
      return;
    }
    onConfirm({ label: trimmedLabel, colorId });
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <FixedPositionLayer
        position={position}
        className="fixed z-[61] w-[304px] rounded-lg border border-border bg-popover p-3 shadow-floating"
        data-telemetry-mask="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 text-sm font-medium text-foreground">
          {title}
        </div>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">
              Name
            </div>
            <Input
              ref={inputRef}
              aria-label="Group name"
              value={label}
              maxLength={40}
              onChange={(event) => setLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") {
                  return;
                }
                event.preventDefault();
                confirm();
              }}
            />
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              Color
            </div>
            <div className="grid grid-cols-6 gap-2">
              {MANUAL_CHAT_GROUP_COLOR_IDS.map((candidate) => (
                <Button
                  key={candidate}
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Use ${candidate} group color`}
                  aria-pressed={candidate === colorId}
                  onClick={() => setColorId(candidate)}
                  className={`size-7 rounded-full border p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover ${
                    candidate === colorId ? "border-foreground" : "border-border"
                  }`}
                  style={{
                    backgroundColor: resolveManualChatGroupColor(candidate),
                  }}
                >
                  <span className="sr-only">{candidate}</span>
                </Button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={trimmedLabel.length === 0}
              onClick={confirm}
            >
              Save
            </Button>
          </div>
        </div>
      </FixedPositionLayer>
    </>,
    document.body,
  );
}

function resolvePopoverPosition(anchorRect: ManualChatGroupEditorAnchorRect) {
  const maxLeft = Math.max(
    VIEWPORT_MARGIN,
    window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN,
  );
  const left = Math.min(
    Math.max(anchorRect.left, VIEWPORT_MARGIN),
    maxLeft,
  );
  const hasRoomBelow = anchorRect.bottom + ANCHOR_OFFSET + ESTIMATED_POPOVER_HEIGHT
    <= window.innerHeight - VIEWPORT_MARGIN;
  const top = hasRoomBelow
    ? anchorRect.bottom + ANCHOR_OFFSET
    : Math.max(
      VIEWPORT_MARGIN,
      anchorRect.top - ANCHOR_OFFSET - ESTIMATED_POPOVER_HEIGHT,
    );

  return { top, left };
}
