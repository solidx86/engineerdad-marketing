#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { design, readout } from "@engineerdad/experiment";

const server = new McpServer({ name: "experiment", version: "0.1.0" });

const toolResult = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
});
const errorResult = (err: unknown) => ({
  isError: true,
  content: [
    { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
  ],
});

server.tool(
  "design",
  "Factorial experiment designer. Returns cell expansion, allocation tagged per 70/20/10, min-creatives sanity check. Pure return — agent owns the Notion write.",
  {
    hypothesis: z.string().min(1),
    factors: z
      .array(
        z.object({ name: z.string().min(1), levels: z.array(z.string().min(1)).min(1) }),
      )
      .min(1),
    hold_constant: z.array(z.string()),
    primary_metric: z.enum(["cpa", "hook_rate", "thumbstop", "ctr"]),
    daily_budget_myr: z.number().positive(),
    duration_days: z.number().int().positive(),
  },
  async (args) => {
    try { return toolResult(design(args)); }
    catch (err) { return errorResult(err); }
  },
);

server.tool(
  "readout",
  "Compute cell-level lift from the analytics Postgres schema. Caller supplies cell→ad_id membership (resolved from CreativeVariants). Reads analytics.meta_insights via the shared @engineerdad/analytics Drizzle client.",
  {
    experiment_id: z.string().min(1),
    cells: z
      .array(
        z.object({
          experiment_id: z.string(),
          cell_id: z.string(),
          ad_ids: z.array(z.string()),
          is_control: z.boolean().optional(),
        }),
      )
      .min(1),
  },
  async (args) => {
    try { return toolResult(await readout(args)); }
    catch (err) { return errorResult(err); }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
