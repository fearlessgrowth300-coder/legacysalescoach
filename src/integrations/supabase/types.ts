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
      knowledge_base_items: {
        Row: {
          brain_type: string
          created_at: string
          file_path: string | null
          id: string
          status: string
          title: string
          type: string
          updated_at: string
          url: string | null
          user_id: string
        }
        Insert: {
          brain_type?: string
          created_at?: string
          file_path?: string | null
          id?: string
          status?: string
          title: string
          type?: string
          updated_at?: string
          url?: string | null
          user_id: string
        }
        Update: {
          brain_type?: string
          created_at?: string
          file_path?: string | null
          id?: string
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
          content: string
          created_at: string
          embedding: string | null
          id: string
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
          content: string
          created_at?: string
          embedding?: string | null
          id?: string
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
          content?: string
          created_at?: string
          embedding?: string | null
          id?: string
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
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string
          id?: string
          name?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          category: string
          created_at: string
          embedding: string | null
          how_to_apply: string
          id: string
          metadata: Json | null
          principle_name: string
          relevance_score: number | null
          source_id: string | null
          source_name: string
          source_type: string
          user_id: string
          what_i_learned: string
          workspace_id: string | null
        }
        Insert: {
          brain_type?: string
          category?: string
          created_at?: string
          embedding?: string | null
          how_to_apply: string
          id?: string
          metadata?: Json | null
          principle_name: string
          relevance_score?: number | null
          source_id?: string | null
          source_name: string
          source_type?: string
          user_id: string
          what_i_learned: string
          workspace_id?: string | null
        }
        Update: {
          brain_type?: string
          category?: string
          created_at?: string
          embedding?: string | null
          how_to_apply?: string
          id?: string
          metadata?: Json | null
          principle_name?: string
          relevance_score?: number | null
          source_id?: string | null
          source_name?: string
          source_type?: string
          user_id?: string
          what_i_learned?: string
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
          service: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key: string
          created_at?: string
          id?: string
          service: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key?: string
          created_at?: string
          id?: string
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
          business_model: string | null
          created_at: string
          custom_framework: string | null
          default_reply_mode: string
          id: string
          instagram_url: string | null
          is_active: boolean
          name: string
          niche_description: string | null
          parsed_framework: Json | null
          positioning: string | null
          products_detected: string | null
          profile_analysis: string | null
          store_url: string | null
          style_vector: Json | null
          target_audience: string | null
          tiktok_url: string | null
          updated_at: string
          user_id: string
          workspace_type: string
        }
        Insert: {
          business_model?: string | null
          created_at?: string
          custom_framework?: string | null
          default_reply_mode?: string
          id?: string
          instagram_url?: string | null
          is_active?: boolean
          name: string
          niche_description?: string | null
          parsed_framework?: Json | null
          positioning?: string | null
          products_detected?: string | null
          profile_analysis?: string | null
          store_url?: string | null
          style_vector?: Json | null
          target_audience?: string | null
          tiktok_url?: string | null
          updated_at?: string
          user_id: string
          workspace_type?: string
        }
        Update: {
          business_model?: string | null
          created_at?: string
          custom_framework?: string | null
          default_reply_mode?: string
          id?: string
          instagram_url?: string | null
          is_active?: boolean
          name?: string
          niche_description?: string | null
          parsed_framework?: Json | null
          positioning?: string | null
          products_detected?: string | null
          profile_analysis?: string | null
          store_url?: string | null
          style_vector?: Json | null
          target_audience?: string | null
          tiktok_url?: string | null
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
          content: string
          id: string
          similarity: number
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
          how_to_apply: string
          id: string
          principle_name: string
          similarity: number
          source_name: string
          what_i_learned: string
        }[]
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
