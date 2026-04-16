import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useTheme, type ThemeMode } from "@/hooks/useTheme";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { Sun, Moon, Monitor, Columns2, AlignLeft } from "lucide-react";

export function PreferencesPanel() {
  const { mode, setMode, resolved } = useTheme();
  const { prefs, setPref } = useUserPreferences();

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
    </div>
  );
}
