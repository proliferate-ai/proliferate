import { Router, type Router as RouterType } from "express";

const router: RouterType = Router({ mergeParams: true });

router.get("/", async (req, res, next) => {
	try {
		const sandboxInfo = await req.hub!.getSandboxInfo();
		res.json(sandboxInfo);
	} catch (error) {
		next(error);
	}
});

export default router;
