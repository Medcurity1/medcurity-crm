export interface DeliverySettings {
  daysOfWeek: number[];
  startHour: string;
  endHour: string;
  timezone: string;
  campaignDailyVolume: number;
  messageSpacingMinutes: number;
}

export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = {
  daysOfWeek: [1, 2, 3, 4, 5],
  startHour: "09:00",
  endHour: "17:00",
  timezone: "America/Los_Angeles",
  campaignDailyVolume: 25,
  messageSpacingMinutes: 15,
};

export const DELIVERY_DAY_OPTIONS = [
  { value: 1, short: "Mon", label: "Monday" },
  { value: 2, short: "Tue", label: "Tuesday" },
  { value: 3, short: "Wed", label: "Wednesday" },
  { value: 4, short: "Thu", label: "Thursday" },
  { value: 5, short: "Fri", label: "Friday" },
  { value: 6, short: "Sat", label: "Saturday" },
  { value: 0, short: "Sun", label: "Sunday" },
] as const;

const TIMEZONE_LABELS: Record<string, string> = {
  "America/Los_Angeles": "Pacific time",
  "America/Denver": "Mountain time",
  "America/Chicago": "Central time",
  "America/New_York": "Eastern time",
};

function formatTime(value: string): string {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  const suffix = hours >= 12 ? "pm" : "am";
  const displayHour = hours % 12 || 12;
  return `${displayHour}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}${suffix}`;
}

export function deliveryDaysLabel(days: number[]): string {
  const ordered = DELIVERY_DAY_OPTIONS.filter((day) => days.includes(day.value));
  if (ordered.length === 5 && ordered.every((day) => day.value >= 1 && day.value <= 5)) return "Weekdays";
  if (ordered.length === 7) return "Every day";
  return ordered.map((day) => day.short).join(", ") || "No sending days";
}

export function deliverySummary(settings: DeliverySettings): string {
  const timezone = TIMEZONE_LABELS[settings.timezone] ?? settings.timezone.replaceAll("_", " ");
  return `${deliveryDaysLabel(settings.daysOfWeek)}, ${formatTime(settings.startHour)}–${formatTime(settings.endHour)} ${timezone}`;
}

export function normalizeDeliverySettings(value?: Partial<DeliverySettings> | null): DeliverySettings {
  const days = Array.isArray(value?.daysOfWeek)
    ? value.daysOfWeek.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : DEFAULT_DELIVERY_SETTINGS.daysOfWeek;
  return {
    daysOfWeek: days.length ? Array.from(new Set(days)) : DEFAULT_DELIVERY_SETTINGS.daysOfWeek,
    startHour: /^\d{2}:\d{2}$/.test(value?.startHour ?? "") ? value!.startHour! : DEFAULT_DELIVERY_SETTINGS.startHour,
    endHour: /^\d{2}:\d{2}$/.test(value?.endHour ?? "") ? value!.endHour! : DEFAULT_DELIVERY_SETTINGS.endHour,
    timezone: value?.timezone || DEFAULT_DELIVERY_SETTINGS.timezone,
    campaignDailyVolume: Math.max(1, Math.min(500, Number(value?.campaignDailyVolume) || DEFAULT_DELIVERY_SETTINGS.campaignDailyVolume)),
    messageSpacingMinutes: Math.max(1, Math.min(120, Number(value?.messageSpacingMinutes) || DEFAULT_DELIVERY_SETTINGS.messageSpacingMinutes)),
  };
}
