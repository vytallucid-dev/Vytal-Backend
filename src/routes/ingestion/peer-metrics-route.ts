// src/routes/peer-metrics.ts
// ─────────────────────────────────────────────────────────────
// Public:
//   GET /api/peer-groups                         — list all peer groups
//   GET /api/peer-groups/:id                     — single peer group + metrics
//   GET /api/peer-groups/:id/stocks              — stocks in group + their metrics
//   GET /api/peer-groups/:id/comparison          — side-by-side stock comparison
//
// Admin:
//   POST /api/admin/peer-metrics/compute         — manual trigger (all/sector/single)
//   GET  /api/admin/peer-metrics/logs            — computation history
//   GET  /api/admin/peer-metrics/status          — current state of all groups
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { z } from "zod";
import {
  getAllPeerGroupsList,
  getALlStockInPeerGroupWithMetrics,
  computePeerGroupMetrics,
  getPeerMetricsLogs,
  getSinglePeerGroupDetail,
} from "../../controllers/ingestion/peer-metrics-controller.js";

export const peerGroupsRouter = Router();
export const adminPeerMetricsRouter = Router();

// ── Decimal formatter ─────────────────────────────────────────

// ── GET /api/peer-groups ──────────────────────────────────────
// List all peer groups, optionally filtered by sector

peerGroupsRouter.get("/", getAllPeerGroupsList);

// ── GET /api/peer-groups/:id ──────────────────────────────────
// Single peer group with full metrics detail

peerGroupsRouter.get("/:id", getSinglePeerGroupDetail);

// ── GET /api/peer-groups/:id/stocks ──────────────────────────
// All stocks in a peer group with their latest fundamentals
// Used for the "Peer Comparison" table in the UI

peerGroupsRouter.get("/:id/stocks", getALlStockInPeerGroupWithMetrics);

// ── POST /api/admin/peer-metrics/trigger ─────────────────────
// Manual trigger — supports all/sector/single scope

adminPeerMetricsRouter.post("/trigger", computePeerGroupMetrics);

// ── GET /api/admin/peer-metrics/logs ─────────────────────────

adminPeerMetricsRouter.get("/logs", getPeerMetricsLogs);


//
// WIRE INTO SCREENER UPLOAD (post_upload trigger):
//   In src/lib/screener/ingest.ts, after successful ingest:
//   import { runPostUploadPeerMetrics } from '../peer-metrics/peer-metrics.service'
//   // At the end of ingestScreenerFile(), after stock is saved:
//   await runPostUploadPeerMetrics(stock.id)
// ─────────────────────────────────────────────────────────────
