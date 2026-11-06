import type { FieldDefinition } from '@wis/core';
import { localize } from '@wis/core';

/** A field definition prepared for the browser: texts already in the user's language. */
export interface FieldView {
  key: string;
  type: FieldDefinition['type'];
  label: string;
  required: boolean;
  sensitive: boolean;
  section: string | null;
  options: { value: string; label: string }[];
}

export function toFieldViews(defs: FieldDefinition[], locale: string): FieldView[] {
  return defs
    .filter((d) => !d.archivedAt)
    .map((d) => ({
      key: d.key,
      type: d.type,
      label: localize(d.label, locale),
      required: d.required,
      sensitive: d.sensitive,
      section: d.section,
      options: d.options.map((o) => ({ value: o.value, label: localize(o.labels, locale) })),
    }));
}
