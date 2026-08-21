import { Rocket, Flame, Wand2, Sparkles } from "lucide-react";

export const CATEGORY: Record<string, { icon: typeof Rocket; accent: string; chip: string; label: string }> = {
  flagship:      { icon: Rocket,   accent: "from-amber-500/20 to-orange-500/10", chip: "bg-amber-500/15 text-amber-600 dark:text-amber-400", label: "Flagship" },
  warming:       { icon: Flame,    accent: "from-orange-500/20 to-rose-500/10",  chip: "bg-orange-500/15 text-orange-600 dark:text-orange-400", label: "Warming" },
  post_demo:     { icon: Sparkles, accent: "from-violet-500/20 to-fuchsia-500/10", chip: "bg-violet-500/15 text-violet-600 dark:text-violet-400", label: "Post-demo" },
  re_engagement: { icon: Sparkles, accent: "from-sky-500/20 to-cyan-500/10",     chip: "bg-sky-500/15 text-sky-600 dark:text-sky-400", label: "Re-engage" },
  event:         { icon: Sparkles, accent: "from-emerald-500/20 to-teal-500/10", chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", label: "Event" },
  custom:        { icon: Wand2,    accent: "from-slate-500/20 to-slate-400/10",  chip: "bg-slate-500/15 text-slate-600 dark:text-slate-300", label: "Custom" },
};
