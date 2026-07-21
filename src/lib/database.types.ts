// Hand-maintained mirror of the Supabase schema (12 original tables + 3 added
// for the allotment/sources/dedup features). Keep in sync with supabase/migrations.
// `Relationships: []` on every table and `Views`/`Functions` on the schema are
// required to satisfy @supabase/postgrest-js's GenericSchema/GenericTable
// constraints — omitting them silently collapses every query result to `never`.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          name: string;
          email: string;
          password_hash: string;
          role: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          email: string;
          password_hash: string;
          role: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["users"]["Insert"]>;
        Relationships: [];
      };
      leads: {
        Row: {
          id: string;
          lead_id: string;
          name: string;
          contact: string;
          email: string | null;
          city: string | null;
          language: string | null;
          source: string | null;
          priority: number;
          assigned_to_email: string;
          current_stage: string;
          current_owner_email: string;
          lead_date: string | null;
          closed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          lead_id: string;
          name: string;
          contact: string;
          email?: string | null;
          city?: string | null;
          language?: string | null;
          source?: string | null;
          priority?: number;
          assigned_to_email: string;
          current_stage?: string;
          current_owner_email: string;
          lead_date?: string | null;
          closed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["leads"]["Insert"]>;
        Relationships: [];
      };
      call_attempts: {
        Row: {
          id: string;
          lead_id: string;
          attempt_number: number;
          connected: boolean;
          outcome: string | null;
          attempted_by: string;
          attempted_at: string;
        };
        Insert: {
          id?: string;
          lead_id: string;
          attempt_number: number;
          connected: boolean;
          outcome?: string | null;
          attempted_by: string;
          attempted_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["call_attempts"]["Insert"]>;
        Relationships: [];
      };
      calling_status: {
        Row: {
          id: string;
          lead_id: string;
          status: string;
          remarks: string | null;
          assigned_kam_email: string | null;
          set_by: string;
          set_at: string;
        };
        Insert: {
          id?: string;
          lead_id: string;
          status: string;
          remarks?: string | null;
          assigned_kam_email?: string | null;
          set_by: string;
          set_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["calling_status"]["Insert"]>;
        Relationships: [];
      };
      round_config: {
        Row: { id: number; num_rounds: number; rounds_required_for_verdict: number; updated_at: string };
        Insert: {
          id?: number;
          num_rounds: number;
          rounds_required_for_verdict: number;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["round_config"]["Insert"]>;
        Relationships: [];
      };
      round_passing_marks: {
        Row: { round_number: number; passing_marks: number };
        Insert: { round_number: number; passing_marks: number };
        Update: Partial<Database["public"]["Tables"]["round_passing_marks"]["Insert"]>;
        Relationships: [];
      };
      questions: {
        Row: { id: string; round_number: number; question_id: string; question_text: string; display_order: number };
        Insert: {
          id?: string;
          round_number: number;
          question_id: string;
          question_text: string;
          display_order: number;
        };
        Update: Partial<Database["public"]["Tables"]["questions"]["Insert"]>;
        Relationships: [];
      };
      interview_rounds: {
        Row: {
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
        };
        Insert: {
          id?: string;
          lead_id: string;
          round_number: number;
          conducted_by: string;
          started_at?: string;
          submitted_at?: string | null;
          total_score?: number | null;
          passed?: boolean | null;
          remarks?: string | null;
          next_owner_email?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["interview_rounds"]["Insert"]>;
        Relationships: [];
      };
      question_grades: {
        Row: { id: string; interview_round_id: string; question_id: string; question_text_used: string; grade: number };
        Insert: {
          id?: string;
          interview_round_id: string;
          question_id: string;
          question_text_used: string;
          grade: number;
        };
        Update: Partial<Database["public"]["Tables"]["question_grades"]["Insert"]>;
        Relationships: [];
      };
      expert_profiles: {
        Row: {
          id: string;
          lead_id: string;
          expert_id: string;
          linked_by: string;
          linked_at: string;
          is_active: boolean;
          activated_at: string | null;
        };
        Insert: {
          id?: string;
          lead_id: string;
          expert_id: string;
          linked_by: string;
          linked_at?: string;
          is_active?: boolean;
          activated_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["expert_profiles"]["Insert"]>;
        Relationships: [];
      };
      stage_pools: {
        Row: { id: string; stage: string; eligible_email: string };
        Insert: { id?: string; stage: string; eligible_email: string };
        Update: Partial<Database["public"]["Tables"]["stage_pools"]["Insert"]>;
        Relationships: [];
      };
      audit_log: {
        Row: {
          id: string;
          lead_id: string | null;
          action: string;
          performed_by: string;
          metadata: Json | null;
          performed_at: string;
        };
        Insert: {
          id?: string;
          lead_id?: string | null;
          action: string;
          performed_by: string;
          metadata?: Json | null;
          performed_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["audit_log"]["Insert"]>;
        Relationships: [];
      };
      source_priority_config: {
        Row: { id: string; source_name: string; priority_score: number; is_active: boolean; updated_at: string };
        Insert: {
          id?: string;
          source_name: string;
          priority_score?: number;
          is_active?: boolean;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["source_priority_config"]["Insert"]>;
        Relationships: [];
      };
      lead_stage_assignments: {
        Row: {
          id: string;
          lead_id: string;
          stage: string;
          assigned_email: string;
          assigned_by: string;
          assigned_at: string;
        };
        Insert: {
          id?: string;
          lead_id: string;
          stage: string;
          assigned_email: string;
          assigned_by: string;
          assigned_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["lead_stage_assignments"]["Insert"]>;
        Relationships: [];
      };
      duplicate_log: {
        Row: {
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
        };
        Insert: {
          id?: string;
          incoming_name?: string | null;
          incoming_contact: string;
          incoming_source?: string | null;
          matched_lead_id?: string | null;
          detected_at?: string;
          detected_by: string;
          payload?: Json | null;
          resolved?: boolean;
          resolved_at?: string | null;
          resolved_by?: string | null;
          resolved_lead_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["duplicate_log"]["Insert"]>;
        Relationships: [];
      };
      crm_settings: {
        Row: { id: number; cooldown_days: number; updated_at: string };
        Insert: { id?: number; cooldown_days?: number; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["crm_settings"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
