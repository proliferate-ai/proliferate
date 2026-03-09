import { watch } from "chokidar";

interface WatcherParams {
	memoryDir: string;
	onChange: () => void;
}

/**
 * Watch memoryDir for .md file changes using chokidar.
 * Sets dirty flag immediately so the next search() call re-syncs the index.
 */
export function createMemoryWatcher(params: WatcherParams): {
	close: () => Promise<void>;
} {
	const watcher = watch("**/*.md", {
		cwd: params.memoryDir,
		ignored: ["**/node_modules/**", "**/.git/**", "**/.memory.db", "**/.memory.db-*"],
		ignoreInitial: true,
		persistent: true,
	});

	// Set dirty immediately — search() handles sync lazily, so debouncing
	// the flag just causes stale results when write + search happen close together.
	watcher.on("add", () => params.onChange());
	watcher.on("change", () => params.onChange());
	watcher.on("unlink", () => params.onChange());

	return {
		close: async () => {
			await watcher.close();
		},
	};
}
