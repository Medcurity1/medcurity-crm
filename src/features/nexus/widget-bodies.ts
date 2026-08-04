// The widget_type -> body component registry.
//
// It sits in its own module (it used to live in NexusGrid) so both the
// grid and the pinned row can render a card without importing each other.
// Register every new widget body here; nothing else needs to know.

import type { ComponentType } from "react";
import type { NexusWidgetBodyProps } from "./WidgetShell";
import { TasksWidget } from "./widgets/TasksWidget";
import { PipelineWidget } from "./widgets/PipelineWidget";
import { CustomReportWidget } from "./widgets/CustomReportWidget";
import { PinnedRecordsWidget } from "./widgets/PinnedRecordsWidget";
import { RequestsWidget } from "./widgets/RequestsWidget";
import { CampaignTouchesWidget } from "./widgets/CampaignTouchesWidget";
import { WinsWidget } from "./widgets/WinsWidget";
import { ColdCallListWidget } from "./widgets/ColdCallListWidget";
import { RecentsWidget } from "./widgets/RecentsWidget";
import type { NexusWidgetType } from "./types";

export const WIDGET_BODIES: Record<
  NexusWidgetType,
  ComponentType<NexusWidgetBodyProps>
> = {
  tasks: TasksWidget,
  pipeline: PipelineWidget,
  custom_report: CustomReportWidget,
  pinned_records: PinnedRecordsWidget,
  requests: RequestsWidget,
  campaign_touches: CampaignTouchesWidget,
  wins: WinsWidget,
  cold_call: ColdCallListWidget,
  recents: RecentsWidget,
};
