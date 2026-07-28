import { useState } from "react";
import { WorkflowRunForm } from "@proliferate/ui";

/**
 * The launch card for a saved workflow revision. `draft` is a controlled
 * `WorkflowArgumentDraft` (`{ supplied, value }` per input), so each cell owns
 * it in state — otherwise every field renders read-only and React warns.
 */
const INPUTS = [
  { name: "ticket", type: "string", required: true },
  { name: "repository", type: "string", required: true },
  { name: "maxFiles", type: "number", required: false },
  { name: "includeLogs", type: "boolean", required: false },
];

const FILLED_DRAFT = {
  ticket: { supplied: true, value: "PROL-1284" },
  repository: { supplied: true, value: "proliferate/anyharness" },
  maxFiles: { supplied: true, value: "40" },
  includeLogs: { supplied: true, value: true },
};

const EMPTY_DRAFT = {
  ticket: { supplied: false, value: "" },
  repository: { supplied: false, value: "" },
  maxFiles: { supplied: false, value: "" },
  includeLogs: { supplied: false, value: false },
};

function Column({ children }) {
  return <div className="w-full max-w-3xl">{children}</div>;
}

export const ReadyToLaunch = () => {
  const [draft, setDraft] = useState(FILLED_DRAFT);
  return (
    <Column>
      <WorkflowRunForm
        inputs={INPUTS}
        draft={draft}
        issues={[]}
        blockers={[]}
        capabilityEnabled
        onChange={setDraft}
        onSubmit={() => undefined}
      />
    </Column>
  );
};

export const ValidationIssues = () => {
  const [draft, setDraft] = useState({
    ...EMPTY_DRAFT,
    repository: { supplied: true, value: "anyharness" },
  });
  return (
    <Column>
      <WorkflowRunForm
        inputs={INPUTS}
        draft={draft}
        issues={[
          {
            path: "arguments.ticket",
            code: "missing",
            message: "ticket is required.",
          },
          {
            path: "arguments.repository",
            code: "unknown",
            message: "repository must be written as owner/name.",
          },
        ]}
        blockers={[]}
        requiredForRunInputNames={new Set(["maxFiles"])}
        capabilityEnabled
        onChange={setDraft}
        onSubmit={() => undefined}
      />
    </Column>
  );
};

export const LaunchFailed = () => {
  const [draft, setDraft] = useState(FILLED_DRAFT);
  return (
    <Column>
      <WorkflowRunForm
        inputs={INPUTS.slice(0, 2)}
        draft={draft}
        issues={[]}
        blockers={[]}
        capabilityEnabled
        launchBlocked
        serverError="Managed delivery returned 503. Nothing was started."
        attemptMessage="This launch may already exist. Check or retry the same run identity."
        onChange={setDraft}
        onSubmit={() => undefined}
        onRetryAttempt={() => undefined}
      />
    </Column>
  );
};

export const CapabilityDisabled = () => {
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  return (
    <Column>
      <WorkflowRunForm
        inputs={[]}
        draft={draft}
        issues={[]}
        blockers={[]}
        capabilityEnabled={false}
        onChange={setDraft}
        onSubmit={() => undefined}
      />
    </Column>
  );
};
