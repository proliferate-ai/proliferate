import {
  cloneElement,
  type MouseEventHandler,
  type ReactElement,
  type Ref,
} from "react";
import { WrapText } from "@proliferate/ui/icons";
import {
  POPOVER_SURFACE_CLASS,
  PopoverButton,
} from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import {
  useChatDiffLineWrapNativeContextMenu,
} from "@/hooks/ui/native/use-chat-diff-line-wrap-native-context-menu";
import { useChatDiffPreferencesStore } from "@/stores/chat/chat-diff-preferences-store";

interface ChatDiffLineWrapContextMenuProps {
  trigger: ReactElement<{
    onClick?: (...args: unknown[]) => void;
    onDoubleClick?: (...args: unknown[]) => void;
    onContextMenu?: (...args: unknown[]) => void;
    onContextMenuCapture?: MouseEventHandler<HTMLElement>;
    ref?: Ref<HTMLElement>;
  }>;
}

export function ChatDiffLineWrapContextMenu({
  trigger,
}: ChatDiffLineWrapContextMenuProps) {
  const wrapLongLines = useChatDiffPreferencesStore((state) => state.wrapLongLines);
  const toggleWrapLongLines = useChatDiffPreferencesStore((state) => state.toggleWrapLongLines);
  const nativeContextMenu = useChatDiffLineWrapNativeContextMenu({
    wrapLongLines,
    onToggleWrapLongLines: toggleWrapLongLines,
  });
  const previousOnContextMenuCapture = trigger.props.onContextMenuCapture;
  const triggerWithNativeContextMenu = cloneElement(trigger, {
    onContextMenuCapture: (event) => {
      previousOnContextMenuCapture?.(event);
      nativeContextMenu.onContextMenuCapture(event);
    },
  });

  return (
    <PopoverButton
      trigger={triggerWithNativeContextMenu}
      triggerMode="contextMenu"
      stopPropagation
      className={`w-52 ${POPOVER_SURFACE_CLASS}`}
    >
      {(close) => (
        <PopoverMenuItem
          icon={<WrapText />}
          label={wrapLongLines ? "Turn line wrapping off" : "Turn line wrapping on"}
          onClick={() => {
            toggleWrapLongLines();
            close();
          }}
        />
      )}
    </PopoverButton>
  );
}
