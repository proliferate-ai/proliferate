import type { ScenarioCellOutcome, ScenarioRunContext } from "../types.js";
import type { PlannedCellV1 } from "../../runner/result.js";
import type { ReadyLocalWorld } from "../../worlds/local-workspace/world.js";
import type { AuthenticatedActor } from "../../fixtures/authenticated-actor.js";
import type { PreparedRepository } from "../../fixtures/prepared-repository.js";
import type { ProductPage } from "../../fixtures/product-page.js";

/**
 * LOCAL-1 (repository to workspace) under `T3-WT-1/local` (world-backed).
 * Owner: builders-ci workstream.
 *
 * Given an authenticated actor and prepared local repository, create a local
 * workspace THROUGH the product surface (Home project picker + "Work locally" +
 * create — the smoke's `selectRepoAndWorkLocally` idiom, but the assertion is
 * the created workspace, not a turn). Assert the correct repository and default
 * branch (T3-REPO-1's default-branch contribution, folded into this one cell),
 * commandable AnyHarness, one visible empty chat, and reload continuity. Do NOT
 * seed the workspace or session directly.
 *
 * Evidence: LOCAL-1 has NO LLM turn, and the four new evidence kinds (audit
 * ruling #3) do not cover it, so its green cell carries `evidence: null` — the
 * repo/branch/empty-chat/reload assertions are proven by the green status and
 * the plan steps (BRIEF §"Evidence → LOCAL-1"). T3-REPO-1's own repo-environment
 * write path stays its diagnostic #1043-blocked behavior, unchanged.
 */

export interface LocalRepoWorkspaceDriver {
  createActor(world: ReadyLocalWorld): Promise<AuthenticatedActor>;
  prepareRepo(world: ReadyLocalWorld, actor: AuthenticatedActor, cellId: string): Promise<PreparedRepository>;
  openPage(world: ReadyLocalWorld, actor: AuthenticatedActor): Promise<ProductPage>;

  /** Create the local workspace via the Home product surface (no seeding) and
   * return the materialized workspace id + observed repo/default-branch. */
  createLocalWorkspaceInUi(world: ReadyLocalWorld, page: ProductPage, repo: PreparedRepository): Promise<{ workspaceId: string; repoName: string; defaultBranch: string }>;

  /** Assert one visible empty chat and commandable AnyHarness for the workspace. */
  assertEmptyChatCommandable(world: ReadyLocalWorld, page: ProductPage, workspaceId: string): Promise<void>;

  /** Reload and assert the workspace/repo/branch/empty-chat persist. */
  reloadAndVerifyContinuity(world: ReadyLocalWorld, page: ProductPage, expect: { workspaceId: string; defaultBranch: string }): Promise<void>;

  closeWorld(world: ReadyLocalWorld): ReturnType<ReadyLocalWorld["close"]>;
}

export const defaultLocalRepoWorkspaceDriver: LocalRepoWorkspaceDriver = {
  createActor: () => repoNotImplemented("createActor"),
  prepareRepo: () => repoNotImplemented("prepareRepo"),
  openPage: () => repoNotImplemented("openPage"),
  createLocalWorkspaceInUi: () => repoNotImplemented("createLocalWorkspaceInUi"),
  assertEmptyChatCommandable: () => repoNotImplemented("assertEmptyChatCommandable"),
  reloadAndVerifyContinuity: () => repoNotImplemented("reloadAndVerifyContinuity"),
  closeWorld: () => repoNotImplemented("closeWorld"),
};

/** LOCAL-1 collector (T3-WT-1/local single cell, world-backed). */
export function collectLocal1WorkspaceCell(
  _ctx: ScenarioRunContext,
  _cell: PlannedCellV1,
  _driver: LocalRepoWorkspaceDriver = defaultLocalRepoWorkspaceDriver,
): Promise<ScenarioCellOutcome> {
  throw new Error("not implemented: builders-ci owns collectLocal1WorkspaceCell (BRIEF §LOCAL-1).");
}

function repoNotImplemented(method: string): never {
  throw new Error(`not implemented: builders-ci owns LocalRepoWorkspaceDriver.${method} (BRIEF §Driver seams).`);
}
