// Campaigns — admin-only AI marketing/outreach hub (ported from Nexus as
// "Playbook"). Sub-tabs: Playbook (weekly AI ideas), Email Campaigns (Smartlead
// cold email), Newsletters (Mailchimp). A Training slide-over feeds the AI.
// (Tab `value`s stay ideas/campaigns/newsletters for stable deep-links.)

import { useState } from "react";
import { Brain } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TrainingPanel } from "./TrainingPanel";
import { IdeasTab } from "./IdeasTab";
import { CampaignsTab } from "./CampaignsTab";
import { NewslettersTab } from "./NewslettersTab";

export function PlaybookPage() {
  const [trainingOpen, setTrainingOpen] = useState(false);

  return (
    <div>
      <PageHeader
        title="Campaigns"
        description="Your outreach command center — AI campaign ideas, cold email, and newsletters."
        actions={
          <Button variant="outline" size="sm" onClick={() => setTrainingOpen(true)}>
            <Brain className="h-4 w-4 mr-2" />
            Training
          </Button>
        }
      />

      <Tabs defaultValue="ideas">
        <TabsList>
          <TabsTrigger value="ideas">Playbook</TabsTrigger>
          <TabsTrigger value="campaigns">Email Campaigns</TabsTrigger>
          <TabsTrigger value="newsletters">Newsletters</TabsTrigger>
        </TabsList>
        <TabsContent value="ideas">
          <IdeasTab />
        </TabsContent>
        <TabsContent value="campaigns">
          <CampaignsTab />
        </TabsContent>
        <TabsContent value="newsletters">
          <NewslettersTab />
        </TabsContent>
      </Tabs>

      <TrainingPanel open={trainingOpen} onOpenChange={setTrainingOpen} />
    </div>
  );
}
