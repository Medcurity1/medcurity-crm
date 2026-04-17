import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export interface EmailSyncConfigState {
  logSent: boolean;
  logReceived: boolean;
  primaryOnly: boolean;
  autoLinkOpps: boolean;
}

interface EmailSyncConfigProps {
  config: EmailSyncConfigState;
  onChange: (config: EmailSyncConfigState) => void;
  disabled?: boolean;
}

export const defaultEmailSyncConfig: EmailSyncConfigState = {
  logSent: true,
  logReceived: true,
  primaryOnly: false,
  autoLinkOpps: true,
};

export function EmailSyncConfig({
  config,
  onChange,
  disabled = false,
}: EmailSyncConfigProps) {
  function toggle(key: keyof EmailSyncConfigState) {
    onChange({ ...config, [key]: !config[key] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="log-sent" className="flex-1 cursor-pointer">
          <div>
            <p className="text-sm font-medium">Log sent emails</p>
            <p className="text-xs text-muted-foreground">
              Record outbound emails sent to CRM contacts
            </p>
          </div>
        </Label>
        <Switch
          id="log-sent"
          checked={config.logSent}
          onCheckedChange={() => toggle("logSent")}
          disabled={disabled}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="log-received" className="flex-1 cursor-pointer">
          <div>
            <p className="text-sm font-medium">Log received emails</p>
            <p className="text-xs text-muted-foreground">
              Record inbound emails received from CRM contacts
            </p>
          </div>
        </Label>
        <Switch
          id="log-received"
          checked={config.logReceived}
          onCheckedChange={() => toggle("logReceived")}
          disabled={disabled}
        />
      </div>

      {/* "Primary-only" toggle removed per Brayden 2026-04-17 — reps wanted
          emails to log for every contact on the account, not just the one
          marked primary. The field stays in the DB config in case we bring
          it back, but is no longer surfaced in the UI. */}

      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="auto-link-opps" className="flex-1 cursor-pointer">
          <div>
            <p className="text-sm font-medium">Auto-link to opportunities</p>
            <p className="text-xs text-muted-foreground">
              Automatically associate logged emails with open opportunities on
              the same account
            </p>
          </div>
        </Label>
        <Switch
          id="auto-link-opps"
          checked={config.autoLinkOpps}
          onCheckedChange={() => toggle("autoLinkOpps")}
          disabled={disabled}
        />
      </div>

      {disabled && (
        <p className="text-xs text-muted-foreground italic pt-2">
          Requires Edge Function deployment to take effect.
        </p>
      )}
    </div>
  );
}
