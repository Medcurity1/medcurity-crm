import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  CheckCircle2,
  XCircle,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  FileText,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/formatters";
import { QueryError } from "@/components/QueryError";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PandaDocDocument {
  id: string;
  pandadoc_id: string;
  name: string;
  status: string;
  account_id: string | null;
  opportunity_id: string | null;
  contact_id: string | null;
  document_url: string | null;
  date_created: string | null;
  date_completed: string | null;
  created_at: string;
}

interface PandaDocConnection {
  id: string;
  provider: string;
  access_token: string | null;
  is_active: boolean;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function usePandaDocConnection() {
  return useQuery({
    queryKey: ["pandadoc_connection"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_sync_connections")
        .select("id, provider, access_token, is_active")
        .eq("provider", "pandadoc")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as PandaDocConnection | null;
    },
  });
}

function useRecentDocuments() {
  return useQuery({
    queryKey: ["pandadoc_recent_documents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pandadoc_documents")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as PandaDocDocument[];
    },
  });
}

function useSaveApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ apiKey, existingId }: { apiKey: string; existingId?: string }) => {
      if (existingId) {
        const { error } = await supabase
          .from("email_sync_connections")
          .update({ access_token: apiKey, is_active: true })
          .eq("id", existingId);
        if (error) throw error;
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");
        const { error } = await supabase
          .from("email_sync_connections")
          .insert({
            user_id: user.id,
            provider: "pandadoc",
            access_token: apiKey,
            is_active: true,
            config: {},
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pandadoc_connection"] });
      toast.success("PandaDoc API key saved");
    },
    onError: (err: Error) => {
      toast.error("Failed to save API key", { description: err.message });
    },
  });
}

function useTestConnection() {
  return useMutation({
    mutationFn: async (apiKey: string) => {
      // Call the PandaDoc API to verify the key works
      const res = await fetch("https://api.pandadoc.com/public/v1/documents?count=1", {
        headers: {
          Authorization: `API-Key ${apiKey}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`PandaDoc API returned ${res.status}: ${text}`);
      }
      return true;
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatStatus(status: string): string {
  // Convert "document.completed" to "Completed"
  return status
    .replace("document.", "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status.includes("completed")) return "default";
  if (status.includes("sent") || status.includes("viewed")) return "secondary";
  if (status.includes("declined") || status.includes("voided")) return "destructive";
  return "outline";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PandaDocSettings() {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);

  const { data: connection, isLoading: loadingConnection } = usePandaDocConnection();
  const {
    data: documents,
    isLoading: loadingDocuments,
    isError: documentsError,
    isFetching: documentsFetching,
    refetch: refetchDocuments,
  } = useRecentDocuments();
  const saveApiKey = useSaveApiKey();
  const testConnection = useTestConnection();

  const isConnected = connection?.is_active && connection?.access_token;
  const webhookUrl = `${env.supabaseUrl}/functions/v1/pandadoc-sync`;

  function handleSaveApiKey() {
    if (!apiKeyInput.trim()) {
      toast.error("Please enter an API key");
      return;
    }
    saveApiKey.mutate({ apiKey: apiKeyInput.trim(), existingId: connection?.id });
    setApiKeyInput("");
  }

  function handleTestConnection() {
    const key = apiKeyInput.trim() || connection?.access_token;
    if (!key) {
      toast.error("No API key to test");
      return;
    }
    testConnection.mutate(key, {
      onSuccess: () => toast.success("PandaDoc connection verified"),
      onError: (err: Error) =>
        toast.error("Connection test failed", { description: err.message }),
    });
  }

  function handleCopyWebhookUrl() {
    navigator.clipboard.writeText(webhookUrl);
    toast.success("Webhook URL copied to clipboard");
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <FileText className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <CardTitle>PandaDoc Integration</CardTitle>
              <CardDescription>
                Sync contracts and proposals. Auto-populate contract dates when
                documents are signed.
              </CardDescription>
            </div>
          </div>
          {isConnected ? (
            <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              Connected
            </Badge>
          ) : (
            <Badge variant="secondary">
              <XCircle className="mr-1 h-3 w-3" />
              Not Connected
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* API Key Configuration */}
        <div className="space-y-3">
          <Label htmlFor="pandadoc-api-key" className="text-sm font-medium">
            API Key
          </Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id="pandadoc-api-key"
                type={showApiKey ? "text" : "password"}
                placeholder={isConnected ? "********** (key saved)" : "Enter your PandaDoc API key"}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
              />
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
            <Button
              variant="outline"
              onClick={handleSaveApiKey}
              disabled={saveApiKey.isPending || !apiKeyInput.trim()}
            >
              {saveApiKey.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Save"
              )}
            </Button>
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={testConnection.isPending}
            >
              {testConnection.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Test"
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Find your API key in PandaDoc under Settings &gt; API &gt; API Key.
          </p>
        </div>

        <Separator />

        {/* Webhook URL */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Webhook URL</Label>
          <div className="flex gap-2">
            <Input
              readOnly
              value={webhookUrl}
              className="font-mono text-xs"
            />
            <Button variant="outline" size="sm" onClick={handleCopyWebhookUrl}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Copy this URL into PandaDoc under Settings &gt; Integrations &gt;
            Webhooks. Subscribe to the <strong>document_state_changed</strong>{" "}
            event.
          </p>
        </div>

        <Separator />

        {/* How it works */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium">How it works</h4>
          <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
            <li>Add your PandaDoc API key above</li>
            <li>Copy the webhook URL into PandaDoc settings</li>
            <li>
              When a document is signed, the CRM automatically updates contract
              dates on the matched account and opportunity
            </li>
            <li>
              An activity record is created to track the signing event
            </li>
          </ol>
        </div>

        <Separator />

        {/* Recent sync history */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Recent Synced Documents</h4>
          {loadingDocuments || loadingConnection ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : documentsError ? (
            <QueryError
              compact
              message="Couldn't load synced documents."
              onRetry={() => refetchDocuments()}
              isRetrying={documentsFetching}
            />
          ) : documents && documents.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Completed</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell className="font-medium">{doc.name}</TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(doc.status)}>
                          {formatStatus(doc.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {doc.date_completed
                          ? formatDate(doc.date_completed)
                          : "--"}
                      </TableCell>
                      <TableCell>
                        {doc.document_url && (
                          <a
                            href={doc.document_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No documents synced yet. Documents will appear here once PandaDoc
              sends webhook events.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
