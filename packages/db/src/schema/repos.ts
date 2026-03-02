/**
 * V1 repo-domain modular exports.
 *
 * Table definitions are centralized in generated `schema.ts`.
 * Relation definitions are centralized in `relations.ts`.
 */

export { repoBaselines, repoBaselineTargets, repos } from "./schema";
export {
	repoBaselinesRelations,
	repoBaselineTargetsRelations,
	reposRelations,
} from "./relations";
