import { NotImplementedError, type ScenarioDefinition, type ScenarioRunContext } from "./types.js";

/**
 * Shared body for every phase-1 stub scenario: under --dry-run, print the id
 * and plan and return; otherwise throw NotImplementedError. Keeps each
 * scenario file to declaring its metadata + plan().
 */
export async function runStub(scenario: ScenarioDefinition, ctx: ScenarioRunContext): Promise<void> {
  if (!ctx.dryRun) {
    throw new NotImplementedError(scenario.id);
  }
  const steps = scenario.plan({ runtimeLane: ctx.runtimeLane, desktop: ctx.desktop, agents: ctx.agents });
  console.log(`\n[dry-run] ${scenario.id} — ${scenario.title}`);
  console.log(`  registry: ${scenario.registryFlowRef}`);
  console.log(`  runtime lane: ${ctx.runtimeLane}  desktop: ${ctx.desktop}  target: ${ctx.targetLane}`);
  const missing = scenario.requiredEnv.filter((name) => !ctx.env.present(name));
  if (missing.length > 0) {
    console.log(`  missing env: ${missing.join(", ")}`);
  } else if (scenario.requiredEnv.length > 0) {
    console.log("  missing env: (none)");
  }
  steps.forEach((step, index) => {
    console.log(`  ${index + 1}. ${step.description}`);
  });
}
