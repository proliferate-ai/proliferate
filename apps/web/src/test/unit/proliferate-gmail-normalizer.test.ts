import {
	normalizeGmailMessageDetail,
	normalizeGmailMessageList,
} from "@/lib/sessions/proliferate/gmail";
import { describe, expect, it } from "vitest";

// Simulate Composio-wrapped Gmail responses (subset of real response)
const composioListResponse = {
	data: {
		messages: [
			{
				id: "19cdf6f593b34fd6",
				threadId: "19cdf6f593b34fd6",
				snippet: "OpenClaw + Robotics Hackathon",
				payload: {
					headers: [
						{ name: "From", value: "Dabl Club <claw@mail.beehiiv.com>" },
						{
							name: "Subject",
							value: "You are invited to Nebius.Build SF: OpenClaw + Robotics Hackathon @ SHACK15",
						},
						{ name: "Date", value: "Thu, 12 Mar 2026 00:11:18 +0000" },
					],
				},
			},
			{
				id: "19cdf63007066d35",
				threadId: "19cdf63007066d35",
				snippet: "Nvidia Sprays the Cash",
				payload: {
					headers: [
						{ name: "From", value: "Martin Peers <info@theinformation.com>" },
						{ name: "Subject", value: "The Briefing: Nvidia Sprays the Cash" },
						{ name: "Date", value: "Thu, 12 Mar 2026 00:05:44 +0000 (UTC)" },
					],
				},
			},
		],
	},
};

// Message with no headers (id-only shape from GMAIL_LIST_MESSAGES)
const idOnlyListResponse = {
	data: {
		messages: [
			{ id: "19cdf6f593b34fd6", threadId: "19cdf6f593b34fd6" },
			{ id: "19cdf63007066d35", threadId: "19cdf63007066d35" },
		],
	},
};

describe("normalizeGmailMessageList", () => {
	it("extracts rows from a Composio-wrapped list response", () => {
		const rows = normalizeGmailMessageList(composioListResponse);
		expect(rows).toHaveLength(2);
		expect(rows?.[0]).toEqual({
			id: "19cdf6f593b34fd6",
			from: "Dabl Club <claw@mail.beehiiv.com>",
			subject: "You are invited to Nebius.Build SF: OpenClaw + Robotics Hackathon @ SHACK15",
			date: "Thu, 12 Mar 2026 00:11:18 +0000",
			snippet: "OpenClaw + Robotics Hackathon",
		});
		expect(rows?.[1].from).toBe("Martin Peers <info@theinformation.com>");
	});

	it("returns null for id-only messages so the UI can fall back to generic JSON", () => {
		const rows = normalizeGmailMessageList(idOnlyListResponse);
		expect(rows).toBeNull();
	});

	it("parses a JSON string result", () => {
		const rows = normalizeGmailMessageList(JSON.stringify(composioListResponse));
		expect(rows).toHaveLength(2);
	});

	it("returns null for empty messages array", () => {
		expect(normalizeGmailMessageList({ data: { messages: [] } })).toBeNull();
	});

	it("returns null for non-parseable input", () => {
		expect(normalizeGmailMessageList(null)).toBeNull();
		expect(normalizeGmailMessageList("not-json")).toBeNull();
		expect(normalizeGmailMessageList({ data: {} })).toBeNull();
	});

	it("works with flat (non-wrapped) response shape", () => {
		const flat = {
			messages: composioListResponse.data.messages,
		};
		const rows = normalizeGmailMessageList(flat);
		expect(rows).toHaveLength(2);
	});

	it("supports provider-specific Gmail shapes with messageId, sender, preview, and timestamp", () => {
		const providerShape = {
			data: {
				messages: [
					{
						to: "pablosfsanchez@gmail.com",
						sender: "LessWrong <no-reply@lesserwrong.com>",
						preview: {
							body: "Lighthaven Sequences Reading Group #74 (Tuesday 3/17)",
							subject:
								"[LessWrong] New event in your area: Lighthaven Sequences Reading Group #74 (Tuesday 3/17)",
						},
						subject:
							"[LessWrong] New event in your area: Lighthaven Sequences Reading Group #74 (Tuesday 3/17)",
						threadId: "19cdfe243e512e9f",
						messageId: "19cdfe243e512e9f",
						messageTimestamp: "2026-03-12T02:31:10Z",
					},
				],
			},
		};

		const rows = normalizeGmailMessageList(providerShape);
		expect(rows).toEqual([
			{
				id: "19cdfe243e512e9f",
				from: "LessWrong <no-reply@lesserwrong.com>",
				subject:
					"[LessWrong] New event in your area: Lighthaven Sequences Reading Group #74 (Tuesday 3/17)",
				date: "2026-03-12T02:31:10Z",
				snippet: "Lighthaven Sequences Reading Group #74 (Tuesday 3/17)",
			},
		]);
	});
});

