import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveAreaExpectation,
  validatePullRequestMetadata,
} from "./pr-metadata.mjs";
import {
  validatePullRequestBody,
  validateReadyPullRequest,
} from "./validate-pr-metadata.mjs";

const valid = {
  title: "fix(server): preserve support report identity",
  labels: ["release:fix", "area:server"],
};
const headSha = "0123456789abcdef0123456789abcdef01234567";

function readyBody({
  evidenceState = "run",
  docsImpact = "- `guides/process/pull-requests.md`",
  currentHead = headSha,
} = {}) {
  return `## Summary

- Tighten the repository documentation contract.

## Testing / Verification

Evidence state: ${evidenceState}

- \`python3.12 scripts/check_docs.py\` — passed.

## Observability

- none — documentation-only behavior has no runtime telemetry delta.

## Security / Privacy

- none — no credential, authorization, private-data, or destructive boundary changed.

## Documentation impact

${docsImpact}

## Affected consumers

- Documentation contributors; proof is the docs checker above.

## Delivery receipt

- Spec revision / rulings: not applicable — standalone documentation repair.
- Base revision: fedcba9876543210fedcba9876543210fedcba98
Current head: ${currentHead}
- Review state: pending.
- Product proof: not-applicable — no product behavior changed.
- Human acceptance: pending.
- Limitations / stop / next consumer: ready for exact-head review.
`;
}

const ready = {
  title: "docs(process): clarify delivery receipts",
  labels: ["release:docs", "area:docs"],
  draft: false,
  body: readyBody(),
  headSha,
};

test("accepts the release metadata contract", () => {
  assert.deepEqual(validatePullRequestMetadata(valid), []);
});

test("requires a conventional title, one release label, and an area", () => {
  const errors = validatePullRequestMetadata({
    title: "Fix support identity",
    labels: ["release:fix", "release:docs"],
  });

  assert.equal(errors.length, 3);
  assert.match(errors[0], /title must match/);
  assert.match(errors[1], /exactly one release/);
  assert.match(errors[2], /at least one area/);
});

test("rejects unknown release and area labels", () => {
  const errors = validatePullRequestMetadata({
    title: valid.title,
    labels: ["release:experimental", "area:unknown"],
  });

  assert.equal(errors.length, 2);
  assert.match(errors[0], /Unknown release label/);
  assert.match(errors[1], /Unknown area label/);
});

test("derives required areas from changed paths", () => {
  const { required, ambiguous } = deriveAreaExpectation([
    "apps/desktop/src/main.ts",
    "server/proliferate/api/support.py",
    ".github/workflows/pr-metadata.yml",
    "anyharness/sdk/src/index.ts",
    "anyharness/crates/anyharness/src/lib.rs",
    "specs/README.md",
  ]);

  assert.deepEqual(required, [
    "area:anyharness",
    "area:desktop",
    "area:docs",
    "area:release",
    "area:sdk",
    "area:server",
  ]);
  assert.deepEqual(ambiguous, []);
});

test("mobile-only and unrecognized paths are neutral, not guessed", () => {
  const { required, ambiguous } = deriveAreaExpectation([
    "apps/mobile/app/index.tsx",
    "Makefile",
    "install/setup.sh",
  ]);

  assert.deepEqual(required, []);
  assert.deepEqual(ambiguous, []);
});

test("blocks when a required area derived from paths is missing", () => {
  const errors = validatePullRequestMetadata({
    title: "fix(desktop): repair updater",
    labels: ["release:fix", "area:server"],
    changedFiles: ["apps/desktop/src/updater.ts"],
  });

  assert.equal(errors.length, 1);
  assert.match(errors[0], /require area label\(s\): area:desktop/);
});

test("passes when applied areas cover every derived area", () => {
  const errors = validatePullRequestMetadata({
    title: "feat(desktop): bundle seed",
    labels: ["release:minor-feature", "area:desktop", "area:release"],
    changedFiles: [
      "apps/desktop/src-tauri/tauri.conf.json",
      ".github/workflows/release-desktop.yml",
    ],
  });

  assert.deepEqual(errors, []);
});

