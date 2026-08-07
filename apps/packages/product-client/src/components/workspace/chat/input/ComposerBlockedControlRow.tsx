import { Button } from "#product/primitives/Button";
import { ChatComposerActions } from "#product/components/workspace/chat/input/ChatComposerActions";
import { ChatComposerControlRowFrame } from "#product/components/workspace/chat/composer/ChatComposerControlRowFrame";
import type { ComposerBlockedActionPresentation } from "#product/lib/domain/chat/composer/composer-blocked-state";

/**
 * The composer takeover's control row: the leading control cluster
 * (model/mode/goal/integrations) is dropped entirely, the trailing slot
 * carries the blocked state's recovery actions, and send stays disabled.
 */
export function ComposerBlockedControlRow({
  actions,
  isRunning,
  isEmpty,
  onSubmit,
  onCancel,
}: {
  actions: ComposerBlockedActionPresentation[];
  isRunning: boolean;
  isEmpty: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <ChatComposerControlRowFrame
      trailing={(
        <>
          {actions.map((action) => (
            <Button
              key={action.key}
              type="button"
              variant={action.variant === "primary" ? "primary" : "secondary"}
              size="sm"
              loading={action.loading}
              disabled={action.disabled}
              onClick={action.onSelect}
            >
              {action.label}
            </Button>
          ))}
        </>
      )}
      action={(
        <ChatComposerActions
          isRunning={isRunning}
          isEmpty={isEmpty}
          isDisabled
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      )}
    />
  );
}
