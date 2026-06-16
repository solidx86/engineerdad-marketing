// Shared branch-slug derivation for sandbox DB naming.
import { execSync } from "node:child_process";

export function branchSlug() {
  const branch = execSync("git symbolic-ref --short HEAD", { encoding: "utf8" }).trim();
  return slugFromBranch(branch);
}

export function slugFromBranch(branch) {
  return "engineerdad_sb_" + branch.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);
}
