import { useState } from "react";
import {
  PlayCircle,
  Plus,
  Phone,
  Mail,
  ClipboardList,
  CheckCircle2,
  Pause,
  ChevronDown,
  ChevronUp,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import {
  useSequences,
  useUpdateSequence,
  useDeleteSequence,
  useSequenceEnrollmentCounts,
  useSequenceEnrollments,
  useAdvanceEnrollment,
  usePauseEnrollment,
} from "./sequences-api";
import { CreateSequenceDialog } from "./CreateSequenceDialog";
import { formatDate } from "@/lib/formatters";
import type { Sequence, SequenceStep, SequenceEnrollment } from "@/types/crm";

// ---------------------------------------------------------------------------
// Step type icon
// ---------------------------------------------------------------------------

function StepIcon({ type }: { type: SequenceStep["type"] }) {
  switch (type) {
    case "email":
      return <Mail className="h-4 w-4 text-blue-600" />;
    case "call":
      return <Phone className="h-4 w-4 text-green-600" />;
    case "task":
      return <ClipboardList className="h-4 w-4 text-amber-600" />;
  }
}

// ---------------------------------------------------------------------------
// Enrollments sub-view (call list + all enrollments)
// ---------------------------------------------------------------------------

function EnrollmentsView({ sequence }: { sequence: Sequence }) {
  const { data: enrollments, isLoading } = useSequenceEnrollments(sequence.id);
  const advanceMutation = useAdvanceEnrollment();
  const pauseMutation = usePauseEnrollment();

  const now = new Date();
  now.setHours(23, 59, 59, 999);

  // Call list: active enrollments where next_touch_at <= today and current step type is "call"
  const callList = (enrollments ?? []).filter((e) => {
    if (e.status !== "active" || !e.next_touch_at) return false;
    if (new Date(e.next_touch_at) > now) return false;
    const step = sequence.steps.find(
      (s) => s.step_number === e.current_step
    );
    return step?.type === "call";
  });

  function getName(e: SequenceEnrollment): string {
    if (e.lead) return `${e.lead.first_name ?? ""} ${e.lead.last_name ?? ""}`.trim();
    if (e.contact) return `${e.contact.first_name ?? ""} ${e.contact.last_name ?? ""}`.trim();
    return "Unknown";
  }

  function getCompany(e: SequenceEnrollment): string {
    if (e.lead) return e.lead.company ?? "";
    if (e.contact) return e.contact.account?.name ?? "";
    return "";
  }

  function getPhone(e: SequenceEnrollment): string {
    if (e.lead) return e.lead.phone ?? "";
    if (e.contact) return e.contact.phone ?? "";
    return "";
  }

  if (isLoading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 bg-muted/20 rounded-b-lg">
      {/* Call list */}
      {callList.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
            <Phone className="h-4 w-4 text-green-600" />
            Today's Call List ({callList.length})
          </h4>
          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Step</TableHead>
                  <TableHead>Next Touch</TableHead>
                  <TableHead className="w-[120px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {callList.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">
                      {getName(e)}
                    </TableCell>
                    <TableCell>{getCompany(e)}</TableCell>
                    <TableCell>{getPhone(e)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        Step {e.current_step}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(e.next_touch_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            advanceMutation.mutate(
                              {
                                enrollmentId: e.id,
                                sequenceId: sequence.id,
                              },
                              {
                                onSuccess: () =>
                                  toast.success("Advanced to next step"),
                              }
                            );
                          }}
                          disabled={advanceMutation.isPending}
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Done
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            pauseMutation.mutate({
                              enrollmentId: e.id,
                              sequenceId: sequence.id,
                              reason: "Manual pause",
                            });
                          }}
                          disabled={pauseMutation.isPending}
                        >
                          <Pause className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* All enrollments */}
      <div>
        <h4 className="text-sm font-semibold mb-2">
          All Enrollments ({enrollments?.length ?? 0})
        </h4>
        {!enrollments?.length ? (
          <p className="text-sm text-muted-foreground">
            No one is enrolled in this sequence yet.
          </p>
        ) : (
          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Step</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Enrolled</TableHead>
                  <TableHead>Next Touch</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrollments.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">
                      {getName(e)}
                    </TableCell>
                    <TableCell>{getCompany(e)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        Step {e.current_step} / {sequence.steps.length}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          e.status === "active"
                            ? "default"
                            : e.status === "completed"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {e.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(e.enrolled_at)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {e.next_touch_at ? formatDate(e.next_touch_at) : "---"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sequence Card
// ---------------------------------------------------------------------------

function SequenceCard({
  sequence,
  activeCount,
  totalCount,
}: {
  sequence: Sequence;
  activeCount: number;
  totalCount: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const updateMutation = useUpdateSequence();
  const deleteMutation = useDeleteSequence();

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div
            className="flex-1 cursor-pointer"
            onClick={() => setExpanded((v) => !v)}
          >
            <CardTitle className="text-base flex items-center gap-2">
              <PlayCircle className="h-5 w-5 text-primary shrink-0" />
              {sequence.name}
              {expanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </CardTitle>
            {sequence.description && (
              <p className="text-sm text-muted-foreground mt-1">
                {sequence.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Switch
              checked={sequence.is_active}
              onCheckedChange={(checked) => {
                updateMutation.mutate({
                  id: sequence.id,
                  is_active: checked,
                });
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              onClick={() => {
                deleteMutation.mutate(sequence.id, {
                  onSuccess: () => toast.success("Sequence deleted"),
                });
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {/* Steps summary */}
        <div className="flex flex-wrap items-center gap-2 mb-2">
          {sequence.steps.map((step) => (
            <div
              key={step.step_number}
              className="flex items-center gap-1 text-xs border rounded-full px-2 py-1"
            >
              <StepIcon type={step.type} />
              <span>
                {step.subject || `Step ${step.step_number}`}
              </span>
              {step.delay_days > 0 && (
                <span className="text-muted-foreground">
                  +{step.delay_days}d
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Stats */}
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>{sequence.steps.length} steps</span>
          <span>{activeCount} active</span>
          <span>{totalCount} total enrolled</span>
        </div>
      </CardContent>

      {expanded && <EnrollmentsView sequence={sequence} />}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function SequencesPage() {
  const [showCreate, setShowCreate] = useState(false);
  const { data: sequences, isLoading } = useSequences();
  const { data: counts } = useSequenceEnrollmentCounts();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales Sequences"
        description="Automated outreach cadences for leads and contacts."
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Sequence
          </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : !sequences?.length ? (
        <EmptyState
          icon={PlayCircle}
          title="No sequences yet"
          description="Create your first sales sequence to automate outreach."
        />
      ) : (
        <div className="space-y-4">
          {sequences.map((seq) => (
            <SequenceCard
              key={seq.id}
              sequence={seq}
              activeCount={counts?.[seq.id]?.active ?? 0}
              totalCount={counts?.[seq.id]?.total ?? 0}
            />
          ))}
        </div>
      )}

      <CreateSequenceDialog
        open={showCreate}
        onOpenChange={setShowCreate}
      />
    </div>
  );
}
