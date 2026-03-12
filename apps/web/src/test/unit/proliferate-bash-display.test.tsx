import { ProliferateBashDisplay } from "@/components/coding-session/tool-ui/proliferate/proliferate-bash-display";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("ProliferateBashDisplay", () => {
	it("renders guide output instead of dropping it", () => {
		const html = renderToStaticMarkup(
			<ProliferateBashDisplay
				parsed={{ kind: "actions-guide", integration: "linear" }}
				result={"# Guide\nUse list_issues"}
				status={{ type: "done" }}
				command={'proliferate actions guide --integration "linear"'}
			/>,
		);

		expect(html).toContain("Linear usage guide");
		expect(html).toContain("Show raw result");
		expect(html).toContain("Show command");
		expect(html).not.toContain("proliferate actions guide --integration &quot;linear&quot;");
	});

	it("falls back to generic result when Gmail mutation summary cannot be compacted", () => {
		const html = renderToStaticMarkup(
			<ProliferateBashDisplay
				parsed={{
					kind: "actions-run",
					integration: "connector:abc",
					action: "GMAIL_BATCH_MODIFY_MESSAGES",
					params: { messageIds: ["m1", "m2"] },
				}}
				result={{ data: { messageIds: ["m1", "m2"], labelIds: ["INBOX"] } }}
				status={{ type: "done" }}
			/>,
		);

		expect(html).toContain("Modified messages");
		expect(html).toContain("Show raw result");
	});

	it("shows compact mutation summary when Gmail mutation has an id", () => {
		const html = renderToStaticMarkup(
			<ProliferateBashDisplay
				parsed={{
					kind: "actions-run",
					integration: "connector:abc",
					action: "GMAIL_SEND_EMAIL",
					params: { recipient_email: "team@proliferate.com" },
				}}
				result={{ data: { id: "msg-123" } }}
				status={{ type: "done" }}
			/>,
		);

		expect(html).toContain("Sent email");
		expect(html).toContain("msg-123");
		expect(html).not.toContain("Show result");
	});

	it("falls back to generic result when Gmail list payload only contains ids", () => {
		const html = renderToStaticMarkup(
			<ProliferateBashDisplay
				parsed={{
					kind: "actions-run",
					integration: "connector:abc",
					action: "GMAIL_LIST_MESSAGES",
					params: { max_results: 10 },
				}}
				result={{
					data: {
						messages: [
							{ id: "m1", threadId: "t1" },
							{ id: "m2", threadId: "t2" },
						],
					},
				}}
				status={{ type: "done" }}
			/>,
		);

		expect(html).toContain("Listed messages");
		expect(html).toContain("2 messages returned");
		expect(html).toContain("m1");
		expect(html).not.toContain("Show raw result");
	});

	it("shows a truncation summary for large CLI results", () => {
		const html = renderToStaticMarkup(
			<ProliferateBashDisplay
				parsed={{
					kind: "actions-run",
					integration: "connector:abc",
					action: "GMAIL_FETCH_EMAILS",
					params: { max_results: 10, verbose: true },
				}}
				result={{
					error: null,
					_truncated: true,
					successfull: true,
					_omittedKeys: 6,
					_originalSize: 61269,
				}}
				status={{ type: "done" }}
			/>,
		);

		expect(html).toContain("Fetched emails");
		expect(html).toContain("Result truncated by the CLI. Open the raw result for full details.");
		expect(html).toContain("Show raw result");
	});

	it("shows a compact integrations summary for actions list", () => {
		const html = renderToStaticMarkup(
			<ProliferateBashDisplay
				parsed={{ kind: "actions-list" }}
				result={{
					integrations: [
						{ integration: "linear", displayName: "Linear", actions: [{ name: "list_teams" }] },
						{
							integration: "connector:abc",
							displayName: "Gmail",
							actions: [{ name: "GMAIL_FETCH_EMAILS" }, { name: "GMAIL_SEND_EMAIL" }],
						},
					],
				}}
				status={{ type: "done" }}
			/>,
		);

		expect(html).toContain("2 integrations available");
		expect(html).toContain("3 actions available");
		expect(html).toContain("Linear");
		expect(html).toContain("Gmail");
	});
});
