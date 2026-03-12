import {
	actionNameToProviderKey,
	integrationToProviderKey,
	parseProliferateCommand,
	resolveIconKey,
} from "@/lib/sessions/proliferate/command-parser";
import { describe, expect, it } from "vitest";

describe("parseProliferateCommand", () => {
	describe("non-proliferate commands", () => {
		it("returns null for empty string", () => {
			expect(parseProliferateCommand("")).toBeNull();
		});

		it("returns null for unrelated commands", () => {
			expect(parseProliferateCommand("ls -la")).toBeNull();
			expect(parseProliferateCommand("git status")).toBeNull();
			expect(parseProliferateCommand("echo hello")).toBeNull();
		});

		it("returns null for proliferate without subcommand", () => {
			expect(parseProliferateCommand("proliferate")).toBeNull();
		});

		it("returns null for unknown group", () => {
			expect(parseProliferateCommand("proliferate unknown command")).toBeNull();
		});
	});

	describe("actions list", () => {
		it("parses bare actions list", () => {
			expect(parseProliferateCommand("proliferate actions list")).toEqual({
				kind: "actions-list",
			});
		});

		it("parses with shell redirect suffix", () => {
			expect(
				parseProliferateCommand("proliferate actions list 2>/dev/null || echo 'No integrations'"),
			).toEqual({ kind: "actions-list" });
		});
	});

	describe("actions guide", () => {
		it("parses integration flag", () => {
			expect(
				parseProliferateCommand(
					'proliferate actions guide --integration "connector:701f8f1c-0f8d-4b2c-a983-25c8f24d2881"',
				),
			).toEqual({
				kind: "actions-guide",
				integration: "connector:701f8f1c-0f8d-4b2c-a983-25c8f24d2881",
			});
		});

		it("returns null when integration is missing", () => {
			expect(parseProliferateCommand("proliferate actions guide")).toBeNull();
		});
	});

	describe("actions run", () => {
		it("parses minimal run command", () => {
			expect(
				parseProliferateCommand(
					'proliferate actions run --integration "connector:abc" --action GMAIL_FETCH_EMAILS',
				),
			).toEqual({
				kind: "actions-run",
				integration: "connector:abc",
				action: "GMAIL_FETCH_EMAILS",
				params: null,
			});
		});

		it("parses run with JSON params (single-quoted)", () => {
			const result = parseProliferateCommand(
				`proliferate actions run --integration "connector:abc" --action GMAIL_FETCH_EMAILS --params '{"max_results": 10, "verbose": true}'`,
			);
			expect(result).toEqual({
				kind: "actions-run",
				integration: "connector:abc",
				action: "GMAIL_FETCH_EMAILS",
				params: { max_results: 10, verbose: true },
			});
		});

		it("parses run with double-quoted params", () => {
			const result = parseProliferateCommand(
				`proliferate actions run --integration "connector:abc" --action GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID --params "{\\"message_id\\": \\"abc123\\"}"`,
			);
			expect(result).toEqual({
				kind: "actions-run",
				integration: "connector:abc",
				action: "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
				params: { message_id: "abc123" },
			});
		});

		it("tolerates invalid JSON in params and sets params to null", () => {
			const result = parseProliferateCommand(
				"proliferate actions run --integration linear --action list_teams --params 'not-json'",
			);
			expect(result).toEqual({
				kind: "actions-run",
				integration: "linear",
				action: "list_teams",
				params: null,
			});
		});

		it("parses native integration (no connector prefix)", () => {
			const result = parseProliferateCommand(
				"proliferate actions run --integration linear --action list_issues",
			);
			expect(result).toEqual({
				kind: "actions-run",
				integration: "linear",
				action: "list_issues",
				params: null,
			});
		});

		it("returns null when integration is missing", () => {
			expect(
				parseProliferateCommand("proliferate actions run --action GMAIL_FETCH_EMAILS"),
			).toBeNull();
		});

		it("returns null when action is missing", () => {
			expect(
				parseProliferateCommand('proliferate actions run --integration "connector:abc"'),
			).toBeNull();
		});

		it("ignores shell suffix after operator", () => {
			const result = parseProliferateCommand(
				`proliferate actions run --integration "connector:abc" --action GMAIL_LIST_MESSAGES --params '{"max_results": 5}' 2>&1`,
			);
			expect(result).toEqual({
				kind: "actions-run",
				integration: "connector:abc",
				action: "GMAIL_LIST_MESSAGES",
				params: { max_results: 5 },
			});
		});
	});

	describe("services", () => {
		it("parses services list", () => {
			expect(parseProliferateCommand("proliferate services list")).toEqual({
				kind: "services",
				subcommand: "list",
				name: undefined,
			});
		});

		it("parses services stop with name", () => {
			expect(parseProliferateCommand("proliferate services stop --name my-server")).toEqual({
				kind: "services",
				subcommand: "stop",
				name: "my-server",
			});
		});
	});

	describe("env", () => {
		it("parses env apply", () => {
			expect(parseProliferateCommand("proliferate env apply --spec '{}'")).toEqual({
				kind: "env",
				subcommand: "apply",
			});
		});
	});
});

describe("integrationToProviderKey", () => {
	it("returns integration string as-is for native providers", () => {
		expect(integrationToProviderKey("linear")).toBe("linear");
		expect(integrationToProviderKey("github")).toBe("github");
	});

	it("returns 'connector' for connector-prefixed integrations", () => {
		expect(integrationToProviderKey("connector:abc-123")).toBe("connector");
	});
});

describe("actionNameToProviderKey", () => {
	it("maps GMAIL_ prefix to gmail", () => {
		expect(actionNameToProviderKey("GMAIL_FETCH_EMAILS")).toBe("gmail");
		expect(actionNameToProviderKey("GMAIL_SEND_EMAIL")).toBe("gmail");
	});

	it("maps SLACK_ prefix to slack", () => {
		expect(actionNameToProviderKey("SLACK_SEND_MESSAGE")).toBe("slack");
	});

	it("returns null for native actions without prefix", () => {
		expect(actionNameToProviderKey("list_teams")).toBeNull();
		expect(actionNameToProviderKey("create_issue")).toBeNull();
	});
});

describe("resolveIconKey", () => {
	it("prefers action prefix over integration string for connector-backed tools", () => {
		expect(resolveIconKey("connector:abc", "GMAIL_FETCH_EMAILS")).toBe("gmail");
	});

	it("falls back to integration string for native integrations", () => {
		expect(resolveIconKey("linear", "list_issues")).toBe("linear");
	});
});
