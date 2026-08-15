import type { WorkflowDefinitionV2 } from "@proliferate/cloud-sdk";

/**
 * Starter templates for the gen-2 builder: the main page's empty state and
 * its "new from template" path both instantiate from these. They are seed
 * CONTENT, not schema — every definition here must stay
 * `validateDefinitionV2`-clean (the test enforces it), and the flagship
 * template doubles as the reference for how prompts are meant to use
 * `@input:`/`@doc:` references.
 */
export interface WorkflowStarterTemplateV2 {
  slug: string;
  title: string;
  description: string;
  definition: WorkflowDefinitionV2;
}

const AGENT_ENGINEERING_PROCESS: WorkflowStarterTemplateV2 = {
  slug: "agent-engineering-process",
  title: "Agent-engineering process",
  description:
    "Research, design behind a human gate, implement, review — the full engineering loop condensed into one chain.",
  definition: {
    schemaVersion: 2,
    nodes: [
      {
        id: "research-questions",
        type: "agent",
        title: "Draft research questions",
        prompt:
          "You are starting work on: @input:goal.\n\n" +
          "Before touching code, write the research questions whose answers would " +
          "change what gets built. Study the repository enough to ask sharp ones — " +
          "where the change lands, which contracts it touches, what may already " +
          "exist. Record them in @doc:research-questions, ordered by how much the " +
          "answer changes the design. Do not answer them yet.",
      },
      {
        id: "research",
        type: "agent",
        title: "Answer the questions",
        prompt:
          "Work through @doc:research-questions one question at a time. Read the " +
          "code — do not guess. Record what you find in @doc:research-findings: " +
          "each answer with file-and-line evidence, plus anything you discover " +
          "that changes the questions themselves. Constraints to respect: " +
          "@input:constraints",
      },
      {
        id: "design",
        type: "agent",
        title: "Propose the design",
        prompt:
          "Using @doc:research-findings, write the smallest design that achieves " +
          "@input:goal into @doc:design: what changes, file by file; what stays " +
          "untouched and why; the contracts and invariants at risk; what you " +
          "deliberately deferred. A reviewer should be able to approve or " +
          "redirect from the document alone.",
      },
      {
        id: "design-gate",
        type: "human_in_loop",
        title: "Approve the design",
        prompt:
          "Read @doc:design against @input:goal. Approve to start " +
          "implementation, or redo the design node with a steering prompt if the " +
          "direction is wrong. This is the cheapest point to change course.",
      },
      {
        id: "implement",
        type: "agent",
        title: "Implement",
        prompt:
          "Implement exactly what @doc:design describes, following the " +
          "repository's own conventions. If the design turns out to be wrong " +
          "somewhere, stop and say precisely where it breaks instead of silently " +
          "improvising around it.",
      },
      {
        id: "review-gate",
        type: "human_in_loop",
        title: "Review the result",
        prompt:
          "Review the implementation against @doc:design and " +
          "@doc:research-findings. Approve to finish the run, or redo the " +
          "implement node with what needs to change.",
      },
    ],
    edges: [
      { from: "research-questions", to: "research" },
      { from: "research", to: "design" },
      { from: "design", to: "design-gate" },
      { from: "design-gate", to: "implement" },
      { from: "implement", to: "review-gate" },
    ],
    inputs: [
      {
        name: "goal",
        description: "What this run should achieve, in one or two sentences.",
        required: true,
      },
      {
        name: "constraints",
        description:
          "Hard boundaries the work must respect — APIs to leave alone, rulings already made, style constraints.",
        required: false,
      },
    ],
    docTemplates: [
      {
        slug: "research-questions",
        producingNodeId: "research-questions",
        body:
          "# Research questions\n\n" +
          "Ordered by how much the answer changes the design.\n\n" +
          "## Open\n\n" +
          "## Answered\n\n" +
          "Move a question here with a one-line answer and a pointer to the evidence.\n",
      },
      {
        slug: "research-findings",
        producingNodeId: "research",
        body:
          "# Research findings\n\n" +
          "## Answers\n\n" +
          "One section per question: the answer first, then the file-and-line evidence.\n\n" +
          "## Surprises\n\n" +
          "Things found along the way that change the questions or the goal itself.\n",
      },
      {
        slug: "design",
        producingNodeId: "design",
        body:
          "# Design\n\n" +
          "## What changes\n\n" +
          "File by file — the smallest change that achieves the goal.\n\n" +
          "## What stays untouched\n\n" +
          "And why that is deliberate.\n\n" +
          "## Risks\n\n" +
          "Contracts and invariants this touches.\n\n" +
          "## Deferred\n\n" +
          "Cut on purpose; each item says what would bring it back.\n",
      },
    ],
  },
};

const RESEARCH_AND_REVIEW: WorkflowStarterTemplateV2 = {
  slug: "research-and-review",
  title: "Research and review",
  description:
    "One agent researches a question and writes findings; a human reviews them before the run completes.",
  definition: {
    schemaVersion: 2,
    nodes: [
      {
        id: "research",
        type: "agent",
        title: "Research",
        prompt:
          "Investigate @input:question. Read the code rather than guessing, and " +
          "write what you find into @doc:findings — answers first, then the " +
          "file-and-line evidence for each.",
      },
      {
        id: "review",
        type: "human_in_loop",
        title: "Review the findings",
        prompt:
          "Read @doc:findings. Approve to complete the run, or redo the research " +
          "node with a sharper question.",
      },
    ],
    edges: [{ from: "research", to: "review" }],
    inputs: [
      {
        name: "question",
        description: "The question to investigate.",
        required: true,
      },
    ],
    docTemplates: [
      {
        slug: "findings",
        producingNodeId: "research",
        body:
          "# Findings\n\n" +
          "## Answers\n\n" +
          "## Evidence\n\n" +
          "File-and-line pointers backing each answer.\n",
      },
    ],
  },
};

export const WORKFLOW_STARTER_TEMPLATES_V2: readonly WorkflowStarterTemplateV2[] = [
  AGENT_ENGINEERING_PROCESS,
  RESEARCH_AND_REVIEW,
];
