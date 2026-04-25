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
      availability_requests: {
        Row: {
          acknowledged_at: string | null
          created_at: string
          id: string
          message: string | null
          requester_id: string
          status: string
          tutor_id: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          created_at?: string
          id?: string
          message?: string | null
          requester_id: string
          status?: string
          tutor_id: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          created_at?: string
          id?: string
          message?: string | null
          requester_id?: string
          status?: string
          tutor_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      chat_message_attachments: {
        Row: {
          created_at: string
          file_name: string
          id: string
          message_id: string
          mime_type: string | null
          size_bytes: number | null
          storage_path: string
          thread_id: string
          uploader_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          message_id: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path: string
          thread_id: string
          uploader_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          message_id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string
          thread_id?: string
          uploader_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_message_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          sender_id: string
          thread_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          sender_id: string
          thread_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          sender_id?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_reads: {
        Row: {
          created_at: string
          id: string
          last_read_at: string
          thread_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_read_at?: string
          thread_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_read_at?: string
          thread_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_threads: {
        Row: {
          created_at: string
          id: string
          last_message_at: string | null
          last_message_preview: string | null
          student_id: string
          tutor_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          student_id: string
          tutor_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          student_id?: string
          tutor_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      lesson_attachments: {
        Row: {
          created_at: string
          file_name: string
          id: string
          lesson_id: string
          mime_type: string | null
          size_bytes: number | null
          storage_path: string
          uploader_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          lesson_id: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path: string
          uploader_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          lesson_id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string
          uploader_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_attachments_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_attachments_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons_visible"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_change_requests: {
        Row: {
          charge_decision: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          kind: string
          lesson_id: string
          proposed_starts_at: string | null
          reason: string | null
          status: string
          student_id: string
          tutor_id: string
          tutor_response: string | null
          updated_at: string
        }
        Insert: {
          charge_decision?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          kind: string
          lesson_id: string
          proposed_starts_at?: string | null
          reason?: string | null
          status?: string
          student_id: string
          tutor_id: string
          tutor_response?: string | null
          updated_at?: string
        }
        Update: {
          charge_decision?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          kind?: string
          lesson_id?: string
          proposed_starts_at?: string | null
          reason?: string | null
          status?: string
          student_id?: string
          tutor_id?: string
          tutor_response?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      lesson_payment_reminders: {
        Row: {
          channel: string
          id: string
          lesson_id: string
          reminder_kind: string
          sent_at: string
          student_id: string
          tutor_id: string
        }
        Insert: {
          channel?: string
          id?: string
          lesson_id: string
          reminder_kind: string
          sent_at?: string
          student_id: string
          tutor_id: string
        }
        Update: {
          channel?: string
          id?: string
          lesson_id?: string
          reminder_kind?: string
          sent_at?: string
          student_id?: string
          tutor_id?: string
        }
        Relationships: []
      }
      lessons: {
        Row: {
          created_at: string
          created_by: string
          duration_minutes: number
          homework: string | null
          id: string
          meeting_url: string | null
          notes: string | null
          source: string
          starts_at: string
          status: Database["public"]["Enums"]["lesson_status"]
          student_id: string
          student_notes: string | null
          student_paid_at: string | null
          student_payment_status: Database["public"]["Enums"]["payment_status"]
          student_price: number
          subject: string
          summary: string | null
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
          homework?: string | null
          id?: string
          meeting_url?: string | null
          notes?: string | null
          source?: string
          starts_at: string
          status?: Database["public"]["Enums"]["lesson_status"]
          student_id: string
          student_notes?: string | null
          student_paid_at?: string | null
          student_payment_status?: Database["public"]["Enums"]["payment_status"]
          student_price?: number
          subject: string
          summary?: string | null
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
          homework?: string | null
          id?: string
          meeting_url?: string | null
          notes?: string | null
          source?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["lesson_status"]
          student_id?: string
          student_notes?: string | null
          student_paid_at?: string | null
          student_payment_status?: Database["public"]["Enums"]["payment_status"]
          student_price?: number
          subject?: string
          summary?: string | null
          tutor_id?: string
          tutor_paid_at?: string | null
          tutor_payout?: number
          tutor_payout_status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: []
      }
      manager_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
        }
        Relationships: []
      }
      manager_notes: {
        Row: {
          author_id: string
          content: string
          created_at: string
          id: string
          subject_user_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          content: string
          created_at?: string
          id?: string
          subject_user_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string
          id?: string
          subject_user_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      paywall_events: {
        Row: {
          created_at: string
          feature_key: string
          id: string
          metadata: Json
          source: string
          subscription_status: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          feature_key: string
          id?: string
          metadata?: Json
          source?: string
          subscription_status?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          feature_key?: string
          id?: string
          metadata?: Json
          source?: string
          subscription_status?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profile_contacts: {
        Row: {
          created_at: string
          email: string | null
          facebook_url: string | null
          instagram_url: string | null
          messenger_url: string | null
          phone: string | null
          telegram: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          facebook_url?: string | null
          instagram_url?: string | null
          messenger_url?: string | null
          phone?: string | null
          telegram?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          facebook_url?: string | null
          instagram_url?: string | null
          messenger_url?: string | null
          phone?: string | null
          telegram?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profile_financial_contacts: {
        Row: {
          bank_card_last4: string | null
          bank_name: string | null
          created_at: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          bank_card_last4?: string | null
          bank_name?: string | null
          created_at?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          bank_card_last4?: string | null
          bank_name?: string | null
          created_at?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_financial_contacts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
          source: string
          student_id: string
          subject: string
          tutor_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          price_per_lesson?: number
          source?: string
          student_id: string
          subject?: string
          tutor_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          price_per_lesson?: number
          source?: string
          student_id?: string
          subject?: string
          tutor_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      subscription_requests: {
        Row: {
          created_at: string
          handled_at: string | null
          handled_by: string | null
          id: string
          manager_response: string | null
          message: string | null
          plan: string
          price: number
          status: Database["public"]["Enums"]["subscription_request_status"]
          tutor_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          manager_response?: string | null
          message?: string | null
          plan?: string
          price?: number
          status?: Database["public"]["Enums"]["subscription_request_status"]
          tutor_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          manager_response?: string | null
          message?: string | null
          plan?: string
          price?: number
          status?: Database["public"]["Enums"]["subscription_request_status"]
          tutor_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      telegram_bot_state: {
        Row: {
          id: number
          update_offset: number
          updated_at: string
        }
        Insert: {
          id: number
          update_offset?: number
          updated_at?: string
        }
        Update: {
          id?: number
          update_offset?: number
          updated_at?: string
        }
        Relationships: []
      }
      tutor_availability_overrides: {
        Row: {
          created_at: string
          end_minute: number
          id: string
          is_available: boolean
          slot_date: string
          start_minute: number
          tutor_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_minute: number
          id?: string
          is_available?: boolean
          slot_date: string
          start_minute: number
          tutor_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_minute?: number
          id?: string
          is_available?: boolean
          slot_date?: string
          start_minute?: number
          tutor_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tutor_availability_weekly: {
        Row: {
          created_at: string
          end_minute: number
          id: string
          start_minute: number
          tutor_id: string
          updated_at: string
          weekday: number
        }
        Insert: {
          created_at?: string
          end_minute: number
          id?: string
          start_minute: number
          tutor_id: string
          updated_at?: string
          weekday: number
        }
        Update: {
          created_at?: string
          end_minute?: number
          id?: string
          start_minute?: number
          tutor_id?: string
          updated_at?: string
          weekday?: number
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
      tutor_referral_requests: {
        Row: {
          budget_note: string | null
          created_at: string
          id: string
          manager_response: string | null
          message: string | null
          preferred_days: string | null
          preferred_level: string | null
          preferred_times: string | null
          resolved_at: string | null
          status: string
          student_id: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          budget_note?: string | null
          created_at?: string
          id?: string
          manager_response?: string | null
          message?: string | null
          preferred_days?: string | null
          preferred_level?: string | null
          preferred_times?: string | null
          resolved_at?: string | null
          status?: string
          student_id: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          budget_note?: string | null
          created_at?: string
          id?: string
          manager_response?: string | null
          message?: string | null
          preferred_days?: string | null
          preferred_level?: string | null
          preferred_times?: string | null
          resolved_at?: string | null
          status?: string
          student_id?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tutor_student_defaults: {
        Row: {
          created_at: string
          default_meeting_url: string | null
          id: string
          student_id: string
          tutor_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_meeting_url?: string | null
          id?: string
          student_id: string
          tutor_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_meeting_url?: string | null
          id?: string
          student_id?: string
          tutor_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tutor_subject_rates: {
        Row: {
          created_at: string
          id: string
          rate_per_lesson: number
          subject: string
          tutor_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          rate_per_lesson?: number
          subject: string
          tutor_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          rate_per_lesson?: number
          subject?: string
          tutor_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tutor_workspace_settings: {
        Row: {
          cancel_free_hours: number
          created_at: string
          independent_workspace: boolean
          onboarding_completed: boolean
          onboarding_step: number
          payment_due_days: number
          payment_due_mode: string
          payment_reminder_enabled: boolean
          subscription_status: string
          subscription_until: string | null
          trial_until: string | null
          tutor_id: string
          updated_at: string
        }
        Insert: {
          cancel_free_hours?: number
          created_at?: string
          independent_workspace?: boolean
          onboarding_completed?: boolean
          onboarding_step?: number
          payment_due_days?: number
          payment_due_mode?: string
          payment_reminder_enabled?: boolean
          subscription_status?: string
          subscription_until?: string | null
          trial_until?: string | null
          tutor_id: string
          updated_at?: string
        }
        Update: {
          cancel_free_hours?: number
          created_at?: string
          independent_workspace?: boolean
          onboarding_completed?: boolean
          onboarding_step?: number
          payment_due_days?: number
          payment_due_mode?: string
          payment_reminder_enabled?: boolean
          subscription_status?: string
          subscription_until?: string | null
          trial_until?: string | null
          tutor_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tutor_workspace_settings_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      user_telegram_links: {
        Row: {
          chat_id: number | null
          created_at: string
          id: string
          link_code: string | null
          link_code_expires_at: string | null
          linked_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          chat_id?: number | null
          created_at?: string
          id?: string
          link_code?: string | null
          link_code_expires_at?: string | null
          linked_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          chat_id?: number | null
          created_at?: string
          id?: string
          link_code?: string | null
          link_code_expires_at?: string | null
          linked_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      lessons_visible: {
        Row: {
          created_at: string | null
          created_by: string | null
          duration_minutes: number | null
          homework: string | null
          id: string | null
          meeting_url: string | null
          notes: string | null
          source: string | null
          starts_at: string | null
          status: Database["public"]["Enums"]["lesson_status"] | null
          student_id: string | null
          student_notes: string | null
          student_paid_at: string | null
          student_payment_status:
            | Database["public"]["Enums"]["payment_status"]
            | null
          student_price: number | null
          subject: string | null
          summary: string | null
          tutor_id: string | null
          tutor_paid_at: string | null
          tutor_payout: number | null
          tutor_payout_status:
            | Database["public"]["Enums"]["payment_status"]
            | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          duration_minutes?: number | null
          homework?: string | null
          id?: string | null
          meeting_url?: string | null
          notes?: string | null
          source?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["lesson_status"] | null
          student_id?: string | null
          student_notes?: never
          student_paid_at?: never
          student_payment_status?: never
          student_price?: never
          subject?: string | null
          summary?: string | null
          tutor_id?: string | null
          tutor_paid_at?: never
          tutor_payout?: never
          tutor_payout_status?: never
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          duration_minutes?: number | null
          homework?: string | null
          id?: string | null
          meeting_url?: string | null
          notes?: string | null
          source?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["lesson_status"] | null
          student_id?: string | null
          student_notes?: never
          student_paid_at?: never
          student_payment_status?: never
          student_price?: never
          subject?: string | null
          summary?: string | null
          tutor_id?: string | null
          tutor_paid_at?: never
          tutor_payout?: never
          tutor_payout_status?: never
          updated_at?: string | null
        }
        Relationships: []
      }
      tutor_public_details: {
        Row: {
          bio: string | null
          created_at: string | null
          subjects: string[] | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          bio?: string | null
          created_at?: string | null
          subjects?: string[] | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          bio?: string | null
          created_at?: string | null
          subjects?: string[] | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      check_user_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      generate_telegram_link_code: {
        Args: { _user_id: string }
        Returns: string
      }
      get_lesson_financials: {
        Args: { _lesson_id: string }
        Returns: {
          id: string
          student_paid_at: string
          student_payment_status: Database["public"]["Enums"]["payment_status"]
          student_price: number
          tutor_paid_at: string
          tutor_payout: number
          tutor_payout_status: Database["public"]["Enums"]["payment_status"]
        }[]
      }
      get_or_create_chat_thread: {
        Args: { _student_id: string; _tutor_id: string }
        Returns: string
      }
      get_tutor_independent_student_count: {
        Args: { _tutor_id: string }
        Returns: number
      }
      has_role:
        | {
            Args: { _role: Database["public"]["Enums"]["app_role"] }
            Returns: boolean
          }
        | {
            Args: {
              _role: Database["public"]["Enums"]["app_role"]
              _user_id: string
            }
            Returns: boolean
          }
      is_independent_tutor: { Args: { _user_id: string }; Returns: boolean }
      is_tutor_pro: { Args: { _tutor_id: string }; Returns: boolean }
      list_lesson_financials: {
        Args: never
        Returns: {
          id: string
          student_paid_at: string
          student_payment_status: Database["public"]["Enums"]["payment_status"]
          student_price: number
          tutor_paid_at: string
          tutor_payout: number
          tutor_payout_status: Database["public"]["Enums"]["payment_status"]
        }[]
      }
      merge_pending_profile: {
        Args: { _email: string; _phone: string; _real_id: string }
        Returns: string
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
    }
    Enums: {
      app_role: "manager" | "tutor" | "student"
      lesson_status: "pending" | "scheduled" | "completed" | "cancelled"
      payment_status: "unpaid" | "paid"
      subscription_request_status:
        | "new"
        | "in_progress"
        | "completed"
        | "rejected"
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
      subscription_request_status: [
        "new",
        "in_progress",
        "completed",
        "rejected",
      ],
    },
  },
} as const
