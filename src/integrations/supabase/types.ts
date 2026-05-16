export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          id: string
          lead_id: string | null
          metadata: Json | null
          performed_at: string
          performed_by: string
        }
        Insert: {
          action: string
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          performed_at?: string
          performed_by: string
        }
        Update: {
          action?: string
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          performed_at?: string
          performed_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      call_attempts: {
        Row: {
          attempt_number: number
          attempted_at: string
          attempted_by: string
          connected: boolean
          id: string
          lead_id: string
          outcome: string | null
        }
        Insert: {
          attempt_number: number
          attempted_at?: string
          attempted_by: string
          connected: boolean
          id?: string
          lead_id: string
          outcome?: string | null
        }
        Update: {
          attempt_number?: number
          attempted_at?: string
          attempted_by?: string
          connected?: boolean
          id?: string
          lead_id?: string
          outcome?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_attempts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      calling_status: {
        Row: {
          assigned_kam_email: string | null
          id: string
          lead_id: string
          remarks: string | null
          set_at: string
          set_by: string
          status: string
        }
        Insert: {
          assigned_kam_email?: string | null
          id?: string
          lead_id: string
          remarks?: string | null
          set_at?: string
          set_by: string
          status: string
        }
        Update: {
          assigned_kam_email?: string | null
          id?: string
          lead_id?: string
          remarks?: string | null
          set_at?: string
          set_by?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "calling_status_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_profiles: {
        Row: {
          activated_at: string | null
          expert_id: string
          id: string
          is_active: boolean
          lead_id: string
          linked_at: string
          linked_by: string
        }
        Insert: {
          activated_at?: string | null
          expert_id: string
          id?: string
          is_active?: boolean
          lead_id: string
          linked_at?: string
          linked_by: string
        }
        Update: {
          activated_at?: string | null
          expert_id?: string
          id?: string
          is_active?: boolean
          lead_id?: string
          linked_at?: string
          linked_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_profiles_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_rounds: {
        Row: {
          conducted_by: string
          id: string
          lead_id: string
          next_owner_email: string | null
          passed: boolean | null
          remarks: string | null
          round_number: number
          started_at: string
          submitted_at: string | null
          total_score: number | null
        }
        Insert: {
          conducted_by: string
          id?: string
          lead_id: string
          next_owner_email?: string | null
          passed?: boolean | null
          remarks?: string | null
          round_number: number
          started_at?: string
          submitted_at?: string | null
          total_score?: number | null
        }
        Update: {
          conducted_by?: string
          id?: string
          lead_id?: string
          next_owner_email?: string | null
          passed?: boolean | null
          remarks?: string | null
          round_number?: number
          started_at?: string
          submitted_at?: string | null
          total_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "interview_rounds_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          assigned_to_email: string
          contact: string
          created_at: string
          current_owner_email: string
          current_stage: string
          id: string
          lead_date: string | null
          lead_id: string
          name: string
          priority: number
          source: string | null
          updated_at: string
        }
        Insert: {
          assigned_to_email: string
          contact: string
          created_at?: string
          current_owner_email: string
          current_stage?: string
          id?: string
          lead_date?: string | null
          lead_id: string
          name: string
          priority?: number
          source?: string | null
          updated_at?: string
        }
        Update: {
          assigned_to_email?: string
          contact?: string
          created_at?: string
          current_owner_email?: string
          current_stage?: string
          id?: string
          lead_date?: string | null
          lead_id?: string
          name?: string
          priority?: number
          source?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      question_grades: {
        Row: {
          grade: number
          id: string
          interview_round_id: string
          question_id: string
          question_text_used: string
        }
        Insert: {
          grade: number
          id?: string
          interview_round_id: string
          question_id: string
          question_text_used: string
        }
        Update: {
          grade?: number
          id?: string
          interview_round_id?: string
          question_id?: string
          question_text_used?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_grades_interview_round_id_fkey"
            columns: ["interview_round_id"]
            isOneToOne: false
            referencedRelation: "interview_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      questions: {
        Row: {
          display_order: number
          id: string
          question_id: string
          question_text: string
          round_number: number
        }
        Insert: {
          display_order: number
          id?: string
          question_id: string
          question_text: string
          round_number: number
        }
        Update: {
          display_order?: number
          id?: string
          question_id?: string
          question_text?: string
          round_number?: number
        }
        Relationships: []
      }
      round_config: {
        Row: {
          id: number
          num_rounds: number
          rounds_required_for_verdict: number
          updated_at: string
        }
        Insert: {
          id?: number
          num_rounds: number
          rounds_required_for_verdict: number
          updated_at?: string
        }
        Update: {
          id?: number
          num_rounds?: number
          rounds_required_for_verdict?: number
          updated_at?: string
        }
        Relationships: []
      }
      round_passing_marks: {
        Row: {
          passing_marks: number
          round_number: number
        }
        Insert: {
          passing_marks: number
          round_number: number
        }
        Update: {
          passing_marks?: number
          round_number?: number
        }
        Relationships: []
      }
      stage_pools: {
        Row: {
          eligible_email: string
          id: string
          stage: string
        }
        Insert: {
          eligible_email: string
          id?: string
          stage: string
        }
        Update: {
          eligible_email?: string
          id?: string
          stage?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string
          password_hash: string
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          name: string
          password_hash: string
          role: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string
          password_hash?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_old_audit_log: { Args: never; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
