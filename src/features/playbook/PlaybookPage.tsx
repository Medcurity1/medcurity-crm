// Playbook — admin-only AI marketing co-pilot (ported from Nexus).
// Two sub-tabs: Ideas (weekly AI suggestions) + Campaigns (Smartlead
// cold-email campaigns). A Training slide-over feeds the AI.

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
        title="Playbook"
        description="Your AI marketing co-pilot — weekly ideas, cold-email campaigns, and newsletters."
        actions={
          <Button variant="outline" size="sm" onClick={() => setTrainingOpen(true)}>
            <Brain className="h-4 w-4 mr-2" />
            Training
          </Button>
        }
      />

      <Tabs defaultValue="ideas">
        <TabsList>
          <TabsTrigger value="ideas">Ideas</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
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
