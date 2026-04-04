import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/* ================================================================
   Types
   ================================================================ */

type EntityType = "accounts" | "contacts" | "leads";

interface DuplicateRecord {
  id: string;
  label: string;
  detail: string;
  href: string;
}

interface DuplicateWarningProps {
  entity: EntityType;
  name?: string;
  email?: string;
  company?: string;
  firstName?: string;
  lastName?: string;
}

/* ================================================================
   Component
   ================================================================ */

export function DuplicateWarning({
  entity,
  name,
  email,
  company,
  firstName,
  lastName,
}: DuplicateWarningProps) {
  const [duplicates, setDuplicates] = useState<DuplicateRecord[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkDuplicates = useCallback(async () => {
    let results: DuplicateRecord[] = [];

    try {
      if (entity === "accounts" && name && name.trim().length >= 2) {
        const { data, error } = await supabase.rpc("find_duplicate_accounts", {
          p_name: name.trim(),
        });
        if (!error && data && data.length > 0) {
          results = data.map(
            (d: { id: string; name: string; industry: string | null }) => ({
              id: d.id,
              label: d.name,
              detail: d.industry ?? "",
              href: `/accounts/${d.id}`,
            })
          );
        }
        // Fallback: if RPC doesn't exist, do a simple ilike query
        if (error?.message?.includes("function") || error?.code === "42883") {
          const { data: fallback } = await supabase
            .from("accounts")
            .select("id, name, industry")
            .ilike("name", `%${name.trim()}%`)
            .is("archived_at", null)
            .limit(5);
          if (fallback) {
            results = fallback.map((d) => ({
              id: d.id,
              label: d.name,
              detail: d.industry ?? "",
              href: `/accounts/${d.id}`,
            }));
          }
        }
      }

      if (entity === "contacts") {
        const hasEmail = email && email.trim().length >= 3;
        const hasName =
          firstName &&
          firstName.trim().length >= 2 &&
          lastName &&
          lastName.trim().length >= 2;

        if (hasEmail || hasName) {
          const { data, error } = await supabase.rpc(
            "find_duplicate_contacts",
            {
              p_email: email?.trim() ?? "",
              p_first_name: firstName?.trim() ?? "",
              p_last_name: lastName?.trim() ?? "",
            }
          );
          if (!error && data && data.length > 0) {
            results = data.map(
              (d: {
                id: string;
                first_name: string;
                last_name: string;
                email: string | null;
              }) => ({
                id: d.id,
                label: `${d.first_name} ${d.last_name}`,
                detail: d.email ?? "",
                href: `/contacts/${d.id}`,
              })
            );
          }
          // Fallback
          if (
            error?.message?.includes("function") ||
            error?.code === "42883"
          ) {
            let query = supabase
              .from("contacts")
              .select("id, first_name, last_name, email")
              .is("archived_at", null)
              .limit(5);

            if (hasEmail) {
              query = query.ilike("email", `%${email!.trim()}%`);
            } else if (hasName) {
              query = query
                .ilike("first_name", `%${firstName!.trim()}%`)
                .ilike("last_name", `%${lastName!.trim()}%`);
            }

            const { data: fallback } = await query;
            if (fallback) {
              results = fallback.map((d) => ({
                id: d.id,
                label: `${d.first_name} ${d.last_name}`,
                detail: d.email ?? "",
                href: `/contacts/${d.id}`,
              }));
            }
          }
        }
      }

      if (entity === "leads") {
        const hasEmail = email && email.trim().length >= 3;
        const hasCompany = company && company.trim().length >= 2;

        if (hasEmail || hasCompany) {
          const { data, error } = await supabase.rpc("find_duplicate_leads", {
            p_email: email?.trim() ?? "",
            p_company: company?.trim() ?? "",
          });
          if (!error && data && data.length > 0) {
            results = data.map(
              (d: {
                id: string;
                first_name: string;
                last_name: string;
                email: string | null;
                company: string | null;
              }) => ({
                id: d.id,
                label: `${d.first_name} ${d.last_name}`,
                detail: [d.email, d.company].filter(Boolean).join(" - "),
                href: `/leads/${d.id}`,
              })
            );
          }
          // Fallback
          if (
            error?.message?.includes("function") ||
            error?.code === "42883"
          ) {
            let query = supabase
              .from("leads")
              .select("id, first_name, last_name, email, company")
              .is("archived_at", null)
              .limit(5);

            if (hasEmail) {
              query = query.ilike("email", `%${email!.trim()}%`);
            } else if (hasCompany) {
              query = query.ilike("company", `%${company!.trim()}%`);
            }

            const { data: fallback } = await query;
            if (fallback) {
              results = fallback.map((d) => ({
                id: d.id,
                label: `${d.first_name} ${d.last_name}`,
                detail: [d.email, d.company].filter(Boolean).join(" - "),
                href: `/leads/${d.id}`,
              }));
            }
          }
        }
      }
    } catch {
      // Silently ignore errors - duplicate detection is non-critical
    }

    setDuplicates(results);
    setDismissed(false);
  }, [entity, name, email, company, firstName, lastName]);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      checkDuplicates();
    }, 500);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [checkDuplicates]);

  if (dismissed || duplicates.length === 0) {
    return null;
  }

  return (
    <div className="rounded-md border border-yellow-300 bg-yellow-50 p-4 dark:border-yellow-700 dark:bg-yellow-950/30">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-yellow-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
            We found {duplicates.length} potential duplicate
            {duplicates.length === 1 ? "" : "s"}
          </p>
          <ul className="mt-2 space-y-1">
            {duplicates.map((dup) => (
              <li key={dup.id} className="text-sm">
                <Link
                  to={dup.href}
                  className="text-yellow-700 underline hover:text-yellow-900 dark:text-yellow-300 dark:hover:text-yellow-100"
                  target="_blank"
                >
                  {dup.label}
                </Link>
                {dup.detail && (
                  <span className="text-yellow-600 dark:text-yellow-400 ml-2">
                    {dup.detail}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 h-7 text-xs text-yellow-700 hover:text-yellow-900 dark:text-yellow-300"
            onClick={() => setDismissed(true)}
          >
            Ignore and continue
          </Button>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-yellow-500 hover:text-yellow-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