test("ambiguous path-to-area result blocks for a human choice", () => {
  const errors = validatePullRequestMetadata({
    title: "chore(deps): bump shared deps",
    labels: ["release:maintenance", "area:release"],
    changedFiles: ["cloud/sdk/package.json"],
  });

  // cloud/sdk/... matches both area:sdk and area:cloud.
  assert.equal(errors.length, 1);
  assert.match(errors[0], /map to more than one area/);
  assert.match(errors[0], /cloud\/sdk\/package\.json -> area:cloud \| area:sdk/);
});

test("ambiguity is resolved once one candidate area is applied", () => {
  const errors = validatePullRequestMetadata({
    title: "chore(sdk): bump cloud sdk deps",
    labels: ["release:maintenance", "area:sdk"],
    changedFiles: ["cloud/sdk/package.json"],
  });

  assert.deepEqual(errors, []);
});

test("drafts bypass title, label, body, and receipt enforcement", () => {
  assert.deepEqual(
    validateReadyPullRequest({
      title: "unfinished",
      labels: [],
      draft: true,
      body: "",
      headSha: "",
    }),
    [],
  );
});

test("accepts a complete minimal docs-only ready receipt", () => {
  assert.deepEqual(validateReadyPullRequest(ready), []);
});

test("accepts a no-documentation-impact reason", () => {
  const body = readyBody({
    docsImpact: "- none — existing owner documentation already covers this refactor.",
  });

  assert.deepEqual(validatePullRequestBody({ body, headSha }), []);
});

test("accepts every enumerated evidence state", () => {
  for (const evidenceState of [
    "pending",
    "not-applicable",
    "run",
    "unavailable",
  ]) {
    assert.deepEqual(
      validatePullRequestBody({
        body: readyBody({ evidenceState }),
        headSha,
      }),
      [],
    );
  }
});

test("rejects missing and duplicate required headings", () => {
  const missing = readyBody().replace("## Observability", "## Runtime signals");
  const missingErrors = validatePullRequestBody({ body: missing, headSha });
  assert.match(missingErrors.join("\n"), /exactly one "## Observability"/);

  const duplicate = `${readyBody()}\n## Summary\n\n- A second summary.\n`;
  const duplicateErrors = validatePullRequestBody({ body: duplicate, headSha });
  assert.match(duplicateErrors.join("\n"), /duplicate "## Summary"/);
});

test("rejects template placeholders in required sections", () => {
  const body = readyBody().replace(
    /## Summary[\s\S]*?## Testing \/ Verification/,
    "## Summary\n\n<!-- Fill this in. -->\n\n-\n\n## Testing / Verification",
  );
  const errors = validatePullRequestBody({ body, headSha });

  assert.match(errors.join("\n"), /Summary.*placeholder content/);
});

test("rejects a documentation impact with neither a path nor reason", () => {
  const errors = validatePullRequestBody({
    body: readyBody({ docsImpact: "- Maybe later." }),
    headSha,
  });

  assert.match(errors.join("\n"), /must name a repository path/);
});

test("rejects an unrecognized evidence state", () => {
  const errors = validatePullRequestBody({
    body: readyBody({ evidenceState: "passed" }),
    headSha,
  });

  assert.match(errors.join("\n"), /pending \| not-applicable \| run \| unavailable/);
});

test("rejects a missing or stale exact-head receipt", () => {
  const missingHead = readyBody().replace(/^Current head:.*$/m, "Current revision: pending");
  assert.match(
    validatePullRequestBody({ body: missingHead, headSha }).join("\n"),
    /must contain Current head/,
  );

  const staleHead = readyBody({
    currentHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
  assert.match(
    validatePullRequestBody({ body: staleHead, headSha }).join("\n"),
    /does not match the PR head/,
  );
});

test("accepts a fuller receipt without judging semantic adequacy", () => {
  const body = readyBody().replace(
    "- Documentation contributors; proof is the docs checker above.",
    "- Contributors: docs check run.\n- Release readers: review pending.\n- Operators: not-applicable — no procedure changed.",
  );

  assert.deepEqual(validatePullRequestBody({ body, headSha }), []);
});
