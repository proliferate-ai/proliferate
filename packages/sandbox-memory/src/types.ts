export interface SearchResult {
	path: string;
	startLine: number;
	endLine: number;
	score: number;
	snippet: string;
	source: string;
}

export interface Chunk {
	id: string;
	path: string;
	startLine: number;
	endLine: number;
	hash: string;
	text: string;
	embedding: number[];
}

export interface FileRecord {
	path: string;
	hash: string;
	mtime: number;
	size: number;
}

export interface SearchOptions {
	maxResults?: number;
	minScore?: number;
}

export interface MemoryManagerOptions {
	memoryDir: string;
	dbPath: string;
	openaiApiKey?: string;
}
