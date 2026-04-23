import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import {
  Pencil,
  ArrowLeft,
  Mail,
  Phone,
  Calendar,
  StickyNote,
  CheckSquare,
  CheckCircle2,
  Clock,
  Reply,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Activity } from "@/types/crm";

// Extended shape with joined related records — used only in this
// detail page, so local instead of polluting the global Activity
// interface with optional relations.
interface ActivityWithRelations extends Activity {
  account?: { id: string; name: string } | null;
  contact?: { id: string; first_name: string | null; last_name: string | null } | null;
  opportunity?: { id: string; name: string } | null;
  lead?: { id: string; first_name: string | null; last_name: string | null; company: string | null } | null;
}
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityForm } from "./ActivityForm";
import { activityLabel, formatDate, formatRelativeDate } from "@/lib/formatters";

/**
 * Full-page view for a single activity. Addresses the user complaint
 * that "clicking an email in the timeline just expands inline — I
 * want a dedicated page like SF shows."
 *
 * For emails with a visible quoted history in the body, the
 * parseEmailChain helper below splits the text into collapsible
 * message cards so the "wall of text" quoted chain is navigable.
 */
export function ActivityDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);

  const { data: activity, isLoading } = useQuery({
    queryKey: ["activities", id],
    queryFn: async () => {
      if (!id) throw new Error("Missing activity id");
      const { data, error } = await supabase
        .from("activities")
        .select(
          "*, " +
          "account:accounts!account_id(id, name), " +
          "contact:contacts!contact_id(id, first_name, last_name), " +
          "opportunity:opportunities!opportunity_id(id, name), " +
          "lead:leads!lead_id(id, first_name, last_name, company), " +
          "owner:user_profiles!owner_user_id(id, full_name)"
        )
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as unknown as ActivityWithRelations;
    },
    enabled: !!id,
  });

  // Parse quoted email chain out of the body so reps see individual
  // messages instead of one wall of text. Only runs for email-type
  // activities — other types (call notes, etc.) just render the body.
  const chain = useMemo(() => {
    if (!activity || activity.activity_type !== "email" || !activity.body) return null;
    return parseEmailChain(activity.body);
  }, [activity]);

  if (isLoading || !activity) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const Icon =
    activity.activity_type === "call" ? Phone :
    activity.activity_type === "email" ? Mail :
    activity.activity_type === "meeting" ? Calendar :
    activity.activity_type === "note" ? StickyNote :
    CheckSquare;

  return (
    <div>
      <div className="mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
      </div>

      <PageHeader
        title={activity.subject}
        description={activityLabel(activity.activity_type)}
        actions={
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-1" />
            Edit
          </Button>
        }
      />

      {/* Meta row — who, when, what it's attached to */}
      <Card className="mb-4">
        <CardContent className="px-4 py-3 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{activityLabel(activity.activity_type)}</span>
            {activity.completed_at && (
              <span className="inline-flex items-center gap-1 text-emerald-600 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Completed {formatDate(activity.completed_at)}
              </span>
            )}
          </div>
          {activity.owner?.full_name && (
            <div className="text-muted-foreground">
              Owner: <span className="text-foreground">{activity.owner.full_name}</span>
            </div>
          )}
          {activity.due_at && (
            <div className="text-muted-foreground inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> Due {formatDate(activity.due_at)}
            </div>
          )}
          <div className="text-muted-foreground">
            Created {formatRelativeDate(activity.created_at)} ·{" "}
            {formatDate(activity.created_at)}
          </div>
          {/* Related record links */}
          <div className="flex flex-wrap gap-3 pt-2 border-t text-xs">
            {activity.account && (
              <RelatedLink label="Account" to={`/accounts/${activity.account.id}`} name={activity.account.name} />
            )}
            {activity.contact && (
              <RelatedLink
                label="Contact"
                to={`/contacts/${activity.contact.id}`}
                name={`${activity.contact.first_name ?? ""} ${activity.contact.last_name ?? ""}`.trim()}
              />
            )}
            {activity.lead && (
              <RelatedLink
                label="Lead"
                to={`/leads/${activity.lead.id}`}
                name={`${activity.lead.first_name ?? ""} ${activity.lead.last_name ?? ""}`.trim() || activity.lead.company || ""}
              />
            )}
            {activity.opportunity && (
              <RelatedLink
                label="Opportunity"
                to={`/opportunities/${activity.opportunity.id}`}
                name={activity.opportunity.name}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Email headers + HTML body (when we have structured data) */}
      {activity.activity_type === "email" && (activity.email_from || (activity.email_to?.length ?? 0) > 0) && (
        <Card className="mb-4">
          <CardContent className="px-4 py-3 space-y-1 text-sm">
            {activity.email_from && (
              <div><span className="text-muted-foreground">From:</span> {activity.email_from}</div>
            )}
            {activity.email_to && activity.email_to.length > 0 && (
              <div><span className="text-muted-foreground">To:</span> {activity.email_to.join(", ")}</div>
            )}
            {activity.email_cc && activity.email_cc.length > 0 && (
              <div><span className="text-muted-foreground">Cc:</span> {activity.email_cc.join(", ")}</div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Structured HTML body (live Outlook-synced emails) */}
      {activity.email_html_body && (
        <Card className="mb-4">
          <CardContent className="p-0">
            <iframe
              title="Email body"
              sandbox=""
              srcDoc={activity.email_html_body}
              className="w-full min-h-[500px] bg-background border-0 rounded-lg"
            />
          </CardContent>
        </Card>
      )}

      {/* Parsed email chain OR plain body */}
      {!activity.email_html_body && chain && chain.length > 1 ? (
        <div className="space-y-2">
          {chain.map((msg, i) => (
            <EmailMessageCard key={i} message={msg} defaultOpen={i === 0} />
          ))}
        </div>
      ) : activity.body ? (
        <Card>
          <CardContent className="px-4 py-3">
            <pre className="whitespace-pre-wrap break-words font-sans text-sm text-foreground">
              {activity.body}
            </pre>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="px-4 py-6 text-sm text-muted-foreground italic">
            No body captured for this activity.
          </CardContent>
        </Card>
      )}

      {/* Reply button for emails */}
      {activity.activity_type === "email" && (activity.email_from || (activity.email_to?.length ?? 0) > 0) && (
        <div className="mt-4">
          <Button asChild>
            <a
              href={buildMailto(activity)}
            >
              <Reply className="h-4 w-4 mr-1" />
              Reply
            </a>
          </Button>
        </div>
      )}

      {editOpen && (
        <ActivityForm
          open={editOpen}
          onOpenChange={setEditOpen}
          activity={activity}
        />
      )}
    </div>
  );
}

function RelatedLink({ label, to, name }: { label: string; to: string; name: string }) {
  if (!name) return null;
  return (
    <span>
      <span className="text-muted-foreground">{label}:</span>{" "}
      <Link to={to} className="text-primary hover:underline">{name}</Link>
    </span>
  );
}

/* ===== Email chain parser =====
 *
 * SF-imported emails arrive as a single body string with the quoted
 * reply history appended as plain text. Typical shape:
 *
 *   Hey Marz,
 *   Thanks for the update...
 *
 *   From: Summer Hume <summer@...>
 *   Sent: Monday, May 12, 2025 1:54 PM
 *   To: Marz Cesarini <marz@...>
 *   Subject: RE: Strengthening Your Security Approach
 *
 *   Hi Marz, Hope the week...
 *
 * We split on the "From: ... Sent: ... Subject:" marker set and
 * return an array of { header, body } message objects.
 */

interface ParsedEmailMessage {
  header: {
    from?: string;
    sent?: string;
    to?: string;
    subject?: string;
  };
  body: string;
}

function parseEmailChain(text: string): ParsedEmailMessage[] {
  // Break points: look for "From: ..." where a following "Sent:" or
  // "Subject:" appears within ~200 chars. This is the classic Outlook
  // / SF reply-quoting format.
  const lines = text.split(/\r?\n/);
  const breakIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^From:\s*\S/.test(line)) {
      // Look ahead 6 lines for Sent: / Subject: — confirms this is a
      // forwarded-header marker, not just the word "From:" in content.
      const window = lines.slice(i, i + 6).join(" ");
      if (/Sent:/i.test(window) || /Subject:/i.test(window) || /To:/i.test(window)) {
        breakIndices.push(i);
      }
    }
  }

  if (breakIndices.length === 0) {
    return [{ header: {}, body: text }];
  }

  const messages: ParsedEmailMessage[] = [];
  // First message = everything before the first break
  const firstBody = lines.slice(0, breakIndices[0]).join("\n").trim();
  if (firstBody) messages.push({ header: {}, body: firstBody });

  for (let b = 0; b < breakIndices.length; b++) {
    const start = breakIndices[b];
    const end = b + 1 < breakIndices.length ? breakIndices[b + 1] : lines.length;
    const block = lines.slice(start, end);
    // Pull From/Sent/To/Subject off the top of the block
    const header: ParsedEmailMessage["header"] = {};
    let bodyStart = 0;
    for (let i = 0; i < Math.min(10, block.length); i++) {
      const l = block[i];
      const fromM = l.match(/^From:\s*(.+)/i);
      const sentM = l.match(/^Sent:\s*(.+)/i);
      const toM   = l.match(/^To:\s*(.+)/i);
      const subjM = l.match(/^Subject:\s*(.+)/i);
      if (fromM) header.from = fromM[1].trim();
      else if (sentM) header.sent = sentM[1].trim();
      else if (toM) header.to = toM[1].trim();
      else if (subjM) { header.subject = subjM[1].trim(); bodyStart = i + 1; break; }
      else if (l.trim() === "") { bodyStart = i + 1; break; }
      bodyStart = i + 1;
    }
    const body = block.slice(bodyStart).join("\n").trim();
    messages.push({ header, body });
  }
  return messages;
}

function EmailMessageCard({ message, defaultOpen }: { message: ParsedEmailMessage; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const hasHeader = message.header.from || message.header.sent || message.header.subject;
  const bodyPreview = message.body.slice(0, 140).replace(/\s+/g, " ");

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-4 py-3 hover:bg-muted/40"
      >
        <div className="flex items-start gap-2">
          {open ? <ChevronDown className="h-4 w-4 mt-0.5 shrink-0" /> : <ChevronRight className="h-4 w-4 mt-0.5 shrink-0" />}
          <div className="flex-1 min-w-0">
            {hasHeader ? (
              <>
                <div className="text-sm font-medium truncate">
                  {message.header.from ?? "(no sender)"}
                  {message.header.subject && (
                    <span className="text-muted-foreground font-normal"> · {message.header.subject}</span>
                  )}
                </div>
                {message.header.sent && (
                  <div className="text-xs text-muted-foreground">{message.header.sent}</div>
                )}
                {message.header.to && (
                  <div className="text-xs text-muted-foreground truncate">To: {message.header.to}</div>
                )}
              </>
            ) : (
              <div className="text-sm font-medium">Message</div>
            )}
            {!open && bodyPreview && (
              <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                {bodyPreview}
              </div>
            )}
          </div>
        </div>
      </button>
      {open && message.body && (
        <CardContent className="px-4 pb-3 pt-0 border-t">
          <pre className="whitespace-pre-wrap break-words font-sans text-sm text-foreground mt-2">
            {message.body}
          </pre>
        </CardContent>
      )}
    </Card>
  );
}

function buildMailto(activity: Activity): string {
  const to = activity.email_direction === "received" && activity.email_from
    ? [activity.email_from]
    : activity.email_to ?? [];
  const subject = activity.subject.match(/^re:\s*/i) ? activity.subject : `Re: ${activity.subject}`;
  return `mailto:${encodeURIComponent(to.join(","))}?subject=${encodeURIComponent(subject)}`;
}
