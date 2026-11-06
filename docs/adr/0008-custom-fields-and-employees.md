# ADR-0008: Custom fields engine, employees and billable headcount

- Status: accepted
- Date: 2026-11-05

## Context

Every customer needs different extra information on an employee (shoe size, licence, preferred role), and later on shifts and other entities. The platform admin must not need a deployment per customer. At the same time the customer is billed by headcount, where a person with a login must never be counted twice.

## Decision

**Storage.** Typed core columns plus `custom_data jsonb` on extensible entities (`employee` first), with a GIN index (`jsonb_path_ops`) and a 16 KB cap per row. Definitions live in `field_definition` (per tenant and entity). No EAV tables.

**Definitions** (`@wis/core`, `fieldDefinitionInputSchema`)

- Types: text, number, date, boolean, select, multi_select. Labels and choice labels exist in **all** supported languages (en, de).
- **Key and type are immutable.** Fields are archived, never deleted: stored values survive and return on restore. Choices can be added or relabelled, never removed. At most 50 fields per entity.
- Rules per type (min/max/integer, length, pattern). User patterns are limited (≤ 100 characters, text length ≤ 200, nested quantifiers rejected) to avoid catastrophic regular expressions.
- `sensitive` fields (e.g. bank details) are readable and writable only with the `employee:read-sensitive` permission; without it they are absent from the validator, from reads, and from custom-field filters.
- Which entities are extensible: core `employee`, plus each module's `extensibleEntities` as `<module>.<entity>` (registry `extensibleEntityIds()`).

**Validation.** `buildCustomDataSchema(defs, {canWriteSensitive})` builds a strict Zod schema from the tenant's definitions: unknown, archived or (without permission) sensitive keys are rejected; `null` clears a value; required fields must be present. On update, values the caller cannot write (archived, sensitive without permission) are preserved. Validation issues carry machine-readable codes and bounds (`Issue`); the UI translates them (en/de), so no English text from the validator reaches users.

**Services** (`@wis/people`): field and employee operations take a tenant-scoped transaction (`withTenant`, RLS) and an `Actor` with `can(resource, action)`. In the web app `can` is answered by better-auth `hasPermission`, so tenant-defined roles are honoured. Audit entries name the changed fields, never the values.

**Employees are not logins.** `employee.user_id` optionally links a person to their account (unique per tenant). `linkEmployeeToUser` (owner connection) checks tenant membership. Employees cannot be deleted by tenant code (no DELETE grant): employment ends with `end_date`; erasure is a separate platform operation (open).

**Billable headcount, counted once** (SQL: `tenant_billing_counts`, `tenant_billable_count`; `@wis/auth`: `getBillingUsage`)

- Categories per active person: `employee_with_login` (active employee linked to a member), `employee_no_login`, `user_only` (members without an active linked employee, plus open invitations as reserved seats unless the invitee is already counted as a member or an active employee by e-mail).
- Preset per tenant (`per_user`, `per_employee`, `both`) selects the categories that are billed. An unlinked employee and a login of the same human count twice until they are linked: linking is the mechanism that merges them.
- `enforce_seat_limit()` is now an **AFTER** trigger on `member`, `invitation` and `employee` (insert, and update of `user_id`/dates). It locks the tenant's entitlement row, counts billable people, and raises `WS001` above the limit; it also blocks suspended and offboarding tenants (`WS004`) and tenants without entitlements (`WS002`). The functions are `SECURITY DEFINER` because tenant code (`wis_app`) cannot read members or invitations.
- Screens (home, platform list/detail), the seat-limit pre-check, and seat-limit changes all use the same SQL functions, so they cannot disagree with enforcement. `snapshotUsage` stores daily counts per category in `usage_snapshots` (platform-only).

## Consequences

- A new extensible entity only needs a manifest entry plus a table with a `custom_data` column; validation, sensitivity and UI inputs are reusable.
- Reporting on a hot custom field may later need an expression index; equality filters already use the GIN index.
- Roles cannot yet see different _layouts_ (only sensitive/non-sensitive); per-role layouts are deferred.
- Changing the billing rules means changing the SQL functions (new migration), not application code.
