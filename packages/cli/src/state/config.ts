/**
 * Config State Management
 *
 * User preferences stored in ~/.proliferate/config.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROLIFERATE_DIR = join(homedir(), ".proliferate");
const CONFIG_FILE = join(PROLIFERATE_DIR, "config.json");
const DEFAULT_API_URL = "https://app.proliferate.com";
const ENV_API_URL = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;

export interface Config {
	apiUrl?: string;
	syncMode?: "gitignore" | "all";
	modelId?: string;
}

/**
 * Ensure ~/.proliferate directory exists
 */
export function ensureDir(): void {
	if (!existsSync(PROLIFERATE_DIR)) {
		mkdirSync(PROLIFERATE_DIR, { recursive: true, mode: 0o700 });
	}
}

/**
 * Get the proliferate directory path
 */
export function getProliferateDir(): string {
	return PROLIFERATE_DIR;
}

/**
 * Get config with priority: env > file > default
 */
export function getConfig(): Config & { apiUrl: string } {
	ensureDir();

	let fileConfig: Config = {};
	if (existsSync(CONFIG_FILE)) {
		try {
			fileConfig = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
		} catch {
			// Ignore invalid config
		}
	}

	const apiUrl = fileConfig.apiUrl ?? ENV_API_URL;

	return {
		...fileConfig,
		apiUrl,
	};
}

/**
 * Save config to file
 */
export function saveConfig(config: Partial<Config>): void {
	ensureDir();
	const existing = getConfig();
	const merged = { ...existing, ...config };
	// Remove the computed apiUrl if it's the default
	const { apiUrl, ...toSave } = merged;
	if (apiUrl !== ENV_API_URL) {
		(toSave as Config).apiUrl = apiUrl;
	}
	writeFileSync(CONFIG_FILE, JSON.stringify(toSave, null, 2), { mode: 0o600 });
}

/**
 * Ensure config is set. For now, just returns config (no prompts needed).
 */
export function ensureConfig(): Config & { apiUrl: string } {
	return getConfig();
}
