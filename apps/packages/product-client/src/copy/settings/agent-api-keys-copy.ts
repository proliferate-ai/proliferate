export const AGENT_API_KEYS_COPY = {
  title: "API keys",
  description:
    "Your saved provider secrets. Wire one into a harness from its Authentication tab.",
  keysSection: "Keys",
  loading: "Loading API keys...",
  loadError: "Could not load API keys. Check your connection and try again.",
  retryAction: "Retry",
  retryingAction: "Retrying…",
  emptyTitle: "No API keys yet",
  emptyDescription: "Add a key to wire it into a harness later.",
  signInRequiredTitle: "Sign in required",
  signInRequired: "Sign in to Proliferate Cloud to manage your API key vault.",
  // Signed in, but the control plane is unreachable. Never a sign-in prompt to
  // someone already signed in (PR2-GATING-01 class), and never a "cloud is not
  // configured" claim: the vault is a control-plane feature, so cloud compute
  // being off is not a reason it is unavailable (ADR FM6/Q9).
  serverUnreachableTitle: "Can't reach the server",
  serverUnreachable:
    "Your API key vault lives on the server. Reconnect to manage your keys.",
  addAction: "Add key",
  addModalHeading: "Add API key",
  addModalDescription:
    "Save a provider secret to wire into a harness from its Authentication tab.",
  createdDetail: (date: string) => `Added ${date}`,
  addError: "Could not add the API key.",
  revokeAction: "Revoke",
  revokeTitle: "Revoke API key",
  revokeDescription: (title: string) =>
    `Revoke ${title}? The secret is deleted and cannot be recovered.`,
  revokeConfirmLabel: "Revoke key",
  revokedToast: "API key revoked.",
  revokeError: "Could not revoke the API key.",
  // A 409 from the server carries the harnesses whose enabled selections still
  // wire this key (contract §5).
  revokeReferencedError: (harnesses: readonly string[]) =>
    `This key is wired into ${harnesses.join(", ")}. Disable those first, then revoke.`,
} as const;
