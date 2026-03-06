import type { ChildProcess } from "node:child_process";

const processes = new Map<string, ChildProcess>();

export function getProcess(name: string): ChildProcess | undefined {
	return processes.get(name);
}

export function setProcess(name: string, process: ChildProcess): void {
	processes.set(name, process);
}

export function deleteProcess(name: string): void {
	processes.delete(name);
}
