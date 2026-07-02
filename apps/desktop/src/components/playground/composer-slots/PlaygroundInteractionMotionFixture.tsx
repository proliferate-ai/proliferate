import { useEffect, useState } from "react";
import { ApprovalCard } from "@/components/workspace/chat/input/ApprovalCard";
import { UserInputCard } from "@/components/workspace/chat/input/UserInputCard";
import { useComposerDockCardPresence } from "@/hooks/chat/ui/use-composer-dock-card-presence";
import {
  EXECUTE_OPTIONS,
  USER_INPUT_SINGLE_OPTION,
} from "@/lib/domain/chat/__fixtures__/playground/panel-interaction-fixtures";
import { noop } from "@/components/playground/PlaygroundComposerActions";

/** How long each card holds the slot before "resolving". */
const PENDING_MS = 3_600;
/** Empty-slot dwell after the exit fade, before the next card mounts. */
const RESOLVED_MS = 1_400;

/**
 * Looping pending→resolved fixture for the composer dock's active-card
 * motion. It drives the REAL presence controller
 * (useComposerDockCardPresence), so what plays here is exactly the product
 * grammar: chip-enter mount (280ms rise out of the composer), 150ms opacity
 * fade on resolve, and an instant swap when a different interaction takes
 * the slot. The cycle alternates an approval card and a question card so
 * both the entrance and the exit replay continuously.
 */
export function PlaygroundInteractionMotionFixture() {
  // Even phases hold a card (0 = approval, 2 = question); odd phases are the
  // resolved gap where the exit fade plays and the slot sits empty.
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const isPending = phase % 2 === 0;
    const timer = window.setTimeout(
      () => setPhase((current) => (current + 1) % 4),
      isPending ? PENDING_MS : RESOLVED_MS,
    );
    return () => window.clearTimeout(timer);
  }, [phase]);

  const entry =
    phase === 0
      ? {
        key: "motion-approval",
        node: (
          <ApprovalCard
            title="git push origin main"
            actions={EXECUTE_OPTIONS}
            onSelectOption={noop}
            onAllow={noop}
            onDeny={noop}
          />
        ),
      }
      : phase === 2
        ? {
          key: "motion-question",
          node: (
            <UserInputCard
              key="motion-question"
              title="Choose provider"
              questions={USER_INPUT_SINGLE_OPTION}
              onSubmit={noop}
              onCancel={noop}
            />
          ),
        }
        : null;

  const slot = useComposerDockCardPresence(entry?.key ?? null, entry?.node ?? null);
  return <>{slot}</>;
}
