import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReleaseBody,
  buildReleaseContextFromApiPayload,
  releaseSectionId,
  releaseTitle,
} from "./publish-product-release.mjs";

const repository = "proliferate-ai/proliferate";

function pr(number, title, labels) {
  return {
    number,
    title,
    url: `https://github.com/${repository}/pull/${number}`,
    author: "octocat",
    labels,
  };
}

function commit(sha, title) {
  return {
    sha,
    title,
    url: `https://github.com/${repository}/commit/${sha}`,
  };
}

test("selects release sections from labels", () => {
  assert.equal(releaseSectionId(["release:large-feature"]), "features");
  assert.equal(releaseSectionId(["release:minor-feature"]), "features");
  assert.equal(releaseSectionId(["release:fix"]), "fixes");
  assert.equal(releaseSectionId(["release:performance"]), "performance");
  assert.equal(releaseSectionId(["release:docs"]), "docs");
  assert.equal(releaseSectionId(["release:maintenance"]), "maintenance");
  assert.equal(releaseSectionId(["area:desktop"]), "other");
  assert.equal(releaseSectionId(["release:skip", "release:fix"]), "");
});

test("builds nightly release body with grouped pull requests", () => {
  const body = buildReleaseBody({
    kind: "nightly",
    releaseTag: "proliferate-v0.1.50",
    productTag: "proliferate-v0.1.50",
    releaseId: "release-2026-06-06",
    base: "1111111111111111111111111111111111111111",
    head: "2222222222222222222222222222222222222222",
    surfaces: ["desktop", "web", "runtime"],
    artifactTags: ["desktop-v0.1.50", "runtime-v0.1.50"],
    workflowUrl: `https://github.com/${repository}/actions/runs/123`,
    repository,
    pullRequests: [
      pr(123, "Add automations", ["release:large-feature", "area:product"]),
      pr(124, "Fix updater publish behavior", ["release:fix", "area:release"]),
      pr(125, "Update install docs", ["release:docs", "area:docs"]),
      pr(126, "Tighten release scripts", ["release:maintenance", "area:release"]),
    ],
    commits: [commit("2222222222222222222222222222222222222222", "release commit")],
  });

  assert.match(body, /## Proliferate v0\.1\.50/);
  assert.match(body, /Daily release train for June 6, 2026\./);
  assert.match(body, /\| Version \| \[proliferate-v0\.1\.50\]/);
  assert.match(body, /### Highlights\n\n- \[#123\].*Add automations/);
  assert.match(body, /### Features\n\n- \[#123\].*Add automations/);
  assert.match(body, /### Fixes\n\n- \[#124\].*Fix updater publish behavior/);
  assert.match(body, /### Docs \/ Website\n\n- \[#125\].*Update install docs/);
  assert.match(body, /### Internal \/ Release\n\n- \[#126\].*Tighten release scripts/);
  assert.match(body, /\| Desktop \| \[desktop-v0\.1\.50\]/);
  assert.match(body, /\| Runtime \| \[runtime-v0\.1\.50\]/);
  assert.doesNotMatch(body, /server-v0\.1\.50/);
});

test("builds hotfix release body with reason", () => {
  const body = buildReleaseBody({
    kind: "hotfix",
    releaseTag: "proliferate-v0.1.51",
    productTag: "proliferate-v0.1.51",
    releaseId: "hotfix-2026-06-06-7",
    base: "1111111111111111111111111111111111111111",
    head: "2222222222222222222222222222222222222222",
    surfaces: ["web"],
    artifactTags: [],
    reason: "Fix login regression",
    workflowUrl: `https://github.com/${repository}/actions/runs/456`,
    repository,
    pullRequests: [pr(130, "Fix login regression", ["release:fix", "area:server"])],
    commits: [commit("2222222222222222222222222222222222222222", "fix login regression")],
  });

  assert.match(body, /Production hotfix for June 6, 2026\./);
  assert.match(body, /Reason: Fix login regression/);
  assert.match(body, /\| Hotfix \| hotfix-2026-06-06-7 \|/);
  assert.match(body, /_No artifact tags for this release\._/);
});

test("uses commits as fallback when there are no pull requests", () => {
  const body = buildReleaseBody({
    kind: "nightly",
    releaseTag: "proliferate-v0.1.50",
    productTag: "proliferate-v0.1.50",
    releaseId: "release-2026-06-06",
    base: "1111111111111111111111111111111111111111",
    head: "2222222222222222222222222222222222222222",
    surfaces: ["web"],
    artifactTags: [],
    workflowUrl: "",
    repository,
    pullRequests: [],
    commits: [commit("2222222222222222222222222222222222222222", "Ship web fix")],
  });

  assert.match(body, /### Other Changes\n\n- \[2222222\].*Ship web fix/);
  assert.match(body, /### Raw Commits[\s\S]*Ship web fix/);
});

test("omits release:skip pull requests from grouped sections but keeps raw commits", () => {
  const body = buildReleaseBody({
    kind: "nightly",
    releaseTag: "proliferate-v0.1.50",
    productTag: "proliferate-v0.1.50",
    releaseId: "release-2026-06-06",
    base: "1111111111111111111111111111111111111111",
    head: "2222222222222222222222222222222222222222",
    surfaces: ["web"],
    artifactTags: [],
    workflowUrl: "",
    repository,
    pullRequests: [pr(140, "Generated SDK churn", ["release:skip", "release:maintenance"])],
    commits: [commit("2222222222222222222222222222222222222222", "Generated SDK churn")],
  });

  assert.doesNotMatch(body, /#140/);
  assert.match(body, /### Raw Commits[\s\S]*Generated SDK churn/);
});

test("normalizes compare and pull payloads from GitHub API", () => {
  const context = buildReleaseContextFromApiPayload({
    repository,
    compare: {
      commits: [
        {
          sha: "1111111111111111111111111111111111111111",
          html_url: `https://github.com/${repository}/commit/1111111`,
          commit: { message: "First commit\n\nBody", author: { name: "Ada" } },
        },
        {
          sha: "2222222222222222222222222222222222222222",
          html_url: `https://github.com/${repository}/commit/2222222`,
          commit: { message: "Second commit", author: { name: "Grace" } },
        },
      ],
    },
    pullsByCommit: {
      "1111111111111111111111111111111111111111": [
        {
          number: 150,
          title: "Add release page publisher",
          html_url: `https://github.com/${repository}/pull/150`,
          user: { login: "ada" },
          labels: [{ name: "release:maintenance" }, { name: "area:release" }],
        },
      ],
      "2222222222222222222222222222222222222222": [
        {
          number: 150,
          title: "Add release page publisher",
          html_url: `https://github.com/${repository}/pull/150`,
          user: { login: "ada" },
          labels: [{ name: "release:maintenance" }, { name: "area:release" }],
        },
      ],
    },
  });

  assert.equal(context.commits.length, 2);
  assert.equal(context.commits[0].title, "First commit");
  assert.deepEqual(context.pullRequests.map((item) => item.number), [150]);
  assert.deepEqual(context.pullRequests[0].labels, ["release:maintenance", "area:release"]);
});

test("builds title for no-version hotfix", () => {
  assert.equal(
    releaseTitle({
      releaseTag: "hotfix-2026-06-06-7",
      productTag: "",
      releaseId: "hotfix-2026-06-06-7",
    }),
    "Proliferate Hotfix hotfix-2026-06-06-7",
  );
});
