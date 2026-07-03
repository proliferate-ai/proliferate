export const AGENT_API_KEYS_COPY = {
  title: "API keys",
  description:
    "Your saved provider secrets. Wire one into a harness from its Authentication tab.",
  keysSection: "Keys",
  loading: "Loading API keys...",
  loadError: "Could not load API keys. Check your connection and try again.",
  emptyTitle: "No API keys yet",
  emptyDescription: "Add a key below to wire it into a harness later.",
  signInRequired: "Sign in to Proliferate Cloud to manage your API key vault.",
  addSection: "Add key",
  addSectionDescription:
    "The value is stored encrypted and never displayed again after saving.",
  titleLabel: "Title",
  titlePlaceholder: "Personal Anthropic API key",
  valueLabel: "Value",
  valuePlaceholder: "sk-...",
  addAction: "Add key",
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
