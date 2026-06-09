#!/usr/bin/env node
// ---------------------------------------------------------------------
// PRODUCTION GUARD for the Pulse CRM repo.
//
// Wired as a Claude Code PreToolUse hook (see .claude/settings.json).
// Runs before every Bash command and file edit. Any action that could
// change PRODUCTION forces an explicit CONFIRMATION PROMPT for Nathan
// ("ask"), in every permission mode including dangerous/bypass.
//
// Per Nathan's direction (2026-06-09): the assistant MAY push to
// production when told to in chat, but a confirmation prompt must
// appear EVERY time before anything production-touching runs. Nathan
// approves the prompt and the action proceeds; he declines and it
// doesn't. Routine Staging work passes through with no prompt.
//
// Production deploys automatically when anything reaches `main`, so
// the prompt-triggering actions are:
//   - any `git push` other than exactly `git push origin Staging`
//   - gh pr merge / gh workflow run / gh run rerun / mutating gh api
//   - any supabase CLI use (can write to a live DB / deploy functions)
//   - edits to the production deploy workflow file
//   - edits to this guard or the settings that wire it in
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
    if (/\.claude[\\/](settings(\.local)?\.json|hooks[\\/]production-guard)/i.test(p)) {
      ask("This edits the production-safety guard or its settings.");
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
    ask("Direct supabase CLI use can modify a live database or deploy functions.");
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

  // ----- shell writes to the production workflow file -----
  if (/white-flower/i.test(stripped) &&
      /(>>?|\btee\b|\bsed\s+-i|\brm\b|\bmv\b|\bcp\b)/.test(stripped)) {
    ask("This would modify the PRODUCTION deploy pipeline file.");
  }

  // ----- shell writes to the guard itself -----
  if (/\.claude\/(hooks\/production-guard|settings)/i.test(stripped) &&
      /(>>?|\btee\b|\bsed\s+-i|\brm\b|\bmv\b|\bcp\b)/.test(stripped)) {
    ask("This would modify the production-safety guard or its settings.");
  }

  // ----- git push: only `git push origin Staging` is prompt-free -----
  if (/\bgit\s+push\b/i.test(stripped)) {
    const segments = stripped.split(/&&|\|\||;|\||\n/);
    for (const seg of segments) {
      const s = seg.trim();
      if (!/\bgit\s+push\b/i.test(s)) continue;
      if (!/^git\s+push\s+(-u\s+)?origin\s+Staging(\s+2>&1)?\s*$/.test(s)) {
        ask(`This push can deploy to PRODUCTION (anything reaching main goes live): "${s}".`);
      }
    }
  }

  process.exit(0);
});
