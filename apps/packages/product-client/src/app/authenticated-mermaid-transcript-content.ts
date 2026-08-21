/** Shared mermaid transcript fixture used by the client-mount browser proof. */

export const MERMAID_FLOWCHART = [
  "flowchart TB",
  "  subgraph Pipeline",
  "    Frontend --> API",
  "    API -->|auth| Runtime",
  "  end",
  "  Runtime --> Decision{Ready?}",
  "  Decision -->|yes| Done",
  "  Decision -->|no| Wait",
].join("\n");

export const MERMAID_SECOND = [
  "flowchart LR",
  "  Alpha --> Beta",
].join("\n");

export const MERMAID_TRANSCRIPT_MARKDOWN = [
  "Here is the architecture.",
  "",
  "```mermaid",
  MERMAID_FLOWCHART,
  "```",
  "",
  "Next steps follow the second view.",
  "",
  "```mermaid",
  MERMAID_SECOND,
  "```",
].join("\n");
