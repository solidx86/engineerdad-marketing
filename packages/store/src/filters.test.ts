import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { briefs, hypotheses } from "./schema.js";
import { buildWhere } from "./filters.js";

// Render a SQL fragment to its actual Postgres text + params for assertion.
// (Drizzle's SQL.toString() yields "[object Object]" — useless for tests;
//  PgDialect.sqlToQuery is the supported introspection path.)
const dialect = new PgDialect();
const render = (where: SQL | undefined) =>
  where ? dialect.sqlToQuery(where) : { sql: "", params: [] };

describe("buildWhere", () => {
  it("returns undefined for an empty filter", () => {
    expect(buildWhere(briefs, {})).toBeUndefined();
    expect(buildWhere(briefs, undefined)).toBeUndefined();
  });

  it("builds an eq for a scalar value", () => {
    const { sql, params } = render(buildWhere(briefs, { runId: "run_1" }));
    expect(sql).toContain("run_id");
    expect(params).toContain("run_1");
  });

  it("ANDs multiple scalar conditions", () => {
    const { sql } = render(
      buildWhere(briefs, { runId: "run_1", approvalStatus: "Approved" }),
    );
    expect(sql).toContain("run_id");
    expect(sql).toContain("approval_status");
    expect(sql.toLowerCase()).toContain("and");
  });

  it("supports the { in: [...] } operator", () => {
    const { sql, params } = render(
      buildWhere(briefs, { approvalStatus: { in: ["Approved", "Rejected"] } }),
    );
    expect(sql).toContain("approval_status");
    expect(sql.toLowerCase()).toContain("in");
    expect(params).toEqual(["Approved", "Rejected"]);
  });

  it("supports the { gte: n } operator", () => {
    const { sql, params } = render(
      buildWhere(hypotheses, { calibrationScore: { gte: 0.7 } }),
    );
    expect(sql).toContain("calibration_score");
    expect(sql).toContain(">=");
    expect(params).toContain(0.7);
  });

  it("throws on an unknown column", () => {
    expect(() => buildWhere(briefs, { nonExistent: "x" })).toThrow(/unknown column/);
  });

  it("throws on an unknown operator", () => {
    expect(() =>
      buildWhere(briefs, { runId: { wat: "x" } as never }),
    ).toThrow(/unknown operator/);
  });
});
