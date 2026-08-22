import { useMemo, useState } from "react";
import { Megaphone } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { QueryError } from "@/components/QueryError";
import {
  useAddCampaignRecipients, useCampaigns, type Recipient,
} from "./api";
import type { QuickCampaignContact } from "./QuickCampaignDialog";

function recipient(contact: QuickCampaignContact): Recipient | null {
  const email = contact.email?.trim();
  if (!email) return null;
  return {
    email,
    first_name: contact.first_name ?? "",
    last_name: contact.last_name ?? "",
    company_name: contact.account?.name ?? "",
    contact_id: contact.id,
    account_id: contact.account_id ?? undefined,
  };
}

export function AddToCampaignDialog({
  open,
  onOpenChange,
  contacts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contacts: QuickCampaignContact[];
}) {
  const campaigns = useCampaigns();
  const add = useAddCampaignRecipients();
  const [campaignId, setCampaignId] = useState("");
  const recipients = useMemo(
    () => contacts.map(recipient).filter((value): value is Recipient => !!value),
    [contacts],
  );
  const eligibleCampaigns = useMemo(
    () => (campaigns.data ?? []).filter((campaign) =>
      (campaign.status === "active" || campaign.status === "draft")
      && campaign.smartlead_campaign_id != null,
    ),
    [campaigns.data],
  );
  const missingEmail = contacts.length - recipients.length;

  function submit() {
    if (!campaignId || !recipients.length) return;
    add.mutate({ campaign_id: campaignId, recipients }, {
      onSuccess: (result) => {
        const excluded =
          result.suppression_dropped
          + result.active_elsewhere_dropped
          + result.already_in_campaign_dropped
          + result.duplicates_dropped
          + result.invalid_dropped
          + result.concurrent_dropped
          + result.smartlead_failed;
        toast.success(
          excluded
            ? `Added ${result.enrolled}. Kept ${excluded} ineligible or duplicate ${excluded === 1 ? "person" : "people"} out.`
            : `Added ${result.enrolled} ${result.enrolled === 1 ? "person" : "people"} to the campaign.`,
        );
        onOpenChange(false);
        setCampaignId("");
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="camp-scope camp-shell sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to a campaign</DialogTitle>
          <DialogDescription>
            Add these people to an existing draft or active campaign. Pulse checks eligibility and duplicates again before changing Smartlead.
          </DialogDescription>
        </DialogHeader>
        {campaigns.isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading campaigns…</p>
        ) : campaigns.isError ? (
          <QueryError message="Couldn't load campaigns." onRetry={() => campaigns.refetch()} />
        ) : !recipients.length ? (
          <EmptyState icon={Megaphone} title="No email on file" description="Add an email address before adding this contact to a campaign." />
        ) : !eligibleCampaigns.length ? (
          <EmptyState icon={Megaphone} title="No open campaigns" description="Start a new campaign first, then people can be added here." />
        ) : (
          <div className="space-y-3">
            {missingEmail > 0 && (
              <p className="text-xs text-amber-600">
                {missingEmail} selected {missingEmail === 1 ? "person has" : "people have"} no email and will stay out.
              </p>
            )}
            <Select value={campaignId} onValueChange={setCampaignId}>
              <SelectTrigger><SelectValue placeholder="Choose a campaign…" /></SelectTrigger>
              <SelectContent>
                {eligibleCampaigns.map((campaign) => (
                  <SelectItem key={campaign.id} value={campaign.id}>
                    {campaign.name} · {campaign.status === "active" ? "Active" : "Draft"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!campaignId || !recipients.length || add.isPending} onClick={submit}>
            {add.isPending ? "Adding…" : `Add ${recipients.length} ${recipients.length === 1 ? "person" : "people"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
