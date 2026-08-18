import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Check,
  Flag,
  Loader2,
  Mail,
  MapPin,
  Phone,
  ClipboardCheck,
  UserPlus,
  Users,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PhoneInput } from "@/components/PhoneInput";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useAccount, useUpdateAccount, useUsers } from "@/features/accounts/api";
import { useCreateContact, useUpdateContact } from "@/features/contacts/api";
import { useUpdateOpportunity } from "./api";
import {
  checkCloseReadiness,
  CLOSE_READINESS_KEYS,
  type CloseReadinessKey,
  type CloseReadinessOpportunity,
} from "@/lib/closeReadiness";
import { FTE_RANGES, formatCurrency } from "@/lib/formatters";
import { US_STATES } from "@/lib/us-states";
import { looksLikeUsZip, zipToState } from "@/lib/us-zip";
import { useDialogDiscardGuard } from "@/hooks/useDialogDiscardGuard";

/**
 * The Finish Line dialog (Molly, 2026-08-12).
 *
 * Molly's words: trying to mark a deal Closed Won, the close-readiness gate
 * points at missing ACCOUNT fields, and fixing them means cancelling her
 * in-flight work, hunting the account page, and retrying until the toast
 * stops. This dialog inverts that: when a close is blocked, every missing
 * item becomes an inline field RIGHT HERE. She fills them, one button saves
 * everything to the right records, the gate re-verifies server-side, and the
 * deal closes. Nothing she was doing is lost, and she never leaves the page.
 *
 * Contract with the four close surfaces (board drag, list inline stage,
 * detail stage bar, edit form):
 *   - The surface runs checkCloseReadiness as before. On a block WITH
 *     missingKeys it opens this dialog instead of toasting. (A block with
 *     no keys is a load failure the dialog can't fix. Keep toasting.)
 *   - onComplete fires only after every fix is saved AND the gate re-ran
 *     green server-side. The surface then commits the close itself (mutate
 *     to closed_won, or re-submit the form). Throwing from onComplete puts
 *     the dialog back in an editable state.
 *   - The dialog closes only via onDismiss (user backed out) or the surface
 *     clearing `request` after its commit succeeds.
 *
 * The assigned-assessor fix is the one deal-side field: when `opportunity`
 * is an id the fix is saved onto the deal row directly; when it is the
 * form's in-flight values object the chosen assessor is handed back through
 * onComplete so the FORM owns writing it (the row may not even exist yet).
 */
export interface FinishLineRequest {
  accountId: string;
  accountName?: string | null;
  missingKeys: CloseReadinessKey[];
  dealName: string;
  amount?: number | null;
  /** Opp id (inline surfaces) or the form's in-flight values. Feeds the
   *  final server-side re-verification and the assessor fix. */
  opportunity?: string | CloseReadinessOpportunity | null;
}

interface FinishLineDialogProps {
  request: FinishLineRequest | null;
  /** User backed out (Not now, X, Escape, overlay). Never fires mid-save. */
  onDismiss: () => void;
  /** All gaps saved + re-verified. Commit the close and clear `request`. */
  onComplete: (result: { assessorId: string | null }) => Promise<void> | void;
}

const EMAIL_RE = /^\S+@\S+\.\S+$/;

function isFilled(v: string): boolean {
  return v.trim() !== "";
}

