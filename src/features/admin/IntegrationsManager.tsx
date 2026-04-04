import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { integrations, type Integration } from "./integrations-config";
import { WebhooksManager } from "./WebhooksManager";

interface IntegrationsManagerProps {
  onNavigateTab?: (tab: string) => void;
}

function statusBadge(status: Integration["status"]) {
  switch (status) {
    case "connected":
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
          Connected
        </Badge>
      );
    case "available":
      return (
        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
          Available
        </Badge>
      );
    case "coming_soon":
      return <Badge variant="secondary">Coming Soon</Badge>;
  }
}

function IntegrationCard({
  integration,
  onNavigateTab,
}: {
  integration: Integration;
  onNavigateTab?: (tab: string) => void;
}) {
  const Icon = integration.icon;

  const handleAction = () => {
    if (integration.actionTab && onNavigateTab) {
      onNavigateTab(integration.actionTab);
    }
  };

  return (
    <Card className="flex flex-col justify-between">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Icon className="h-5 w-5 text-muted-foreground" />
            </div>
            <CardTitle className="text-base">{integration.name}</CardTitle>
          </div>
          {statusBadge(integration.status)}
        </div>
        <CardDescription className="pt-1">
          {integration.description}
        </CardDescription>
      </CardHeader>

      <CardFooter>
        {integration.status === "coming_soon" ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="w-full">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled
                >
                  Coming Soon
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              This integration is not yet available.
            </TooltipContent>
          </Tooltip>
        ) : integration.actionTab ? (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleAction}
          >
            {integration.actionLabel ?? "Configure"}
          </Button>
        ) : integration.status === "connected" ? (
          <Button variant="outline" size="sm" className="w-full">
            Disconnect
          </Button>
        ) : (
          <Button variant="default" size="sm" className="w-full">
            Connect
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

export function IntegrationsManager({
  onNavigateTab,
}: IntegrationsManagerProps) {
  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Integrations</h2>
        <p className="text-sm text-muted-foreground">
          Connect your CRM with external tools and services.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {integrations.map((integration) => (
          <IntegrationCard
            key={integration.id}
            integration={integration}
            onNavigateTab={onNavigateTab}
          />
        ))}
      </div>

      <Separator />

      <WebhooksManager />
    </div>
  );
}
