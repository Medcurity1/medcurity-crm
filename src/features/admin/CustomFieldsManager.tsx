import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { CustomFieldDefinition, CustomFieldType } from "@/types/crm";
import {
  useCustomFieldDefinitions,
  useCreateCustomField,
  useUpdateCustomField,
  useDeleteCustomField,
} from "./admin-api";
import { AddFieldDialog } from "./AddFieldDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Text",
  textarea: "Text Area",
  number: "Number",
  currency: "Currency",
  date: "Date",
  checkbox: "Checkbox",
  select: "Dropdown",
  multi_select: "Multi-Select",
  url: "URL",
  email: "Email",
  phone: "Phone",
};

type EntityTab = CustomFieldDefinition["entity"];

const ENTITY_TABS: { value: EntityTab; label: string }[] = [
  { value: "accounts", label: "Accounts" },
  { value: "contacts", label: "Contacts" },
  { value: "opportunities", label: "Opportunities" },
];

function EntityFieldsTable({ entity }: { entity: EntityTab }) {
  const { data: fields, isLoading } = useCustomFieldDefinitions(entity);
  const createField = useCreateCustomField();
  const updateField = useUpdateCustomField();
  const deleteField = useDeleteCustomField();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<CustomFieldDefinition | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomFieldDefinition | null>(null);

  function handleOpenAdd() {
    setEditingField(null);
    setDialogOpen(true);
  }

  function handleOpenEdit(field: CustomFieldDefinition) {
    setEditingField(field);
    setDialogOpen(true);
  }

  function handleSave(
    values: Omit<CustomFieldDefinition, "id" | "created_at" | "updated_at">
  ) {
    if (editingField) {
      updateField.mutate(
        { id: editingField.id, ...values },
        {
          onSuccess: () => {
            toast.success("Custom field updated");
            setDialogOpen(false);
          },
          onError: (err) => {
            toast.error(`Failed to update field: ${err.message}`);
          },
        }
      );
    } else {
      createField.mutate(values, {
        onSuccess: () => {
          toast.success("Custom field created");
          setDialogOpen(false);
        },
        onError: (err) => {
          toast.error(`Failed to create field: ${err.message}`);
        },
      });
    }
  }

  function handleToggleActive(field: CustomFieldDefinition) {
    updateField.mutate(
      { id: field.id, entity: field.entity, is_active: !field.is_active },
      {
        onSuccess: () => {
          toast.success(
            field.is_active ? "Field deactivated" : "Field activated"
          );
        },
        onError: (err) => {
          toast.error(`Failed to toggle field: ${err.message}`);
        },
      }
    );
  }

  function handleConfirmDelete() {
    if (!deleteTarget) return;
    deleteField.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast.success("Custom field deleted");
        setDeleteTarget(null);
      },
      onError: (err) => {
        toast.error(`Failed to delete field: ${err.message}`);
        setDeleteTarget(null);
      },
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {fields?.length ?? 0} custom field{fields?.length !== 1 ? "s" : ""} defined
        </p>
        <Button size="sm" onClick={handleOpenAdd}>
          <Plus className="h-4 w-4 mr-1" />
          Add Custom Field
        </Button>
      </div>

      {fields && fields.length > 0 ? (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Required</TableHead>
                <TableHead>Section</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fields.map((field) => (
                <TableRow key={field.id}>
                  <TableCell className="font-medium">{field.label}</TableCell>
                  <TableCell>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                      {field.field_key}
                    </code>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {FIELD_TYPE_LABELS[field.field_type]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {field.is_required ? (
                      <Badge variant="default">Yes</Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm">No</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{field.section}</TableCell>
                  <TableCell>
                    <Switch
                      checked={field.is_active}
                      onCheckedChange={() => handleToggleActive(field)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleOpenEdit(field)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(field)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="border rounded-lg p-8 text-center text-muted-foreground">
          No custom fields defined for {entity} yet. Click "Add Custom Field" to
          create one.
        </div>
      )}

      <AddFieldDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entity={entity}
        existingField={editingField}
        onSave={handleSave}
        saving={createField.isPending || updateField.isPending}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Custom Field</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the field "{deleteTarget?.label}"?
              This action cannot be undone. Existing data stored under this field
              key will remain but will no longer be displayed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteField.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function CustomFieldsManager() {
  return (
    <Tabs defaultValue="accounts" className="space-y-4">
      <TabsList>
        {ENTITY_TABS.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {ENTITY_TABS.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          <EntityFieldsTable entity={tab.value} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
