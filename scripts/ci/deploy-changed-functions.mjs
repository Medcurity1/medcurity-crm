import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const CI_MANAGED_FUNCTIONS = [
  ["outlook-oauth", true],
  ["daily-deal", false],
  ["sync-emails", false],
  ["outlook-calendar-sync", false],
  ["task-reminders", false],
  ["task-digest", false],
  ["product-request-action", false],
  ["collateral-sync", false],
  ["request-email-notify", false],
  ["meddy-chat", true],
  ["meddy-support", true],
  ["meddy-staff-action", false],
  ["meddy-sweep", false],
  ["meddy-weekly-report", false],
  ["meddy-crawl", false],
  ["playbook-ai", false],
  ["playbook-smartlead", false],
  ["playbook-mailchimp", false],
  ["ask-ai", false],
  ["partner-contract-summary", false],
  ["invite-user", false],
  ["inbound-lead", true],
  ["nexus-activity", true],
  ["campaign-webhooks", true],
];

const managedNames = new Set(CI_MANAGED_FUNCTIONS.map(([name]) => name));

export function selectFunctions(changedFiles, safeDiff = true) {
  if (!safeDiff) return CI_MANAGED_FUNCTIONS.map(([name]) => name);
  if (
    changedFiles.some(
      (file) =>
        file.startsWith("supabase/functions/_shared/") ||
        file === "scripts/ci/deploy-changed-functions.mjs",
    )
  ) {
    return CI_MANAGED_FUNCTIONS.map(([name]) => name);
  }
  const selected = new Set();
  for (const file of changedFiles) {
    const match = file.match(/^supabase\/functions\/([^/]+)\//);
    if (match && managedNames.has(match[1])) selected.add(match[1]);
  }
  return CI_MANAGED_FUNCTIONS.map(([name]) => name).filter((name) => selected.has(name));
}

export function deployArgs(name) {
  const entry = CI_MANAGED_FUNCTIONS.find(([candidate]) => candidate === name);
  if (!entry) throw new Error(`Unknown CI-managed function: ${name}`);
  return ["supabase", "functions", "deploy", name, ...(entry[1] ? ["--no-verify-jwt"] : [])];
}

function parseArgs(argv) {
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    base: value("--base"),
    head: value("--head") ?? "HEAD",
    dryRun: argv.includes("--dry-run"),
  };
}

function changedBetween(base, head) {
  if (!base || /^0+$/.test(base) || !head || base === head) {
    return { files: [], safe: false };
  }
  try {
    const output = execFileSync("git", ["diff", "--name-only", base, head], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { files: output.split("\n").filter(Boolean), safe: true };
  } catch {
    return { files: [], safe: false };
  }
}

export function planDeployments({ files, safe }) {
  return selectFunctions(files, safe).map((name) => ["npx", ...deployArgs(name)]);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const diff = changedBetween(options.base, options.head);
  const commands = planDeployments(diff);
  if (!diff.safe) console.log("Could not establish a safe diff. Deploying all CI-managed functions.");
  if (!commands.length) console.log("No CI-managed Edge Function changes detected.");
  for (const command of commands) {
    console.log(command.join(" "));
    if (options.dryRun) continue;
    const result = spawnSync(command[0], command.slice(1), { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
