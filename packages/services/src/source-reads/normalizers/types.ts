/**
 * Common normalized item shape for source reads.
 *
 * All provider-specific API responses are mapped to this format
 * so the manager harness sees a consistent interface.
 */

export type SourceType = "sentry" | "linear" | "github";

export interface NormalizedSourceItem {
	sourceType: SourceType;
	sourceRef: string;
	title: string;
	body: string | null;
	severity: string | null;
	priority: string | null;
	status: string | null;
	url: string | null;
	createdAt: string | null;
	updatedAt: string | null;
	metadata: Record<string, unknown>;
}

export interface SourceQueryResult {
	items: NormalizedSourceItem[];
	cursor: string | null;
	hasMore: boolean;
}

export interface SourceNormalizer {
	readonly sourceType: SourceType;
	query(
		token: string,
		sourceRef: string,
		cursor?: string,
		limit?: number,
	): Promise<SourceQueryResult>;
	getItem(token: string, sourceRef: string, itemRef: string): Promise<NormalizedSourceItem | null>;
}
