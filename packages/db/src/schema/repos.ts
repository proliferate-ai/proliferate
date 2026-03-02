/**
 * V1 repo-domain modular exports.
 *
 * Table definitions are centralized in generated `schema.ts`.
 * Relation definitions are centralized in `relations.ts`.
 */

export { repoBaselines, repoBaselineTargets, repos, workspaceCacheSnapshots } from "./schema";
export {
	repoBaselinesRelations,
	repoBaselineTargetsRelations,
	reposRelations,
	workspaceCacheSnapshotsRelations,
} from "./relations";
