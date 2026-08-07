import { CircleAlert } from "#product/primitives/icons/status";
import { Spinner } from "#product/primitives/Spinner";
import { twMerge } from "#product/primitives/utils/tw-merge";
import type {
  ComposerBlockedIcon,
  ComposerBlockedTone,
} from "#product/lib/domain/chat/composer/composer-blocked-state";

/**
 * The composer takeover's status line: replaces the textarea entirely while
 * a persistent blocking condition holds (worktree missing, runtime down,
 * cloud/cowork provisioning). One icon, one sentence, no tray.
 */
export function ComposerBlockedStatusLine({
  icon,
  tone,
  message,
}: {
  icon: ComposerBlockedIcon;
  tone: ComposerBlockedTone;
  message: string;
}) {
  return (
    <div
      // Destructive states interrupt (the retired panels' restore-error had
      // role=alert); waiting states just announce politely.
      role={tone === "destructive" ? "alert" : "status"}
      className="flex items-center gap-2 pt-0.5 pb-3.5 text-composer"
    >
      {icon === "alert"
        ? (
          <CircleAlert
            className={twMerge("icon-paired shrink-0", tone === "destructive" ? "text-destructive" : "text-faint")}
          />
        )
        : (
          <Spinner
            className={twMerge("icon-paired shrink-0", tone === "destructive" ? "text-destructive" : "text-faint")}
          />
        )}
      <span className="min-w-0 text-foreground">{message}</span>
    </div>
  );
}
