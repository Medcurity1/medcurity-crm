// My Settings → Notifications: per-type banner/sound/duration controls
// for Meddy + CRM notification types, the Meddy email opt-ins, and the
// personal Pushover key. Ports the Nexus settings rows (renderNotifRow,
// index.html:10222-10258) with the "Long (15s)" label fix.

import { useEffect, useState } from "react";
import { Bell, Mail, Play, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/features/auth/AuthProvider";
import { previewSound } from "@/lib/notification-sounds";
import { staffAction } from "@/features/meddy/api";
import {
  CRM_NOTIF_TYPES,
  EMAIL_OPT_INS,
  MEDDY_NOTIF_TYPES,
  useNotifPrefs,
  useSavePushoverKey,
  useUpdateNotifPrefs,
  type NotifTypeDef,
} from "./prefs-api";

// Full audition list (2026-06-12): the 4 Nexus originals plus 10 new
// candidates. Nathan is picking a top 5 — trim this list once chosen.
const SOUND_OPTIONS = [
  { value: "soft", label: "Soft (original)" },
  { value: "melody", label: "Melody (original)" },
  { value: "pulse", label: "Pulse (original)" },
  { value: "chime", label: "Chime (original)" },
  { value: "bubble", label: "Bubble" },
  { value: "marimba", label: "Marimba" },
  { value: "ding", label: "Ding" },
  { value: "doorbell", label: "Doorbell" },
  { value: "glass", label: "Glass" },
  { value: "drop", label: "Drop" },
  { value: "knock", label: "Knock" },
  { value: "twinkle", label: "Twinkle" },
  { value: "horn", label: "Horn" },
  { value: "echo", label: "Echo" },
];

// Value 10 repeats for 15s (the engine's "long" cycle) — label says so.
const DURATION_OPTIONS = [
  { value: 0, label: "Short (once)" },
  { value: 5, label: "Medium (5s)" },
  { value: 10, label: "Long (15s)" },
  { value: 30, label: "Persistent (30s)" },
];

export function NotificationSettingsPanel() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const { data, isLoading } = useNotifPrefs();
  const prefs = data?.prefs ?? {};

  if (isLoading) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>;
  }

  const meddyTypes = MEDDY_NOTIF_TYPES.filter((t) => !t.adminOnly || isAdmin);

  return (
    <div className="max-w-3xl space-y-8">
      <Section
        icon={<Bell className="h-4 w-4" />}
        title="Meddy notifications"
        desc="Alerts from the website chat assistant. Banner shows the in-app popup; Sound plays the chosen tone."
      >
        {meddyTypes.map((def) => (
          <NotifRow key={def.key} def={def} prefs={prefs} />
        ))}
      </Section>

      <Section
        icon={<Bell className="h-4 w-4" />}
        title="CRM notifications"
        desc="Alerts from your day-to-day CRM activity."
      >
        {CRM_NOTIF_TYPES.map((def) => (
          <NotifRow key={def.key} def={def} prefs={prefs} />
        ))}
      </Section>

      <Section
        icon={<Mail className="h-4 w-4" />}
        title="Email alerts"
        desc="Meddy emails sent to your inbox. All start off — turn on the ones you want."
      >
        {EMAIL_OPT_INS.map((opt) => (
          <EmailRow key={opt.key} optKey={opt.key} label={opt.label} desc={opt.desc} prefs={prefs} />
        ))}
      </Section>

      <Section
        icon={<Smartphone className="h-4 w-4" />}
        title="Phone notifications (Pushover)"
        desc="Get instant phone alerts when a visitor requests a human. Requires the Pushover app ($4.99 one-time). Enter your Pushover user key below."
      >
        <PushoverRow savedKey={data?.pushover_key ?? null} />
      </Section>
    </div>
  );
}

function Section({
  icon,
  title,
  desc,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
      <div className="mt-3 divide-y divide-border rounded-lg border border-border">{children}</div>
    </div>
  );
}

function NotifRow({ def, prefs }: { def: NotifTypeDef; prefs: Record<string, unknown> }) {
  const update = useUpdateNotifPrefs();

  const bannerOn = prefs[def.key] !== false;
  const soundOn = prefs[`sound_${def.key}`] !== false;
  // Legacy 'alert' normalizes to 'chime' (Nexus index.html:10225).
  const rawSoundType = (prefs[`soundtype_${def.key}`] as string) || def.defSound;
  const soundType = rawSoundType === "alert" ? "chime" : rawSoundType;
  const duration = Number(prefs[`duration_${def.key}`] ?? def.defDuration);

  function setPref(patch: Record<string, unknown>) {
    update.mutate(patch);
  }

  function onBannerToggle(on: boolean) {
    setPref({ [def.key]: on });
    // Enabling a banner with OS permission undecided asks for it (Nexus).
    if (on && typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{def.label}</p>
          <p className="text-xs text-muted-foreground">{def.desc}</p>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Sound
            <Switch
              checked={soundOn}
              onCheckedChange={(on) => setPref({ [`sound_${def.key}`]: on })}
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Banner
            <Switch checked={bannerOn} onCheckedChange={onBannerToggle} />
          </label>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5 text-muted-foreground">
          Sound:
          <select
            value={soundType}
            disabled={!soundOn}
            onChange={(e) => setPref({ [`soundtype_${def.key}`]: e.target.value })}
            className="h-7 rounded-md border border-input bg-transparent px-2 text-xs disabled:opacity-50 dark:bg-input/30"
          >
            {SOUND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="ghost"
          size="icon-xs"
          title="Preview"
          disabled={!soundOn}
          onClick={() => previewSound(soundType, "short")}
        >
          <Play className="h-3 w-3" />
        </Button>
        <label className="flex items-center gap-1.5 text-muted-foreground">
          Duration:
          <select
            value={duration}
            onChange={(e) => setPref({ [`duration_${def.key}`]: Number(e.target.value) })}
            className="h-7 rounded-md border border-input bg-transparent px-2 text-xs dark:bg-input/30"
          >
            {DURATION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

function EmailRow({
  optKey,
  label,
  desc,
  prefs,
}: {
  optKey: string;
  label: string;
  desc: string;
  prefs: Record<string, unknown>;
}) {
  const update = useUpdateNotifPrefs();
  // Opt-IN: only explicit true subscribes (edge functions match 'true').
  const on = prefs[optKey] === true || prefs[optKey] === "true";
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <Switch checked={on} onCheckedChange={(v) => update.mutate({ [optKey]: v })} />
    </div>
  );
}

function PushoverRow({ savedKey }: { savedKey: string | null }) {
  const [key, setKey] = useState(savedKey ?? "");
  const [testing, setTesting] = useState(false);
  const save = useSavePushoverKey();

  useEffect(() => {
    setKey(savedKey ?? "");
  }, [savedKey]);

  async function testPush() {
    setTesting(true);
    try {
      const res = await staffAction("pushover_test");
      if (res.success) toast.success("Test push sent — check your phone");
      else toast.error(String(res.error ?? "Test failed"));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3">
      <Input
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="Pushover user key"
        className="h-8 w-64 font-mono text-xs"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={save.isPending || key.trim() === (savedKey ?? "")}
        onClick={() => save.mutate(key)}
      >
        Save
      </Button>
      <Button size="sm" variant="outline" disabled={!savedKey || testing} onClick={testPush}>
        {testing ? "Sending…" : "Test"}
      </Button>
      {savedKey && (
        <span className="text-xs text-muted-foreground">
          Key on file ending in …{savedKey.slice(-4)}
        </span>
      )}
    </div>
  );
}
