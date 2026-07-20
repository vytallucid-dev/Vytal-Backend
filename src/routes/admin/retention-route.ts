// ─────────────────────────────────────────────────────────────
// RETENTION ADMIN ROUTES (Layer 3)
//
// Mount under /api/v1/admin/retention behind requireAdmin. The surface over
// retention_policy: read the policies, preview a proposed change's delta (real
// dry-run), write a change (policy UPDATE + audit row, one transaction), and read
// the audit changelog.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import {
  getPolicies,
  previewChange,
  writePolicy,
  getAudit,
  getAuditForTable,
} from "../../controllers/admin/retention-controller.js";

export const retentionAdminRouter = Router();

retentionAdminRouter.get("/policies", getPolicies);
retentionAdminRouter.post("/preview", previewChange);
retentionAdminRouter.post("/policies/:table", writePolicy);
retentionAdminRouter.get("/audit", getAudit);
retentionAdminRouter.get("/audit/:table", getAuditForTable);
