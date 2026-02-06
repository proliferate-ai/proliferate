import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import dotenv from "dotenv";
import { ENV_SCHEMA_PATH } from "./paths";

export type EnvMap = Record<string, string>;

export interface EnvState {
	values: EnvMap;
	touched: Set<string>;
	set: (key: string, value: string) => void;
	getDefault: (key: string) => string | undefined;
	hasRealValue: (key: string) => boolean;
	ensureGenerated: (key: string, bytes?: number) => void;
}

export function parseEnvFile(path: string): EnvMap {
	if (!existsSync(path)) return {};
	const raw = readFileSync(path, "utf-8");
	return dotenv.parse(raw);
}

export function formatEnvValue(value: string): string {
	let out = value;
	if (out.includes("\n")) {
		out = out.replace(/\n/g, "\\n");
	}
	const needsQuotes = /[\s#'"]/.test(out);
	if (needsQuotes) {
		out = out.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
		out = `"${out}"`;
	}
	return out;
}

export function mergeEnvTemplate(templatePath: string, values: EnvMap): string {
	const raw = readFileSync(templatePath, "utf-8");
	const lines = raw.split("\n");
	const output: string[] = [];
	const seen = new Set<string>();

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
			output.push(line);
			continue;
		}
		const idx = trimmed.indexOf("=");
		const key = trimmed.slice(0, idx).trim();
		const value = values[key];
		if (value !== undefined) {
			output.push(`${key}=${formatEnvValue(value)}`);
			seen.add(key);
		} else {
			output.push(line);
		}
	}

	for (const [key, value] of Object.entries(values)) {
		if (seen.has(key)) continue;
		output.push(`${key}=${formatEnvValue(value)}`);
	}

	return output.join("\n");
}

export function randomBase64(bytes = 32): string {
	return crypto.randomBytes(bytes).toString("base64");
}

export function looksLikePlaceholder(value: string | undefined): boolean {
	if (!value) return true;
	const lowered = value.toLowerCase();
	return (
		lowered.includes("replace-me") ||
		lowered.includes("changeme") ||
		lowered.includes("example") ||
		lowered.includes("disabled") ||
		lowered.includes("xxx")
	);
}

export function createEnvState(envExisting: EnvMap, envExample: EnvMap): EnvState {
	const values: EnvMap = { ...envExisting };
	const touched = new Set<string>();

	const set = (key: string, value: string) => {
		values[key] = value;
		touched.add(key);
	};

	const getDefault = (key: string) => values[key] ?? envExample[key];

	const hasRealValue = (key: string) => {
		const current = values[key];
		return !!current && !looksLikePlaceholder(current);
	};

	const ensureGenerated = (key: string, bytes = 32) => {
		const current = values[key] ?? envExample[key];
		if (looksLikePlaceholder(current)) {
			values[key] = randomBase64(bytes);
			touched.add(key);
		}
	};

	return { values, touched, set, getDefault, hasRealValue, ensureGenerated };
}

export function parseSchemaKeys(path = ENV_SCHEMA_PATH): {
	publicKeys: string[];
	serverKeys: string[];
} {
	if (!existsSync(path)) return { publicKeys: [], serverKeys: [] };
	const raw = readFileSync(path, "utf-8");
	const lines = raw.split("\n");
	const publicKeys: string[] = [];
	const serverKeys: string[] = [];
	let mode: "public" | "server" | null = null;

	for (const line of lines) {
		if (line.includes("export const publicSchema")) {
			mode = "public";
			continue;
		}
		if (line.includes("export const serverSchema")) {
			mode = "server";
			continue;
		}
		if (line.includes("} as const")) {
			mode = null;
			continue;
		}
		if (!mode) continue;
		const match = line.match(/^\s*([A-Z0-9_]+)\s*:/);
		if (match) {
			if (mode === "public") publicKeys.push(match[1]);
			else serverKeys.push(match[1]);
		}
	}

	return { publicKeys, serverKeys };
}

export function getStringOutput(
	outputs: Record<string, unknown>,
	keys: string[],
): string | undefined {
	for (const key of keys) {
		const value = outputs[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

export function getStringArrayOutput(
	outputs: Record<string, unknown>,
	keys: string[],
): string[] | undefined {
	for (const key of keys) {
		const value = outputs[key];
		if (Array.isArray(value)) {
			const cleaned = value.filter((item) => typeof item === "string") as string[];
			if (cleaned.length > 0) return cleaned;
		}
		if (typeof value === "string") {
			const parts = value
				.split(",")
				.map((part) => part.trim())
				.filter(Boolean);
			if (parts.length > 0) return parts;
		}
	}
	return undefined;
}

export function pickOutput(
	outputs: Record<string, unknown>,
	keys: string[],
	fallback?: string,
): string | undefined {
	return getStringOutput(outputs, keys) ?? fallback;
}
