import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { EmailIntegrationSettings } from "@/features/admin/EmailIntegrationSettings";
import { PreferencesPanel } from "./PreferencesPanel";

const VALID_TABS = ["preferences", "email"];

/**
 * Self-service settings page available to every authenticated user,
 * regardless of role. Holds the things a rep needs to manage their own
 * experience — theme preference and their personal Outlook/Gmail
 * connection — without giving them access to org-wide admin tools.
 *
 * Admin-only things (users, permissions, custom fields, imports, audit
 * log, etc.) continue to live in /admin under AdminSettings.
 */
export function UserSettings() {
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = (() => {
    const t = searchParams.get("tab");
    return t && VALID_TABS.includes(t) ? t : "preferences";
  })();

  const setActiveTab = (tab: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", tab);
        return next;
      },
      { replace: true }
    );
  };

  // If the Outlook OAuth callback bounces back to /settings?outlook=...,
  // force the email tab so the user sees the result / connected state.
  useEffect(() => {
    if (searchParams.get("outlook")) {
      setActiveTab("email");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader title="My Settings" />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
          <TabsTrigger value="email">My Email</TabsTrigger>
        </TabsList>

        <TabsContent value="preferences" className="mt-6">
          <PreferencesPanel />
        </TabsContent>

        <TabsContent value="email" className="mt-6">
          <EmailIntegrationSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
