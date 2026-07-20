// Mount under /api/v1/admin/ingestion-errors. Admin-gated upstream.
import { Router } from "express";
import {
  listIngestionErrors,
  patchIngestionError,
  fillIngestionError,
  refetchIngestionError,
  rescoreIngestionError,
  recomputeIngestionError,
} from "../../controllers/ingestion/ingestion-errors-controller.js";

export const ingestionErrorsRouter = Router();

ingestionErrorsRouter.get("/", listIngestionErrors);
ingestionErrorsRouter.patch("/:id", patchIngestionError);
ingestionErrorsRouter.post("/:id/fill", fillIngestionError);
ingestionErrorsRouter.post("/:id/refetch", refetchIngestionError);
ingestionErrorsRouter.post("/:id/rescore", rescoreIngestionError);
// Score Compute (Part B): re-attempt a thrown PHS compute. Triggers only — the row
// self-resolves through the heal path on the next successful compute (see the controller).
ingestionErrorsRouter.post("/:id/recompute", recomputeIngestionError);
