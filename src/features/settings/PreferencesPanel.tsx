import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useTheme, type ThemeMode } from "@/hooks/useTheme";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { QUICK_TASK_SHORTCUTS } from "@/lib/quick-task-shortcut";
import { Sun, Moon, Monitor, Columns2, AlignLeft, Phone, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/features/auth/AuthProvider";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export function PreferencesPanel() {
  const { mode, setMode, resolved } = useTheme();
  const { prefs, setPref } = useUserPreferences();
  const { profile, updateMyProfile } = useAuth();
  const [outreachPhone, setOutreachPhone] = useState(profile?.outreach_phone ?? "");
  const [savingPhone, setSavingPhone] = useState(false);

  useEffect(() => setOutreachPhone(profile?.outreach_phone ?? ""), [profile?.outreach_phone]);

  async function saveOutreachPhone() {
    setSavingPhone(true);
    try {
      await updateMyProfile({ outreach_phone: outreachPhone.trim() || null });
      toast.success("Outreach profile saved");
    } catch (error) {
      toast.error("Couldn't save your outreach profile: " + (error as Error).message);
    } finally {
      setSavingPhone(false);
    }
  }

  const modes: Array<{ key: ThemeMode; label: string; icon: typeof Sun }> = [
    { key: "light", label: "Light", icon: Sun },
    { key: "dark", label: "Dark", icon: Moon },
    { key: "system", label: "System", icon: Monitor },
  ];

  const layouts: Array<{
    key: "stacked" | "side_panel";
    label: string;
    description: string;
    icon: typeof Columns2;
  }> = [
    {
      key: "side_panel",
      label: "Side Panel",
      description: "Activity pinned to the right; related tabs at top.",
      icon: Columns2,
    },
    {
      key: "stacked",
      label: "Stacked",
      description: "Classic single-column layout with tabs at the bottom.",
      icon: AlignLeft,
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Outreach Profile</CardTitle>
          <CardDescription>
            Campaigns uses this information automatically in call notes and other assigned outreach tasks.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="outreach-phone">Work phone</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Phone className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input id="outreach-phone" className="pl-9" value={outreachPhone} onChange={(e) => setOutreachPhone(e.target.value)} placeholder="509.555.0123" />
              </div>
              <Button onClick={saveOutreachPhone} disabled={savingPhone || outreachPhone.trim() === (profile?.outreach_phone ?? "")}>
                {savingPhone && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Your connected sending inbox supplies the email signature automatically.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>
            Choose how the CRM looks. "System" follows your device setting and
            updates when you toggle dark mode at the OS level.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label>Theme</Label>
          <div className="flex gap-2">
            {modes.map(({ key, label, icon: Icon }) => {
              const active = mode === key;
              return (
                <Button
                  key={key}
                  type="button"
                  variant={active ? "default" : "outline"}
                  onClick={() => setMode(key)}
                  className="flex-1"
                >
                  <Icon className="h-4 w-4 mr-2" />
                  {label}
                </Button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Currently showing: <strong>{resolved}</strong>
            {mode === "system" ? " (following system)" : ""}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Detail Page Layout</CardTitle>
          <CardDescription>
            Change the layout used on Account (and later Contact / Opportunity)
            detail pages.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label>Layout</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {layouts.map(({ key, label, description, icon: Icon }) => {
              const active = prefs.detailLayout === key;
              return (
                <Button
                  key={key}
                  type="button"
                  variant={active ? "default" : "outline"}
                  onClick={() => setPref("detailLayout", key)}
                  className="h-auto py-3 px-4 items-start justify-start text-left whitespace-normal"
                >
                  <Icon className="h-4 w-4 mr-2 mt-0.5 shrink-0" />
                  <span className="flex flex-col gap-0.5">
                    <span className="font-semibold">{label}</span>
                    <span className="text-xs font-normal opacity-80">
                      {description}
                    </span>
                  </span>
                </Button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Reload a detail page after changing.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quick Task Shortcut</CardTitle>
          <CardDescription>
            The keyboard shortcut that pops the Quick Task window from any
            screen. Ctrl + Space is the default, but on a Mac it can clash with
            the system "switch input source" shortcut — pick another if it
            doesn't work for you.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label>Shortcut</Label>
          <div className="grid grid-cols-1 gap-2">
            {QUICK_TASK_SHORTCUTS.map(({ value, label }) => {
              const active = prefs.quickTaskShortcut === value;
              return (
                <Button
                  key={value}
                  type="button"
                  variant={active ? "default" : "outline"}
                  onClick={() => setPref("quickTaskShortcut", value)}
                  className="justify-start"
                >
                  {label}
                </Button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Takes effect immediately. Works even while you're typing in a field.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
