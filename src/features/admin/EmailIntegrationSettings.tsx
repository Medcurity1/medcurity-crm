import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Mail, Loader2, Unlink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  EmailSyncConfig,
  type EmailSyncConfigState,
} from "./EmailSyncConfig";
import {
  useMyEmailConnections,
  useUpdateEmailConnection,
  useDisconnectEmailConnection,
  useMyEmailSyncRuns,
  useSyncEmailsNow,
  startOutlookConnect,
  type EmailSyncConnection,
  type EmailSyncConfigJson,
} from "./email-sync-api";

type Provider = "gmail" | "outlook";

const providerLabels: Record<Provider, string> = {
  gmail: "Gmail",
  outlook: "Outlook",
};

function jsonToUi(cfg: EmailSyncConfigJson): EmailSyncConfigState {
  return {
    logSent: cfg.log_sent,
    logReceived: cfg.log_received,
    primaryOnly: cfg.primary_only,
    autoLinkOpps: cfg.auto_link_opps,
  };
}

function uiToJson(cfg: EmailSyncConfigState): EmailSyncConfigJson {
  return {
    log_sent: cfg.logSent,
    log_received: cfg.logReceived,
    primary_only: cfg.primaryOnly,
    auto_link_opps: cfg.autoLinkOpps,
  };
}

function formatDateTime(value: string | null): string {
  if (!value) return "Never";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

// ---------------------------------------------------------------------------
// Connection card (one per provider row in email_sync_connections)
// ---------------------------------------------------------------------------

function ConnectedProviderCard({
  connection,
}: {
  connection: EmailSyncConnection;
}) {
  const updateConn = useUpdateEmailConnection();
  const disconnectConn = useDisconnectEmailConnection();
  const syncNow = useSyncEmailsNow();
  const label = providerLabels[connection.provider];

  function handleConfigChange(next: EmailSyncConfigState) {
    updateConn.mutate(
      { id: connection.id, config: uiToJson(next) },
      {
        onSuccess: () => toast.success("Sync settings saved"),
        onError: (err: Error) =>
          toast.error("Failed to save settings", { description: err.message }),
      }
    );
  }

  function handleDisconnect() {
    if (
      !confirm(
        `Disconnect ${label}? Future emails will not be logged until you reconnect.`
      )
    ) {
      return;
    }
    disconnectConn.mutate(connection.id, {
      onSuccess: () => toast.success(`${label} disconnected`),
      onError: (err: Error) =>
        toast.error("Failed to disconnect", { description: err.message }),
    });
  }

  function handleSyncNow() {
    syncNow.mutate(undefined, {
      onSuccess: (result) => {
        if (result.connections_processed === 0) {
          toast.info("No active connections to sync");
        } else if (result.activities_created > 0) {
          toast.success(
            `Sync complete — ${result.activities_created} new email${
              result.activities_created === 1 ? "" : "s"
            } logged`
          );
        } else {
          toast.success("Sync complete — no new emails matched a contact");
        }
      },
      onError: (err: Error) =>
        toast.error("Sync failed", { description: err.message }),
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Mail className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-base">{label}</CardTitle>
              {connection.email_address && (
                <CardDescription className="pt-1">
                  {connection.email_address}
                </CardDescription>
              )}
            </div>
          </div>
          <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
            Connected
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground pt-2">
          Last sync: {formatDateTime(connection.last_sync_at)}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <EmailSyncConfig
          config={jsonToUi(connection.config)}
          onChange={handleConfigChange}
          disabled={updateConn.isPending}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={handleSyncNow}
            disabled={syncNow.isPending}
          >
            {syncNow.isPending ? (
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-3 w-3" />
            )}
            Sync Now
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDisconnect}
            disabled={disconnectConn.isPending}
          >
            {disconnectConn.isPending ? (
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
            ) : (
              <Unlink className="mr-2 h-3 w-3" />
            )}
            Disconnect {label}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DisconnectedProviderCard({
  provider,
  onConnect,
  isPending,
}: {
  provider: Provider;
  onConnect: () => void;
  isPending: boolean;
}) {
  const label = providerLabels[provider];
  const supported = provider === "outlook";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Mail className="h-5 w-5 text-muted-foreground" />
            </div>
            <CardTitle className="text-base">{label}</CardTitle>
          </div>
          <Badge variant="secondary">Not Connected</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Button
          size="sm"
          className="w-full"
          onClick={onConnect}
          disabled={!supported || isPending}
        >
          {isPending ? (
            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
          ) : null}
          {supported ? `Connect ${label}` : `${label} (coming soon)`}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function EmailIntegrationSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: connections, isLoading } = useMyEmailConnections();
  const { data: runs } = useMyEmailSyncRuns(10);

  // Surface the OAuth callback result (success / error query-string) as a
  // toast, then strip it from the URL so reloads don't re-fire it.
  useEffect(() => {
    const outlook = searchParams.get("outlook");
    if (!outlook) return;
    if (outlook === "connected") {
      toast.success("Outlook connected successfully");
    } else if (outlook === "error") {
      const reason = searchParams.get("reason") ?? "unknown";
      toast.error("Outlook connection failed", {
        description: reason.replace(/_/g, " "),
      });
    }
    const next = new URLSearchParams(searchParams);
    next.delete("outlook");
    next.delete("reason");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const outlookConn = connections?.find((c) => c.provider === "outlook");
  const gmailConn = connections?.find((c) => c.provider === "gmail");

  async function handleConnectOutlook() {
    try {
      await startOutlookConnect();
    } catch (err) {
      toast.error("Failed to start Outlook connect", {
        description: (err as Error).message,
      });
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Email Integration</CardTitle>
          <CardDescription>
            Connect your email to automatically log emails to and from CRM
            contacts. Matching emails are attached to the contact, the account,
            and optionally the most recent open opportunity.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {outlookConn ? (
                <ConnectedProviderCard connection={outlookConn} />
              ) : (
                <DisconnectedProviderCard
                  provider="outlook"
                  onConnect={handleConnectOutlook}
                  isPending={false}
                />
              )}
              {gmailConn ? (
                <ConnectedProviderCard connection={gmailConn} />
              ) : (
                <DisconnectedProviderCard
                  provider="gmail"
                  onConnect={() =>
                    toast.info("Gmail OAuth not yet enabled", {
                      description:
                        "Contact your CRM admin to enable Gmail sync.",
                    })
                  }
                  isPending={false}
                />
              )}
            </div>
          )}

          <Separator />

          <div className="space-y-2">
            <h4 className="text-sm font-medium">How it works</h4>
            <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
              <li>Connect your email account</li>
              <li>
                A background job runs every 10 minutes, fetching new mail
              </li>
              <li>
                Emails matching a CRM contact's email address become logged
                activities on the contact and account
              </li>
              <li>Duplicate messages are skipped automatically</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      {runs && runs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent sync runs</CardTitle>
            <CardDescription>
              Most recent 10 background sync jobs for your connections.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Started</TableHead>
                    <TableHead className="text-right">Fetched</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="text-xs">
                        {formatDateTime(run.started_at)}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {run.emails_fetched}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {run.activities_created}
                      </TableCell>
                      <TableCell>
                        {run.error_message ? (
                          <Badge variant="destructive" className="text-xs">
                            Failed
                          </Badge>
                        ) : run.finished_at ? (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-xs">
                            Success
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            Running
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
