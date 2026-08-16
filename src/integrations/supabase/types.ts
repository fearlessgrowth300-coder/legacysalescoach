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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      ai_chat_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          image_url: string | null
          is_edited: boolean
          is_pinned: boolean
          metadata: Json
          role: string
          user_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          image_url?: string | null
          is_edited?: boolean
          is_pinned?: boolean
          metadata?: Json
          role?: string
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          image_url?: string | null
          is_edited?: boolean
          is_pinned?: boolean
          metadata?: Json
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_conversations: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          content: string
          created_at: string
          detected_tone: string | null
          direction: string
          id: string
          is_ai_suggestion: boolean
          prospect_id: string
          screenshot_url: string | null
          thread_type: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          detected_tone?: string | null
          direction?: string
          id?: string
          is_ai_suggestion?: boolean
          prospect_id: string
          screenshot_url?: string | null
          thread_type?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          detected_tone?: string | null
          direction?: string
          id?: string
          is_ai_suggestion?: boolean
          prospect_id?: string
          screenshot_url?: string | null
          thread_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      company_materials: {
        Row: {
          content: string | null
          created_at: string
          file_path: string | null
          format: string
          id: string
          status: string
          title: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          file_path?: string | null
          format?: string
          id?: string
          status?: string
          title: string
          type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string | null
          created_at?: string
          file_path?: string | null
          format?: string
          id?: string
          status?: string
          title?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      company_profiles: {
        Row: {
          business_type: string
          company_name: string
          created_at: string
          id: string
          objections: string | null
          pain_points: string | null
          target_audience: string | null
          updated_at: string
          user_id: string
          what_selling: string | null
        }
        Insert: {
          business_type?: string
          company_name?: string
          created_at?: string
          id?: string
          objections?: string | null
          pain_points?: string | null
          target_audience?: string | null
          updated_at?: string
          user_id: string
          what_selling?: string | null
        }
        Update: {
          business_type?: string
          company_name?: string
          created_at?: string
          id?: string
          objections?: string | null
          pain_points?: string | null
          target_audience?: string | null
          updated_at?: string
          user_id?: string
          what_selling?: string | null
        }
        Relationships: []
      }
      conversation_analytics: {
        Row: {
          ai_suggestions_used: number
          avg_response_time_mins: number | null
          created_at: string
          id: string
          key_insights: string | null
          messages_count: number
          outcome: string
          prospect_id: string | null
          questioning_patterns_used: string[] | null
          tone_progression: string[] | null
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          ai_suggestions_used?: number
          avg_response_time_mins?: number | null
          created_at?: string
          id?: string
          key_insights?: string | null
          messages_count?: number
          outcome?: string
          prospect_id?: string | null
          questioning_patterns_used?: string[] | null
          tone_progression?: string[] | null
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          ai_suggestions_used?: number
          avg_response_time_mins?: number | null
          created_at?: string
          id?: string
          key_insights?: string | null
          messages_count?: number
          outcome?: string
          prospect_id?: string | null
          questioning_patterns_used?: string[] | null
          tone_progression?: string[] | null
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_analytics_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_analytics_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_insights: {
        Row: {
          created_at: string
          id: string
          insight: string
          insight_type: string
          metadata: Json | null
          prospect_id: string | null
          source: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          insight: string
          insight_type?: string
          metadata?: Json | null
          prospect_id?: string | null
          source?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          insight?: string
          insight_type?: string
          metadata?: Json | null
          prospect_id?: string | null
          source?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_insights_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      friend_audience_signals: {
        Row: {
          created_at: string
          first_seen_at: string
          id: string
          last_seen_at: string
          loss_count: number
          observation_count: number
          positive_feedback_count: number
          signal_key: string
          signal_type: string
          updated_at: string
          user_id: string
          win_count: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          loss_count?: number
          observation_count?: number
          positive_feedback_count?: number
          signal_key: string
          signal_type: string
          updated_at?: string
          user_id: string
          win_count?: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          loss_count?: number
          observation_count?: number
          positive_feedback_count?: number
          signal_key?: string
          signal_type?: string
          updated_at?: string
          user_id?: string
          win_count?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "friend_audience_signals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      friend_prospect_signals: {
        Row: {
          first_seen_at: string
          id: string
          last_seen_at: string
          prospect_id: string
          signal_key: string
          signal_type: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          prospect_id: string
          signal_key: string
          signal_type: string
          user_id: string
          workspace_id: string
        }
        Update: {
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          prospect_id?: string
          signal_key?: string
          signal_type?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "friend_prospect_signals_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friend_prospect_signals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_base_items: {
        Row: {
          book_brief: Json | null
          brain_type: string
          created_at: string
          file_path: string | null
          id: string
          indexed_at: string | null
          source_chunk_count: number
          source_index_version: number
          status: string
          title: string
          type: string
          updated_at: string
          url: string | null
          user_id: string
        }
        Insert: {
          book_brief?: Json | null
          brain_type?: string
          created_at?: string
          file_path?: string | null
          id?: string
          indexed_at?: string | null
          source_chunk_count?: number
          source_index_version?: number
          status?: string
          title: string
          type?: string
          updated_at?: string
          url?: string | null
          user_id: string
        }
        Update: {
          book_brief?: Json | null
          brain_type?: string
          created_at?: string
          file_path?: string | null
          id?: string
          indexed_at?: string | null
          source_chunk_count?: number
          source_index_version?: number
          status?: string
          title?: string
          type?: string
          updated_at?: string
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      knowledge_chunks: {
        Row: {
          brain_type: string
          category: string
          chunk_index: number | null
          chunk_kind: string
          content: string
          created_at: string
          embedding: string | null
          id: string
          locator: string | null
          metadata: Json
          relevance_score: number
          source_id: string | null
          source_type: string
          trigger_phrases: string | null
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          brain_type?: string
          category?: string
          chunk_index?: number | null
          chunk_kind?: string
          content: string
          created_at?: string
          embedding?: string | null
          id?: string
          locator?: string | null
          metadata?: Json
          relevance_score?: number
          source_id?: string | null
          source_type?: string
          trigger_phrases?: string | null
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          brain_type?: string
          category?: string
          chunk_index?: number | null
          chunk_kind?: string
          content?: string
          created_at?: string
          embedding?: string | null
          id?: string
          locator?: string | null
          metadata?: Json
          relevance_score?: number
          source_id?: string | null
          source_type?: string
          trigger_phrases?: string | null
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "knowledge_base_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_chunks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_evidence_links: {
        Row: {
          created_at: string
          evidence_mode: string
          extraction_confidence: number
          id: string
          knowledge_chunk_id: string | null
          locator: string | null
          metadata: Json
          node_id: string
          quoted_text: string | null
          sales_brain_id: string | null
          source_id: string | null
          speaker: string | null
          supports_or_contradicts: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          evidence_mode?: string
          extraction_confidence?: number
          id?: string
          knowledge_chunk_id?: string | null
          locator?: string | null
          metadata?: Json
          node_id: string
          quoted_text?: string | null
          sales_brain_id?: string | null
          source_id?: string | null
          speaker?: string | null
          supports_or_contradicts?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          evidence_mode?: string
          extraction_confidence?: number
          id?: string
          knowledge_chunk_id?: string | null
          locator?: string | null
          metadata?: Json
          node_id?: string
          quoted_text?: string | null
          sales_brain_id?: string | null
          source_id?: string | null
          speaker?: string | null
          supports_or_contradicts?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_evidence_links_knowledge_chunk_id_fkey"
            columns: ["knowledge_chunk_id"]
            isOneToOne: false
            referencedRelation: "knowledge_chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_evidence_links_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "sales_knowledge_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_evidence_links_sales_brain_id_fkey"
            columns: ["sales_brain_id"]
            isOneToOne: false
            referencedRelation: "sales_brain"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_evidence_links_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "knowledge_base_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_evidence_links_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_registry: {
        Row: {
          contact_status: string
          created_at: string
          id: string
          last_observed_at: string | null
          name: string
          past_advice: Json | null
          persona_type: string | null
          prospect_id: string | null
          prospect_profile: Json
          psychological_state: string | null
          subtext_analysis: string | null
          updated_at: string
          upload_matches: Json | null
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          contact_status?: string
          created_at?: string
          id?: string
          last_observed_at?: string | null
          name: string
          past_advice?: Json | null
          persona_type?: string | null
          prospect_id?: string | null
          prospect_profile?: Json
          psychological_state?: string | null
          subtext_analysis?: string | null
          updated_at?: string
          upload_matches?: Json | null
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          contact_status?: string
          created_at?: string
          id?: string
          last_observed_at?: string | null
          name?: string
          past_advice?: Json | null
          persona_type?: string | null
          prospect_id?: string | null
          prospect_profile?: Json
          psychological_state?: string | null
          subtext_analysis?: string | null
          updated_at?: string
          upload_matches?: Json | null
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_registry_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_registry_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      learned_insights: {
        Row: {
          created_at: string
          id: string
          insight: string
          insight_type: string
          prospect_id: string | null
          source: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          insight: string
          insight_type?: string
          prospect_id?: string | null
          source?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          insight?: string
          insight_type?: string
          prospect_id?: string | null
          source?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "learned_insights_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learned_insights_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      otp_codes: {
        Row: {
          attempts: number
          code: string
          created_at: string
          email: string
          expires_at: string
          id: string
          type: string
        }
        Insert: {
          attempts?: number
          code: string
          created_at?: string
          email: string
          expires_at: string
          id?: string
          type: string
        }
        Update: {
          attempts?: number
          code?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          type?: string
        }
        Relationships: []
      }
      practice_call_sessions: {
        Row: {
          created_at: string
          id: string
          overall_score: number | null
          phone_number: string
          scenario_id: string
          scenario_name: string
          status: string
          transcript: Json
          twilio_call_sid: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          overall_score?: number | null
          phone_number: string
          scenario_id: string
          scenario_name?: string
          status?: string
          transcript?: Json
          twilio_call_sid?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          overall_score?: number | null
          phone_number?: string
          scenario_id?: string
          scenario_name?: string
          status?: string
          transcript?: Json
          twilio_call_sid?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string
          phone_number: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string
          id?: string
          name?: string
          phone_number?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string
          phone_number?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      prospect_fact_ledger: {
        Row: {
          confidence: number
          contradicts_fact_id: string | null
          created_at: string
          fact_key: string
          fact_value: Json
          first_observed_at: string
          id: string
          invalidated_at: string | null
          last_confirmed_at: string
          metadata: Json
          normalized_value: string
          prospect_id: string
          source_direction: string | null
          source_message_id: string | null
          status: string
          thread_type: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          confidence?: number
          contradicts_fact_id?: string | null
          created_at?: string
          fact_key: string
          fact_value: Json
          first_observed_at?: string
          id?: string
          invalidated_at?: string | null
          last_confirmed_at?: string
          metadata?: Json
          normalized_value: string
          prospect_id: string
          source_direction?: string | null
          source_message_id?: string | null
          status?: string
          thread_type?: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          confidence?: number
          contradicts_fact_id?: string | null
          created_at?: string
          fact_key?: string
          fact_value?: Json
          first_observed_at?: string
          id?: string
          invalidated_at?: string | null
          last_confirmed_at?: string
          metadata?: Json
          normalized_value?: string
          prospect_id?: string
          source_direction?: string | null
          source_message_id?: string | null
          status?: string
          thread_type?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_fact_ledger_contradicts_fact_id_fkey"
            columns: ["contradicts_fact_id"]
            isOneToOne: false
            referencedRelation: "prospect_fact_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_fact_ledger_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_fact_ledger_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_fact_ledger_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      prospects: {
        Row: {
          conversation_stage: string
          conversation_summary: string | null
          created_at: string
          detected_interests: string | null
          has_followed_back: boolean
          id: string
          instagram_url: string | null
          instagram_username: string | null
          name: string
          outcome: string
          platform: string
          profile_pic_url: string | null
          reply_mode: string
          store_url: string | null
          suggested_comment: string | null
          suggested_first_message: string | null
          target_video_caption: string | null
          target_video_url: string | null
          tiktok_url: string | null
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          conversation_stage?: string
          conversation_summary?: string | null
          created_at?: string
          detected_interests?: string | null
          has_followed_back?: boolean
          id?: string
          instagram_url?: string | null
          instagram_username?: string | null
          name: string
          outcome?: string
          platform?: string
          profile_pic_url?: string | null
          reply_mode?: string
          store_url?: string | null
          suggested_comment?: string | null
          suggested_first_message?: string | null
          target_video_caption?: string | null
          target_video_url?: string | null
          tiktok_url?: string | null
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          conversation_stage?: string
          conversation_summary?: string | null
          created_at?: string
          detected_interests?: string | null
          has_followed_back?: boolean
          id?: string
          instagram_url?: string | null
          instagram_username?: string | null
          name?: string
          outcome?: string
          platform?: string
          profile_pic_url?: string | null
          reply_mode?: string
          store_url?: string | null
          suggested_comment?: string | null
          suggested_first_message?: string | null
          target_video_caption?: string | null
          target_video_url?: string | null
          tiktok_url?: string | null
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_brain: {
        Row: {
          brain_type: string
          buying_stages: string[]
          category: string
          common_mistake: string | null
          connected_principles: string | null
          contraindications: string[]
          created_at: string
          embedding: string | null
          evidence_mode: string
          exact_words_to_use: string | null
          extraction_confidence: number
          hidden_causes: string[]
          how_to_apply: string
          id: string
          intended_outcomes: string[]
          knowledge_types: string[]
          language_patterns: string[]
          metadata: Json | null
          objection_types: string[]
          power_level: number | null
          principle_name: string
          psychological_mechanisms: string[]
          real_example_or_story: string | null
          relevance_score: number | null
          source_id: string | null
          source_name: string
          source_type: string
          techniques: string[]
          the_deep_why: string | null
          user_id: string
          what_i_learned: string
          when_not_to_use: string | null
          when_to_use: string | null
          words_to_never_use: string | null
          works_best_for: string | null
          workspace_id: string | null
        }
        Insert: {
          brain_type?: string
          buying_stages?: string[]
          category?: string
          common_mistake?: string | null
          connected_principles?: string | null
          contraindications?: string[]
          created_at?: string
          embedding?: string | null
          evidence_mode?: string
          exact_words_to_use?: string | null
          extraction_confidence?: number
          hidden_causes?: string[]
          how_to_apply: string
          id?: string
          intended_outcomes?: string[]
          knowledge_types?: string[]
          language_patterns?: string[]
          metadata?: Json | null
          objection_types?: string[]
          power_level?: number | null
          principle_name: string
          psychological_mechanisms?: string[]
          real_example_or_story?: string | null
          relevance_score?: number | null
          source_id?: string | null
          source_name: string
          source_type?: string
          techniques?: string[]
          the_deep_why?: string | null
          user_id: string
          what_i_learned: string
          when_not_to_use?: string | null
          when_to_use?: string | null
          words_to_never_use?: string | null
          works_best_for?: string | null
          workspace_id?: string | null
        }
        Update: {
          brain_type?: string
          buying_stages?: string[]
          category?: string
          common_mistake?: string | null
          connected_principles?: string | null
          contraindications?: string[]
          created_at?: string
          embedding?: string | null
          evidence_mode?: string
          exact_words_to_use?: string | null
          extraction_confidence?: number
          hidden_causes?: string[]
          how_to_apply?: string
          id?: string
          intended_outcomes?: string[]
          knowledge_types?: string[]
          language_patterns?: string[]
          metadata?: Json | null
          objection_types?: string[]
          power_level?: number | null
          principle_name?: string
          psychological_mechanisms?: string[]
          real_example_or_story?: string | null
          relevance_score?: number | null
          source_id?: string | null
          source_name?: string
          source_type?: string
          techniques?: string[]
          the_deep_why?: string | null
          user_id?: string
          what_i_learned?: string
          when_not_to_use?: string | null
          when_to_use?: string | null
          words_to_never_use?: string | null
          works_best_for?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_brain_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "knowledge_base_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_brain_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_concepts: {
        Row: {
          aliases: string[]
          canonical_key: string
          concept_type: string
          created_at: string
          description: string | null
          id: string
          metadata: Json
          name: string
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          aliases?: string[]
          canonical_key: string
          concept_type: string
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json
          name: string
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          aliases?: string[]
          canonical_key?: string
          concept_type?: string
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json
          name?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_concepts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_decisions: {
        Row: {
          analysis_snapshot: Json
          created_at: string
          earliest_missing_checkpoint: string | null
          funnel_stage: string | null
          generation_status: string
          hidden_cause_hypothesis: string | null
          id: string
          input_message_id: string | null
          input_text: string
          model_name: string | null
          model_provider: string | null
          next_best_action: string | null
          objection_type: string | null
          prospect_fact_used: string | null
          prospect_id: string
          score_breakdown: Json
          selected_graph_path: Json
          selected_knowledge_node_id: string | null
          selected_sales_brain_id: string | null
          thread_type: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          analysis_snapshot?: Json
          created_at?: string
          earliest_missing_checkpoint?: string | null
          funnel_stage?: string | null
          generation_status?: string
          hidden_cause_hypothesis?: string | null
          id?: string
          input_message_id?: string | null
          input_text: string
          model_name?: string | null
          model_provider?: string | null
          next_best_action?: string | null
          objection_type?: string | null
          prospect_fact_used?: string | null
          prospect_id: string
          score_breakdown?: Json
          selected_graph_path?: Json
          selected_knowledge_node_id?: string | null
          selected_sales_brain_id?: string | null
          thread_type?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          analysis_snapshot?: Json
          created_at?: string
          earliest_missing_checkpoint?: string | null
          funnel_stage?: string | null
          generation_status?: string
          hidden_cause_hypothesis?: string | null
          id?: string
          input_message_id?: string | null
          input_text?: string
          model_name?: string | null
          model_provider?: string | null
          next_best_action?: string | null
          objection_type?: string | null
          prospect_fact_used?: string | null
          prospect_id?: string
          score_breakdown?: Json
          selected_graph_path?: Json
          selected_knowledge_node_id?: string | null
          selected_sales_brain_id?: string | null
          thread_type?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_decisions_input_message_id_fkey"
            columns: ["input_message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_decisions_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_decisions_selected_knowledge_node_id_fkey"
            columns: ["selected_knowledge_node_id"]
            isOneToOne: false
            referencedRelation: "sales_knowledge_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_decisions_selected_sales_brain_id_fkey"
            columns: ["selected_sales_brain_id"]
            isOneToOne: false
            referencedRelation: "sales_brain"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_decisions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_evaluation_cases: {
        Row: {
          active: boolean
          anonymized: boolean
          created_at: string
          expected_facts: Json
          expected_knowledge: Json
          expected_reply_constraints: Json
          expected_stage: string | null
          id: string
          input_conversation: Json
          name: string
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          active?: boolean
          anonymized?: boolean
          created_at?: string
          expected_facts?: Json
          expected_knowledge?: Json
          expected_reply_constraints?: Json
          expected_stage?: string | null
          id?: string
          input_conversation: Json
          name: string
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          active?: boolean
          anonymized?: boolean
          created_at?: string
          expected_facts?: Json
          expected_knowledge?: Json
          expected_reply_constraints?: Json
          expected_stage?: string | null
          id?: string
          input_conversation?: Json
          name?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_evaluation_cases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_evaluation_runs: {
        Row: {
          created_at: string
          evaluation_case_id: string
          failure_reasons: string[]
          generated_decision: Json
          generated_reply: string | null
          id: string
          metrics: Json
          model_name: string | null
          model_provider: string | null
          passed: boolean
          total_score: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          evaluation_case_id: string
          failure_reasons?: string[]
          generated_decision?: Json
          generated_reply?: string | null
          id?: string
          metrics?: Json
          model_name?: string | null
          model_provider?: string | null
          passed?: boolean
          total_score?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          evaluation_case_id?: string
          failure_reasons?: string[]
          generated_decision?: Json
          generated_reply?: string | null
          id?: string
          metrics?: Json
          model_name?: string | null
          model_provider?: string | null
          passed?: boolean
          total_score?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_evaluation_runs_evaluation_case_id_fkey"
            columns: ["evaluation_case_id"]
            isOneToOne: false
            referencedRelation: "sales_evaluation_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_knowledge_edges: {
        Row: {
          confidence: number
          created_at: string
          evidence_count: number
          from_node_id: string
          id: string
          metadata: Json
          relationship_type: string
          to_node_id: string
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          confidence?: number
          created_at?: string
          evidence_count?: number
          from_node_id: string
          id?: string
          metadata?: Json
          relationship_type: string
          to_node_id: string
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          confidence?: number
          created_at?: string
          evidence_count?: number
          from_node_id?: string
          id?: string
          metadata?: Json
          relationship_type?: string
          to_node_id?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_knowledge_edges_from_node_id_fkey"
            columns: ["from_node_id"]
            isOneToOne: false
            referencedRelation: "sales_knowledge_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_knowledge_edges_to_node_id_fkey"
            columns: ["to_node_id"]
            isOneToOne: false
            referencedRelation: "sales_knowledge_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_knowledge_edges_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_knowledge_nodes: {
        Row: {
          buying_stages: string[]
          canonical_key: string
          concept_id: string | null
          confidence: number
          created_at: string
          id: string
          metadata: Json
          node_type: string
          objection_types: string[]
          sales_brain_id: string | null
          source_id: string | null
          summary: string | null
          title: string
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          buying_stages?: string[]
          canonical_key: string
          concept_id?: string | null
          confidence?: number
          created_at?: string
          id?: string
          metadata?: Json
          node_type: string
          objection_types?: string[]
          sales_brain_id?: string | null
          source_id?: string | null
          summary?: string | null
          title: string
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          buying_stages?: string[]
          canonical_key?: string
          concept_id?: string | null
          confidence?: number
          created_at?: string
          id?: string
          metadata?: Json
          node_type?: string
          objection_types?: string[]
          sales_brain_id?: string | null
          source_id?: string | null
          summary?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_knowledge_nodes_concept_id_fkey"
            columns: ["concept_id"]
            isOneToOne: false
            referencedRelation: "sales_concepts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_knowledge_nodes_sales_brain_id_fkey"
            columns: ["sales_brain_id"]
            isOneToOne: false
            referencedRelation: "sales_brain"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_knowledge_nodes_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "knowledge_base_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_knowledge_nodes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_outcome_events: {
        Row: {
          created_at: string
          decision_id: string | null
          event_type: string
          event_value: number | null
          funnel_stage: string | null
          id: string
          message_id: string | null
          metadata: Json
          model_name: string | null
          model_provider: string | null
          objection_type: string | null
          occurred_at: string
          prospect_id: string
          prospect_segment: string | null
          reply_style: string | null
          strategy_attempt_id: string | null
          strategy_key: string | null
          user_id: string
          workspace_id: string
          workspace_offer: string | null
        }
        Insert: {
          created_at?: string
          decision_id?: string | null
          event_type: string
          event_value?: number | null
          funnel_stage?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json
          model_name?: string | null
          model_provider?: string | null
          objection_type?: string | null
          occurred_at?: string
          prospect_id: string
          prospect_segment?: string | null
          reply_style?: string | null
          strategy_attempt_id?: string | null
          strategy_key?: string | null
          user_id: string
          workspace_id: string
          workspace_offer?: string | null
        }
        Update: {
          created_at?: string
          decision_id?: string | null
          event_type?: string
          event_value?: number | null
          funnel_stage?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json
          model_name?: string | null
          model_provider?: string | null
          objection_type?: string | null
          occurred_at?: string
          prospect_id?: string
          prospect_segment?: string | null
          reply_style?: string | null
          strategy_attempt_id?: string | null
          strategy_key?: string | null
          user_id?: string
          workspace_id?: string
          workspace_offer?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_outcome_events_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "sales_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_outcome_events_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_outcome_events_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_outcome_events_strategy_attempt_id_fkey"
            columns: ["strategy_attempt_id"]
            isOneToOne: false
            referencedRelation: "sales_strategy_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_outcome_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_strategy_attempts: {
        Row: {
          completed_at: string | null
          copied_at: string | null
          created_at: string
          decision_id: string | null
          final_outcome: string | null
          first_suggested_at: string
          funnel_stage: string | null
          generated_message: string
          hidden_cause_hypothesis: string | null
          id: string
          metadata: Json
          permission_reached: boolean
          prospect_fact_used: string | null
          prospect_id: string
          prospect_reaction: string | null
          rationale: string | null
          replied_at: string | null
          reply_act: string | null
          selected_knowledge_node_id: string | null
          selected_sales_brain_id: string | null
          sentiment_change: string | null
          status: string
          strategy_key: string
          strategy_name: string | null
          suggestion_id: string | null
          thread_type: string
          updated_at: string
          used_at: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          completed_at?: string | null
          copied_at?: string | null
          created_at?: string
          decision_id?: string | null
          final_outcome?: string | null
          first_suggested_at?: string
          funnel_stage?: string | null
          generated_message: string
          hidden_cause_hypothesis?: string | null
          id?: string
          metadata?: Json
          permission_reached?: boolean
          prospect_fact_used?: string | null
          prospect_id: string
          prospect_reaction?: string | null
          rationale?: string | null
          replied_at?: string | null
          reply_act?: string | null
          selected_knowledge_node_id?: string | null
          selected_sales_brain_id?: string | null
          sentiment_change?: string | null
          status?: string
          strategy_key: string
          strategy_name?: string | null
          suggestion_id?: string | null
          thread_type?: string
          updated_at?: string
          used_at?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          completed_at?: string | null
          copied_at?: string | null
          created_at?: string
          decision_id?: string | null
          final_outcome?: string | null
          first_suggested_at?: string
          funnel_stage?: string | null
          generated_message?: string
          hidden_cause_hypothesis?: string | null
          id?: string
          metadata?: Json
          permission_reached?: boolean
          prospect_fact_used?: string | null
          prospect_id?: string
          prospect_reaction?: string | null
          rationale?: string | null
          replied_at?: string | null
          reply_act?: string | null
          selected_knowledge_node_id?: string | null
          selected_sales_brain_id?: string | null
          sentiment_change?: string | null
          status?: string
          strategy_key?: string
          strategy_name?: string | null
          suggestion_id?: string | null
          thread_type?: string
          updated_at?: string
          used_at?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_strategy_attempts_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "sales_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_strategy_attempts_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_strategy_attempts_selected_knowledge_node_id_fkey"
            columns: ["selected_knowledge_node_id"]
            isOneToOne: false
            referencedRelation: "sales_knowledge_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_strategy_attempts_selected_sales_brain_id_fkey"
            columns: ["selected_sales_brain_id"]
            isOneToOne: false
            referencedRelation: "sales_brain"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_strategy_attempts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_strategy_performance: {
        Row: {
          copied_count: number
          created_at: string
          effectiveness_score: number
          funnel_stage: string | null
          ghosted_count: number
          handoff_count: number
          id: string
          knowledge_node_id: string | null
          last_event_at: string | null
          objection_type: string | null
          permission_count: number
          positive_count: number
          prospect_segment: string | null
          refused_count: number
          reply_count: number
          sale_count: number
          sales_brain_id: string | null
          strategy_key: string
          suggested_count: number
          updated_at: string
          used_count: number
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          copied_count?: number
          created_at?: string
          effectiveness_score?: number
          funnel_stage?: string | null
          ghosted_count?: number
          handoff_count?: number
          id?: string
          knowledge_node_id?: string | null
          last_event_at?: string | null
          objection_type?: string | null
          permission_count?: number
          positive_count?: number
          prospect_segment?: string | null
          refused_count?: number
          reply_count?: number
          sale_count?: number
          sales_brain_id?: string | null
          strategy_key: string
          suggested_count?: number
          updated_at?: string
          used_count?: number
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          copied_count?: number
          created_at?: string
          effectiveness_score?: number
          funnel_stage?: string | null
          ghosted_count?: number
          handoff_count?: number
          id?: string
          knowledge_node_id?: string | null
          last_event_at?: string | null
          objection_type?: string | null
          permission_count?: number
          positive_count?: number
          prospect_segment?: string | null
          refused_count?: number
          reply_count?: number
          sale_count?: number
          sales_brain_id?: string | null
          strategy_key?: string
          suggested_count?: number
          updated_at?: string
          used_count?: number
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_strategy_performance_knowledge_node_id_fkey"
            columns: ["knowledge_node_id"]
            isOneToOne: false
            referencedRelation: "sales_knowledge_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_strategy_performance_sales_brain_id_fkey"
            columns: ["sales_brain_id"]
            isOneToOne: false
            referencedRelation: "sales_brain"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_strategy_performance_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      suggestion_feedback: {
        Row: {
          conversation_stage: string | null
          created_at: string
          feedback: string
          framework_used: string | null
          id: string
          prospect_id: string
          suggestion_text: string
          suggestion_type: string
          thread_type: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          conversation_stage?: string | null
          created_at?: string
          feedback: string
          framework_used?: string | null
          id?: string
          prospect_id: string
          suggestion_text: string
          suggestion_type?: string
          thread_type?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          conversation_stage?: string | null
          created_at?: string
          feedback?: string
          framework_used?: string | null
          id?: string
          prospect_id?: string
          suggestion_text?: string
          suggestion_type?: string
          thread_type?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suggestion_feedback_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suggestion_feedback_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_api_keys: {
        Row: {
          api_key: string
          created_at: string
          id: string
          label: string
          service: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key: string
          created_at?: string
          id?: string
          label?: string
          service: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key?: string
          created_at?: string
          id?: string
          label?: string
          service?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      workspace_links: {
        Row: {
          created_at: string
          expert_workspace_id: string
          friend_workspace_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expert_workspace_id: string
          friend_workspace_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expert_workspace_id?: string
          friend_workspace_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_links_expert_workspace_id_fkey"
            columns: ["expert_workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_links_friend_workspace_id_fkey"
            columns: ["friend_workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_proof_assets: {
        Row: {
          approved_for_ai: boolean
          created_at: string
          description: string | null
          id: string
          mime_type: string | null
          result_date: string | null
          result_type: string
          result_value: string | null
          storage_path: string | null
          title: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          approved_for_ai?: boolean
          created_at?: string
          description?: string | null
          id?: string
          mime_type?: string | null
          result_date?: string | null
          result_type?: string
          result_value?: string | null
          storage_path?: string | null
          title: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          approved_for_ai?: boolean
          created_at?: string
          description?: string | null
          id?: string
          mime_type?: string | null
          result_date?: string | null
          result_type?: string
          result_value?: string | null
          storage_path?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_proof_assets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_training_data: {
        Row: {
          content: string | null
          created_at: string
          file_path: string | null
          id: string
          status: string
          style_analysis: Json | null
          title: string
          type: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          status?: string
          style_analysis?: Json | null
          title: string
          type?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          content?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          status?: string
          style_analysis?: Json | null
          title?: string
          type?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_training_data_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          approved_stories: Json
          audience_description: string | null
          auto_profile_draft: Json
          business_model: string | null
          common_objections: string | null
          created_at: string
          custom_framework: string | null
          default_reply_mode: string
          expert_description: string | null
          forbidden_claims: string | null
          friend_backstory: string | null
          friend_learning_mode: string
          friend_persona: Json
          friend_persona_approved_at: string | null
          friend_persona_status: string
          friend_persona_version: number
          friend_setup_mode: string
          id: string
          instagram_url: string | null
          is_active: boolean
          name: string
          niche_description: string | null
          offer_truth: Json
          pain_points: string | null
          parsed_framework: Json | null
          positioning: string | null
          products_detected: string | null
          profile_analysis: string | null
          referral_triggers: string | null
          store_url: string | null
          style_vector: Json | null
          target_audience: string | null
          tiktok_url: string | null
          transformation: string | null
          updated_at: string
          user_id: string
          workspace_type: string
        }
        Insert: {
          approved_stories?: Json
          audience_description?: string | null
          auto_profile_draft?: Json
          business_model?: string | null
          common_objections?: string | null
          created_at?: string
          custom_framework?: string | null
          default_reply_mode?: string
          expert_description?: string | null
          forbidden_claims?: string | null
          friend_backstory?: string | null
          friend_learning_mode?: string
          friend_persona?: Json
          friend_persona_approved_at?: string | null
          friend_persona_status?: string
          friend_persona_version?: number
          friend_setup_mode?: string
          id?: string
          instagram_url?: string | null
          is_active?: boolean
          name: string
          niche_description?: string | null
          offer_truth?: Json
          pain_points?: string | null
          parsed_framework?: Json | null
          positioning?: string | null
          products_detected?: string | null
          profile_analysis?: string | null
          referral_triggers?: string | null
          store_url?: string | null
          style_vector?: Json | null
          target_audience?: string | null
          tiktok_url?: string | null
          transformation?: string | null
          updated_at?: string
          user_id: string
          workspace_type?: string
        }
        Update: {
          approved_stories?: Json
          audience_description?: string | null
          auto_profile_draft?: Json
          business_model?: string | null
          common_objections?: string | null
          created_at?: string
          custom_framework?: string | null
          default_reply_mode?: string
          expert_description?: string | null
          forbidden_claims?: string | null
          friend_backstory?: string | null
          friend_learning_mode?: string
          friend_persona?: Json
          friend_persona_approved_at?: string | null
          friend_persona_status?: string
          friend_persona_version?: number
          friend_setup_mode?: string
          id?: string
          instagram_url?: string | null
          is_active?: boolean
          name?: string
          niche_description?: string | null
          offer_truth?: Json
          pain_points?: string | null
          parsed_framework?: Json | null
          positioning?: string | null
          products_detected?: string | null
          profile_analysis?: string | null
          referral_triggers?: string | null
          store_url?: string | null
          style_vector?: Json | null
          target_audience?: string | null
          tiktok_url?: string | null
          transformation?: string | null
          updated_at?: string
          user_id?: string
          workspace_type?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bump_friend_audience_signal: {
        Args: {
          p_metric?: string
          p_prospect_id?: string
          p_signal_key: string
          p_signal_type: string
          p_user_id: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      get_sales_evaluation_dashboard: {
        Args: { p_since?: string; p_user_id: string; p_workspace_id?: string }
        Returns: Json
      }
      match_knowledge_chunks: {
        Args: {
          match_count?: number
          match_threshold?: number
          p_user_id?: string
          query_embedding: string
        }
        Returns: {
          brain_type: string
          category: string
          chunk_index: number
          chunk_kind: string
          content: string
          id: string
          locator: string
          metadata: Json
          relevance_score: number
          similarity: number
          source_id: string
          source_type: string
          trigger_phrases: string
        }[]
      }
      match_sales_brain: {
        Args: {
          match_count?: number
          match_threshold?: number
          p_user_id?: string
          query_embedding: string
        }
        Returns: {
          category: string
          common_mistake: string
          exact_words_to_use: string
          how_to_apply: string
          id: string
          power_level: number
          principle_name: string
          real_example_or_story: string
          relevance_score: number
          similarity: number
          source_id: string
          source_name: string
          source_type: string
          the_deep_why: string
          what_i_learned: string
          when_not_to_use: string
          when_to_use: string
        }[]
      }
      normalize_sales_key: { Args: { value: string }; Returns: string }
      rank_sales_strategy_candidates: {
        Args: {
          p_funnel_stage: string
          p_objection_type: string
          p_prospect_id: string
          p_prospect_segment: string
          p_sales_brain_ids?: string[]
          p_user_id: string
          p_workspace_id: string
        }
        Returns: {
          effectiveness_score: number
          permission_count: number
          previous_attempt_count: number
          previous_failure_count: number
          reply_count: number
          sale_count: number
          sales_brain_id: string
          strategy_key: string
          used_count: number
        }[]
      }
      record_friend_learning_signals: {
        Args: {
          p_metric?: string
          p_profile: Json
          p_prospect_id?: string
          p_user_id: string
          p_workspace_id: string
        }
        Returns: undefined
      }
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
