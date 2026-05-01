import { Command } from "cmdk";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export interface CommandPaletteCloseOptions {
  restoreFocus?: boolean;
}

interface CommandPaletteContextValue {
  close: (options?: CommandPaletteCloseOptions) => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export function useCommandPaletteClose(): (options?: CommandPaletteCloseOptions) => void {
  const context = useContext(CommandPaletteContext);
  if (!context) {
    throw new Error("useCommandPaletteClose must be used inside CommandPaletteRoot");
  }
  return context.close;
}

type CommandRootProps = ComponentProps<typeof Command>;

interface CommandPaletteRootProps extends Omit<CommandRootProps, "label"> {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
}

export function CommandPaletteRoot({
  open,
  onClose,
  label,
  children,
  className,
  ...props
}: CommandPaletteRootProps) {
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef(true);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback((options?: CommandPaletteCloseOptions) => {
    restoreFocusRef.current = options?.restoreFocus ?? true;
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    restoreFocusRef.current = true;
    const raf = window.requestAnimationFrame(() => {
      const input = dialogRef.current?.querySelector<HTMLInputElement>("[cmdk-input]");
      input?.focus();
    });
    return () => {
      window.cancelAnimationFrame(raf);
      if (!restoreFocusRef.current) {
        return;
      }
      const previousFocus = previousFocusRef.current;
      if (previousFocus?.isConnected) {
        previousFocus.focus();
      }
    };
  }, [open]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close({ restoreFocus: true });
      return;
    }
    if (event.key !== "Tab") {
      return;
    }

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      [
        "button:not([disabled])",
        "[href]",
        "input:not([disabled])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        "[tabindex]:not([tabindex='-1'])",
      ].join(","),
    );
    if (!focusable || focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, [close]);

  const contextValue = useMemo(() => ({ close }), [close]);

  if (!open) {
    return null;
  }

  return createPortal(
    <CommandPaletteContext.Provider value={contextValue}>
      <div
        className="fixed inset-0 z-[999] bg-overlay/50"
        data-telemetry-block
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            close({ restoreFocus: true });
          }
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className="fixed left-1/2 top-[20vh] flex max-h-[calc(100vh-1rem)] w-[calc(100vw-16px)] max-w-[580px] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-border/70 bg-popover/85 text-foreground shadow-floating-dark backdrop-blur-[16px]"
          onKeyDown={onKeyDown}
        >
          <Command
            shouldFilter={false}
            label={label}
            className={className}
            {...props}
          >
            {children}
          </Command>
        </div>
      </div>
    </CommandPaletteContext.Provider>,
    document.body,
  );
}

type CommandPaletteInputProps = ComponentProps<typeof Command.Input>;

export function CommandPaletteInput({
  className,
  ...props
}: CommandPaletteInputProps) {
  return (
    <Command.Input
      className={`h-11 w-full min-w-0 bg-transparent text-base leading-[21px] text-foreground outline-none placeholder:text-muted-foreground ${className ?? ""}`}
      data-telemetry-mask
      {...props}
    />
  );
}

type CommandPaletteListProps = ComponentProps<typeof Command.List>;

export function CommandPaletteList({
  className,
  ...props
}: CommandPaletteListProps) {
  return (
    <Command.List
      className={`max-h-[400px] min-h-0 overflow-y-auto px-1.5 py-1.5 ${className ?? ""}`}
      data-telemetry-mask
      {...props}
    />
  );
}

type CommandPaletteGroupProps = ComponentProps<typeof Command.Group>;

export function CommandPaletteGroup({
  className,
  ...props
}: CommandPaletteGroupProps) {
  return (
    <Command.Group
      className={`py-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:leading-4 [&_[cmdk-group-heading]]:text-muted-foreground ${className ?? ""}`}
      {...props}
    />
  );
}

type CommandPaletteItemProps = ComponentProps<typeof Command.Item>;

export function CommandPaletteItem({
  className,
  ...props
}: CommandPaletteItemProps) {
  return (
    <Command.Item
      className={`flex h-9 cursor-default select-none items-center gap-2 rounded-md px-2 text-xs leading-4 text-foreground outline-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-45 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground ${className ?? ""}`}
      {...props}
    />
  );
}
