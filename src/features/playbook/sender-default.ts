export type SenderAccount = {
  id: number;
  from_email?: string;
  from_name?: string;
};

type SenderDefault = {
  accountId: number;
  expectedEmail: string;
  shared?: boolean;
};

// Production identities and Smartlead account IDs were resolved together on
// launch night. IDs are pinned so Summer's legacy medcurityco.com mailbox can
// never win by list ordering or a fuzzy name match.
const DEFAULTS_BY_USER_EMAIL: Record<string, SenderDefault> = {
  "joeg@medcurity.com": {
    accountId: 3657983,
    expectedEmail: "joeg@medcurity.com",
  },
  "mollym@medcurity.com": {
    accountId: 7145804,
    expectedEmail: "mollym@medcurity.com",
  },
  "summerh@medcurity.com": {
    accountId: 2955119,
    expectedEmail: "summerh@medcurity.com",
  },
  // Nathan and Jordan use the approved shared sender. Smartlead's
  // authoritative account name is "Medcurity News".
  "nathang@medcurity.com": {
    accountId: 20367956,
    expectedEmail: "news@accessmedcurity.com",
    shared: true,
  },
  "jordanm@medcurity.com": {
    accountId: 20367956,
    expectedEmail: "news@accessmedcurity.com",
    shared: true,
  },
};

export function defaultSenderForUser(
  userEmail: string | null | undefined,
  accounts: SenderAccount[],
): SenderAccount | null {
  const mapping = DEFAULTS_BY_USER_EMAIL[(userEmail ?? "").trim().toLowerCase()];
  if (!mapping) return null;
  return accounts.find((account) =>
    account.id === mapping.accountId
    && (account.from_email ?? "").trim().toLowerCase() === mapping.expectedEmail,
  ) ?? null;
}

export function senderDisplayLabel(account: SenderAccount): string {
  const email = account.from_email?.trim();
  const name = account.from_name?.trim();
  const shared =
    account.id === 20367956 && email?.toLowerCase() === "news@accessmedcurity.com";
  if (shared) return `Medcurity News (shared) · ${email}`;
  if (name && email) return `${name} · ${email}`;
  return email || name || `Inbox ${account.id}`;
}
