export function rewriteOpencodePath(path: string): string {
	const index = path.indexOf("/opencode");
	if (index >= 0) {
		return path.slice(index + 9) || "/";
	}
	return path;
}
