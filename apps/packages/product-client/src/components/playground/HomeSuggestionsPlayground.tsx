import { useCallback, useRef, useState } from "react";
import {
  HomeComposerForm,
  type HomeComposerFormHandle,
} from "#product/components/home/screen/HomeComposerForm";
import { HomeSuggestionCards } from "#product/components/home/screen/HomeSuggestionCards";
import { CHAT_SURFACE_GUTTER_CLASSNAME } from "#product/config/chat-layout";
import { useChatPromptAttachments } from "#product/hooks/chat/ui/use-chat-prompt-attachments";
import { CoworkThreadLaunchProvider } from "#product/providers/CoworkThreadLaunchProvider";

/**
 * Authenticated-surface fixture for deterministic suggestion interaction and
 * geometry proof. It composes the production suggestion grid and Home composer
 * while keeping launch disabled and form submits locally countable.
 */
export function HomeSuggestionsPlayground() {
  const [submitCount, setSubmitCount] = useState(0);
  const composerRef = useRef<HomeComposerFormHandle | null>(null);
  const attachments = useChatPromptAttachments({
    scopeKey: "home-suggestions-playground",
    promptCapabilities: null,
    canAttachFiles: false,
  });

  const replaceDraftAndFocus = useCallback((text: string) => {
    composerRef.current?.replaceDraftAndFocus(text);
  }, []);

  return (
    <div
      className="relative flex h-screen w-full min-w-0 overflow-hidden bg-background text-foreground"
      data-home-suggestions-playground
      data-telemetry-block
      onSubmitCapture={() => setSubmitCount((count) => count + 1)}
    >
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div
          className={`flex min-h-0 flex-1 basis-0 items-end justify-center pb-24 ${CHAT_SURFACE_GUTTER_CLASSNAME}`}
        >
          <div className="relative mx-auto w-full max-w-transcript-thread">
            <div className="flex flex-col items-center text-center">
              <h1 className="max-w-full whitespace-pre-wrap text-hero font-medium text-foreground select-none">
                What should we build?
              </h1>
            </div>
            <div
              className="absolute inset-x-[29px] top-full mt-8"
              data-home-card-region
              data-home-suggestions-region
            >
              <HomeSuggestionCards onSelect={replaceDraftAndFocus} />
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 basis-0" />

        <div
          className={`relative z-raised shrink-0 pb-4 pt-1.5 ${CHAT_SURFACE_GUTTER_CLASSNAME}`}
          data-home-composer-dock
        >
          <div className="mx-auto w-full max-w-transcript-thread">
            <CoworkThreadLaunchProvider>
              <HomeComposerForm
                ref={composerRef}
                targetDisabledReason={null}
                modelAvailabilityState="launchable"
                canLaunchTarget={false}
                modelSelection={null}
                modeId={null}
                launchControlValues={{}}
                launchTarget={null}
                attachments={attachments}
                controlsSlot={(
                  <span className="text-ui-sm text-muted-foreground">
                    Suggestion interaction fixture
                  </span>
                )}
                targetPickerSlot={(
                  <span className="text-ui-sm text-muted-foreground">This machine</span>
                )}
                modelAvailabilityNoticeSlot={null}
                submitDisabledReasonCtaSlot={null}
              />
            </CoworkThreadLaunchProvider>
            <output
              className="sr-only"
              data-home-suggestion-submit-count
              aria-label="Fixture submit count"
            >
              {submitCount}
            </output>
          </div>
        </div>
      </main>
    </div>
  );
}
