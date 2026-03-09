/**
 * Convert a cron expression to a human-readable description.
 * Handles common patterns; falls back to showing the raw expression.
 */
export function describeCron(expr: string): string {
	const parts = expr.trim().split(/\s+/);
	if (parts.length !== 5) return expr;

	const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

	// Every minute: * * * * *
	if (minute === "*" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
		return "Every minute";
	}

	// Every N minutes: */N * * * *
	const everyNMinutes = minute?.match(/^\*\/(\d+)$/);
	if (everyNMinutes && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
		const n = Number(everyNMinutes[1]);
		return n === 1 ? "Every minute" : `Every ${n} minutes`;
	}

	// Every N hours: 0 */N * * *
	const everyNHours = hour?.match(/^\*\/(\d+)$/);
	if (minute === "0" && everyNHours && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
		const n = Number(everyNHours[1]);
		return n === 1 ? "Every hour" : `Every ${n} hours`;
	}

	// Hourly at specific minute: N * * * *
	if (
		minute?.match(/^\d+$/) &&
		hour === "*" &&
		dayOfMonth === "*" &&
		month === "*" &&
		dayOfWeek === "*"
	) {
		const m = Number(minute);
		return m === 0 ? "Every hour" : `Every hour at :${String(m).padStart(2, "0")}`;
	}

	// Daily at specific time: M H * * *
	if (
		minute?.match(/^\d+$/) &&
		hour?.match(/^\d+$/) &&
		dayOfMonth === "*" &&
		month === "*" &&
		dayOfWeek === "*"
	) {
		return `Every day at ${formatTime(Number(hour), Number(minute))}`;
	}

	// Weekly: M H * * D
	const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
	if (
		minute?.match(/^\d+$/) &&
		hour?.match(/^\d+$/) &&
		dayOfMonth === "*" &&
		month === "*" &&
		dayOfWeek?.match(/^\d$/)
	) {
		const dayName = dayNames[Number(dayOfWeek)] ?? dayOfWeek;
		return `Every ${dayName} at ${formatTime(Number(hour), Number(minute))}`;
	}

	// Monthly: M H D * *
	if (
		minute?.match(/^\d+$/) &&
		hour?.match(/^\d+$/) &&
		dayOfMonth?.match(/^\d+$/) &&
		month === "*" &&
		dayOfWeek === "*"
	) {
		const d = Number(dayOfMonth);
		return `Monthly on the ${ordinal(d)} at ${formatTime(Number(hour), Number(minute))}`;
	}

	return expr;
}

function formatTime(hour: number, minute: number): string {
	const period = hour >= 12 ? "PM" : "AM";
	const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
	return `${displayHour}:${String(minute).padStart(2, "0")} ${period}`;
}

function ordinal(n: number): string {
	const s = ["th", "st", "nd", "rd"];
	const v = n % 100;
	return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
