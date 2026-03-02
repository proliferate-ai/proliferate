/**
 * Source normalizer registry.
 *
 * Maps source types to their normalizer implementations.
 */

import { GitHubNormalizer } from "./github";
import { LinearNormalizer } from "./linear";
import { SentryNormalizer } from "./sentry";
import type { SourceNormalizer, SourceType } from "./types";

export type {
	NormalizedSourceItem,
	SourceNormalizer,
	SourceQueryResult,
	SourceType,
} from "./types";

const normalizers: Record<SourceType, SourceNormalizer> = {
	sentry: new SentryNormalizer(),
	linear: new LinearNormalizer(),
	github: new GitHubNormalizer(),
};

export function getNormalizer(sourceType: SourceType): SourceNormalizer | undefined {
	return normalizers[sourceType];
}

export const SUPPORTED_SOURCE_TYPES: readonly SourceType[] = ["sentry", "linear", "github"];
