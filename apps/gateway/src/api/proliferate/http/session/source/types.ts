export interface SourceQueryParams {
	bindingId: string;
	cursor?: string;
	limit?: number;
}

export interface SourceGetParams {
	bindingId: string;
	sourceRef: string;
}
