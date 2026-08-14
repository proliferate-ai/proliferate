import * as PopoverPrimitive from "@radix-ui/react-popover";

import { Popover, PopoverAnchor } from "#product/primitives/Popover";
import { useNativeOverlayRegistration } from "#product/primitives/overlays/overlay-presence";
import type { CloudRepoPickerProps } from "#product/lib/domain/workspaces/cloud/cloud-repo-picker-view";
import {
  ADD_REPOSITORY_SURFACE_CLASS,
  AddRepositoryPopover,
  type AddRepoFlowOption,
  type AddRepoFlowStep,
} from "./AddRepositoryPopover";

export {
  ADD_REPOSITORY_SURFACE_CLASS,
  AddRepositoryPopover,
  GITHUB_CONNECTION_FOOTNOTE,
} from "./AddRepositoryPopover";
export type {
  AddRepoFlowOption,
  AddRepoFlowStep,
} from "./AddRepositoryPopover";

/** The app-level flow's surface: the shared chrome plus the enter animation
 * PopoverButton adds for the anchored hosts. */
export const ADD_REPO_SURFACE_CLASS =
  `${ADD_REPOSITORY_SURFACE_CLASS} data-[state=open]:animate-popover-in`;

export interface AddRepoFlowProps {
  open: boolean;
  step: AddRepoFlowStep;
  options: readonly AddRepoFlowOption[];
  /** True while a local add is committing (disables entry options). */
  adding?: boolean;
  /** False while the GitHub App is unauthorized — shows the entry footnote. */
  githubConnected?: boolean;
  entryNote?: string | null;
  error?: string | null;
  cloudPicker?: CloudRepoPickerProps | null;
  clonePicker?: CloudRepoPickerProps | null;
  onPickOption: (option: AddRepoFlowOption) => void;
  onBack: () => void;
  onClose: () => void;
}

/**
 * The app-level (store-driven) presentation of the add-repository flow.
 *
 * A popover surface rather than the old centered Dialog: the flow is a menu of
 * choices followed by a picker, which is the product's popover language, and
 * the two anchored entry points (the sidebar "+" and the project menu's sweep)
 * host the exact same body. This one has no element to anchor to — it is raised
 * by a command, not by a control — so it hangs off a fixed anchor near the top
 * of the viewport and keeps the popover's chrome, dismissal and focus
 * neutrality.
 */
export function AddRepoFlow({
  open,
  step,
  options,
  adding = false,
  githubConnected = true,
  entryNote = null,
  error = null,
  cloudPicker = null,
  clonePicker = null,
  onPickOption,
  onBack,
  onClose,
}: AddRepoFlowProps) {
  useNativeOverlayRegistration(open);

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onClose();
        }
      }}
      modal
    >
      <PopoverAnchor asChild>
        <span
          aria-hidden
          className="pointer-events-none fixed left-1/2 top-[15vh] block size-0"
        />
      </PopoverAnchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          data-slot="popover-content"
          side="bottom"
          align="center"
          sideOffset={0}
          // Focus neutrality, matching PopoverButton: opening must not blur the
          // composer, closing must not yank focus back to an anchor that is not
          // a control.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          className={`z-50 outline-none ${ADD_REPO_SURFACE_CLASS} [transform-origin:var(--radix-popover-content-transform-origin)]`}
        >
          <AddRepositoryPopover
            step={step}
            options={options}
            adding={adding}
            githubConnected={githubConnected}
            entryNote={entryNote}
            error={error}
            cloudPicker={cloudPicker}
            clonePicker={clonePicker}
            onPickOption={onPickOption}
            onBack={onBack}
          />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </Popover>
  );
}
