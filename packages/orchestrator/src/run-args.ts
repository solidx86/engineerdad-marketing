/** Typed run parameters parsed from the run-creation `args` string. */
export type RunParams = {
  args: string;
  dryRun: boolean;
  channelFilter?: string[];
  dailyBudgetMyr?: number;
};

/**
 * Parse the run-creation `args` string into typed params. Recognises
 * `--dry-run`, `--channels=a,b,c`, and `--daily-budget=N`; unrecognised tokens
 * survive only in `args`. The distribute stage reads `dryRun` / `channelFilter`
 * / `dailyBudgetMyr` off `run.params` — without this parse they are never set,
 * so `/distribute --dry-run` and `--channels=` would be silent no-ops. (B-010)
 */
export function parseRunArgs(args: string): RunParams {
  const params: RunParams = { args, dryRun: false };
  for (const tok of args.trim().split(/\s+/).filter(Boolean)) {
    if (tok === "--dry-run") {
      params.dryRun = true;
    } else if (tok.startsWith("--channels=")) {
      const list = tok
        .slice("--channels=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (list.length > 0) params.channelFilter = list;
    } else if (tok.startsWith("--daily-budget=")) {
      const n = Number(tok.slice("--daily-budget=".length));
      if (Number.isFinite(n)) params.dailyBudgetMyr = n;
    }
  }
  return params;
}