describe("normalizeGmailMessageDetail", () => {
	const detailResponse = {
		data: {
			id: "19cdf6f593b34fd6",
			snippet: "OpenClaw + Robotics Hackathon",
			payload: {
				headers: [
					{ name: "From", value: "Dabl Club <claw@mail.beehiiv.com>" },
					{ name: "To", value: "pablo@proliferate.com" },
					{
						name: "Subject",
						value: "You are invited to Nebius.Build SF",
					},
					{ name: "Date", value: "Thu, 12 Mar 2026 00:11:18 +0000" },
				],
			},
		},
	};

	it("extracts detail from a Composio-wrapped single message response", () => {
		const detail = normalizeGmailMessageDetail(detailResponse);
		expect(detail).toEqual({
			id: "19cdf6f593b34fd6",
			from: "Dabl Club <claw@mail.beehiiv.com>",
			to: "pablo@proliferate.com",
			subject: "You are invited to Nebius.Build SF",
			date: "Thu, 12 Mar 2026 00:11:18 +0000",
			snippet: "OpenClaw + Robotics Hackathon",
		});
	});

	it("parses a JSON string result", () => {
		const detail = normalizeGmailMessageDetail(JSON.stringify(detailResponse));
		expect(detail?.id).toBe("19cdf6f593b34fd6");
	});

	it("handles draft detail results with nested message payload", () => {
		const draftResponse = {
			data: {
				id: "draft-123",
				message: {
					snippet: "Draft body preview",
					payload: {
						headers: [
							{ name: "From", value: "Pablo <pablo@proliferate.com>" },
							{ name: "To", value: "team@proliferate.com" },
							{ name: "Subject", value: "Draft subject" },
							{ name: "Date", value: "Thu, 12 Mar 2026 00:11:18 +0000" },
						],
					},
				},
			},
		};

		const detail = normalizeGmailMessageDetail(draftResponse);
		expect(detail).toEqual({
			id: "draft-123",
			from: "Pablo <pablo@proliferate.com>",
			to: "team@proliferate.com",
			subject: "Draft subject",
			date: "Thu, 12 Mar 2026 00:11:18 +0000",
			snippet: "Draft body preview",
		});
	});

	it("supports provider-specific single-message shapes", () => {
		const providerShape = {
			data: {
				messageId: "19cdfe243e512e9f",
				to: "pablosfsanchez@gmail.com",
				sender: "LessWrong <no-reply@lesserwrong.com>",
				preview: {
					body: "Lighthaven Sequences Reading Group #74 (Tuesday 3/17)",
					subject:
						"[LessWrong] New event in your area: Lighthaven Sequences Reading Group #74 (Tuesday 3/17)",
				},
				subject:
					"[LessWrong] New event in your area: Lighthaven Sequences Reading Group #74 (Tuesday 3/17)",
				messageText: "Full body here",
				messageTimestamp: "2026-03-12T02:31:10Z",
			},
		};

		const detail = normalizeGmailMessageDetail(providerShape);
		expect(detail).toEqual({
			id: "19cdfe243e512e9f",
			from: "LessWrong <no-reply@lesserwrong.com>",
			to: "pablosfsanchez@gmail.com",
			subject:
				"[LessWrong] New event in your area: Lighthaven Sequences Reading Group #74 (Tuesday 3/17)",
			date: "2026-03-12T02:31:10Z",
			snippet: "Full body here",
		});
	});

	it("returns null when id is missing", () => {
		expect(normalizeGmailMessageDetail({ data: { snippet: "test" } })).toBeNull();
	});

	it("returns null for non-parseable input", () => {
		expect(normalizeGmailMessageDetail(null)).toBeNull();
		expect(normalizeGmailMessageDetail("not-json")).toBeNull();
	});
});
