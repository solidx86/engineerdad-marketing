#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { store, ENTITY_NAMES, type EntityName, type Filter } from "@engineerdad/store";

const EntityEnum = z.enum(ENTITY_NAMES as [EntityName, ...EntityName[]]);

// Runtime guard so direct handler calls (tests, future in-process callers)
// validate entity names the same way the zod-gated MCP transport would.
function assertEntity(name: string): asserts name is EntityName {
  if (!(ENTITY_NAMES as readonly string[]).includes(name)) {
    throw new Error(`unknown entity "${name}"`);
  }
}

export const handlers = {
  async query(args: {
    entity: EntityName;
    filter?: Record<string, unknown>;
    fields?: string[];
  }) {
    assertEntity(args.entity);
    return store.query(
      args.entity,
      (args.filter ?? {}) as Filter,
      args.fields ? { fields: args.fields } : undefined,
    );
  },
  async get(args: { entity: EntityName; id: string }) {
    assertEntity(args.entity);
    return store.get(args.entity, args.id);
  },
  async create(args: { entity: EntityName; props: Record<string, unknown> }) {
    assertEntity(args.entity);
    return store.create(args.entity, args.props);
  },
  async update(args: {
    entity: EntityName;
    id: string;
    props: Record<string, unknown>;
    fillOnlyIfEmpty?: boolean;
  }) {
    assertEntity(args.entity);
    return store.update(args.entity, args.id, args.props, {
      fillOnlyIfEmpty: args.fillOnlyIfEmpty,
    });
  },
  async set_status(args: { entity: EntityName; id: string; status: string }) {
    assertEntity(args.entity);
    return store.setStatus(args.entity, args.id, args.status);
  },
};

const toolResult = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
});

const server = new McpServer({ name: "store", version: "0.1.0" });

server.tool(
  "query",
  "List entity rows matching a filter. Returns IDs (and small opt-in fields) only — bulk content never crosses the wire. Use `get` to read a full row.",
  {
    entity: EntityEnum,
    filter: z.record(z.unknown()).optional(),
    fields: z.array(z.string()).optional(),
  },
  async (args) => toolResult(await handlers.query(args)),
);

server.tool(
  "get",
  "Fetch one full entity row by id. The only path to read bulk text fields.",
  { entity: EntityEnum, id: z.string().min(1) },
  async (args) => toolResult(await handlers.get(args)),
);

server.tool(
  "create",
  "Insert a new entity row. Runs the compliance scanner synchronously; refusal blocks the write and returns { ok: false, problems }.",
  { entity: EntityEnum, props: z.record(z.unknown()) },
  async (args) => toolResult(await handlers.create(args)),
);

server.tool(
  "update",
  "Patch an entity row. fillOnlyIfEmpty=true leaves existing non-empty fields untouched (article-enrichment pattern).",
  {
    entity: EntityEnum,
    id: z.string().min(1),
    props: z.record(z.unknown()),
    fillOnlyIfEmpty: z.boolean().optional(),
  },
  async (args) => toolResult(await handlers.update(args)),
);

server.tool(
  "set_status",
  "Flip an entity row's approvalStatus. Used by the review UI's status dropdown and by the orchestrator's HG gate writers.",
  {
    entity: EntityEnum,
    id: z.string().min(1),
    status: z.string().min(1),
  },
  async (args) => toolResult(await handlers.set_status(args)),
);

if (import.meta.url === `file://${process.argv[1]}`) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
