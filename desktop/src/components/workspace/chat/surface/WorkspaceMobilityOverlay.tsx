import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { useWorkspaceMobility } from "@/hooks/workspaces/use-workspace-mobility";
import { useMobilityFooterContext } from "@/hooks/workspaces/mobility/use-mobility-footer-context";
import {
  mobilityReconnectCopy,
  mobilityStatusCopy,
} from "@/config/mobility-copy";
import {
  ArrowUpRight,
  BrailleSweepBadge,
} from "@/components/ui/icons";
import {
  useBrailleCascade,
  useBrailleSnake,
  useBrailleSweep,
} from "@/hooks/ui/use-braille-sweep";

const BRAILLE_FIELD_SLOTS = Array.from({ length: 28 }, (_, index) => index);

function brailleFieldTone(index: number): string {
  switch (index % 4) {
    case 0:
      return "text-foreground/12";
    case 1:
      return "text-foreground/18";
    case 2:
      return "text-foreground/10";
    default:
      return "text-foreground/15";
  }
}

export function WorkspaceMobilityOverlay() {
  const navigate = useNavigate();
  const mobility = useWorkspaceMobility();
  const footerContext = useMobilityFooterContext();
  const sweep = useBrailleSweep();
  const snake = useBrailleSnake();
  const cascade = useBrailleCascade();
  const [completionVisible, setCompletionVisible] = useState(false);
  const [cleanupFailureDismissed, setCleanupFailureDismissed] = useState(false);

  useEffect(() => {
    if (mobility.status.phase === "success") {
      setCompletionVisible(true);
      if (!mobility.showMcpNotice) {
        const timer = window.setTimeout(() => {
          setCompletionVisible(false);
        }, 1400);
        return () => window.clearTimeout(timer);
      }
      return;
    }

    if (
      mobility.status.phase !== "cleanup_failed"
      && mobility.status.phase !== "provisioning"
      && mobility.status.phase !== "transferring"
      && mobility.status.phase !== "finalizing"
      && mobility.status.phase !== "cleanup_pending"
      && !mobility.showMcpNotice
    ) {
      setCompletionVisible(false);
    }
  }, [mobility.showMcpNotice, mobility.status.phase]);

  useEffect(() => {
    if (mobility.status.phase !== "cleanup_failed") {
      setCleanupFailureDismissed(false);
    }
  }, [mobility.status.phase]);

  const mode = useMemo(() => {
    if (
      mobility.status.phase === "provisioning"
      || mobility.status.phase === "transferring"
      || mobility.status.phase === "finalizing"
      || mobility.status.phase === "cleanup_pending"
    ) {
      return "progress" as const;
    }
    if (mobility.status.phase === "cleanup_failed") {
      if (cleanupFailureDismissed) {
        return "hidden" as const;
      }
      return "cleanup_failed" as const;
    }
    if (completionVisible || mobility.showMcpNotice) {
      return "completion" as const;
    }
    return "hidden" as const;
  }, [
    cleanupFailureDismissed,
    completionVisible,
    mobility.showMcpNotice,
    mobility.status.phase,
  ]);

  if (mode === "hidden") {
    return null;
  }

  const isCompletion = mode === "completion";
  const isCleanupFailure = mode === "cleanup_failed";
  const primaryFrame = isCompletion || isCleanupFailure ? cascade : sweep;
  const secondaryFrame = isCompletion ? sweep : snake;
  const title = mobility.status.title
    ?? mobilityStatusCopy(
      isCleanupFailure ? "cleanup_failed" : "success",
      mobility.status.direction,
    ).title;
  const description = isCleanupFailure
    ? mobility.status.description
      ?? mobilityStatusCopy("cleanup_failed", mobility.status.direction).description
    : isCompletion
      ? mobility.status.description
        ?? mobilityStatusCopy("success", mobility.status.direction).description
      : mobility.status.description
        ?? mobilityStatusCopy(mobility.status.phase, mobility.status.direction).description;

  return (
    <div className="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-background/66 backdrop-blur-[2px]">
      <div className="pointer-events-none absolute inset-0 grid grid-cols-4 gap-x-8 gap-y-10 px-8 py-10 @lg:grid-cols-7">
        {BRAILLE_FIELD_SLOTS.map((index) => (
          <span
            key={index}
            aria-hidden
            className={`font-mono text-2xl leading-none tracking-[-0.18em] ${brailleFieldTone(index)} ${
              index % 2 === 0 ? "animate-pulse" : ""
            }`}
            style={{ animationDelay: `${(index % 6) * 120}ms` }}
          >
            {index % 3 === 0 ? primaryFrame : secondaryFrame}
          </span>
        ))}
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-lg flex-col items-center px-6 text-center">
        <span
          aria-hidden
          className={`font-mono text-7xl leading-none tracking-[-0.22em] text-foreground transition-all duration-300 ${
            isCompletion || isCleanupFailure ? "opacity-100" : "opacity-95"
          }`}
        >
          {primaryFrame}
        </span>

        {footerContext?.locationLabel && (
          <p className="mt-6 text-xs uppercase tracking-[0.12em] text-muted-foreground/80">
            {footerContext.locationLabel}
          </p>
        )}

        <h2 className="mt-3 text-2xl font-medium tracking-tight text-foreground">
          {title}
        </h2>
        {description && (
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            {description}
          </p>
        )}

        {mode === "progress" && (
          <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-foreground/6 px-3 py-1.5 text-sm text-muted-foreground">
            <BrailleSweepBadge className="text-base text-foreground" />
            <span>{mobilityStatusCopy(mobility.status.phase, mobility.status.direction).title}</span>
          </div>
        )}

        {mode === "completion" && mobility.showMcpNotice && (
          <div className="mt-6 w-full rounded-2xl bg-foreground/6 p-4 text-left">
            <p className="text-sm text-muted-foreground">
              {mobilityReconnectCopy(mobility.status.direction)}
            </p>
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={mobility.dismissNotice}
              >
                Dismiss
              </Button>
              <Button
                size="sm"
                onClick={() => navigate("/powers")}
              >
                Open Powers
                <ArrowUpRight className="ml-1 size-3.5" />
              </Button>
            </div>
          </div>
        )}

        {mode === "cleanup_failed" && (
          <div className="mt-6 flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                void mobility.retryCleanup();
              }}
            >
              Retry cleanup
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCleanupFailureDismissed(true);
              }}
            >
              Continue working
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
