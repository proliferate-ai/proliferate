import { automations } from "../src";

async function main() {
	const [automationId, orgId, userId] = process.argv.slice(2);
	if (!automationId || !orgId || !userId) {
		throw new Error("usage: trigger-manual-run <automationId> <orgId> <userId>");
	}
	const result = await automations.triggerManualRun(automationId, orgId, userId);
	console.log(JSON.stringify(result));
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
