import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useTheme, type ThemeMode } from "@/hooks/useTheme";
import { Sun, Moon, Monitor } from "lucide-react";

export function PreferencesPanel() {
  const { mode, setMode, resolved } = useTheme();

  const modes: Array<{ key: ThemeMode; label: string; icon: typeof Sun }> = [
    { key: "light", label: "Light", icon: Sun },
    { key: "dark", label: "Dark", icon: Moon },
    { key: "system", label: "System", icon: Monitor },
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
    </div>
  );
}
