import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Phone, Mail, Calendar, StickyNote, CheckSquare, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeDate } from "@/lib/formatters";
import type { ActivityType } from "@/types/crm";

interface TeamActivity {
  id: string;
  activity_type: ActivityType;
  subject: string;
  created_at: string;
  account_id: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
  owner: { full_name: string | null } | null;
  account: { name: string } | null;
  contact: { first_name: string | null; last_name: string | null } | null;
  opportunity: { name: string } | null;
}

function activityIcon(type: ActivityType) {
  switch (type) {
    case "call":
      return Phone;
    case "email":
      return Mail;
    case "meeting":
      return Calendar;
    case "note":
      return StickyNote;
    case "task":
      return CheckSquare;
    default:
      return Users;
  }
}

function actionVerb(type: ActivityType): string {
  switch (type) {
    case "call":
      return "logged a call";
    case "email":
      return "sent an email";
    case "meeting":
      return "logged a meeting";
    case "note":
      return "added a note";
    case "task":
      return "created a task";
    default:
      return "added an activity";
  }
}

function relatedLabel(a: TeamActivity): { text: string; href: string } | null {
  if (a.opportunity && a.opportunity_id) {
    return { text: a.opportunity.name, href: `/opportunities/${a.opportunity_id}` };
  }
  if (a.contact && a.contact_id) {
    const name = `${a.contact.first_name ?? ""} ${a.contact.last_name ?? ""}`.trim();
    return { text: name || "Contact", href: `/contacts/${a.contact_id}` };
  }
  if (a.account && a.account_id) {
    return { text: a.account.name, href: `/accounts/${a.account_id}` };
  }
  return null;
}

export function TeamActivityFeed() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", "team-activity-feed"],
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("activities")
        .select(
          "id, activity_type, subject, created_at, account_id, contact_id, opportunity_id, owner:user_profiles!owner_user_id(full_name), account:accounts(name), contact:contacts(first_name, last_name), opportunity:opportunities(name)",
        )
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(15);
      if (error) throw error;
      return (rows ?? []) as unknown as TeamActivity[];
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          Team Activity Feed
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3">
                <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                <div className="space-y-1.5 flex-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : !data?.length ? (
          <p className="text-sm text-muted-foreground">No recent team activity.</p>
        ) : (
          <div className="space-y-4">
            {data.map((a) => {
              const Icon = activityIcon(a.activity_type);
              const related = relatedLabel(a);
              const ownerName = a.owner?.full_name ?? "Someone";
              return (
                <div key={a.id} className="flex items-start gap-3">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">
                      <span className="font-medium">{ownerName}</span>{" "}
                      <span className="text-muted-foreground">
                        {actionVerb(a.activity_type)}
                      </span>
                      {related && (
                        <>
                          {" "}
                          <span className="text-muted-foreground">with</span>{" "}
                          <Link
                            to={related.href}
                            className="font-medium text-primary hover:underline"
                          >
                            {related.text}
                          </Link>
                        </>
                      )}
                    </p>
                    {a.subject && (
                      <p className="text-xs text-muted-foreground truncate">
                        {a.subject}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatRelativeDate(a.created_at)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
