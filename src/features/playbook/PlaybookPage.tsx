// Campaigns — admin-only AI marketing/outreach hub (ported from Nexus as
// "Playbook"). Sub-tabs (in order): Campaigns (sequences — email + calls +
// LinkedIn; the default), Playbook (weekly AI ideas), Newsletters (Mailchimp).
// A Training slide-over feeds the AI.
// (Tab `value`s stay campaigns/ideas/newsletters for stable deep-links.)

import { useState } from "react";
import { Brain, Lightbulb } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TrainingPanel } from "./TrainingPanel";
import { InsightsPanel } from "./InsightsPanel";
import { IdeasTab } from "./IdeasTab";
import { CampaignsTab } from "./CampaignsTab";
import { NewslettersTab } from "./NewslettersTab";
import { usePendingSuggestionCount } from "./api";

export function PlaybookPage() {
  const [trainingOpen, setTrainingOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const { data: pendingCount } = usePendingSuggestionCount();

  return (
    <div>
      <PageHeader
        title="Campaigns"
        description="Your outreach command center — AI campaign ideas, cold email, and newsletters."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setInsightsOpen(true)}>
              <Lightbulb className="h-4 w-4 mr-2" />
              Insights
              {!!pendingCount && (
                <Badge variant="secondary" className="ml-1.5 h-4 min-w-4 px-1 text-[10px]">
                  {pendingCount}
                </Badge>
              )}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setTrainingOpen(true)}>
              <Brain className="h-4 w-4 mr-2" />
              Training
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="campaigns">
        <TabsList>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="ideas">Playbook</TabsTrigger>
          <TabsTrigger value="newsletters">Newsletters</TabsTrigger>
        </TabsList>
        <TabsContent value="campaigns">
          <CampaignsTab />
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
