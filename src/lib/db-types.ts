// Plain row types for every table, mirroring backend/migrations/001_initial_schema.sql.
// Replaces the old Supabase-generated `Database` type (src/lib/database.types.ts,
// removed) now that queries go through raw SQL via src/lib/db.ts instead of
// the supabase-js query builder.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  password: string | null;
  role: string;
  created_at: string;
  updated_at: string;
}

export interface LeadRow {
  id: string;
  lead_id: string;
  name: string;
  contact: string;
  email: string | null;
  city: string | null;
  language: string | null;
  source: string | null;
  priority: number;
  assigned_to_email: string | null;
  current_stage: string;
  current_owner_email: string | null;
  lead_date: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CallAttemptRow {
  id: string;
  lead_id: string;
  attempt_number: number;
  connected: boolean;
  outcome: string | null;
  attempted_by: string;
  attempted_at: string;
}

export interface CallingStatusRow {
  id: string;
  lead_id: string;
  status: string;
  remarks: string | null;
  assigned_kam_email: string | null;
  set_by: string;
  set_at: string;
}

export interface RoundConfigRow {
  id: number;
  num_rounds: number;
  rounds_required_for_verdict: number;
  updated_at: string;
}

export interface RoundPassingMarkRow {
  round_number: number;
  passing_marks: number;
}

export interface QuestionRow {
  id: string;
  round_number: number;
  question_id: string;
  question_text: string;
  display_order: number;
}

export interface InterviewRoundRow {
  id: string;
  lead_id: string;
  round_number: number;
  conducted_by: string;
  started_at: string;
  submitted_at: string | null;
  total_score: number | null;
  passed: boolean | null;
  remarks: string | null;
  next_owner_email: string | null;
}

export interface QuestionGradeRow {
  id: string;
  interview_round_id: string;
  question_id: string;
  question_text_used: string;
  grade: number;
}

export interface ExpertProfileRow {
  id: string;
  lead_id: string;
  expert_id: string;
  linked_by: string;
  linked_at: string;
  is_active: boolean;
  activated_at: string | null;
}

export interface StagePoolRow {
  id: string;
  stage: string;
  eligible_email: string;
}

export interface AuditLogRow {
  id: string;
  lead_id: string | null;
  action: string;
  performed_by: string;
  metadata: Json | null;
  performed_at: string;
}

export interface SourcePriorityConfigRow {
  id: string;
  source_name: string;
  priority_score: number;
  is_active: boolean;
  form_url: string | null;
  updated_at: string;
}

export interface LeadStageAssignmentRow {
  id: string;
  lead_id: string;
  stage: string;
  assigned_email: string;
  assigned_by: string;
  assigned_at: string;
}

export interface DuplicateLogRow {
  id: string;
  incoming_name: string | null;
  incoming_contact: string;
  incoming_source: string | null;
  matched_lead_id: string | null;
  detected_at: string;
  detected_by: string;
  payload: Json | null;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  resolved_lead_id: string | null;
}

export interface CrmSettingsRow {
  id: number;
  cooldown_days: number;
  default_chain: Json | null;
  updated_at: string;
}
