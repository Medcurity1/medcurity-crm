#!/usr/bin/env node
// ---------------------------------------------------------------------
// PRODUCTION GUARD for the Pulse CRM repo.
//
// Wired as a Claude Code PreToolUse hook (see .claude/settings.json).
// Runs before every Bash command and file edit and forces a single
// CONFIRMATION PROMPT for Nathan ("ask") before anything that could
// change PRODUCTION, in every permission mode including dangerous.
//
// Design goal (Nathan, 2026-06-10): be a two-factor check on real
// production-risky actions ONLY. Do NOT get in the way of ordinary,
// safe work (Staging pushes, feature-branch pushes, read-only gh and
// supabase commands). Narrow, not broad.
//
// Prompts on:
//   - git push that targets `main` (auto-deploys to prod), force/all/
//     mirror pushes, or an ambiguous bare push that could hit main.
//     Explicit pushes to any non-main branch pass through.
//   - gh pr merge / gh workflow run / gh run rerun / mutating gh api.
//   - DANGEROUS supabase subcommands only (db push, db reset, db
//     remote, functions deploy, link, migration up/repair, secrets
//     set, db dump). Read-only supabase (status, list, diff, lint,
//     --version) passes through.
//   - edits/overwrites of the production deploy workflow, this guard,
//     or .claude/settings.json (the file that wires the guard in).
// ---------------------------------------------------------------------

let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let input = {};
  try { input = JSON.parse(raw || "{}"); } catch { /* no tool info; nothing to check */ }

  const ask = (reason) => {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason:
          "PRODUCTION CONFIRMATION REQUIRED: " + reason +
          " Approve only if you (Nathan) gave the go-ahead for this.",
      },
    }));
    process.exit(0);
  };

  const tool = String(input.tool_name || "");
  const ti = input.tool_input || {};

  // ----- File-edit confirmation -----
  if (tool === "Edit" || tool === "Write" || tool === "NotebookEdit") {
    const p = String(ti.file_path || "");
    if (/azure-static-web-apps-white-flower/i.test(p)) {
      ask("This edits the PRODUCTION deploy pipeline file.");
    }
    if (/\.claude[\\/](settings\.json|hooks[\\/]production-guard)/i.test(p)) {
      ask("This edits the production-safety guard or the settings that wire it in.");
    }
    process.exit(0);
  }

  if (tool !== "Bash") process.exit(0);
  const cmd = String(ti.command || "");
  // Strip quoted strings so commit messages mentioning "supabase" or
  // "git push main" don't trigger false positives.
  const stripped = cmd.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');

  // ----- dangerous supabase subcommands only -----
  if (/(^|[\s;&|(])(npx\s+|pnpm\s+(dlx\s+)?|yarn\s+)?supabase\b/i.test(stripped) &&
      /\bsupabase\b[\s\S]*?\b(db\s+push|db\s+reset|db\s+remote|functions\s+deploy|link|migration\s+(up|repair)|secrets\s+set|db\s+dump|branches)\b/i.test(stripped)) {
    ask("This supabase command can write to a live database, deploy functions, or change project links.");
  }

  // ----- gh commands that can move main or trigger deploys -----
  if (/\bgh\s+pr\s+merge\b/i.test(stripped)) {
    ask("Merging a PR can put code on main, which auto-deploys to PRODUCTION.");
  }
  if (/\bgh\s+workflow\s+run\b/i.test(stripped)) {
    ask("Manually running a workflow can trigger a PRODUCTION deploy.");
  }
  if (/\bgh\s+run\s+rerun\b/i.test(stripped)) {
    ask("Re-running a workflow run can trigger a PRODUCTION deploy.");
  }
  if (/\bgh\s+api\b/i.test(stripped) &&
      /(-X|--method)[\s=]*(post|put|patch|delete)|--field\b|\s-f\s|\/merges\b|git\/refs|pulls\/[^\s]*\/merge|dispatches/i.test(stripped)) {
    ask("GitHub API write operations can modify branches or trigger deploys.");
  }

  // ----- shell writes to the production workflow file or the guard -----
  if (/white-flower/i.test(stripped) &&
      /(>>?|\btee\b|\bsed\s+-i|\brm\b|\bmv\b|\bcp\b)/.test(stripped)) {
    ask("This would modify the PRODUCTION deploy pipeline file.");
  }
  if (/\.claude\/(hooks\/production-guard|settings\.json)/i.test(stripped) &&
      /(>>?|\btee\b|\bsed\s+-i|\brm\b|\bmv\b|\bcp\b)/.test(stripped)) {
    ask("This would modify the production-safety guard or its settings.");
  }

  // ----- git push: prompt only for main / force / ambiguous pushes -----
  if (/\bgit\s+push\b/i.test(stripped)) {
    const segs = stripped
      .split(/&&|\|\||;|\n/)
      .map((x) => x.trim())
      .filter((x) => /\bgit\s+push\b/i.test(x));
    for (const s of segs) {
      if (/(--force\b|--force-with-lease\b|\s-f\b|--mirror\b|--all\b)/.test(s)) {
        ask("Force / mirror / all push can rewrite or mass-push branches, including main.");
      }
      if (/\bmain\b/.test(s)) {
        ask("This push targets main, which auto-deploys to PRODUCTION.");
      }
      // Explicit "git push <remote> <branch>" to a non-main branch is
      // safe (only main deploys to prod). A bare/ambiguous push that
      // names no branch could be the current branch — prompt to be safe.
      const hasExplicitRef = /\bgit\s+push\s+(?:--?\S+\s+)*\S+\s+\S+/.test(s);
      if (!hasExplicitRef) {
        ask("This push names no branch and could push the current branch (possibly main).");
      }
    }
  }

  process.exit(0);
});
