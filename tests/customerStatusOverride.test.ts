import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), "utf8");

describe("Account Status correction", () => {
  it("keeps the manual Customer action admin-only and requires a reason", () => {
    const detail = read("src", "features", "accounts", "AccountDetail.tsx");
    const dialog = read("src", "features", "accounts", "CustomerStatusOverrideDialog.tsx");
    expect(detail).toContain('isAdmin && account.customer_status !== "client"');
    expect(detail).toContain("Mark as Customer");
    expect(dialog).toContain('placeholder="Example: Active contract is not in Pulse yet"');
    expect(dialog).toContain('disabled={!reason.trim() || mutation.isPending}');
  });

  it("reuses the existing override RPC and refreshes account queries", () => {
    const api = read("src", "features", "accounts", "api.ts");
    expect(api).toContain('override: "client" | "former_client"');
    expect(api).toContain('supabase.rpc("set_account_customer_status_override"');
    expect(api).toContain('queryKey: ["accounts", variables.accountId]');
  });

  it("enforces Customer authorization and reason requirements in Postgres", () => {
    const migration = read(
      "supabase",
      "migrations",
      "20260819020000_customer_status_override_roles.sql",
    );
    expect(migration).toContain("p_override = 'client'");
    expect(migration).toContain("not public.is_admin()");
    expect(migration).toContain("nullif(trim(p_reason), '') is null");
    expect(migration).toContain("v_existing = 'client'");
    expect(migration).toContain("public.has_crm_write_role()");
    expect(migration).toContain("revoke all on function public.set_account_customer_status_override");
  });

  it("shows whether status is automatic or manual and exposes the saved reason", () => {
    const detail = read("src", "features", "accounts", "AccountDetail.tsx");
    expect(detail).toContain("Automatic from deal and contract history");
    expect(detail).toContain("account.customer_status_override_reason");
    expect(detail).toContain("Make automatic again");
  });
});
