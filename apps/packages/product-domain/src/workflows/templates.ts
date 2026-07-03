/**
 * The 5 curated workflow starters (spec 3.6 templates gallery).
 *
 * These are full, valid `WorkflowDefinition`s used both as the empty-state
 * gallery and as the seed a "start from template" create writes. The Setup
 * harness/model here are readable placeholders — the create flow re-defaults
 * Setup to the user's first available catalog agent, so the ids need not match a
 * live catalog. Every templated field uses only declared args and earlier-step
 * outputs, so each definition passes validation as-is.
 */

import {
  WORKFLOW_GOAL_DEFAULT_MAX_TURNS,
  WORKFLOW_GOAL_DEFAULT_MAX_WALL_SECS,
  WORKFLOW_GOAL_DEFAULT_TOKEN_BUDGET,
  type WorkflowDefinition,
  type WorkflowSetup,
} from "./definition";

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  /** A one-line "what it does" used under the card title. */
  tagline: string;
  definition: WorkflowDefinition;
}

function setup(harness: string, model: string): WorkflowSetup {
  return { harness, model, sessionBinding: "fresh" };
}

const DEFAULT_GOAL_CAPS = {
  maxTurns: WORKFLOW_GOAL_DEFAULT_MAX_TURNS,
  maxWallSecs: WORKFLOW_GOAL_DEFAULT_MAX_WALL_SECS,
  tokenBudget: WORKFLOW_GOAL_DEFAULT_TOKEN_BUDGET,
} as const;

const FIX_UNTIL_GREEN: WorkflowTemplate = {
  id: "fix-until-green",
  name: "Fix until green",
  description: "Run the tests, then iterate an agent on the failures until the suite is green, and open a PR.",
  tagline: "Iterate until the tests pass",
  definition: {
    args: [
      { name: "test_command", type: "string", required: false, default: "make test" },
    ],
    setup: setup("claude-code", "sonnet"),
    steps: [
      {
        kind: "shell.run",
        onFail: { kind: "continue" },
        command: "{{args.test_command}}",
        outputName: "baseline",
      },
      {
        kind: "agent.prompt",
        onFail: { kind: "stop" },
        prompt:
          "The test suite is failing. Investigate the failures, fix the root cause, "
          + "and re-run the tests to confirm they pass.",
        goal: {
          objective: "the full test suite passes with no failing tests",
          ...DEFAULT_GOAL_CAPS,
          onBlocked: "notify",
          verify: { shell: "{{args.test_command}}", expectExit: 0 },
        },
      },
      {
        kind: "scm.open_pr",
        onFail: { kind: "stop" },
        title: "Fix failing tests",
        body: "Automated fix produced by the fix-until-green workflow.",
        draft: false,
      },
    ],
  },
};

const SENTRY_TRIAGE: WorkflowTemplate = {
  id: "sentry-triage",
  name: "Sentry triage",
  description: "Investigate a Sentry issue, find the root cause, implement a fix, and notify the channel.",
  tagline: "Root-cause a Sentry issue",
  definition: {
    args: [{ name: "issue_url", type: "string", required: true }],
    setup: setup("claude-code", "sonnet"),
    steps: [
      {
        kind: "agent.prompt",
        onFail: { kind: "stop" },
        prompt:
          "Investigate the Sentry issue at {{args.issue_url}}. Reproduce it, identify the "
          + "root cause, and implement a fix.",
        goal: {
          objective: "the root cause is identified and a fix is implemented",
          ...DEFAULT_GOAL_CAPS,
          onBlocked: "pause_for_approval",
        },
      },
      {
        kind: "scm.open_pr",
        onFail: { kind: "continue" },
        title: "Fix Sentry issue",
        body: "Triaged from {{args.issue_url}}.",
        draft: true,
      },
      {
        kind: "notify",
        onFail: { kind: "continue" },
        channel: "slack",
        message: "Sentry triage finished for {{args.issue_url}}.",
      },
    ],
  },
};

const PR_QA: WorkflowTemplate = {
  id: "pr-qa",
  name: "PR QA",
  description: "Check out a pull request, run the tests, review for regressions, and post a QA summary.",
  tagline: "QA a pull request end-to-end",
  definition: {
    args: [
      { name: "pr_number", type: "number", required: true },
      { name: "base", type: "string", required: false, default: "main" },
    ],
    setup: setup("claude-code", "sonnet"),
    steps: [
      {
        kind: "shell.run",
        onFail: { kind: "stop" },
        command: "gh pr checkout {{args.pr_number}}",
        outputName: "checkout",
      },
      {
        kind: "agent.prompt",
        onFail: { kind: "stop" },
        prompt:
          "Review PR #{{args.pr_number}} (base {{args.base}}). Run the tests, check for "
          + "regressions, and write a concise QA summary of the risks.",
        goal: {
          objective: "the PR builds, tests pass, and a risk summary is written",
          ...DEFAULT_GOAL_CAPS,
          onBlocked: "notify",
          verify: { shell: "make test", expectExit: 0 },
        },
      },
      {
        kind: "notify",
        onFail: { kind: "continue" },
        channel: "in_app",
        message: "QA finished for PR #{{args.pr_number}}.",
      },
    ],
  },
};

const CHANGELOG: WorkflowTemplate = {
  id: "changelog",
  name: "Changelog",
  description: "Collect commits since a point, draft a user-facing changelog, and open a draft PR.",
  tagline: "Draft a changelog from commits",
  definition: {
    args: [{ name: "since", type: "string", required: false, default: "HEAD~50" }],
    setup: setup("claude-code", "sonnet"),
    steps: [
      {
        kind: "shell.run",
        onFail: { kind: "stop" },
        command: "git log --oneline {{args.since}}..HEAD",
        outputName: "commits",
      },
      {
        kind: "agent.prompt",
        onFail: { kind: "stop" },
        prompt:
          "Write a user-facing changelog from these commits, grouped by feature and fix:\n"
          + "{{steps[0].output.commits}}",
      },
      {
        kind: "scm.open_pr",
        onFail: { kind: "stop" },
        title: "Update changelog",
        body: "{{steps[1].output.changelog}}",
        draft: true,
      },
    ],
  },
};

const WEEKLY_DIGEST: WorkflowTemplate = {
  id: "weekly-digest",
  name: "Weekly digest",
  description: "Summarize the past week of work into a digest and post it to Slack. Pair with a schedule.",
  tagline: "Summarize the week and post it",
  definition: {
    args: [],
    setup: setup("claude-code", "sonnet"),
    steps: [
      {
        kind: "shell.run",
        onFail: { kind: "continue" },
        command: "git log --since='1 week ago' --oneline",
        outputName: "commits",
      },
      {
        kind: "agent.prompt",
        onFail: { kind: "stop" },
        prompt:
          "Summarize the past week of work into a short digest with highlights and risks, "
          + "from these commits:\n{{steps[0].output.commits}}",
      },
      {
        kind: "notify",
        onFail: { kind: "continue" },
        channel: "slack",
        message: "Weekly digest:\n{{steps[1].output.digest}}",
      },
    ],
  },
};

export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  FIX_UNTIL_GREEN,
  SENTRY_TRIAGE,
  PR_QA,
  CHANGELOG,
  WEEKLY_DIGEST,
];

export function workflowTemplateById(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((template) => template.id === id);
}
