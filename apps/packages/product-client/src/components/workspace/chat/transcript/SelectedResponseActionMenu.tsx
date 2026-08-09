import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { MessageCircleQuestion, MessageSquarePlus, MessagesSquare } from "lucide-react";
import { CHAT_SELECTED_RESPONSE_ACTIONS } from "#product/copy/chat/chat-copy";
import type { SelectedResponseSelection } from "#product/domain/chats/transcript/selected-response-context";
import { useSelectedResponseActions } from "#product/hooks/chat/workflows/use-selected-response-actions";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "#product/primitives/Popover";
import { PopoverMenuItem } from "#product/primitives/PopoverMenuItem";

export type SelectedResponseAction = "add-to-chat" | "more-details" | "side-chat";

export function ConnectedSelectedResponseActionMenu({
  selection,
  focusRequestNonce,
  onDismiss,
}: {
  selection: SelectedResponseSelection;
  focusRequestNonce: number;
  onDismiss: (options?: {
    clearNativeSelection?: boolean;
    restoreTranscriptFocus?: boolean;
  }) => void;
}) {
  const actions = useSelectedResponseActions();
  const handleAction = (action: SelectedResponseAction) => {
    onDismiss({ clearNativeSelection: true });
    if (action === "add-to-chat") {
      actions.addToChat(selection.text);
    } else if (action === "more-details") {
      actions.moreDetails(selection.text);
    } else {
      actions.askInSideChat(selection.text);
    }
  };

  return (
    <SelectedResponseActionMenu
      selection={selection}
      focusRequestNonce={focusRequestNonce}
      onAction={handleAction}
      onDismiss={() => onDismiss()}
      onEscape={() => onDismiss({ restoreTranscriptFocus: true })}
    />
  );
}

export function SelectedResponseActionMenu({
  selection,
  focusRequestNonce,
  onAction,
  onDismiss,
  onEscape,
}: {
  selection: SelectedResponseSelection;
  focusRequestNonce: number;
  onAction: (action: SelectedResponseAction) => void;
  onDismiss: () => void;
  onEscape: () => void;
}) {
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const virtualAnchorRef = useRef({
    getBoundingClientRect: (): DOMRect => {
      const rect = selectionRef.current.anchorRect;
      return new DOMRect(rect.x, rect.y, rect.width, rect.height);
    },
  });
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeItemIndex, setActiveItemIndex] = useState(0);

  useEffect(() => {
    if (focusRequestNonce <= 0) {
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      setActiveItemIndex(0);
      itemRefs.current[0]?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [focusRequestNonce]);

  const handleItemKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = itemRefs.current.indexOf(event.currentTarget);
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % itemRefs.current.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + itemRefs.current.length) % itemRefs.current.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = itemRefs.current.length - 1;
    }
    if (nextIndex !== null) {
      event.preventDefault();
      setActiveItemIndex(nextIndex);
      itemRefs.current[nextIndex]?.focus();
    }
  };

  const items: Array<{
    action: SelectedResponseAction;
    label: string;
    icon: typeof MessageSquarePlus;
  }> = [
    {
      action: "add-to-chat",
      label: CHAT_SELECTED_RESPONSE_ACTIONS.addToChat,
      icon: MessageSquarePlus,
    },
    {
      action: "more-details",
      label: CHAT_SELECTED_RESPONSE_ACTIONS.moreDetails,
      icon: MessageCircleQuestion,
    },
    {
      action: "side-chat",
      label: CHAT_SELECTED_RESPONSE_ACTIONS.askInSideChat,
      icon: MessagesSquare,
    },
  ];

  return (
    <Popover open onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <PopoverAnchor virtualRef={virtualAnchorRef} />
      <PopoverContent
        variant="menu"
        role="menu"
        aria-label={CHAT_SELECTED_RESPONSE_ACTIONS.menuLabel}
        data-selected-response-actions
        side="top"
        align="center"
        sideOffset={8}
        collisionPadding={8}
        sticky="always"
        updatePositionStrategy="always"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          onEscape();
        }}
      >
        {items.map((item, index) => {
          const Icon = item.icon;
          return (
            <PopoverMenuItem
              key={item.action}
              ref={(node) => { itemRefs.current[index] = node; }}
              role="menuitem"
              tabIndex={activeItemIndex === index ? 0 : -1}
              label={item.label}
              icon={<Icon aria-hidden="true" className="icon-paired" />}
              onPointerDown={(event) => event.preventDefault()}
              onFocus={() => setActiveItemIndex(index)}
              onKeyDown={handleItemKeyDown}
              onClick={() => onAction(item.action)}
            />
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
