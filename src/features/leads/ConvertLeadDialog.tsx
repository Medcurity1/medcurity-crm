import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useConvertLead } from "./api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import type { Lead } from "@/types/crm";

interface ConvertLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead;
}

export function ConvertLeadDialog({ open, onOpenChange, lead }: ConvertLeadDialogProps) {
  const navigate = useNavigate();
  const convertMutation = useConvertLead();

  const [accountName, setAccountName] = useState(lead.company ?? `${lead.first_name} ${lead.last_name}`);
  const [firstName, setFirstName] = useState(lead.first_name);
  const [lastName, setLastName] = useState(lead.last_name);
  const [createOpportunity, setCreateOpportunity] = useState(true);
  const [opportunityName, setOpportunityName] = useState(
    `${lead.company ?? lead.last_name} - New Business`
  );
  const [opportunityAmount, setOpportunityAmount] = useState<string>("");
  const [opportunityStage, setOpportunityStage] = useState("lead");

  async function handleConvert() {
    try {
      const result = await convertMutation.mutateAsync({
        leadId: lead.id,
        accountName,
        firstName,
        lastName,
        email: lead.email,
        phone: lead.phone,
        title: lead.title,
        industry: lead.industry,
        website: lead.website,
        street: lead.street,
        city: lead.city,
        state: lead.state,
        zip: lead.zip,
        country: lead.country,
        createOpportunity,
        opportunityName: createOpportunity ? opportunityName : undefined,
        opportunityAmount: createOpportunity && opportunityAmount
          ? Number(opportunityAmount)
          : undefined,
        opportunityStage: createOpportunity ? opportunityStage : undefined,
      });
      toast.success("Lead converted successfully");
      onOpenChange(false);
      navigate(`/accounts/${result.account.id}`);
    } catch (err) {
      toast.error("Failed to convert lead: " + (err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Convert Lead</DialogTitle>
          <DialogDescription>
            Convert this lead into an Account, Contact, and optionally an Opportunity.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Account */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Account
            </h4>
            <div className="space-y-2">
              <Label htmlFor="convert_account_name">Account Name *</Label>
              <Input
                id="convert_account_name"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
              />
            </div>
          </div>

          {/* Contact */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Contact
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="convert_first_name">First Name *</Label>
                <Input
                  id="convert_first_name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="convert_last_name">Last Name *</Label>
                <Input
                  id="convert_last_name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Opportunity */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="create_opportunity"
                checked={createOpportunity}
                onCheckedChange={(v) => setCreateOpportunity(v === true)}
              />
              <Label htmlFor="create_opportunity" className="text-sm font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer">
                Create Opportunity
              </Label>
            </div>

            {createOpportunity && (
              <div className="space-y-4 pl-6 border-l-2 border-muted">
                <div className="space-y-2">
                  <Label htmlFor="convert_opp_name">Opportunity Name</Label>
                  <Input
                    id="convert_opp_name"
                    value={opportunityName}
                    onChange={(e) => setOpportunityName(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="convert_opp_amount">Amount</Label>
                    <Input
                      id="convert_opp_amount"
                      type="number"
                      step="0.01"
                      value={opportunityAmount}
                      onChange={(e) => setOpportunityAmount(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Stage</Label>
                    <Select value={opportunityStage} onValueChange={setOpportunityStage}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lead">Lead</SelectItem>
                        <SelectItem value="qualified">Qualified</SelectItem>
                        <SelectItem value="proposal">Proposal</SelectItem>
                        <SelectItem value="verbal_commit">Verbal Commit</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleConvert}
            disabled={!accountName || !firstName || !lastName || convertMutation.isPending}
          >
            {convertMutation.isPending ? "Converting..." : "Convert Lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
