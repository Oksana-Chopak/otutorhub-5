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
          archived: boolean
          body: string
          created_at: string
          id: string
          sender_id: string
          thread_id: string
        }
        Insert: {
          archived?: boolean
          body: string
          created_at?: string
          id?: string
          sender_id: string
          thread_id: string
        }
        Update: {
          archived?: boolean
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
      group_enrollments: {
        Row: {
          created_at: string
          group_id: string
          id: string
          joined_at: string
          status: string
          student_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          joined_at?: string
          status?: string
          student_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          joined_at?: string
          status?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_enrollments_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "lesson_groups"
            referencedColumns: ["id"]
          },
        ]
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
      lesson_details: {
        Row: {
          created_at: string
          homework: string | null
          lesson_id: string
          student_notes: string | null
          student_paid_at: string | null
          student_payment_status: string | null
          student_price: number | null
          summary: string | null
          tutor_paid_at: string | null
          tutor_payout: number | null
          tutor_payout_status: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          homework?: string | null
          lesson_id: string
          student_notes?: string | null
          student_paid_at?: string | null
          student_payment_status?: string | null
          student_price?: number | null
          summary?: string | null
          tutor_paid_at?: string | null
          tutor_payout?: number | null
          tutor_payout_status?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          homework?: string | null
          lesson_id?: string
          student_notes?: string | null
          student_paid_at?: string | null
          student_payment_status?: string | null
          student_price?: number | null
          summary?: string | null
          tutor_paid_at?: string | null
          tutor_payout?: number | null
          tutor_payout_status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_details_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: true
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_details_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: true
            referencedRelation: "lessons_visible"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_feedback: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          lesson_id: string
          rating: number
          student_id: string
          tutor_id: string
          updated_at: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          lesson_id: string
          rating: number
          student_id: string
          tutor_id: string
          updated_at?: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          lesson_id?: string
          rating?: number
          student_id?: string
          tutor_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      lesson_groups: {
        Row: {
          created_at: string
          id: string
          name: string
          subject: string | null
          subject_id: string | null
          tutor_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          subject?: string | null
          subject_id?: string | null
          tutor_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          subject?: string | null
          subject_id?: string | null
          tutor_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_groups_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
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
      lesson_reminders: {
        Row: {
          channel: string
          id: string
          lesson_id: string
          recipient_id: string
          recipient_role: string
          reminder_kind: string
          sent_at: string
          student_id: string
          tutor_id: string
        }
        Insert: {
          channel?: string
          id?: string
          lesson_id: string
          recipient_id: string
          recipient_role: string
          reminder_kind: string
          sent_at?: string
          student_id: string
          tutor_id: string
        }
        Update: {
          channel?: string
          id?: string
          lesson_id?: string
          recipient_id?: string
          recipient_role?: string
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
          group_id: string | null
          id: string
          lesson_type: Database["public"]["Enums"]["lesson_type"]
          meeting_url: string | null
          notes: string | null
          source: string
          starts_at: string
          status: Database["public"]["Enums"]["lesson_status"]
          student_id: string | null
          subject: string
          subject_id: string | null
          tutor_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          duration_minutes?: number
          group_id?: string | null
          id?: string
          lesson_type?: Database["public"]["Enums"]["lesson_type"]
          meeting_url?: string | null
          notes?: string | null
          source?: string
          starts_at: string
          status?: Database["public"]["Enums"]["lesson_status"]
          student_id?: string | null
          subject: string
          subject_id?: string | null
          tutor_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          duration_minutes?: number
          group_id?: string | null
          id?: string
          lesson_type?: Database["public"]["Enums"]["lesson_type"]
          meeting_url?: string | null
          notes?: string | null
          source?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["lesson_status"]
          student_id?: string | null
          subject?: string
          subject_id?: string | null
          tutor_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lessons_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "lesson_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      liqpay_payments: {
        Row: {
          amount: number
          card_token: string | null
          created_at: string
          currency: string
          id: string
          is_recurring: boolean
          liqpay_action: string | null
          liqpay_payment_id: string | null
          order_id: string
          paid_at: string | null
          period_end: string | null
          period_start: string | null
          plan: string
          raw_callback: Json | null
          status: string
          tutor_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          card_token?: string | null
          created_at?: string
          currency?: string
          id?: string
          is_recurring?: boolean
          liqpay_action?: string | null
          liqpay_payment_id?: string | null
          order_id: string
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          plan: string
          raw_callback?: Json | null
          status?: string
          tutor_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          card_token?: string | null
          created_at?: string
          currency?: string
          id?: string
          is_recurring?: boolean
          liqpay_action?: string | null
          liqpay_payment_id?: string | null
          order_id?: string
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          plan?: string
          raw_callback?: Json | null
          status?: string
          tutor_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "liqpay_payments_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      pro_bonus_ledger: {
        Row: {
          created_at: string
          days_granted: number
          id: string
          metadata: Json | null
          reason: string
          tutor_id: string
        }
        Insert: {
          created_at?: string
          days_granted: number
          id?: string
          metadata?: Json | null
          reason: string
          tutor_id: string
        }
        Update: {
          created_at?: string
          days_granted?: number
          id?: string
          metadata?: Json | null
          reason?: string
          tutor_id?: string
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
          archived_at: string | null
          avatar_url: string | null
          created_at: string
          first_name: string
          id: string
          is_pending: boolean
          last_name: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          avatar_url?: string | null
          created_at?: string
          first_name?: string
          id: string
          is_pending?: boolean
          last_name?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
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
      referral_codes: {
        Row: {
          code: string
          created_at: string
          id: string
          tutor_id: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          tutor_id: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          tutor_id?: string
        }
        Relationships: []
      }
      referrals: {
        Row: {
          code: string
          created_at: string
          id: string
          pro_bonus_granted: boolean
          referred_id: string
          referrer_id: string
          signed_up_at: string
          signup_bonus_granted: boolean
          upgraded_to_pro_at: string | null
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          pro_bonus_granted?: boolean
          referred_id: string
          referrer_id: string
          signed_up_at?: string
          signup_bonus_granted?: boolean
          upgraded_to_pro_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          pro_bonus_granted?: boolean
          referred_id?: string
          referrer_id?: string
          signed_up_at?: string
          signup_bonus_granted?: boolean
          upgraded_to_pro_at?: string | null
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
      student_intake_quiz: {
        Row: {
          created_at: string
          goal: string | null
          goal_other: string | null
          id: string
          level: string | null
          schedule: string[]
          student_id: string
          subjects: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          goal?: string | null
          goal_other?: string | null
          id?: string
          level?: string | null
          schedule?: string[]
          student_id: string
          subjects?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          goal?: string | null
          goal_other?: string | null
          id?: string
          level?: string | null
          schedule?: string[]
          student_id?: string
          subjects?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      student_rates: {
        Row: {
          archived_at: string | null
          created_at: string
          currency: string
          id: string
          payment_details: string | null
          price_per_lesson: number
          source: string
          student_id: string
          subject: string
          tutor_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          payment_details?: string | null
          price_per_lesson?: number
          source?: string
          student_id: string
          subject?: string
          tutor_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          payment_details?: string | null
          price_per_lesson?: number
          source?: string
          student_id?: string
          subject?: string
          tutor_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      student_wallet_transactions: {
        Row: {
          amount_delta: number
          created_at: string
          created_by: string | null
          id: string
          kind: string
          lesson_id: string | null
          lessons_delta: number
          note: string | null
          student_id: string
          tutor_id: string
        }
        Insert: {
          amount_delta?: number
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          lesson_id?: string | null
          lessons_delta?: number
          note?: string | null
          student_id: string
          tutor_id: string
        }
        Update: {
          amount_delta?: number
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          lesson_id?: string | null
          lessons_delta?: number
          note?: string | null
          student_id?: string
          tutor_id?: string
        }
        Relationships: []
      }
      subjects: {
        Row: {
          created_at: string
          emoji: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          emoji?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          emoji?: string | null
          id?: string
          name?: string
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
      tutor_badges: {
        Row: {
          awarded_at: string
          badge_key: string
          id: string
          metadata: Json | null
          tutor_id: string
        }
        Insert: {
          awarded_at?: string
          badge_key: string
          id?: string
          metadata?: Json | null
          tutor_id: string
        }
        Update: {
          awarded_at?: string
          badge_key?: string
          id?: string
          metadata?: Json | null
          tutor_id?: string
        }
        Relationships: []
      }
      tutor_daily_digests: {
        Row: {
          channel: string
          digest_date: string
          id: string
          sent_at: string
          tutor_id: string
        }
        Insert: {
          channel?: string
          digest_date: string
          id?: string
          sent_at?: string
          tutor_id: string
        }
        Update: {
          channel?: string
          digest_date?: string
          id?: string
          sent_at?: string
          tutor_id?: string
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
      tutor_notes: {
        Row: {
          created_at: string
          id: string
          text: string
          tutor_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          text: string
          tutor_id: string
        }
        Update: {
          created_at?: string
          id?: string
          text?: string
          tutor_id?: string
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
      tutor_streaks: {
        Row: {
          bonus_granted_at: string | null
          current_streak: number
          freezes_available: number
          freezes_granted_month: string | null
          last_freeze_used_at: string | null
          last_lesson_date: string | null
          longest_streak: number
          tutor_id: string
          updated_at: string
        }
        Insert: {
          bonus_granted_at?: string | null
          current_streak?: number
          freezes_available?: number
          freezes_granted_month?: string | null
          last_freeze_used_at?: string | null
          last_lesson_date?: string | null
          longest_streak?: number
          tutor_id: string
          updated_at?: string
        }
        Update: {
          bonus_granted_at?: string | null
          current_streak?: number
          freezes_available?: number
          freezes_granted_month?: string | null
          last_freeze_used_at?: string | null
          last_lesson_date?: string | null
          longest_streak?: number
          tutor_id?: string
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
      tutor_student_pairs: {
        Row: {
          created_at: string
          from_lessons: number
          from_rates: number
          student_id: string
          tutor_id: string
        }
        Insert: {
          created_at?: string
          from_lessons?: number
          from_rates?: number
          student_id: string
          tutor_id: string
        }
        Update: {
          created_at?: string
          from_lessons?: number
          from_rates?: number
          student_id?: string
          tutor_id?: string
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
          current_plan: string | null
          daily_digest_enabled: boolean
          independent_workspace: boolean
          liqpay_card_token: string | null
          liqpay_recurring_active: boolean
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
          current_plan?: string | null
          daily_digest_enabled?: boolean
          independent_workspace?: boolean
          liqpay_card_token?: string | null
          liqpay_recurring_active?: boolean
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
          current_plan?: string | null
          daily_digest_enabled?: boolean
          independent_workspace?: boolean
          liqpay_card_token?: string | null
          liqpay_recurring_active?: boolean
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
          group_id: string | null
          homework: string | null
          id: string | null
          lesson_type: Database["public"]["Enums"]["lesson_type"] | null
          meeting_url: string | null
          notes: string | null
          source: string | null
          starts_at: string | null
          status: Database["public"]["Enums"]["lesson_status"] | null
          student_id: string | null
          student_notes: string | null
          student_paid_at: string | null
          student_payment_status: string | null
          student_price: number | null
          subject: string | null
          subject_id: string | null
          summary: string | null
          tutor_id: string | null
          tutor_paid_at: string | null
          tutor_payout: number | null
          tutor_payout_status: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lessons_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "lesson_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      student_wallet_balances: {
        Row: {
          amount_balance: number | null
          last_transaction_at: string | null
          lessons_balance: number | null
          student_id: string | null
          tutor_id: string | null
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
      claim_referral: { Args: { _code: string }; Returns: Json }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      generate_referral_code: { Args: { _tutor_id: string }; Returns: string }
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
      get_referral_leaderboard: {
        Args: { _month: number; _year: number }
        Returns: {
          first_name: string
          last_name: string
          pro_upgrades: number
          referrer_id: string
          total_signups: number
        }[]
      }
      get_referral_savings_uah: { Args: { _tutor_id: string }; Returns: number }
      get_tutor_independent_student_count: {
        Args: { _tutor_id: string }
        Returns: number
      }
      get_tutor_level: { Args: { _tutor_id: string }; Returns: Json }
      get_tutor_monthly_summary: {
        Args: { _month: number; _tutor_id: string; _year: number }
        Returns: Json
      }
      get_wallet_balance: {
        Args: { _student_id: string; _tutor_id: string }
        Returns: {
          amount_balance: number
          lessons_balance: number
        }[]
      }
      grant_pro_days: {
        Args: {
          _days: number
          _metadata?: Json
          _reason: string
          _tutor_id: string
        }
        Returns: undefined
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
      is_group_active_student: {
        Args: { _group_id: string; _user_id: string }
        Returns: boolean
      }
      is_group_tutor: {
        Args: { _group_id: string; _user_id: string }
        Returns: boolean
      }
      is_independent_tutor: { Args: { _user_id: string }; Returns: boolean }
      is_pending_email: { Args: { _email: string }; Returns: boolean }
      is_pending_profile: { Args: { _user_id: string }; Returns: boolean }
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
      manager_purge_user: { Args: { _user_id: string }; Returns: undefined }
      mark_referral_pro_upgrade: {
        Args: { _tutor_id: string }
        Returns: undefined
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
      wallet_adjust: {
        Args: {
          _amount_delta: number
          _lessons_delta: number
          _note: string
          _student_id: string
          _tutor_id: string
        }
        Returns: string
      }
      wallet_delete_transaction: {
        Args: { _hard?: boolean; _tx_id: string }
        Returns: string
      }
      wallet_topup: {
        Args: {
          _amount_delta: number
          _lessons_delta: number
          _note?: string
          _student_id: string
          _tutor_id: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "manager" | "tutor" | "student"
      lesson_status: "pending" | "scheduled" | "completed" | "cancelled"
      lesson_type: "individual" | "pair" | "group"
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
      lesson_type: ["individual", "pair", "group"],
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
