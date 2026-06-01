import {
  Check,
  Cloud,
  ExternalLink,
  GitBranch,
  Loader2,
  Smartphone,
  Sparkles,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import type {
  CloudChatComposerControlView,
  CloudChatComposerFooterControlView,
} from "./CloudChatComposerView";
import { CloudChatSingleControl } from "./CloudChatSingleControl";

export function CloudChatComposerFooter({
  composerControls,
  controls,
  disabled = false,
}: {
  composerControls: readonly CloudChatComposerControlView[];
  controls: readonly CloudChatComposerFooterControlView[];
  disabled?: boolean;
}) {
  const [copiedFeedbackKey, setCopiedFeedbackKey] = useState<string | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const footerActionSequenceRef = useRef(0);
  const copiedControl = copiedFeedbackKey
    ? controls.find((control) => footerControlFeedbackKey(control) === copiedFeedbackKey)
    : undefined;
  const copiedAnnouncement = copiedFeedbackKey
    ? copiedFeedbackLabel(copiedControl)
    : null;

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  function showCopiedFeedback(feedbackKey: string) {
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current);
    }
    setCopiedFeedbackKey(feedbackKey);
    copiedTimerRef.current = window.setTimeout(() => {
      setCopiedFeedbackKey((current) => current === feedbackKey ? null : current);
      copiedTimerRef.current = null;
    }, 1400);
  }

  function handleFooterControlClick(control: CloudChatComposerFooterControlView) {
    if (!control.onClick) {
      return;
    }
    const actionSequence = footerActionSequenceRef.current + 1;
    footerActionSequenceRef.current = actionSequence;
    const feedbackKey = footerControlFeedbackKey(control);
    const action = control.onClick();
    void Promise.resolve(action)
      .then((result) => {
        if (
          control.feedback === "copied"
          && result !== false
          && footerActionSequenceRef.current === actionSequence
        ) {
          showCopiedFeedback(feedbackKey);
        }
      })
      .catch(() => undefined);
  }

  if (composerControls.length === 0 && controls.length === 0) {
    return null;
  }

  return (
    <div className="rounded-[var(--radius-composer,1.5rem)] px-2 pt-2">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {composerControls.map((control) => (
          <CloudChatSingleControl
            key={control.id}
            control={control}
            composerDisabled={disabled}
          />
        ))}
        <span className="sr-only" role="status" aria-live="polite">
          {copiedAnnouncement}
        </span>
        {controls.map((control) => {
          const Icon = iconForComposerFooterControl(control.icon);
          const copied = copiedFeedbackKey === footerControlFeedbackKey(control);
          return (
            <ComposerControlButton
              key={control.id}
              type="button"
              disabled={control.disabled || control.pending}
              active={control.active}
              tone={control.active ? "accent" : "neutral"}
              icon={copied ? <Check size={14} /> : <Icon size={14} />}
              label={control.label}
              detail={control.detail}
              trailing={control.pending ? (
                <Loader2 size={12} className="shrink-0 animate-spin text-muted-foreground/70" />
              ) : undefined}
              aria-label={copied ? copiedFeedbackLabel(control) : undefined}
              title={copied ? "Copied" : control.title ?? undefined}
              className="max-w-full shrink-0 sm:max-w-[18rem]"
              data-telemetry-mask
              onClick={() => handleFooterControlClick(control)}
            />
          );
        })}
      </div>
    </div>
  );
}

function footerControlFeedbackKey(control: CloudChatComposerFooterControlView): string {
  return [
    control.id,
    control.feedbackKey ?? control.label,
    control.detail ?? "",
  ].join("\0");
}

function copiedFeedbackLabel(
  control: CloudChatComposerFooterControlView | undefined,
): string | undefined {
  if (!control) {
    return undefined;
  }
  const copiedSubject = control.title?.replace(/^Copy\s+/iu, "") || control.detail || control.label;
  return `Copied ${copiedSubject}`;
}

function iconForComposerFooterControl(
  icon: CloudChatComposerFooterControlView["icon"],
): ComponentType<{ size?: number; className?: string }> {
  switch (icon) {
    case "branch":
      return GitBranch;
    case "external":
      return ExternalLink;
    case "globe":
      return Smartphone;
    case "sparkles":
      return Sparkles;
    case "users":
      return Users;
    case "cloud":
    case "repo":
    default:
      return Cloud;
  }
}
