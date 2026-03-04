import { Router, type Router as RouterType } from "express";

const router: RouterType = Router({ mergeParams: true });

router.post("/cancel", async (req, res, next) => {
	try {
		req.hub!.postCancel();
		res.json({ ok: true });
	} catch (error) {
		next(error);
	}
});

export default router;
