import { useEffect, useRef } from "react";
import { MessageCircleQuestion } from "#product/primitives/icons/core";
import { MessageSquarePlus } from "#product/primitives/icons/product";
import { CHAT_SELECTED_RESPONSE_ACTIONS } from "#product/copy/chat/chat-copy";
import type { SelectedResponseSelection } from "#product/domain/chats/transcript/selected-response-context";
import { useSelectedResponseActions } from "#product/hooks/chat/workflows/use-selected-response-actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#product/primitives/DropdownMenu";

export type SelectedResponseAction = "add-to-chat" | "more-details";

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
    } else {
      actions.moreDetails(selection.text);
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
  const contentRef = useRef<HTMLDivElement | null>(null);

  // Keyboard invocation (and only keyboard invocation) puts the first item in
  // hand. A pointer-made selection must leave focus in the document so the live
  // text selection survives long enough for the action to read it, which is why
  // `onOpenAutoFocus` below is prevented and this nonce is the discriminator.
  useEffect(() => {
    if (focusRequestNonce <= 0) {
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      contentRef.current
        ?.querySelector<HTMLElement>('[data-slot="dropdown-menu-item"]')
        ?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [focusRequestNonce]);

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
  ];

  const anchorRect = selection.anchorRect;

  return (
    // `modal={false}`: modal mode puts `pointer-events: none` on the body and
    // traps focus, which would kill transcript scrolling and the live text
    // selection this menu acts on.
    <DropdownMenu
      open
      modal={false}
      onOpenChange={(open) => { if (!open) onDismiss(); }}
    >
      {/*
        Radix's dropdown-menu has no `Anchor`, so there is no virtual-ref path
        for the selection rect the way `Popover` had. The trigger is instead a
        zero-affordance element parked over the live selection rect and the
        popper anchors to it. It is inert: no pointer events, out of the tab
        order, hidden from the accessibility tree.
      */}
      <DropdownMenuTrigger
        aria-hidden="true"
        tabIndex={-1}
        // Runtime-calculated position from the live selection rect — the one
        // sanctioned inline-style case (styling.md § Callsite Styling). It is
        // recomputed on every render, which is what `updatePositionStrategy`
        // relied on before.
        //
        // Containing-block dependency, unlike the virtual anchor this replaced:
        // `position: fixed` resolves against the viewport ONLY while no
        // ancestor of the transcript establishes a containing block. Giving any
        // ancestor `transform`, `filter`, `backdrop-filter`, `perspective`,
        // `contain` or `will-change: transform` silently re-bases these
        // coordinates and detaches the menu from the selection. The chain
        // (ChatView → SessionTranscriptPane → MessageList → ChatTranscriptView)
        // carries none of those today.
        style={{
          position: "fixed",
          top: anchorRect.y,
          left: anchorRect.x,
          width: anchorRect.width,
          height: anchorRect.height,
        }}
        className="pointer-events-none block"
      />
      <DropdownMenuContent
        ref={contentRef}
        aria-label={CHAT_SELECTED_RESPONSE_ACTIONS.menuLabel}
        // Radix labels the menu by its trigger. This trigger is the inert
        // selection-rect stand-in below and carries no text, so the reference
        // would erase the menu's accessible name; the label above is the name.
        aria-labelledby={undefined}
        // Load-bearing, not decorative: chat-transcript-selection.ts classifies
        // a click as "inside the menu" with `closest(...)` on this attribute and
        // suppresses dismissal. Drop it and every menu click dismisses the menu
        // before its action runs.
        data-selected-response-actions
        side="top"
        align="center"
        sideOffset={8}
        collisionPadding={8}
        sticky="always"
        updatePositionStrategy="always"
        // Arrow navigation wraps at both ends, matching the roving-tabindex
        // machine this replaced.
        loop
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        // WKWebView runs the native mouse-down focus fixup even though the
        // items cancel pointerdown, parking focus outside this portalled menu
        // mid-press; left alone, the focus-outside close unmounts the menu
        // before pointerup so no item can ever activate. Outside-click
        // dismissal is already owned by the transcript's own pointerdown
        // handling, so the focus-outside path carries no other duty here.
        onFocusOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          onEscape();
        }}
      >
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem
              key={item.action}
              // Keeps focus from moving on pointer-down. WebKit still clears
              // the window selection natively on menu-item mouse-down despite
              // the cancel; the selectionchange guard in
              // chat-transcript-selection-handlers.ts keeps the menu alive
              // through that so the click can finish (`onAction` reads the
              // captured text, not the live selection).
              onPointerDown={(event) => event.preventDefault()}
              // Hover is a focus move too: Radix focuses the hovered item on
              // pointer-move and the content on pointer-leave, and WebKit
              // clears the window selection whenever focus moves — which nulls
              // the published selection and unmounts this menu before a click
              // can land. Cancelling both makes Radix skip those focus moves;
              // the classes below supply the hover ink that focus-driven
              // `data-highlighted` would have painted.
              onPointerMove={(event) => event.preventDefault()}
              onPointerLeave={(event) => event.preventDefault()}
              className="hover:bg-hover hover:[&_svg]:opacity-100"
              onSelect={() => onAction(item.action)}
            >
              <Icon aria-hidden="true" className="icon-paired" />
              {item.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
