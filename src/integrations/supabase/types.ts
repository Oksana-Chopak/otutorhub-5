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
      lessons: {
        Row: {
          created_at: string
          created_by: string
          duration_minutes: number
          id: string
          notes: string | null
          starts_at: string
          status: Database["public"]["Enums"]["lesson_status"]
          student_id: string
          student_paid_at: string | null
          student_payment_status: Database["public"]["Enums"]["payment_status"]
          student_price: number
          subject: string
          tutor_id: string
          tutor_paid_at: string | null
          tutor_payout: number
          tutor_payout_status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          duration_minutes?: number
          id?: string
          notes?: string | null
          starts_at: string
          status?: Database["public"]["Enums"]["lesson_status"]
          student_id: string
          student_paid_at?: string | null
          student_payment_status?: Database["public"]["Enums"]["payment_status"]
          student_price?: number
          subject: string
          tutor_id: string
          tutor_paid_at?: string | null
          tutor_payout?: number
          tutor_payout_status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          duration_minutes?: number
          id?: string
          notes?: string | null
          starts_at?: string
          status?: Database["public"]["Enums"]["lesson_status"]
          student_id?: string
          student_paid_at?: string | null
          student_payment_status?: Database["public"]["Enums"]["payment_status"]
          student_price?: number
          subject?: string
          tutor_id?: string
          tutor_paid_at?: string | null
          tutor_payout?: number
          tutor_payout_status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: []
      }
      profile_contacts: {
        Row: {
          created_at: string
          email: string | null
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          first_name: string
          id: string
          is_pending: boolean
          last_name: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          first_name?: string
          id: string
          is_pending?: boolean
          last_name?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          first_name?: string
          id?: string
          is_pending?: boolean
          last_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      student_details: {
        Row: {
          created_at: string
          grade_level: string | null
          parent_contact: string | null
          parent_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          grade_level?: string | null
          parent_contact?: string | null
          parent_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          grade_level?: string | null
          parent_contact?: string | null
          parent_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      student_rates: {
        Row: {
          created_at: string
          id: string
          price_per_lesson: number
          student_id: string
          tutor_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          price_per_lesson?: number
          student_id: string
          tutor_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          price_per_lesson?: number
          student_id?: string
          tutor_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tutor_details: {
        Row: {
          bio: string | null
          created_at: string
          rate_per_lesson: number
          subjects: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          bio?: string | null
          created_at?: string
          rate_per_lesson?: number
          subjects?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          bio?: string | null
          created_at?: string
          rate_per_lesson?: number
          subjects?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      merge_pending_profile: {
        Args: { _email: string; _phone: string; _real_id: string }
        Returns: string
      }
    }
    Enums: {
      app_role: "manager" | "tutor" | "student"
      lesson_status: "pending" | "scheduled" | "completed" | "cancelled"
      payment_status: "unpaid" | "paid"
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
    Enums: {
      app_role: ["manager", "tutor", "student"],
      lesson_status: ["pending", "scheduled", "completed", "cancelled"],
      payment_status: ["unpaid", "paid"],
    },
  },
} as const
