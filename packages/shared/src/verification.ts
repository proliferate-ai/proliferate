// Default folder where agents build verification evidence
export const VERIFICATION_FOLDER = ".proliferate/.verification";

export interface VerificationArgs {
	folder?: string; // Defaults to .proliferate/.verification
}

export interface VerificationResult {
	key: string; // S3 prefix where files were uploaded (e.g., "sessions/{sessionId}/verification/{timestamp}")
}

// File metadata returned when listing verification files from S3
export interface VerificationFile {
	key: string; // Full S3 object key
	name: string; // Filename only
	path: string; // Relative path from the prefix (e.g., "screenshots/home.png")
	contentType: string; // MIME type from S3 metadata or inferred from extension
	size: number; // File size in bytes
	lastModified: string; // ISO timestamp
}
