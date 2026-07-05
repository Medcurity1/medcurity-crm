import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ShieldCheck, Sparkles } from "lucide-react";
import { formatRelativeDate } from "@/lib/formatters";
import {
  AI_CAPABILITIES,
  useAiSettings,
  useRecentAiQueries,
  useUpdateAiSettings,
  type AiCapability,
} from "./ai-admin-api";

// ── Capability metadata ──────────────────────────────────────────────
// Friendly label + one-line description, grouped into sensible sections.
// The `key` values MUST match the nine capability names exactly.

interface CapabilityMeta {
  key: AiCapability;
  label: string;
  description: string;
}

interface CapabilityGroup {
  title: string;
  capabilities: CapabilityMeta[];
}

const CAPABILITY_GROUPS: CapabilityGroup[] = [
  {
    title: "Records",
    capabilities: [
      {
        key: "search_accounts",
        label: "Search accounts",
        description: "Search & filter accounts by name, owner, status, and more.",
      },
      {
        key: "get_account",
        label: "Summarize an account",
        description: "Pull up and summarize one account with its key details.",
      },
      {
        key: "search_contacts",
        label: "Search contacts",
        description: "Find contacts across the CRM by name, email, or company.",
      },
      {
        key: "get_contact",
        label: "Summarize a contact",
        description: "Pull up and summarize a single contact record.",
      },
    ],
  },
  {
    title: "Pipeline & renewals",
    capabilities: [
      {
        key: "search_opportunities",
        label: "Search opportunities",
        description: "Search & filter deals by stage, owner, amount, or close date.",
      },
      {
        key: "pipeline_summary",
        label: "Pipeline summary",
        description: "Roll up open pipeline totals and counts by stage.",
      },
      {
        key: "list_renewals",
        label: "List renewals",
        description: "Surface upcoming and overdue contract renewals.",
      },
    ],
  },
  {
    title: "Tasks",
    capabilities: [
      {
        key: "list_my_tasks",
        label: "List my tasks",
        description: "Show the asking user's own open tasks and reminders.",
      },
    ],
  },
  {
    title: "Help",
    capabilities: [
      {
        key: "how_do_i",
        label: "Answer product questions",
        description: "Answer “how do I…” questions about using the CRM.",
      },
    ],
  },
];

// Model options for the select.
const MODEL_OPTIONS: { value: string; label: string; hint: string }[] = [
  {
    value: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    hint: "Recommended — balanced speed and quality",
  },
  {
    value: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    hint: "Cheaper and faster",
  },
  {
    value: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    hint: "Most capable",
  },
];

const RATE_LIMIT_MIN = 1;
const RATE_LIMIT_MAX = 1000;

export function AiAssistantAdmin() {
  const { data: settings, isLoading } = useAiSettings();
  const update = useUpdateAiSettings();
  const { data: recent, isLoading: loadingRecent } = useRecentAiQueries(20);

  const [rateLimit, setRateLimit] = useState<string>("");

  useEffect(() => {
    if (settings) setRateLimit(String(settings.rate_limit_per_hour));
  }, [settings]);

  const enabled = new Set(settings?.enabled_capabilities ?? []);

  function handleToggleCapability(key: AiCapability, on: boolean) {
    if (!settings) return;
    // Rebuild the full array of enabled names from the canonical list so we
    // never persist stale or unknown values.
    const next = AI_CAPABILITIES.filter((c) =>
      c === key ? on : enabled.has(c)
    );
    update.mutate({ enabled_capabilities: next });
  }

  function handleSaveRateLimit() {
    if (!settings) return;
    const parsed = Number.parseInt(rateLimit, 10);
    if (
      !Number.isFinite(parsed) ||
      parsed < RATE_LIMIT_MIN ||
      parsed > RATE_LIMIT_MAX
    ) {
      // Snap the input back to the last saved value.
      setRateLimit(String(settings.rate_limit_per_hour));
      return;
    }
    if (parsed === settings.rate_limit_per_hour) return;
    update.mutate({ rate_limit_per_hour: parsed });
  }

  function handleModelChange(value: string) {
    if (!settings || value === settings.model) return;
    update.mutate({ model: value });
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Read-only reassurance ──────────────────────────────── */}
      <div className="rounded-md border border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30 p-4 flex gap-3">
        <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
        <div className="text-sm text-emerald-900 dark:text-emerald-200">
          <span className="font-semibold">Ask AI is read-only</span> — it can
          search, summarize, and surface records, but has no ability to create,
          edit, or delete anything. These toggles only control which lookups it
          can perform.
        </div>
      </div>

      {/* ── Capabilities ───────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" />
            Capabilities
          </CardTitle>
          <CardDescription>
            Choose which read-only lookups the assistant is allowed to perform.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {CAPABILITY_GROUPS.map((group) => (
            <div key={group.title} className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.title}
              </h3>
              <div className="space-y-3">
                {group.capabilities.map((cap) => (
                  <div
                    key={cap.key}
                    className="flex items-start justify-between gap-4 rounded-md border p-3"
                  >
                    <div className="space-y-0.5">
                      <Label
                        htmlFor={`cap-${cap.key}`}
                        className="text-sm font-medium"
                      >
                        {cap.label}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {cap.description}
                      </p>
                    </div>
                    <Switch
                      id={`cap-${cap.key}`}
                      checked={enabled.has(cap.key)}
                      onCheckedChange={(on) =>
                        handleToggleCapability(cap.key, on)
                      }
                      disabled={update.isPending}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Behaviour: rate limit + model ──────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Behavior</CardTitle>
          <CardDescription>
            Control usage limits and which Claude model powers the assistant.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="ai-rate-limit">Rate limit (per user, per hour)</Label>
            <Input
              id="ai-rate-limit"
              type="number"
              min={RATE_LIMIT_MIN}
              max={RATE_LIMIT_MAX}
              value={rateLimit}
              onChange={(e) => setRateLimit(e.target.value)}
              onBlur={handleSaveRateLimit}
              disabled={update.isPending}
              className="max-w-[200px]"
            />
            <p className="text-xs text-muted-foreground">
              Maximum questions each user may ask per hour ({RATE_LIMIT_MIN}–
              {RATE_LIMIT_MAX}).
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-model">Model</Label>
            <Select
              value={settings?.model}
              onValueChange={handleModelChange}
              disabled={update.isPending}
            >
              <SelectTrigger id="ai-model" className="max-w-[280px]">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {MODEL_OPTIONS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    <span className="flex flex-col">
                      <span>{m.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {m.hint}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Sonnet is the recommended default.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Recent activity ────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent activity</CardTitle>
          <CardDescription>
            The latest questions asked, who asked them, and which lookups the
            assistant used.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loadingRecent ? (
            <div className="space-y-2 p-6">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : recent && recent.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[140px]">Who</TableHead>
                    <TableHead>Question</TableHead>
                    <TableHead>Tools used</TableHead>
                    <TableHead className="w-[120px] text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-xs font-medium">
                        {row.asker_name ?? "Unknown"}
                      </TableCell>
                      <TableCell className="text-xs max-w-[360px]">
                        <span className="line-clamp-2 flex items-center gap-1">
                          {!row.ok && (
                            <Badge
                              variant="destructive"
                              className="text-[10px] px-1 py-0"
                            >
                              error
                            </Badge>
                          )}
                          {row.question}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.tools_called.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {row.tools_called.map((t, i) => (
                              <Badge
                                key={`${row.id}-${t}-${i}`}
                                variant="secondary"
                                className="text-[10px] font-normal"
                              >
                                {t}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground whitespace-nowrap">
                        {formatRelativeDate(row.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No questions asked yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
