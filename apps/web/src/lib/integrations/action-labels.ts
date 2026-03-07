export function formatActionLabel(actionName: string): string {
	if (!actionName) {
		return "";
	}

	const withSpaces = actionName
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.trim();

	if (!withSpaces) {
		return actionName;
	}

	return withSpaces
		.split(/\s+/)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(" ");
}
