import { useState } from "react";
import { Pause, Play, PlayCircle, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  useActiveEnrollmentsForLead,
  useActiveEnrollmentsForContact,
  usePauseEnrollment,
  useResumeEnrollment,
} from "./sequences-api";
import { EnrollInSequenceDialog } from "./EnrollInSequenceDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/formatters";
import type { SequenceEnrollment } from "@/types/crm";

interface SequencesTabProps {
  leadId?: string;
  contactId?: string;
  accountId?: string | null;
}

export function SequencesTab({ leadId, contactId, accountId }: SequencesTabProps) {
  const [showEnroll, setShowEnroll] = useState(false);

  const leadQuery = useActiveEnrollmentsForLead(leadId);
  const contactQuery = useActiveEnrollmentsForContact(contactId);

  const isLoading = leadId ? leadQuery.isLoading : contactQuery.isLoading;
  const enrollments = (leadId ? leadQuery.data : contactQuery.data) ?? [];

  const pauseMutation = usePauseEnrollment();
  const resumeMutation = useResumeEnrollment();

  function handlePause(e: SequenceEnrollment) {
    pauseMutation.mutate(
      {
        enrollmentId: e.id,
        sequenceId: e.sequence_id,
        leadId: leadId,
        contactId: contactId,
        reason: "Manual pause",
      },
      {
        onSuccess: () => toast.success("Sequence paused"),
        onError: (err) => toast.error("Failed to pause: " + (err as Error).message),
      }
    );
  }

  function handleResume(e: SequenceEnrollment) {
    resumeMutation.mutate(
      {
        enrollmentId: e.id,
        sequenceId: e.sequence_id,
        leadId: leadId,
        contactId: contactId,
      },
      {
        onSuccess: () => toast.success("Sequence resumed"),
        onError: (err) => toast.error("Failed to resume: " + (err as Error).message),
      }
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowEnroll(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Enroll in Sequence
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : !enrollments.length ? (
        <EmptyState
          icon={PlayCircle}
          title="Not enrolled in any sequences"
          description="Enroll this record in a sales sequence to start automated outreach."
        />
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sequence</TableHead>
                <TableHead>Current Step</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Next Touch</TableHead>
                <TableHead className="w-[120px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {enrollments.map((e) => {
                const stepCount = e.sequence?.steps?.length ?? 0;
                return (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">
                      {e.sequence?.name ?? "\u2014"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        Step {e.current_step}
                        {stepCount > 0 ? ` / ${stepCount}` : ""}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          e.status === "active" ? "default" : "outline"
                        }
                      >
                        {e.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {e.next_touch_at ? formatDate(e.next_touch_at) : "\u2014"}
                    </TableCell>
                    <TableCell>
                      {e.status === "active" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handlePause(e)}
                          disabled={pauseMutation.isPending}
                        >
                          <Pause className="h-3 w-3 mr-1" />
                          Pause
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleResume(e)}
                          disabled={resumeMutation.isPending}
                        >
                          <Play className="h-3 w-3 mr-1" />
                          Resume
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <EnrollInSequenceDialog
        open={showEnroll}
        onOpenChange={setShowEnroll}
        leadId={leadId ?? null}
        contactId={contactId ?? null}
        accountId={accountId ?? null}
      />
    </div>
  );
}