export function FinishLineDialog({ request, onDismiss, onComplete }: FinishLineDialogProps) {
  const open = !!request;
  const accountId = request?.accountId;

  // ----- data ---------------------------------------------------------
  const { data: account } = useAccount(open ? accountId : undefined);
  const needsEmail = !!request?.missingKeys.includes("contact_email");
  const { data: contacts, isLoading: contactsLoading } = useQuery({
    queryKey: ["finish-line-contacts", accountId],
    enabled: open && needsEmail && !!accountId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("id, first_name, last_name, title, email, is_primary")
        .eq("account_id", accountId!)
        .is("archived_at", null)
        .order("is_primary", { ascending: false })
        .order("first_name");
      if (error) throw error;
      return data as {
        id: string;
        first_name: string;
        last_name: string;
        title: string | null;
        email: string | null;
        is_primary: boolean;
      }[];
    },
  });
  const { data: users } = useUsers();

  const updateAccount = useUpdateAccount();
  const updateContact = useUpdateContact();
  const createContact = useCreateContact();
  const updateOpportunity = useUpdateOpportunity();

  // ----- field state --------------------------------------------------
  // `activeKeys` starts as the blocking set and only changes if the final
  // re-verification surfaces something new (a teammate edited concurrently).
  const [activeKeys, setActiveKeys] = useState<CloseReadinessKey[]>([]);
  const [phone, setPhone] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [zip, setZip] = useState("");
  const [fteRange, setFteRange] = useState("");
  const [contactMode, setContactMode] = useState<"existing" | "new">("existing");
  const [contactId, setContactId] = useState<string | null>(null);
  const [contactEmail, setContactEmail] = useState("");
  const [newFirst, setNewFirst] = useState("");
  const [newLast, setNewLast] = useState("");
  const [assessorId, setAssessorId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const sectionsRef = useRef<HTMLDivElement | null>(null);

  // Reset everything for each fresh block, then let the seeding effects
  // below fill in whatever the account already has (a half-typed address
  // should start half-typed, not blank).
  const seededAccount = useRef<string | null>(null);
  const seededContacts = useRef<string | null>(null);
  // Discard-guard baseline: what the fields looked like right after
  // seeding, before any edit. The seed effects below write here alongside
  // their setState calls, so `dirty` (below) can tell "this field still
  // shows what the account already had" apart from "Molly typed this."
  const baselineRef = useRef({
    phone: "",
    street: "",
    city: "",
    stateCode: "",
    zip: "",
    fteRange: "",
    contactMode: "existing" as "existing" | "new",
    contactId: null as string | null,
    contactEmail: "",
  });
  useEffect(() => {
    if (!request) return;
    setActiveKeys(request.missingKeys);
    setPhone("");
    setStreet("");
    setCity("");
    setStateCode("");
    setZip("");
    setFteRange("");
    setContactMode("existing");
    setContactId(null);
    setContactEmail("");
    setNewFirst("");
    setNewLast("");
    setAssessorId(null);
    setBusy(false);
    setDone(false);
    seededAccount.current = null;
    seededContacts.current = null;
    baselineRef.current = {
      phone: "",
      street: "",
      city: "",
      stateCode: "",
      zip: "",
      fteRange: "",
      contactMode: "existing",
      contactId: null,
      contactEmail: "",
    };
  }, [request]);

  useEffect(() => {
    if (!open || !account || !accountId || seededAccount.current === accountId) return;
    seededAccount.current = accountId;
    const seeded = {
      phone: (account.phone as string | null) ?? "",
      street: (account.billing_street as string | null) ?? "",
      city: (account.billing_city as string | null) ?? "",
      stateCode: (account.billing_state as string | null) ?? "",
      zip: (account.billing_zip as string | null) ?? "",
      fteRange: (account.fte_range as string | null) ?? "",
    };
    setPhone(seeded.phone);
    setStreet(seeded.street);
    setCity(seeded.city);
    setStateCode(seeded.stateCode);
    setZip(seeded.zip);
    setFteRange(seeded.fteRange);
    baselineRef.current = { ...baselineRef.current, ...seeded };
  }, [open, account, accountId]);

  useEffect(() => {
    if (!open || !needsEmail || !contacts || seededContacts.current === accountId) return;
    seededContacts.current = accountId ?? null;
    if (contacts.length === 0) {
      setContactMode("new");
      baselineRef.current = { ...baselineRef.current, contactMode: "new" };
    } else {
      // The gate only fires this section when NO contact has an email, so
      // preselecting the primary (or first) is who Molly would fix anyway.
      const primary = contacts.find((c) => c.is_primary) ?? contacts[0];
      setContactId(primary.id);
      setContactEmail(primary.email ?? "");
      baselineRef.current = {
        ...baselineRef.current,
        contactId: primary.id,
        contactEmail: primary.email ?? "",
      };
    }
  }, [open, needsEmail, contacts, accountId]);

  // Guard against a stray outside-click/Esc wiping everything Molly just
  // typed — compare live field state to the seeded baseline above (NOT to
  // blank), so a dialog that opened pre-filled from the account's existing
  // data doesn't falsely read as dirty. newFirst/newLast/assessorId are
  // never seeded, so their baseline is always blank/null.
  const dirty =
    phone !== baselineRef.current.phone ||
    street !== baselineRef.current.street ||
    city !== baselineRef.current.city ||
    stateCode !== baselineRef.current.stateCode ||
    zip !== baselineRef.current.zip ||
    fteRange !== baselineRef.current.fteRange ||
    contactMode !== baselineRef.current.contactMode ||
    contactId !== baselineRef.current.contactId ||
    contactEmail !== baselineRef.current.contactEmail ||
    newFirst !== "" ||
    newLast !== "" ||
    assessorId !== null;
  const discard = useDialogDiscardGuard(dirty, () => {
    if (!busy) onDismiss();
  });

  // ----- per-section readiness (client mirror of the gate) ------------
  const needs = (k: CloseReadinessKey) => activeKeys.includes(k);
  const phoneOk = isFilled(phone);
  const addressOk = isFilled(street) && isFilled(city) && isFilled(stateCode) && isFilled(zip);
  const fteOk = isFilled(fteRange);
  // Deliberately STRICTER than the gate for email: the gate only wants a
  // non-blank string, but saving a typo'd email helps nobody. Never weaker.
  const emailOk =
    contactMode === "new"
      ? isFilled(newFirst) && isFilled(newLast) && EMAIL_RE.test(contactEmail.trim())
      : !!contactId && EMAIL_RE.test(contactEmail.trim());
  const assessorOk = !!assessorId;

  const sections = useMemo(() => {
    const ok: Record<CloseReadinessKey, boolean> = {
      account_phone: phoneOk,
      account_billing_address: addressOk,
      account_fte_range: fteOk,
      contact_email: emailOk,
      assigned_assessor: assessorOk,
    };
    // Render in the canonical key order regardless of missing-set order.
    return CLOSE_READINESS_KEYS.filter((k) => activeKeys.includes(k)).map((k) => ({
      key: k,
      ok: ok[k],
    }));
  }, [activeKeys, phoneOk, addressOk, fteOk, emailOk, assessorOk]);

  const readyCount = sections.filter((s) => s.ok).length;
  const allReady = sections.length > 0 && readyCount === sections.length;
  const accountLabel = request?.accountName || "the account";

  // ----- save + verify + hand off -------------------------------------
  async function finish() {
    if (!request || !accountId || busy || !allReady) return;
    setBusy(true);
    try {
      // 1. Account fields, one patch. Only the sections this block asked
      // for: untouched account data stays untouched.
      const patch: Record<string, unknown> = {};
      if (needs("account_phone")) patch.phone = phone.trim();
      if (needs("account_billing_address")) {
        patch.billing_street = street.trim();
        patch.billing_city = city.trim();
        patch.billing_state = stateCode.trim();
        patch.billing_zip = zip.trim();
      }
      if (needs("account_fte_range")) patch.fte_range = fteRange;
      if (Object.keys(patch).length > 0) {
        await updateAccount.mutateAsync({ id: accountId, ...patch });
      }

      // 2. The contact email (or the account's very first contact).
      if (needs("contact_email")) {
        if (contactMode === "new") {
          await createContact.mutateAsync({
            account_id: accountId,
            first_name: newFirst.trim(),
            last_name: newLast.trim(),
            email: contactEmail.trim(),
          });
        } else if (contactId) {
          await updateContact.mutateAsync({ id: contactId, email: contactEmail.trim() });
        }
      }

      // 3. The assessor. Deal row when we have an id; the form writes its
      // own copy via onComplete when the deal is still in-flight.
      let chosenAssessor: string | null = null;
      if (needs("assigned_assessor") && assessorId) {
        chosenAssessor = assessorId;
        if (typeof request.opportunity === "string") {
          await updateOpportunity.mutateAsync({
            id: request.opportunity,
            assigned_assessor_id: assessorId,
          });
        }
      }

      // 4. Re-run the REAL gate server-side. The dialog's green checks are
      // a mirror, not the authority; this catches concurrent edits and any
      // rule the mirror got wrong.
      const verifyCtx =
        request.opportunity == null || typeof request.opportunity === "string"
          ? request.opportunity
          : {
              ...request.opportunity,
              assigned_assessor_id:
                chosenAssessor ?? request.opportunity.assigned_assessor_id ?? null,
            };
      const res = await checkCloseReadiness(supabase, accountId, verifyCtx);
      if (!res.ready) {
        if (res.missingKeys && res.missingKeys.length > 0) {
          setActiveKeys(res.missingKeys);
          toast.info("Saved your fixes, but the account now needs something else too. It's listed below.");
        } else {
          toast.error(res.missing[0] ?? "The account could not be re-checked. Please try again.");
        }
        setBusy(false);
        return;
      }

      // 5. Hand the close back to the surface that started it. It commits
      // the stage change and clears `request` on success.
      setDone(true);
      await onComplete({ assessorId: chosenAssessor });
    } catch (e) {
      toast.error("Couldn't finish the close: " + (e as Error).message);
      setBusy(false);
      setDone(false);
    }
  }

  const total = sections.length;
  return (
    <>
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) discard.requestClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="p-0 gap-0 overflow-hidden sm:max-w-xl border-0 shadow-2xl"
        onInteractOutside={(e) => {
          if (busy) e.preventDefault();
        }}
        onOpenAutoFocus={(e) => {
          // Radix would focus the header's X. Land on the first gap's input
          // instead so Molly can start typing immediately.
          e.preventDefault();
          const root = sectionsRef.current;
          requestAnimationFrame(() => {
            root
              ?.querySelector<HTMLElement>("input, [role='combobox']")
              ?.focus();
          });
        }}
      >
        {/* ---------- header band ---------- */}
        <div className="fl-header relative px-6 pt-5 pb-6 text-white">
          <div className="relative z-10">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/12 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/90 ring-1 ring-white/20 backdrop-blur-sm">
                <Flag className="h-3 w-3" aria-hidden />
                Finish line
              </span>
              {!busy && (
                <button
                  type="button"
                  onClick={discard.requestClose}
                  className="rounded-md p-1 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="Close"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              )}
            </div>

            <DialogTitle className="mt-4 text-xl font-semibold leading-tight text-white">
              {request?.dealName || "Close this deal"}
            </DialogTitle>
            <DialogDescription className="mt-1.5 text-[13px] leading-relaxed text-white/80">
              This deal is one step from Closed Won. {accountLabel} needs{" "}
              {total === 1 ? "one quick detail" : `${total} quick details`} first. Fill{" "}
              {total === 1 ? "it" : "them"} in right here and finish the close. Nothing you
              were doing is lost.
            </DialogDescription>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/85">
              {typeof request?.amount === "number" && request.amount > 0 && (
                <span className="rounded-md bg-white/12 px-2 py-0.5 font-medium tabular-nums ring-1 ring-white/15">
                  {formatCurrency(request.amount)}
                </span>
              )}
              {request?.accountName && (
                <span className="rounded-md bg-white/12 px-2 py-0.5 ring-1 ring-white/15">
                  {request.accountName}
                </span>
              )}
            </div>

            {/* progress track: one lit segment per completed item */}
            <div className="mt-5">
              <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-white/85">
                <span aria-live="polite">
                  {allReady ? "All set. Take it across the line." : `${readyCount} of ${total} ready`}
                </span>
                <span className="tabular-nums">{total > 0 ? Math.round((readyCount / total) * 100) : 0}%</span>
              </div>
              <div className="flex gap-1.5" role="progressbar" aria-valuenow={readyCount} aria-valuemin={0} aria-valuemax={total}>
                {sections.map((s) => (
                  <div
                    key={s.key}
                    className={cn(
                      "h-1.5 flex-1 rounded-full transition-all duration-500",
                      s.ok
                        ? "bg-gradient-to-r from-emerald-300 to-lime-300 shadow-[0_0_10px_rgba(110,231,183,0.6)]"
                        : "bg-white/25",
                    )}
                  />
                ))}
              </div>
            </div>
          </div>
          {/* the finish-line motif: a faint checkered strip on the header's edge */}
          <div className="fl-checker absolute inset-x-0 bottom-0 h-2 opacity-60" aria-hidden />
        </div>

        {/* ---------- the gaps ---------- */}
        <div ref={sectionsRef} className="max-h-[50dvh] space-y-3.5 overflow-y-auto bg-background px-5 py-5">
          {needs("account_phone") && (
            <GapCard
              ok={phoneOk}
              icon={<Phone className="h-4 w-4" aria-hidden />}
              title="Account phone number"
              hint={`Saves to ${accountLabel}. Type an extension right after the number if there is one.`}
            >
              <PhoneInput
                value={phone}
                onChange={setPhone}
                aria-label="Account phone number"
              />
            </GapCard>
          )}

          {needs("account_billing_address") && (
            <GapCard
              ok={addressOk}
              icon={<MapPin className="h-4 w-4" aria-hidden />}
              title="Billing address"
              hint={`Saves to ${accountLabel}. Type the ZIP and the state fills itself in.`}
            >
              <div className="space-y-2.5">
                <Input
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  placeholder="Street address"
                  aria-label="Billing street"
                />
                <div className="grid grid-cols-[1fr_5.5rem_6rem] gap-2.5">
                  <Input
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="City"
                    aria-label="Billing city"
                  />
                  <Select
                    value={stateCode || "none"}
                    onValueChange={(v) => setStateCode(v === "none" ? "" : v)}
                  >
                    <SelectTrigger aria-label="Billing state">
                      <SelectValue placeholder="State" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">State</SelectItem>
                      {US_STATES.map((s) => (
                        <SelectItem key={s.code} value={s.code}>
                          {s.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={zip}
                    onChange={(e) => {
                      const z = e.target.value;
                      setZip(z);
                      // The small magic moment: a valid ZIP fills the state.
                      if (looksLikeUsZip(z)) {
                        const st = zipToState(z);
                        if (st) setStateCode(st);
                      }
                    }}
                    placeholder="ZIP"
                    inputMode="numeric"
                    aria-label="Billing ZIP"
                  />
                </div>
              </div>
            </GapCard>
          )}

          {needs("account_fte_range") && (
            <GapCard
              ok={fteOk}
              icon={<Users className="h-4 w-4" aria-hidden />}
              title="FTE range"
              hint={`About how many employees ${accountLabel} has. Saves to the account.`}
            >
              <Select value={fteRange || "none"} onValueChange={(v) => setFteRange(v === "none" ? "" : v)}>
                <SelectTrigger className="w-48" aria-label="FTE range">
                  <SelectValue placeholder="Pick a range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Pick a range</SelectItem>
                  {FTE_RANGES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r} employees
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </GapCard>
          )}

          {needs("contact_email") && (
            <GapCard
              ok={emailOk}
              icon={<Mail className="h-4 w-4" aria-hidden />}
              title="A contact with an email"
              hint={
                contacts && contacts.length === 0
                  ? `${accountLabel} has no contacts yet, so this also creates its first one.`
                  : "Every client needs at least one reachable contact. Saves to the contact you pick."
              }
            >
              {contactsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-2/3" />
                </div>
              ) : contactMode === "new" ? (
                <div className="space-y-2.5">
                  <div className="grid grid-cols-2 gap-2.5">
                    <Input
                      value={newFirst}
                      onChange={(e) => setNewFirst(e.target.value)}
                      placeholder="First name"
                      aria-label="New contact first name"
                    />
                    <Input
                      value={newLast}
                      onChange={(e) => setNewLast(e.target.value)}
                      placeholder="Last name"
                      aria-label="New contact last name"
                    />
                  </div>
                  <Input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="name@company.com"
                    aria-label="New contact email"
                  />
                  {contacts && contacts.length > 0 && (
                    <button
                      type="button"
                      className="text-xs font-medium text-primary hover:underline"
                      onClick={() => setContactMode("existing")}
                    >
                      Use an existing contact instead
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2.5">
                  <Select
                    value={contactId ?? ""}
                    onValueChange={(v) => {
                      setContactId(v);
                      const c = contacts?.find((x) => x.id === v);
                      setContactEmail(c?.email ?? "");
                    }}
                  >
                    <SelectTrigger aria-label="Which contact">
                      <SelectValue placeholder="Pick a contact" />
                    </SelectTrigger>
                    <SelectContent>
                      {contacts?.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.first_name} {c.last_name}
                          {c.is_primary ? " (primary)" : ""}
                          {c.title ? ` · ${c.title}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="name@company.com"
                    aria-label="Contact email"
                  />
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    onClick={() => {
                      setContactMode("new");
                      setContactEmail("");
                    }}
                  >
                    <UserPlus className="h-3 w-3" aria-hidden />
                    Add a new contact instead
                  </button>
                </div>
              )}
            </GapCard>
          )}

          {needs("assigned_assessor") && (
            <GapCard
              ok={assessorOk}
              icon={<ClipboardCheck className="h-4 w-4" aria-hidden />}
              title="Assigned Assessor"
              hint="This deal includes services. The assessor is who delivers the assessment. Saves to the deal."
            >
              <Select value={assessorId ?? "none"} onValueChange={(v) => setAssessorId(v === "none" ? null : v)}>
                <SelectTrigger className="w-64" aria-label="Assigned assessor">
                  <SelectValue placeholder="Pick a teammate" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Pick a teammate</SelectItem>
                  {users?.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.full_name ?? u.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </GapCard>
          )}
        </div>

        {/* ---------- footer ---------- */}
        <div className="flex items-center gap-3 border-t bg-muted/40 px-5 py-4">
          <Button type="button" variant="ghost" onClick={discard.requestClose} disabled={busy}>
            Not now
          </Button>
          <div className="flex-1" />
          <Button
            type="button"
            onClick={finish}
            disabled={!allReady || busy}
            className={cn(
              "fl-cta relative overflow-hidden border-0 px-5 text-white transition-all duration-300",
              allReady && !busy && "shadow-lg shadow-emerald-500/25",
            )}
          >
            {done ? (
              <>
                <Check className="mr-1.5 h-4 w-4" aria-hidden />
                Deal is won
              </>
            ) : busy ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                Crossing the line…
              </>
            ) : (
              <>
                <Flag className="mr-1.5 h-4 w-4" aria-hidden />
                Save and close the deal
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    {discard.dialog}
    </>
  );
}

/**
 * One missing item. The icon chip flips to an emerald check the moment the
 * inputs satisfy the rule, the card tints to match, and the header track
 * lights another segment. Inputs stay editable after going green.
 */
function GapCard({
  ok,
  icon,
  title,
  hint,
  children,
}: {
  ok: boolean;
  icon: React.ReactNode;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition-all duration-300",
        ok
          ? "border-emerald-500/40 bg-emerald-500/[0.05] dark:border-emerald-400/25"
          : "border-border bg-card shadow-sm",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors duration-300",
            ok ? "fl-pop bg-emerald-500 text-white" : "bg-primary/10 text-primary",
          )}
        >
          {ok ? <Check className="h-4 w-4" aria-hidden /> : icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">{title}</p>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{hint}</p>
        </div>
        {ok && (
          <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
            Ready
          </span>
        )}
      </div>
      <div className="mt-3 sm:pl-12">{children}</div>
    </div>
  );
}
