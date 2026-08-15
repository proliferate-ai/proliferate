import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { assertWrappedPreamble, researchAndReviewDefinition, t3Wf1 } from "./t3-wf-1.js";
import { buildPlannedCells } from "../runner/plan.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const STARTER_TEMPLATES_PATH = path.join(
  REPO_ROOT,
  "apps/packages/product-client/src/config/workflows/starter-templates.ts",
);

test("expandCells plans exactly one fixed-harness cell, regardless of --agents", () => {
  const specs = t3Wf1.expandCells({ runtimeLane: "local", desktop: "web", agents: ["all"] });
  assert.deepEqual(specs, [{ dimensions: { harness: "claude" } }]);
});

test("T3-WF-1 plans exactly one cell: T3-WF-1/local/harness=claude", async () => {
  const cells = await buildPlannedCells([t3Wf1], { desktop: "web", agents: ["all"] });
  assert.equal(cells.length, 1);
  const [cell] = cells;
  assert.equal(cell.cell_id, "T3-WF-1/local/harness=claude");
  assert.equal(cell.runtime_lane, "local");
  assert.deepEqual(cell.dimensions, { harness: "claude" });
});

test("planCell names all six frozen-contract assertions and the cell's own id", async () => {
  const cells = await buildPlannedCells([t3Wf1], { desktop: "web", agents: ["all"] });
  const [cell] = cells;
  const steps = t3Wf1.planCell({ runtimeLane: "local", desktop: "web", agents: ["all"] }, cell);
  assert.equal(steps.length, 6);
  for (const step of steps) {
    assert.match(step.description, /T3-WF-1\/local\/harness=claude/);
  }
  const joined = steps.map((step) => step.description).join(" | ");
  assert.match(joined, /materializes a\s+workspace and starts node 1/);
  assert.match(joined, /wrapped\s+preamble/);
  assert.match(joined, /\.proliferate\/context\//);
  assert.match(joined, /awaiting_human/);
  assert.match(joined, /nodes\/\{gate\}\/approve/);
  assert.match(joined, /\{run, nodes\[\], docs\[\]\}/);
});

test("assertWrappedPreamble accepts a real wrapper (differs from raw, still carries it verbatim)", () => {
  const raw = "Investigate @input:question and write into @doc:findings.";
  const wrapped = `You are running inside an automated workflow. ${raw}\n\nReply when done.`;
  assert.doesNotThrow(() => assertWrappedPreamble(wrapped, raw));
});

test("assertWrappedPreamble rejects the raw prompt sent verbatim (no wrapper at all)", () => {
  const raw = "Investigate @input:question and write into @doc:findings.";
  assert.throws(() => assertWrappedPreamble(raw, raw), /must wrap the node's raw prompt/);
});

test("assertWrappedPreamble rejects a wrapper that altered the underlying node prompt", () => {
  const raw = "Investigate @input:question and write into @doc:findings.";
  const mangled = "You are running inside an automated workflow. Do something useful.";
  assert.throws(() => assertWrappedPreamble(mangled, raw), /must still carry the node's raw prompt text/);
});

test("researchAndReviewDefinition: two nodes, agent then human_in_loop gate, model on research only", () => {
  const definition = researchAndReviewDefinition({ agentKind: "claude", modelId: "haiku" });
  assert.equal(definition.schemaVersion, 2);
  assert.equal(definition.nodes.length, 2);

  const [research, review] = definition.nodes;
  assert.equal(research.id, "research");
  assert.equal(research.type, "agent");
  assert.deepEqual(research.model, { agentKind: "claude", modelId: "haiku" });
  assert.match(research.prompt, /@input:question/);
  assert.match(research.prompt, /@doc:findings/);

  assert.equal(review.id, "review");
  assert.equal(review.type, "human_in_loop");
  assert.equal(review.model, undefined);
  assert.match(review.prompt, /@doc:findings/);

  assert.deepEqual(definition.edges, [{ from: "research", to: "review" }]);
  assert.equal(definition.inputs?.length, 1);
  assert.equal(definition.inputs?.[0]?.name, "question");
  assert.equal(definition.inputs?.[0]?.required, true);

  assert.equal(definition.docTemplates?.length, 1);
  assert.equal(definition.docTemplates?.[0]?.slug, "findings");
  assert.equal(definition.docTemplates?.[0]?.producingNodeId, "research");
});

test("researchAndReviewDefinition stays in sync with the shipped RESEARCH_AND_REVIEW starter template", () => {
  // tests/release has no dependency on @proliferate/product-client (see its
  // package.json), so this scenario's definition is a deliberate structural
  // copy rather than an import (same reasoning as the frozen SDK contract
  // types above it in t3-wf-1.ts). Guard the copy against silent drift by
  // checking the shipped source still contains our copied prompt/body text
  // verbatim, rather than trusting the copy forever.
  //
  // The shipped source spells each prompt/body as several `"..." + "..."`
  // string literals split across lines for readability; evaluating our own
  // copy collapses that into one continuous string. Collapse the same
  // adjacent-literal-concatenation syntax out of the raw source text first
  // (join `"...", whitespace/newlines, +, whitespace/newlines, "..."` pairs),
  // so the comparison is against what the source literally evaluates to, not
  // its multi-line JS spelling.
  const rawSource = readFileSync(STARTER_TEMPLATES_PATH, "utf8");
  const source = rawSource.replace(/"\s*\+\s*"/g, "");
  const definition = researchAndReviewDefinition({ agentKind: "claude", modelId: "haiku" });
  for (const node of definition.nodes) {
    assert.ok(
      source.includes(node.prompt),
      `starter-templates.ts RESEARCH_AND_REVIEW must still contain node "${node.id}"'s prompt verbatim ` +
        "(researchAndReviewDefinition has drifted from the shipped starter template)",
    );
  }
  for (const docTemplate of definition.docTemplates ?? []) {
    // docTemplate.body is evaluated (real newline characters); the source
    // file spells them as the literal two-character escape `\n`. Re-escape
    // before comparing against the raw (collapsed-concatenation) source text.
    const bodyAsSourceLiteral = docTemplate.body.replace(/\n/g, "\\n");
    assert.ok(
      source.includes(bodyAsSourceLiteral),
      `starter-templates.ts RESEARCH_AND_REVIEW must still contain the "${docTemplate.slug}" doc template body ` +
        "verbatim (researchAndReviewDefinition has drifted from the shipped starter template)",
    );
  }
  assert.ok(source.includes('slug: "research-and-review"'), "the shipped starter template slug must still exist");
});
