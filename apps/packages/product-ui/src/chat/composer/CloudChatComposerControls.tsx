import { ArrowUp, Plus } from "lucide-react";
import { twMerge } from "tailwind-merge";
import { ComposerActionButton } from "@proliferate/ui/primitives/ComposerActionButton";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import type {
  CloudChatComposerControlStripProps,
  CloudChatComposerView,
} from "./CloudChatComposerView";
import { ChatComposerControlRowFrame } from "./ChatComposerControlRowFrame";
import { CloudChatModelConfigControl } from "./CloudChatModelConfigControl";
import { CloudChatSingleControl } from "./CloudChatSingleControl";

export function CloudChatComposerControlRow({ composer }: { composer: CloudChatComposerView }) {
  const leadingControls = (composer.controls ?? []).filter((control) => control.placement === "leading");
  const modelConfigControls = (composer.controls ?? []).filter((control) => control.placement !== "leading");

  return (
    <ChatComposerControlRowFrame
      leading={(
        <>
          <ComposerControlButton
            type="button"
            icon={<Plus size={17} />}
            iconOnly
            label="Add context"
            disabled={composer.disabled}
            className="text-[color:var(--color-composer-control-foreground)]"
          />
          {leadingControls.map((control) => (
            <CloudChatSingleControl
              key={control.id}
              control={control}
              composerDisabled={composer.disabled}
            />
          ))}
        </>
      )}
      trailing={(
        modelConfigControls.length > 0 ? (
          <CloudChatModelConfigControl
            controls={modelConfigControls}
            composerDisabled={composer.disabled}
          />
        ) : null
      )}
      action={(
        <ComposerActionButton
          type="submit"
          aria-label="Send message"
          disabled={!composer.canSubmit || composer.disabled || composer.isSubmitting}
          loading={composer.isSubmitting}
          data-chat-send-button
        >
          {composer.isSubmitting ? null : <ArrowUp size={14} />}
        </ComposerActionButton>
      )}
    />
  );
}

export function CloudChatComposerControlStrip({
  controls,
  disabled = false,
  className = "",
}: CloudChatComposerControlStripProps) {
  const leadingControls = controls.filter((control) => control.placement === "leading");
  const modelConfigControls = controls.filter((control) => control.placement !== "leading");
  return (
    <div
      className={twMerge(
        "grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[5px]",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-[5px]">
        {leadingControls.map((control) => (
          <CloudChatSingleControl
            key={control.id}
            control={control}
            composerDisabled={disabled}
          />
        ))}
      </div>

      <div className="min-w-0" aria-hidden="true" />

      <div className="flex min-w-0 items-center gap-[5px]">
        {modelConfigControls.length > 0 ? (
          <CloudChatModelConfigControl
            controls={modelConfigControls}
            composerDisabled={disabled}
          />
        ) : null}
      </div>
    </div>
  );
}
