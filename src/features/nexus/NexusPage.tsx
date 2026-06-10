import { Sparkles, ListChecks, Inbox, Send, LayoutDashboard } from "lucide-react";
import { NexusRequestWidgets } from "@/features/requests/RequestWidgets";

/**
 * Nexus — the future personal command center (placeholder).
 *
 * Shipped now as a "Coming Soon" tab so we can build features into it
 * incrementally (Requests first). It will eventually become each user's
 * tailored home dashboard, replacing the generic Home tab. Visible to
 * everyone; the real per-user content lights up as it's built.
 */
const FEATURES = [
  {
    icon: ListChecks,
    title: "Your tasks & priorities",
    desc: "What needs your attention today, sorted so the important things rise to the top.",
  },
  {
    icon: Inbox,
    title: "Requests at your fingertips",
    desc: "Collateral, product, and CRM requests that are yours to act on — right where you can see them.",
  },
  {
    icon: Send,
    title: "Campaign hand-offs",
    desc: "Know the moment an outreach sequence reaches your step, so the call happens at the right time.",
  },
  {
    icon: LayoutDashboard,
    title: "Your numbers, simplified",
    desc: "The spreadsheets you live in, reimagined as clean, at-a-glance views built around how you work.",
  },
];

export function NexusPage() {
  return (
    <div className="mx-auto max-w-3xl py-10">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-orange-500/10 via-background to-primary/10 p-10 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500/15 ring-1 ring-orange-500/30">
          <Sparkles className="h-7 w-7 text-orange-500" />
        </div>
        <span className="inline-flex items-center rounded-full bg-orange-500 px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
          Coming Soon
        </span>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Nexus</h1>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
          Your personal command center. Nexus will bring everything that matters to
          you into one place, tailored to how you work, so your day is clear at a
          glance.
        </p>
      </div>

      <div className="mt-8">
        <NexusRequestWidgets />
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
              <f.icon className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-semibold">{f.title}</p>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        We're building this now. You'll see it light up here soon.
      </p>
    </div>
  );
}
