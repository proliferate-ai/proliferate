import { useState } from "react";
import { Button } from "#product/primitives/Button";
import { ModalShell } from "./ModalShell";

export interface ToastDetailsModalContent {
  title: string;
  subtitle?: string;
  payload: string;
}

/**
 * Details destination 2: the payload has no home surface, so this compact
 * modal is the terminus — read it, copy it, close it.
 *
 * It scrolls instead of growing, and carries the two things people actually
 * want from an opaque failure: the text on their clipboard and a way to report
 * it. There is deliberately no Retry — retrying belongs to the toast, where
 * the action was.
 */
export function ToastDetailsModal({
  content,
  onClose,
  onReportBug,
}: {
  content: ToastDetailsModalContent | null;
  onClose: () => void;
  onReportBug?: (payload: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <ModalShell
      open={content !== null}
      onClose={() => {
        setCopied(false);
        onClose();
      }}
      title={content?.title ?? ""}
      // Same recipe as the app's other compact detail modals: popover
      // background, no border ring, modal shadow — moving from a floating
      // toast into its detail surface shouldn't change the UI language.
      sizeClassName="max-w-[520px] max-h-[70vh]"
      panelClassName="border-0 rounded-2xl bg-popover ring-0 shadow-modal"
      bodyClassName="flex min-h-0 flex-col overflow-hidden px-5 pb-4 pt-0"
      headerContent={(
        <div className="min-w-0 space-y-0.5">
          <h2 className="truncate text-ui font-medium text-foreground">
            {content?.title}
          </h2>
          {content?.subtitle ? (
            <p className="truncate text-ui-sm text-muted-foreground">
              {content.subtitle}
            </p>
          ) : null}
        </div>
      )}
      footer={(
        <>
          {onReportBug ? (
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto"
              onClick={() => {
                if (content) {
                  onReportBug(content.payload);
                }
              }}
            >
              Report a bug
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (!content) {
                return;
              }
              void navigator.clipboard?.writeText(content.payload);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy details"}
          </Button>
        </>
      )}
    >
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/60 bg-surface-elevated-secondary px-3 py-2 font-mono text-ui-sm leading-5 text-muted-foreground">
        {content?.payload}
      </pre>
    </ModalShell>
  );
}
