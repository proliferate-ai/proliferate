import { ArrowUp, Plus } from "lucide-react";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
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
            icon={<Plus className="icon-control" />}
            iconOnly
            label="Add context"
            disabled={composer.disabled}
            className="text-composer-control-foreground"
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
          {composer.isSubmitting ? null : <ArrowUp className="icon-control" />}
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
  // [CHAT-02] (D-V2-4): 8px between control clusters, same as
  // ChatComposerControlRowFrame. [SPACE-01] originally routed this strip's
  // gap-[5px] sites to 6px; the addendum's RULED block amended every
  // composer-surface site to [CHAT-02]'s 8px so both composer control rows read
  // identically.
  return (
    <div
      className={twMerge(
        "grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {leadingControls.map((control) => (
          <CloudChatSingleControl
            key={control.id}
            control={control}
            composerDisabled={disabled}
          />
        ))}
      </div>

      <div className="min-w-0" aria-hidden="true" />

      <div className="flex min-w-0 items-center gap-2">
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
