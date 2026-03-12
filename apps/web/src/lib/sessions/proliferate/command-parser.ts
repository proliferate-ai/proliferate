/**
 * Parser for `proliferate` CLI bash command strings.
 *
 * Produces a typed discriminated union for the stable CLI surface:
 *   proliferate actions list
 *   proliferate actions guide --integration <id>
 *   proliferate actions run --integration <id> --action <action> [--params <json>]
 *   proliferate services <subcommand> [--name <n>]
 *   proliferate env <subcommand>
 */

export type ProliferateCommand =
	| { kind: "actions-list" }
	| { kind: "actions-guide"; integration: string }
	| {
			kind: "actions-run";
			integration: string;
			action: string;
			params: Record<string, unknown> | null;
	  }
	| { kind: "services"; subcommand: string; name?: string }
	| { kind: "env"; subcommand: string };

/**
 * Derive a stable provider icon key from an integration string.
 * "linear" -> "linear"
 * "connector:uuid" -> "connector" (caller uses displayName or action prefix for better label)
 */
export function integrationToProviderKey(integration: string): string {
	if (integration.startsWith("connector:")) return "connector";
	return integration;
}

/**
 * Derive a provider key from a Composio-style action name prefix.
 * "GMAIL_FETCH_EMAILS" -> "gmail"
 * "SLACK_SEND_MESSAGE" -> "slack"
 * "list_teams" -> null (native, no prefix)
 */
export function actionNameToProviderKey(action: string): string | null {
	const upper = action.toUpperCase();
	if (upper.startsWith("GMAIL_")) return "gmail";
	if (upper.startsWith("SLACK_")) return "slack";
	if (upper.startsWith("NOTION_")) return "notion";
	if (upper.startsWith("SALESFORCE_")) return "salesforce";
	if (upper.startsWith("HUBSPOT_")) return "hubspot";
	if (upper.startsWith("GOOGLE_CALENDAR_")) return "google-calendar";
	if (upper.startsWith("GOOGLE_DRIVE_")) return "google-drive";
	if (upper.startsWith("COMPOSIO_")) return "composio";
	return null;
}

/**
 * Resolve the best icon key for an actions-run call, combining both
 * the integration string and the action name prefix.
 */
export function resolveIconKey(integration: string, action: string): string {
	// Action name prefix is the most specific signal for composio connectors
	const fromAction = actionNameToProviderKey(action);
	if (fromAction) return fromAction;
	// Fall back to integration string
	return integrationToProviderKey(integration);
}

// ---------------------------------------------------------------------------
// Tokenizer — handles shell quoting and stops at shell operators
// ---------------------------------------------------------------------------

function tokenize(input: string): string[] {
	const tokens: string[] = [];
	let i = 0;

	while (i < input.length) {
		while (i < input.length && /\s/.test(input[i])) i++;
		if (i >= input.length) break;

		const ch = input[i];

		// Stop at shell operators
		if (ch === "|" || ch === "&" || ch === ";") break;
		if (ch === ">") break;
		// 2> redirect
		if (/\d/.test(ch) && i + 1 < input.length && input[i + 1] === ">") break;

		if (ch === '"') {
			i++;
			let token = "";
			while (i < input.length && input[i] !== '"') {
				if (input[i] === "\\" && i + 1 < input.length) {
					i++;
					token += input[i];
				} else {
					token += input[i];
				}
				i++;
			}
			i++; // closing quote
			tokens.push(token);
			continue;
		}

		if (ch === "'") {
			i++;
			let token = "";
			while (i < input.length && input[i] !== "'") {
				token += input[i];
				i++;
			}
			i++; // closing quote
			tokens.push(token);
			continue;
		}

		let token = "";
		while (
			i < input.length &&
			!/\s/.test(input[i]) &&
			input[i] !== "|" &&
			input[i] !== "&" &&
			input[i] !== ";" &&
			input[i] !== ">"
		) {
			if (/\d/.test(input[i]) && i + 1 < input.length && input[i + 1] === ">") break;
			token += input[i];
			i++;
		}
		if (token) tokens.push(token);
	}

	return tokens;
}

function parseFlags(tokens: string[]): Record<string, string> {
	const flags: Record<string, string> = {};
	let i = 0;
	while (i < tokens.length) {
		const token = tokens[i];
		if (token.startsWith("--")) {
			const key = token.slice(2);
			const next = tokens[i + 1];
			if (next !== undefined && !next.startsWith("--")) {
				flags[key] = next;
				i += 2;
			} else {
				flags[key] = "true";
				i += 1;
			}
		} else {
			i++;
		}
	}
	return flags;
}

/**
 * Parse a bash command string into a typed ProliferateCommand.
 * Returns null if the command is not a `proliferate` CLI invocation.
 */
export function parseProliferateCommand(command: string): ProliferateCommand | null {
	const tokens = tokenize(command.trim());

	// Find the `proliferate` token — may be preceded by env vars or a path
	const idx = tokens.findIndex((t) => t === "proliferate" || t.endsWith("/proliferate"));
	if (idx === -1) return null;

	const args = tokens.slice(idx + 1);
	if (args.length === 0) return null;

	const group = args[0];
	const subcommand = args[1];
	const flags = parseFlags(args.slice(2));

	if (group === "actions") {
		if (subcommand === "list") return { kind: "actions-list" };

		if (subcommand === "guide") {
			const integration = flags.integration;
			if (!integration) return null;
			return { kind: "actions-guide", integration };
		}

		if (subcommand === "run") {
			const integration = flags.integration;
			const action = flags.action;
			if (!integration || !action) return null;

			let params: Record<string, unknown> | null = null;
			if (flags.params) {
				try {
					params = JSON.parse(flags.params) as Record<string, unknown>;
				} catch {
					params = null;
				}
			}
			return { kind: "actions-run", integration, action, params };
		}

		return null;
	}

	if (group === "services") {
		return { kind: "services", subcommand: subcommand ?? "list", name: flags.name };
	}

	if (group === "env") {
		return { kind: "env", subcommand: subcommand ?? "" };
	}

	return null;
}
