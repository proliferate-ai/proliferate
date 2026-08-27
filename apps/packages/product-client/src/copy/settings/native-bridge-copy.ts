// The native-migration bridge's one-time prompt (agent_auth spec, zero-rows
// cutover row). PLACEHOLDER COPY — every string here is flagged for the
// design pass; the mechanics (when the prompt shows, what acting does) are
// the spec's, the words are not final.
export const NATIVE_BRIDGE_COPY = {
  title: (displayName: string) => `${displayName} is using your own login`,
  body: (displayName: string) =>
    `Agents now pick an auth method in Proliferate. Your existing ${displayName} `
    + "login keeps working — choosing a method below is optional.",
  dismiss: "Dismiss",
} as const;
