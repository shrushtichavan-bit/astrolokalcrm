# Admin Panel + Pool-Based Rounds

## 1. Database changes (single migration)

- `ALTER TABLE leads ADD COLUMN lead_date DATE;`
- No other schema changes — existing `stage_pools`, `interview_rounds`, `call_attempts`, `calling_status`, `expert_profiles`, `round_config`, `users` already support everything needed.

## 2. Sync update (`src/lib/sync.functions.ts` / `src/lib/sheets.server.ts`)

- Read column G as `lead_date`; parse `DD/MM/YYYY` or `YYYY-MM-DD` → ISO date.
- Upsert into `leads.lead_date` on every leads sync.

## 3. Pool-based round logic audit (`src/lib/leads.functions.ts`, `src/lib/lead-helpers.server.ts`)

- Remove any `user.role === 'kam'` gates around round actions. Eligibility for any round N is purely: `exists(stage_pools where stage='round_N' and eligible_email = me)`.
- Same for `expert_creation` pool — not role-based.
- Calling stage remains owner-based (`leads.assigned_to_email` / `current_owner_email`).
- Admin role only used to gate `/admin/*` routes.

## 4. Server functions for admin (`src/lib/admin.functions.ts`)

All protected by `requireAdmin()` helper that calls `requireRole('admin')` (extend the `Role` type to include `'admin'` in `src/lib/auth.server.ts`).

- `getFunnel({ from?, to?, person? })` → reads `round_config.num_rounds`, returns rows: Leads Uploaded, Attempt Made, Connected, Round 1..N Done, Passed, Profile Created, Active. Filter leads by `lead_date` range.
- `getCallers({ from?, to? })` → per `assigned_to_email`: assigned/A1/A2/A3/connected counts + conversion.
- `getRoundWorkers({ round, from?, to? })` → per email in `stage_pools where stage='round_N'`: assigned (rounds started)/done (submitted)/pass rate.
- `getCreationAgents({ from?, to? })` → per email in `stage_pools where stage='expert_creation'`: assigned/created/active.
- `getTAT({ from?, to? })` → SQL aggregates (avg/min/max in hours) for each stage transition; round rows dynamic by `num_rounds`.
- `listAllLeads({ from?, to?, person?, stage?, status?, verdict?, sort? })` → flattened rows with A1/A2/A3 outcomes + per-round verdicts + computed display stage.
- `exportLeadsCsv(filters)` → returns CSV string.

All queries via `supabaseAdmin`. Cache layer is optional; skip in v1 (admin section is low-traffic).

## 5. Admin UI routes

- `src/routes/admin.tsx` — layout with tab nav + `<Outlet/>`; `beforeLoad` redirects non-admin to `/`.
- `src/routes/admin.index.tsx` — Funnel Overview (default).
- `src/routes/admin.people.tsx` — Callers + per-round tables (dynamic) + Creation agents.
- `src/routes/admin.tat.tsx` — TAT table with red-highlight thresholds.
- `src/routes/admin.leads.tsx` — All Leads table with filters, CSV export button.

Each tab has date range + person filters where applicable. Row click → drawer (use existing `Dialog` or `Sheet` component) listing leads.

## 6. Dashboard updates (`src/routes/index.tsx`, `src/routes/leads.$id.tsx`)

- Lead cards: small grey `lead_date` text.
- Dashboard: From/To date range filter on `lead_date`.

## 7. Nav (`src/components/AppShell.tsx`)

- Show "Admin" link only when `me.role === 'admin'`.

## Notes

- "admin" role must exist in `users.role`. Document that admins are seeded by setting role='admin' in the credentials sheet.
- All Date math in SQL via `EXTRACT(EPOCH FROM ...)`.
- Use `Promise.all` in admin handlers for parallelism.
- Dynamically generate round rows in funnel/TAT/people from `round_config.num_rounds` — no hardcoding.
