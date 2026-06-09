#!/usr/bin/env node
// ---------------------------------------------------------------------
// PRODUCTION GUARD for the Pulse CRM repo.
//
// Wired as a Claude Code PreToolUse hook (see .claude/settings.json).
// Runs before every Bash command and file edit, and DENIES anything
// that could change production without Nathan's explicit, manual
// approval. Hooks run in every permission mode, including
// "dangerous" / bypassPermissions — this is the unskippable backstop.
//
// Production deploys automatically when anything reaches the `main`
// branch, so the rules are:
//   - git push: ONLY the exact form `git push origin Staging` passes.
//     Anything else (push to main, bare push, force push) is blocked.
//   - gh pr merge / gh workflow run / gh run rerun / mutating gh api:
//     blocked (any of these can move main or trigger a deploy).
//   - supabase CLI: blocked entirely (can write to a live database
//     or deploy functions directly).
//   - Edits to the production deploy workflow file, or to this guard
//     and its settings: blocked.
//
// To do a production push: Nathan gives the go-ahead in chat, then he
// runs the push himself or approves it manually outside this guard.
// ---------------------------------------------------------------------

let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let input = {};
  try { input = JSON.parse(raw || "{}"); } catch { /* fail open to a deny-nothing pass; malformed input means no tool info */ }

  const deny = (reason) => {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          "PRODUCTION GUARD blocked this: " + reason +
          " Production changes require Nathan's explicit go-ahead in chat, " +
          "and the final push must be run or manually approved by him.",
      },
    }));
    process.exit(0);
  };

  const tool = String(input.tool_name || "");
  const ti = input.tool_input || {};

  // ----- File-edit protection -----
  if (tool === "Edit" || tool === "Write" || tool === "NotebookEdit") {
    const p = String(ti.file_path || "");
    if (/azure-static-web-apps-white-flower/i.test(p)) {
      deny("This file controls the PRODUCTION deploy pipeline.");
    }
    if (/\.claude[\\/](settings(\.local)?\.json|hooks[\\/]production-guard)/i.test(p)) {
      deny("This file is part of the production-safety guard itself.");
    }
    process.exit(0);
  }

  if (tool !== "Bash") process.exit(0);
  const cmd = String(ti.command || "");
  // Strip quoted strings so commit messages mentioning "supabase" or
  // "git push" don't trigger false positives.
  const stripped = cmd.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');

  // ----- supabase CLI: can hit a live DB / deploy functions -----
  if (/(^|[\s;&|(])(npx\s+|pnpm\s+(dlx\s+)?|yarn\s+)?supabase\b/i.test(stripped)) {
    deny("Direct supabase CLI use can modify a live database or deploy functions.");
  }

  // ----- gh commands that can move main or trigger deploys -----
  if (/\bgh\s+pr\s+merge\b/i.test(stripped)) {
    deny("Merging a PR can put code on main, which auto-deploys to production.");
  }
  if (/\bgh\s+workflow\s+run\b/i.test(stripped)) {
    deny("Manually running a workflow can trigger a production deploy.");
  }
  if (/\bgh\s+run\s+rerun\b/i.test(stripped)) {
    deny("Re-running a workflow run can trigger a production deploy.");
  }
  if (/\bgh\s+api\b/i.test(stripped) &&
      /(-X|--method)[\s=]*(post|put|patch|delete)|--field\b|\s-f\s|\/merges\b|git\/refs|pulls\/[^\s]*\/merge|dispatches/i.test(stripped)) {
    deny("GitHub API write operations can modify branches or trigger deploys.");
  }

  // ----- shell writes to the production workflow file -----
  if (/white-flower/i.test(stripped) &&
      /(>>?|\btee\b|\bsed\s+-i|\brm\b|\bmv\b|\bcp\b)/.test(stripped)) {
    deny("This would modify the PRODUCTION deploy pipeline file.");
  }

  // ----- git push: only `git push origin Staging` allowed -----
  if (/\bgit\s+push\b/i.test(stripped)) {
    const segments = stripped.split(/&&|\|\||;|\||\n/);
    for (const seg of segments) {
      const s = seg.trim();
      if (!/\bgit\s+push\b/i.test(s)) continue;
      // Allowed: git push [-u] origin Staging, optional stderr redirect.
      if (!/^git\s+push\s+(-u\s+)?origin\s+Staging(\s+2>&1)?\s*$/.test(s)) {
        deny(`Only "git push origin Staging" is allowed automatically. Blocked: "${s}".`);
      }
    }
  }

  process.exit(0);
});
