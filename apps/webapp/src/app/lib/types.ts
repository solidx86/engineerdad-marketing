import type { EntityName } from "@engineerdad/store";

export type FieldRole =
  | "primary" | "meta" | "list" | "link" | "status" | "badge" | "timestamp" | "bindings";

export type FieldSpec =
  | { role: FieldRole; field: string; label?: string }
  | { role: "bilingual"; en: string; bm: string; label?: string }
  | { role: "fk"; field: string; fk: EntityName; label?: string };

export interface Section {
  title: string;
  fields: FieldSpec[];
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

export interface EntityLayout {
  header: {
    title: string;
    subtitle?: string;
    status: string;
    secondaryStatus?: string;
  };
  primary: Section[];
  secondary: Section[];
}

export type ColumnType = "text" | "chips" | "status" | "badge" | "runId" | "timestamp";

export interface ColumnSpec {
  field: string;
  label: string;
  type: ColumnType;
  width?: "narrow" | "wide";
  sortable?: boolean;
}

export interface FilterSpec {
  field: string;
  label: string;
  type: "select" | "multiSelect";
  options: readonly string[];
}

export interface ListConfig {
  columns: ColumnSpec[];
  filters: FilterSpec[];
  defaultSort?: { field: string; dir: "asc" | "desc" };
}

export type Lang = "en" | "ms";
