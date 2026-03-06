import { Router } from "express";
import {
	getRepoDiff,
	getRepoStatus,
	listRepos,
	resolveRepoPath,
	validateFilePathInRepo,
} from "../../app/git/query-git.js";
import { requireAuth } from "../middleware/auth.js";

export function createGitRoutes(): Router {
	const router = Router();

	router.get("/git/repos", requireAuth, async (_req, res) => {
		try {
			res.json({ repos: await listRepos() });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			res.status(500).json({ error: message });
		}
	});

	router.get("/git/status", requireAuth, async (req, res) => {
		const repoId = req.query.repo as string | undefined;
		if (!repoId) {
			res.status(400).json({ error: "repo query parameter is required" });
			return;
		}
		const repoPath = resolveRepoPath(repoId);
		if (!repoPath) {
			res.status(400).json({ error: "Invalid repo ID" });
			return;
		}

		try {
			res.json(await getRepoStatus(repoPath));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			res.status(500).json({ error: message });
		}
	});

	router.get("/git/diff", requireAuth, async (req, res) => {
		const repoId = req.query.repo as string | undefined;
		const filePath = req.query.path as string | undefined;
		if (!repoId) {
			res.status(400).json({ error: "repo query parameter is required" });
			return;
		}
		const repoPath = resolveRepoPath(repoId);
		if (!repoPath) {
			res.status(400).json({ error: "Invalid repo ID" });
			return;
		}
		if (filePath && !validateFilePathInRepo(repoPath, filePath)) {
			res.status(400).json({ error: "Invalid file path" });
			return;
		}

		try {
			res.json({ diff: await getRepoDiff(repoPath, filePath) });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			res.status(500).json({ error: message });
		}
	});

	return router;
}
