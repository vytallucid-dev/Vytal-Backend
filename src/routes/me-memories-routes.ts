// ─────────────────────────────────────────────────────────────
// /api/v1/me — the reader's stated memories. Mounted behind requireAuth beside the other `me`
// routers. Every handler derives the owner from req.authUser, never from the payload.
//
// ★ THESE THREE ARE WHAT CLOSED CHECKLIST ROWS 24 AND 26 (stage 8). Until they existed, the only way
//   to write a stated preference was a model calling a tool — so the capability could not survive the
//   cut. They are ordinary endpoints: the app's own settings surface can call them tomorrow.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import {
  listReaderMemories, createReaderMemory, deleteReaderMemory,
} from "../controllers/me/memories-controller.js";

export const meMemoriesRouter = Router();

meMemoriesRouter.get("/memories", listReaderMemories);
meMemoriesRouter.post("/memories", createReaderMemory);
meMemoriesRouter.delete("/memories/:id", deleteReaderMemory);
