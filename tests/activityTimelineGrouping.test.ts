import { describe, it, expect } from "vitest";
import {
  groupActivitiesForTimeline,
  type ThreadGroup,
} from "@/features/activities/ActivityTimeline";
import type { Activity } from "@/types/crm";

// ---------------------------------------------------------------------------
// groupActivitiesForTimeline groups same-thread emails under one row, and
// (when dedupeFanOut is true, i.e. an account-scoped timeline) collapses
// rows that are the SAME email logged to multiple matched contacts under
// the account (dce9b1f) so the "N earlier messages" chevron doesn't show
// copies of the identical message. Contact-scoped timelines pass
// dedupeFanOut: false and must keep every per-contact row — see
// ActivityTimeline's dedupeFanOut = accountId && !contactId.
// ---------------------------------------------------------------------------

let counter = 0;
function makeActivity(overrides: Partial<Activity> = {}): Activity {
  counter += 1;
  return {
    id: `activity-${counter}`,
    account_id: null,
    contact_id: null,
    opportunity_id: null,
    lead_id: null,
    owner_user_id: "owner-1",
    activity_type: "email",
    subject: "Subject",
    body: null,
    due_at: null,
    activity_date: null,
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    email_direction: null,
    email_from: null,
    email_to: null,
    email_cc: null,
    email_html_body: null,
    email_thread_id: null,
    external_message_id: null,
    reminder_schedule: "none",
    reminder_at: null,
    reminder_channels: [],
    last_reminder_sent_at: null,
    priority: null,
    recur_freq: null,
    recur_interval: 1,
    recur_weekday: null,
    recur_monthday: null,
    recur_until: null,
    recurrence_parent_id: null,
    outlook_event_id: null,
    outlook_sync_error: null,
    outlook_synced_at: null,
    ...overrides,
  };
}

function isThreadGroup(x: Activity | ThreadGroup): x is ThreadGroup {
  return (x as ThreadGroup).threadKey !== undefined;
}

describe("groupActivitiesForTimeline", () => {
  it("groups emails sharing a thread id; the first occurrence becomes primary", () => {
    const a = makeActivity({ id: "a", email_thread_id: "thread-1", external_message_id: "msg-a" });
    const b = makeActivity({ id: "b", email_thread_id: "thread-1", external_message_id: "msg-b" });
    const out = groupActivitiesForTimeline([a, b], { dedupeFanOut: false });
    expect(out).toHaveLength(1);
    const group = out[0];
    expect(isThreadGroup(group)).toBe(true);
    if (isThreadGroup(group)) {
      expect(group.primary.id).toBe("a");
      expect(group.others.map((o) => o.id)).toEqual(["b"]);
    }
  });

  it("does not group non-email activities or emails without a thread id", () => {
    const call = makeActivity({ id: "c", activity_type: "call" });
    const emailNoThread = makeActivity({ id: "e", email_thread_id: null });
    const out = groupActivitiesForTimeline([call, emailNoThread], { dedupeFanOut: false });
    expect(out).toHaveLength(2);
    expect(out.every((x) => !isThreadGroup(x))).toBe(true);
  });

  describe("dedupeFanOut: false (contact-scoped timelines)", () => {
    it("keeps every fan-out row (one per matched contact) as separate 'others' entries", () => {
      const primary = makeActivity({ id: "p", email_thread_id: "t1", external_message_id: "msg-1" });
      const dupe1 = makeActivity({ id: "d1", email_thread_id: "t1", external_message_id: "msg-1" });
      const dupe2 = makeActivity({ id: "d2", email_thread_id: "t1", external_message_id: "msg-1" });
      const out = groupActivitiesForTimeline([primary, dupe1, dupe2], { dedupeFanOut: false });
      expect(out).toHaveLength(1);
      const group = out[0] as ThreadGroup;
      expect(group.others).toHaveLength(2);
    });
  });

  describe("dedupeFanOut: true (account-scoped timelines)", () => {
    it("collapses duplicate fan-out rows sharing external_message_id into a single ungrouped row (no fake thread/chevron for one real email)", () => {
      const primary = makeActivity({ id: "p", email_thread_id: "t1", external_message_id: "msg-1" });
      const dupe1 = makeActivity({ id: "d1", email_thread_id: "t1", external_message_id: "msg-1" });
      const dupe2 = makeActivity({ id: "d2", email_thread_id: "t1", external_message_id: "msg-1" });
      const out = groupActivitiesForTimeline([primary, dupe1, dupe2], { dedupeFanOut: true });
      expect(out).toHaveLength(1);
      // Only one unique message exists once fan-out copies are dropped, so
      // this should render exactly like a lone email always has — a plain
      // row, not a ThreadGroup with an empty/pointless "others" chevron.
      expect(isThreadGroup(out[0])).toBe(false);
      expect((out[0] as Activity).id).toBe("p");
    });

    it("keeps genuinely different messages in the same thread (a real reply chain)", () => {
      const first = makeActivity({ id: "r2", email_thread_id: "t1", external_message_id: "msg-2" });
      const second = makeActivity({ id: "r1", email_thread_id: "t1", external_message_id: "msg-1" });
      const out = groupActivitiesForTimeline([first, second], { dedupeFanOut: true });
      expect(out).toHaveLength(1);
      const group = out[0] as ThreadGroup;
      expect(group.primary.id).toBe("r2");
      expect(group.others.map((o) => o.id)).toEqual(["r1"]);
    });

    it("dedupes a fan-out copy of the group's primary message too, not just later entries", () => {
      const primary = makeActivity({ id: "p", email_thread_id: "t1", external_message_id: "msg-1" });
      const dupeOfPrimary = makeActivity({ id: "dp", email_thread_id: "t1", external_message_id: "msg-1" });
      const realReply = makeActivity({ id: "r", email_thread_id: "t1", external_message_id: "msg-2" });
      const out = groupActivitiesForTimeline([primary, dupeOfPrimary, realReply], {
        dedupeFanOut: true,
      });
      const group = out[0] as ThreadGroup;
      expect(group.others.map((o) => o.id)).toEqual(["r"]);
    });

    it("does not touch manually-logged emails without an external_message_id", () => {
      const primary = makeActivity({ id: "p", email_thread_id: "t1", external_message_id: null });
      const other = makeActivity({ id: "o", email_thread_id: "t1", external_message_id: null });
      const out = groupActivitiesForTimeline([primary, other], { dedupeFanOut: true });
      const group = out[0] as ThreadGroup;
      expect(group.others).toHaveLength(1);
    });

    it("dedupes each thread independently without cross-thread interference", () => {
      const t1a = makeActivity({ id: "1a", email_thread_id: "t1", external_message_id: "msg-1" });
      const t1b = makeActivity({ id: "1b", email_thread_id: "t1", external_message_id: "msg-1" });
      const t2a = makeActivity({ id: "2a", email_thread_id: "t2", external_message_id: "msg-2" });
      const t2b = makeActivity({ id: "2b", email_thread_id: "t2", external_message_id: "msg-2" });
      const out = groupActivitiesForTimeline([t1a, t1b, t2a, t2b], { dedupeFanOut: true });
      expect(out).toHaveLength(2);
      expect(out.every((x) => !isThreadGroup(x))).toBe(true);
      expect((out[0] as Activity).id).toBe("1a");
      expect((out[1] as Activity).id).toBe("2a");
    });
  });
});
