export function writeJson(data: unknown): void {
	process.stdout.write(`${JSON.stringify(data)}\n`);
}

export function writeStderr(message: string): void {
	process.stderr.write(`${message}\n`);
}
