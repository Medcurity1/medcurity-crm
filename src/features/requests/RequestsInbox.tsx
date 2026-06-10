import { useState } from "react";
import { Inbox } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import type { RequestType, RequestStatus } from "@/types/crm";
import { useRequests } from "./api";
import { RequestCard } from "./RequestCard";

/**
 * Admin-only Requests inbox (lives in Admin Settings). The complete,
 * browsable history of every submitted request, filterable by type,
 * status, and time window.
 */
export function RequestsInbox() {
  const [type, setType] = useState<RequestType | "all">("all");
  const [status, setStatus] = useState<RequestStatus | "all">("all");
  const [windowDays, setWindowDays] = useState<string>("60");

  const { data, isLoading } = useRequests({
    type: type === "all" ? undefined : type,
    status: status === "all" ? undefined : status,
    sinceDays: windowDays === "all" ? undefined : Number(windowDays),
  });

  const pendingCount = (data ?? []).filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={type} onValueChange={(v) => setType(v as RequestType | "all")}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="collateral">Collateral</SelectItem>
            <SelectItem value="product">Product</SelectItem>
            <SelectItem value="crm">CRM</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as RequestStatus | "all")}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="denied">Denied</SelectItem>
          </SelectContent>
        </Select>
        <Select value={windowDays} onValueChange={setWindowDays}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="60">Last 60 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </SelectContent>
        </Select>
        {!isLoading && (
          <span className="ml-auto text-sm text-muted-foreground">
            {pendingCount} pending · {(data ?? []).length} shown
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No requests"
          description="No requests match these filters yet."
        />
      ) : (
        <div className="space-y-2">
          {data.map((r) => (
            <RequestCard key={r.id} request={r} showType />
          ))}
        </div>
      )}
    </div>
  );
}
