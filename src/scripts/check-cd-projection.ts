import { buildUniverseHealthView } from "../scoring/read/universe-view.service.js";

const view = await buildUniverseHealthView();
const total = view.members.length;
const cScored = view.members.filter((m) => m.flowCategoryStates?.C_insider === "scored").length;
const cDormant = view.members.filter(
  (m) => m.flowCategoryStates && m.flowCategoryStates.C_insider !== "scored",
).length;
const noField = view.members.filter((m) => !m.flowCategoryStates).length;

console.log("═══ flowCategoryStates in universe view ═══");
console.log(`total members: ${total}`);
console.log(`C_insider — scored: ${cScored}  dormant: ${cDormant}  no-field: ${noField}`);

const hcltech = view.members.find((m) => m.symbol === "HCLTECH");
console.log("\nHCLTECH flowCategoryStates:", JSON.stringify(hcltech?.flowCategoryStates, null, 2));

const dormantEx = view.members.find(
  (m) => m.flowCategoryStates && m.flowCategoryStates.C_insider !== "scored",
);
console.log(
  `\ndormant eg (${dormantEx?.symbol ?? "none"}):`,
  JSON.stringify(dormantEx?.flowCategoryStates, null, 2),
);
