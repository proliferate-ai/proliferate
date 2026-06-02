import { type FormEvent, type KeyboardEvent } from "react";
import { ComposerTextarea } from "@proliferate/ui/primitives/ComposerTextarea";
import { ComposerTextareaFrame } from "@proliferate/ui/primitives/ComposerTextareaFrame";
import {
  CloudChatComposerControlRow,
  CloudChatComposerControlStrip,
} from "./composer/CloudChatComposerControls";
import { CloudChatComposerFooter } from "./composer/CloudChatComposerFooter";
import type { CloudChatComposerView } from "./composer/CloudChatComposerView";
import { ChatComposerSurface } from "./composer/ChatComposerSurface";

export type {
  CloudChatComposerControlGroupView,
  CloudChatComposerControlOptionView,
  CloudChatComposerControlStripProps,
  CloudChatComposerControlView,
  CloudChatComposerFooterControlView,
  CloudChatComposerView,
} from "./composer/CloudChatComposerView";
export { CloudChatComposerControlStrip };

export function CloudChatComposer({ composer }: { composer: CloudChatComposerView }) {
  function submitComposer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (composer.canSubmit && !composer.disabled && !composer.isSubmitting) {
      composer.onSubmit();
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter"
      && !event.shiftKey
      && !event.metaKey
      && !event.ctrlKey
      && !event.altKey
      && !event.nativeEvent.isComposing
      && composer.canSubmit
      && !composer.disabled
      && !composer.isSubmitting
    ) {
      event.preventDefault();
      composer.onSubmit();
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <ChatComposerSurface overflowMode="visible">
        <form onSubmit={submitComposer} className="relative flex flex-col">
          <ComposerTextareaFrame topInset="standard">
            <ComposerTextarea
              rows={2}
              value={composer.value}
              onChange={(event) => composer.onChange(event.currentTarget.value)}
              onKeyDown={handleComposerKeyDown}
              disabled={composer.disabled}
              className="min-h-[2.25rem]"
              placeholder={composer.placeholder}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              data-telemetry-mask
            />
          </ComposerTextareaFrame>
          <CloudChatComposerControlRow composer={composer} />
        </form>
      </ChatComposerSurface>
      <CloudChatComposerFooter
        composerControls={composer.footerComposerControls ?? []}
        controls={composer.footerControls ?? []}
        disabled={composer.disabled}
      />
    </div>
  );
}
