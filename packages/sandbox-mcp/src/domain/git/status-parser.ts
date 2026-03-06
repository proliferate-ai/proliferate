export interface GitStatusFile {
	status: string;
	path: string;
}

export interface ParsedGitStatus {
	branch: string;
	ahead: number;
	behind: number;
	files: GitStatusFile[];
}

export function parsePorcelainStatus(output: string): ParsedGitStatus {
	const lines = output.split("\n");
	let branch = "";
	let ahead = 0;
	let behind = 0;
	const files: GitStatusFile[] = [];

	for (const line of lines) {
		if (line.startsWith("# branch.head ")) {
			branch = line.slice("# branch.head ".length);
			continue;
		}
		if (line.startsWith("# branch.ab ")) {
			const match = line.match(/\+(\d+) -(\d+)/);
			if (match) {
				ahead = Number.parseInt(match[1], 10);
				behind = Number.parseInt(match[2], 10);
			}
			continue;
		}
		if (line.startsWith("1 ")) {
			const fields = line.split(" ");
			const status = fields[1] || "M.";
			const filePath = fields.slice(8).join(" ");
			files.push({ status, path: filePath });
			continue;
		}
		if (line.startsWith("2 ")) {
			const tabParts = line.split("\t");
			const fields = tabParts[0].split(" ");
			const status = fields[1] || "R.";
			const filePath = tabParts[1] || fields.slice(9).join(" ");
			files.push({ status, path: filePath });
			continue;
		}
		if (line.startsWith("? ")) {
			files.push({ status: "?", path: line.slice(2) });
		}
	}

	return { branch, ahead, behind, files };
}
