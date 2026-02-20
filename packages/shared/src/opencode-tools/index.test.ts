import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
	AUTOMATION_COMPLETE_TOOL,
	REQUEST_ENV_VARIABLES_TOOL,
	SAVE_ENV_FILES_TOOL,
	SAVE_SERVICE_COMMANDS_TOOL,
	SAVE_SNAPSHOT_TOOL,
} from "./index";

/**
 * Validate that a tool template string is syntactically valid TypeScript.
 * This catches escaping bugs (like triple-escaped backticks) that cause
 * OpenCode's bundler to reject the tool at runtime, silently aborting prompts.
 */
function validateToolSyntax(name: string, source: string) {
	const result = ts.transpileModule(source, {
		compilerOptions: {
			target: ts.ScriptTarget.ESNext,
			module: ts.ModuleKind.ESNext,
		},
		reportDiagnostics: true,
	});
	const errors = (result.diagnostics ?? []).filter(
		(d) => d.category === ts.DiagnosticCategory.Error,
	);
	if (errors.length > 0) {
		const messages = errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
		throw new Error(`${name} has syntax errors:\n${messages.join("\n")}`);
	}
}

describe("opencode tool templates", () => {
	const tools: Record<string, string> = {
		REQUEST_ENV_VARIABLES_TOOL,
		SAVE_SNAPSHOT_TOOL,
		AUTOMATION_COMPLETE_TOOL,
		SAVE_SERVICE_COMMANDS_TOOL,
		SAVE_ENV_FILES_TOOL,
	};

	for (const [name, source] of Object.entries(tools)) {
		it(`${name} is valid TypeScript`, () => {
			expect(() => validateToolSyntax(name, source)).not.toThrow();
		});
	}
});
