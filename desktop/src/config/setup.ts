import type { SetupRequirementKind } from "@/hooks/setup/use-setup-requirements";

export const SETUP_COPY = {
  loadingMessage: "Restoring your setup",
  loadingSubtext: "Loading your saved preferences before opening Proliferate.",
  titles: {
    "open-target": "Where should we open files?",
    "chat-defaults": "Choose your defaults",
  } satisfies Record<SetupRequirementKind, string>,
  descriptions: {
    "open-target":
      "Pick the app Proliferate opens when you click into files or folders.",
    "chat-defaults":
      "This agent and model will be used for new chats. You can always change these later.",
  } satisfies Record<SetupRequirementKind, string>,
  openTargetAction: "Continue",
  chatDefaultsAction: "Get started",
  pendingDefaultsMessage: "Loading available agents",
  pendingDefaultsSubtext: "Waiting for the runtime to finish starting up.",
  chosenDefaultPending:
    "Your chosen default will unlock chat once that agent finishes installing or becomes ready.",
} as const;
