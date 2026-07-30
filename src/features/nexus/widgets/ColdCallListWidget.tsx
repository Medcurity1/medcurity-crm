// Nexus 'cold_call' widget (docket C2, Phase 2): the Home Cold Call list's
// Nexus twin. Thin wrapper over the shared ColdCallBody (source picker +
// warm-first table, list-driven per Summer's 2026-07-15 answer) so both
// tabs stay identical until Home retires. Configless; shows dials only for
// users who picked a call list or match the auto pool.

import { useCallback } from "react";
import { ColdCallBody } from "@/features/dashboard/ColdCallWidget";
import type { NexusWidgetBodyProps } from "../WidgetShell";

export function ColdCallListWidget({ widget, onDataUpdated }: NexusWidgetBodyProps) {
  const report = useCallback(
    (at: number) => onDataUpdated?.(at),
    [onDataUpdated],
  );
  return <ColdCallBody onDataUpdated={report} limit={widget.preview_count} />;
}
