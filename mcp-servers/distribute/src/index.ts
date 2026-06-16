#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildPostingPack, backfillAdId } from "./build-pack.js";

const server = new McpServer({ name: "distribute", version: "0.1.0" });
const toolResult = (p: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(p, null, 2) }] });
const errorResult = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }] });

server.tool(
  "get_posting_pack",
  "Render the Meta-paid manual posting pack for a run (campaign/adset/ad config + budget + creative asset URLs). Read-only; the user posts these by hand in Ads Manager.",
  { runId: z.string().min(1), dailyBudgetMyr: z.number().nonnegative().default(0) },
  async ({ runId, dailyBudgetMyr }) => {
    try { return toolResult(await buildPostingPack(runId, dailyBudgetMyr)); }
    catch (e) { return errorResult(e); }
  },
);

server.tool(
  "backfill_meta_ids",
  "Record the Meta ad IDs (EN/BM) the user created by hand into CreativeVariants.adId so analytics can join on them.",
  { rowId: z.string().min(1), adIdEn: z.string().nullable(), adIdMs: z.string().nullable() },
  async ({ rowId, adIdEn, adIdMs }) => {
    try { return toolResult(await backfillAdId(rowId, adIdEn, adIdMs)); }
    catch (e) { return errorResult(e); }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
