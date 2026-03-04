import { Router, type Router as RouterType } from "express";
import cancelRouter from "./cancel";
import infoRouter from "./info";
import messageRouter from "./message";

export function createSessionRuntimeRouter(): RouterType {
	const router: RouterType = Router({ mergeParams: true });
	router.use(infoRouter);
	router.use(messageRouter);
	router.use(cancelRouter);

	return router;
}
