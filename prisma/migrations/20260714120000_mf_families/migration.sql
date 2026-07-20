-- ═══════════════════════════════════════════════════════════════
-- MF FAMILIES (Step 16) — the "same fund" grouping over the scheme catalogue.
--
-- WHAT THIS IS: a DISPLAY grouping. "HDFC Large Cap Fund" is ONE fund that AMFI publishes as 4
-- scheme codes (Direct/Regular × Growth/IDCW). The catalogue stores those 4 honestly and
-- separately — they have genuinely different NAVs — but the fund detail page must present them as
-- one fund with four variants, not four lookalike rows. These two tables ARE that grouping and
-- nothing more.
--
-- WHY TABLES AND NOT A `family_id` COLUMN ON `instruments` — the load-bearing choice:
--   A family is DERIVED FROM MESSY TEXT. There is no clean key for "same fund": the scheme CODE
--   does not group a fund's plans (Step 9 proved it), so the grouping must come from parsing
--   `scheme_name`, and a heuristic over 13,704 hand-typed strings WILL have bugs.
--   Therefore the grouping must live where a bug in it CANNOT REACH the catalogue. With these
--   tables, a re-derive is `DELETE FROM mf_families` + re-INSERT — and `instruments` is not in
--   the statement at all. Not one row, not one column, not one index. Its fingerprint cannot move
--   because nothing writes to it. A `family_id` column would instead UPDATE all 17,904 catalogue
--   rows on every re-derive, putting NAV, ISIN, analytics and the 17,567-row fingerprint inside
--   the blast radius of a string-parsing heuristic. That trade is not worth a slightly shorter
--   join. Undo is `DROP TABLE` × 2.
--
-- THE GRAIN — a family groups SCHEME CODES, not ISINs:
--   17,567 MF catalogue rows → 13,704 scheme codes (a code carries up to 2 ISINs: the payout and
--   the reinvestment share one NAV series). The scheme code IS the NAV grain — the same grain
--   `mf_analytics` is keyed on — so it is the grain a family groups. `scheme_code` is the PRIMARY
--   KEY of `mf_family_members`: one scheme code belongs to EXACTLY ONE family, enforced by the
--   database rather than by the job remembering to.
--
-- NO FOREIGN KEY to `instruments`, deliberately: `instruments.amfi_scheme_code` is non-unique by
--   design (2 ISINs per code), so a FK is impossible. This is the same soft join `mf_analytics`
--   already makes on the same column, for the same reason.
--
-- HONEST-EMPTY IS A COLUMN, NOT A COMMENT: `ungrouped_reason` carries WHY a scheme was refused a
--   group (e.g. "unclaimed-amount scheme — not a plan variant"). 29 schemes are refused today.
--   An ungrouped scheme is an honest singleton with a stated reason — never force-merged into a
--   family it might not belong to. A WRONG grouping (two funds merged, or one fund's variants
--   split under another fund's name) is strictly worse than an ungrouped singleton, because it
--   would show one fund's plans under another fund's name. When the name does not clearly
--   resolve, we DO NOT GROUP, and we say so in this column.
--
-- `plan_option` is the AUDIT TRAIL of the normalizer: the exact plan/option tokens that were
--   stripped to reach the family key ("direct plan + growth"). It is what makes over-merge
--   DETECTABLE — two members of one family claiming the SAME slot means either an AMFI duplicate
--   or a bad merge, and without this column that check is impossible. It is also what the detail
--   page renders as the variant label, so it is not merely diagnostic.
--
-- ZERO CHANGE to existing rows: both tables are NEW. `instruments`, `mf_analytics`, `daily_prices`
-- and every other table are untouched — not one column added, not one row written. The 17,567-row
-- MF fingerprint (9a573df845df745ffe74277aff455734) and the 14,041-row analytics fingerprint
-- (ae60da32be6f0680622ef7f66f3e2960) MUST be byte-identical after this migration and after every
-- re-derive. That is an un-waivable Gate-3 check.
--
-- Drift-safe apply: BEGIN/COMMIT over DIRECT_URL, then `migrate resolve --applied`.
-- ═══════════════════════════════════════════════════════════════

-- ── THE FAMILY — one row per derived fund. ──
CREATE TABLE "mf_families" (
    "id"               TEXT         NOT NULL,
    -- The normalized key the grouping is BY: the scheme name with every KNOWN plan/option token
    -- tail-stripped ("hdfc large cap fund"). Lowercased and punctuation-collapsed — it is a KEY,
    -- not a label. `canonical_name` is what a human reads.
    "family_key"       TEXT         NOT NULL,
    -- The AMC. The family key is SCOPED BY IT: two houses both publish a "Large Cap Fund", and the
    -- house is the one hard, non-derived discriminator we already trust (ingested from AMFI's own
    -- header in Step 9). It is what makes a cross-AMC merge structurally impossible.
    "fund_house"       TEXT         NOT NULL,
    -- The display name, carried over from the raw `scheme_name` with the AMC's own casing intact
    -- ("HDFC Large Cap Fund" — not the lowercased key). This is what the fund detail page renders.
    "canonical_name"   TEXT         NOT NULL,
    "asset_class"      "AssetClass" NOT NULL,   -- mutual_fund | etf. A family NEVER mixes the two.
    "scheme_count"     INTEGER      NOT NULL,   -- denormalized fan-out; the page needs it without a COUNT()
    -- TRUE when this family holds exactly ONE scheme. Two very different things land here and the
    -- next column tells them apart: a fund that genuinely has one variant, versus one we REFUSED
    -- to group. Both are honest; only the second is a normalizer gap.
    "is_singleton"     BOOLEAN      NOT NULL,
    -- HONEST-EMPTY. NULL = grouped confidently. Non-null = we declined to group this scheme and
    -- this is why. Never fabricate a family to make this column NULL.
    "ungrouped_reason" TEXT,
    "derived_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mf_families_pkey" PRIMARY KEY ("id")
);

-- One family per (house, key) — the identity of the grouping, and what makes the re-derive
-- deterministic: the same catalogue must always produce the same set of families.
CREATE UNIQUE INDEX "mf_families_fund_house_family_key_key"
    ON "mf_families"("fund_house", "family_key");

-- The catalogue-side lookups the fund pages make.
CREATE INDEX "mf_families_fund_house_idx"  ON "mf_families"("fund_house");
CREATE INDEX "mf_families_asset_class_idx" ON "mf_families"("asset_class");

-- ── THE MEMBERSHIP — one row per scheme code. ──
CREATE TABLE "mf_family_members" (
    -- PRIMARY KEY, and that IS the invariant: a scheme code belongs to EXACTLY ONE family. The
    -- database refuses to represent a scheme in two families at once — the job cannot get it wrong.
    -- No FK to `instruments`: `amfi_scheme_code` is non-unique there by design (2 ISINs per code),
    -- exactly as `mf_analytics.scheme_code` joins softly for the same reason.
    "scheme_code" TEXT NOT NULL,
    "family_id"   TEXT NOT NULL,
    -- PROVENANCE — the raw AMFI name this membership was derived FROM, verbatim. When a grouping
    -- looks wrong, this is the evidence; without it the derivation is unfalsifiable.
    "scheme_name" TEXT NOT NULL,
    -- The plan/option tokens the normalizer STRIPPED to reach the key ("direct plan + growth").
    -- NULL when nothing was stripped. This is the variant label the detail page renders, AND the
    -- column that makes over-merge detectable: two members claiming one slot is a red flag.
    "plan_option" TEXT,

    CONSTRAINT "mf_family_members_pkey" PRIMARY KEY ("scheme_code")
);

CREATE INDEX "mf_family_members_family_id_idx" ON "mf_family_members"("family_id");

-- CASCADE is the re-derive: `DELETE FROM mf_families` clears the memberships with it, so a
-- re-run replaces the grouping wholesale and can never leave an orphan pointing at a family that
-- no longer exists. `instruments` is not named in that statement — which is the entire point.
ALTER TABLE "mf_family_members"
    ADD CONSTRAINT "mf_family_members_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "mf_families"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
