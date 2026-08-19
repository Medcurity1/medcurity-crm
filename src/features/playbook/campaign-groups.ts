// Campaign list group open/close defaults. Pure so the home-page groups
// (Needs you / Active / Drafts / Recently ended / Replies) can be tested
// without rendering the tab.

export type CampaignListGroupId = "needsYou" | "active" | "drafts" | "recentlyEnded";
export type CampaignHomeGroupId = CampaignListGroupId | "replies";

export function defaultCampaignGroupOpen(
  id: CampaignHomeGroupId,
  count: number,
  searchActive = false,
): boolean {
  if (count <= 0) return false;
  if (id === "recentlyEnded") return searchActive;
  return true;
}

export function campaignGroupOpen(
  id: CampaignHomeGroupId,
  count: number,
  searchActive: boolean,
  userOverride: boolean | undefined,
): boolean {
  if (userOverride !== undefined) return userOverride;
  return defaultCampaignGroupOpen(id, count, searchActive);
}

export function collapsedSearchMatchLabel(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 match" : `${count} matches`;
}
