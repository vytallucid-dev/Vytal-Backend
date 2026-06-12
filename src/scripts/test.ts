import { nseClient } from "../lib/client.js";

// throwaway script
const result = await nseClient.get(
  "/api/corporates-financial-results?index=equities&period=Quarterly&symbol=TCS&fromDate=01-01-2024&toDate=31-03-2024",
);
console.log(JSON.stringify(result, null, 2).slice(0, 2000));
