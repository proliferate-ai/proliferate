import { watch } from "chokidar";

interface WatcherParams {
	memoryDir: string;
	onChange: () => void;
	debounceMs?: number;
}

/**
 * Watch memoryDir for .md file changes using chokidar.
 * Debounces change events and calls onChange callback.
 */
export function createMemoryWatcher(params: WatcherParams): {
	close: () => Promise<void>;
} {
	const debounceMs = params.debounceMs ?? 1500;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const debouncedOnChange = () => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			params.onChange();
		}, debounceMs);
	};

	const watcher = watch("**/*.md", {
		cwd: params.memoryDir,
		ignored: ["**/node_modules/**", "**/.git/**", "**/.memory.db", "**/.memory.db-*"],
		ignoreInitial: true,
		persistent: true,
	});

	watcher.on("add", debouncedOnChange);
	watcher.on("change", debouncedOnChange);
	watcher.on("unlink", debouncedOnChange);

	return {
		close: async () => {
			if (timer) clearTimeout(timer);
			await watcher.close();
		},
	};
}
