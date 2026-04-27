/**
 * Page Layout types — mirror the Postgres schema in
 * supabase/migrations/20260426000007_page_layouts_schema.sql
 */

export type LayoutEntity =
  | "accounts"
  | "contacts"
  | "leads"
  | "opportunities"
  | "activities"
  | "products"
  | "account_partners";

export type FieldWidth = "full" | "half" | "third";

export interface PageLayout {
  id: string;
  entity: LayoutEntity;
  name: string;
  is_default: boolean;
  is_locked: boolean;
  created_at: string;
  updated_at: string;
}

export interface PageLayoutSection {
  id: string;
  layout_id: string;
  title: string;
  sort_order: number;
  collapsed_by_default: boolean;
  detail_only: boolean;
  form_only: boolean;
  created_at: string;
}

export interface PageLayoutField {
  id: string;
  section_id: string;
  field_key: string;
  sort_order: number;
  width: FieldWidth;
  read_only_on_form: boolean;
  hide_on_form: boolean;
  hide_on_detail: boolean;
  admin_only_on_form: boolean;
  required_override: boolean | null;
  label_override: string | null;
  help_text: string | null;
  created_at: string;
}

/** A section with its fields nested for convenient rendering. */
export interface PageLayoutSectionWithFields extends PageLayoutSection {
  fields: PageLayoutField[];
}

/** A full layout with sections + fields, ordered. */
export interface ResolvedPageLayout extends PageLayout {
  sections: PageLayoutSectionWithFields[];
}
