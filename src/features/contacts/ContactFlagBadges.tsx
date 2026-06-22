// Small inline badges for a contact's outreach flags (V3-B). Rendered next
// to the contact name in lists + on the detail header so an NLE / Do-Not-
// Call / Do-Not-Contact contact is visually unmistakable. Renders nothing
// when the contact has no flags, so it never adds clutter for the 95% of
// contacts with none.

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ContactFlags {
  no_longer_employed?: boolean | null;
  do_not_call?: boolean | null;
  do_not_contact?: boolean | null;
}

export function ContactFlagBadges({
  contact,
  className,
}: {
  contact: ContactFlags;
  className?: string;
}) {
  const nle = !!contact.no_longer_employed;
  const dnCall = !!contact.do_not_call;
  const dnContact = !!contact.do_not_contact;
  if (!nle && !dnCall && !dnContact) return null;

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1 align-middle", className)}>
      {nle && (
        <Badge
          variant="secondary"
          className="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
          title="No longer employed — excluded from outreach"
        >
          No longer employed
        </Badge>
      )}
      {dnCall && (
        <Badge
          variant="secondary"
          className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
          title="Do not call"
        >
          Do not call
        </Badge>
      )}
      {dnContact && (
        <Badge
          variant="secondary"
          className="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
          title="Do not contact"
        >
          Do not contact
        </Badge>
      )}
    </span>
  );
}
