import { test as base } from "@playwright/test";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../../..");
const TEST_DB_URL = "postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test";

function wipeAndPushPostgres() {
  // Drop both the public schema (store entities) AND the orchestrator schema
  // (runs, run_steps, step_results). Without the orchestrator drop here, run
  // rows survive across e2e invocations and the next seed.orchestratorRun()
  // PK-collides on run_a/run_b/run_z/run_dbg.
  execSync(
    `docker exec engineerdad-postgres psql -U engineerdad -d engineerdad_test -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO engineerdad; DROP SCHEMA IF EXISTS orchestrator CASCADE;"`,
    { cwd: REPO_ROOT, stdio: "ignore" },
  );
  execSync("pnpm --filter @engineerdad/store push", { cwd: REPO_ROOT, env: { ...process.env, DATABASE_URL: TEST_DB_URL }, stdio: "ignore" });
  // Orchestrator schema (runs, run_steps, step_results) is also in Postgres — re-push it.
  execSync("pnpm --filter @engineerdad/orchestrator push", { cwd: REPO_ROOT, env: { ...process.env, DATABASE_URL: TEST_DB_URL }, stdio: "ignore" });
}

export interface StoreSeed {
  create: (entity: string, props: Record<string, unknown>) => Promise<{ id: string }>;
  orchestratorRun: (runId: string, stage: string, status: string, params?: Record<string, unknown>) => Promise<void>;
  orchestratorStep: (runId: string, stepId: string, stage: string, status: string, opts?: { problems?: string[]; result?: unknown }) => Promise<void>;
}

export const test = base.extend<{ seed: StoreSeed }>({
  seed: async ({}, use) => {
    wipeAndPushPostgres();
    process.env.DATABASE_URL = TEST_DB_URL;
    const { store } = await import("@engineerdad/store");
    const orch = await import("@engineerdad/orchestrator");
    const seed: StoreSeed = {
      async create(entity, props) {
        const r = await store.create(entity as never, props);
        if (!r.ok) throw new Error(r.problems?.join("; ") ?? "seed failed");
        return { id: r.id! };
      },
      async orchestratorRun(runId, stage, status, params = {}) {
        // createRun() inserts with status "active"; set the actual status after.
        await orch.createRun(runId, stage as never, params);
        if (status !== "active") {
          await orch.setRunStage(runId, stage as never, status as never);
        }
      },
      async orchestratorStep(runId, stepId, stage, status, opts = {}) {
        await orch.upsertStep(runId, {
          stepId,
          stage: stage as never,
          status: status as never,
          result: opts.result ?? null,
          problems: opts.problems ?? [],
          attempts: 0,
        } as never);
      },
    };
    await use(seed);
  },
});

export { expect } from "@playwright/test";
