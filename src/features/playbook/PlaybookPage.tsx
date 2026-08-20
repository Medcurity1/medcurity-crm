// Campaigns — admin-only AI marketing/outreach hub (ported from Nexus as
// "Playbook"). Sub-tabs (in order): Campaigns (sequences — email + calls +
// LinkedIn; the default), Playbook (weekly AI ideas), Newsletters (Mailchimp).
// A Training slide-over feeds the AI.
// (Tab `value`s stay campaigns/ideas/newsletters for stable deep-links.)
//
// Aurora restructure (Nathan 8/19): ONE title, no subtitle, and the
// campaigns utilities (Templates, Sending inboxes) live up here beside
// Insights/Training instead of stacking a second toolbar row below. Their
// dialogs stay inside CampaignsTab (they hand off into the wizard there);
// this header just owns the open/closed state and passes it down.

import { useState } from "react";
import { Brain, Inbox, LayoutTemplate, Lightbulb } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TrainingPanel } from "./TrainingPanel";
import { InsightsPanel } from "./InsightsPanel";
import { IdeasTab } from "./IdeasTab";
import { CampaignsTab } from "./CampaignsTab";
import { NewslettersTab } from "./NewslettersTab";
import { usePendingSuggestionCount } from "./api";
import "./campaigns.css";

export function PlaybookPage() {
  const [tab, setTab] = useState("campaigns");
  const [trainingOpen, setTrainingOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [inboxHealthOpen, setInboxHealthOpen] = useState(false);
  const { data: pendingCount } = usePendingSuggestionCount();

  return (
    <div className="camp-scope">
      <PageHeader
        title="Campaigns"
        actions={
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {tab === "campaigns" && (
              <>
                <button type="button" className="camp-btn" onClick={() => setTemplatesOpen(true)}>
                  <LayoutTemplate className="h-4 w-4" />
                  Templates
                </button>
                <button type="button" className="camp-btn" onClick={() => setInboxHealthOpen(true)}>
                  <Inbox className="h-4 w-4" />
                  Sending inboxes
                </button>
              </>
            )}
            <button type="button" className="camp-btn" onClick={() => setInsightsOpen(true)}>
              <Lightbulb className="h-4 w-4" />
              Insights
              {!!pendingCount && (
                <Badge variant="secondary" className="ml-0.5 h-4 min-w-4 px-1 text-[10px]">
                  {pendingCount}
                </Badge>
              )}
            </button>
            <button type="button" className="camp-btn" onClick={() => setTrainingOpen(true)}>
              <Brain className="h-4 w-4" />
              Training
            </button>
          </div>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="ideas">Ideas</TabsTrigger>
          <TabsTrigger value="newsletters">Newsletters</TabsTrigger>
        </TabsList>
        <TabsContent value="campaigns">
          <CampaignsTab
            templatesOpen={templatesOpen}
            onTemplatesOpenChange={setTemplatesOpen}
            inboxHealthOpen={inboxHealthOpen}
            onInboxHealthOpenChange={setInboxHealthOpen}
          />
        </TabsContent>
        <TabsContent value="ideas">
          <IdeasTab />
        </TabsContent>
        <TabsContent value="newsletters">
          <NewslettersTab />
        </TabsContent>
      </Tabs>

      <TrainingPanel open={trainingOpen} onOpenChange={setTrainingOpen} />
      <InsightsPanel open={insightsOpen} onOpenChange={setInsightsOpen} />
    </div>
  );
}
