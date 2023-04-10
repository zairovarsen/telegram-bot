export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[]

export interface Database {
  public: {
    Tables: {
      documents: {
        Row: {
          content: string | null
          created_at: string
          embedding: unknown | null
          id: number
          token_count: number | null
          updated_at: string
          url: string | null
          user_id: number | null
        }
        Insert: {
          content?: string | null
          created_at?: string
          embedding?: unknown | null
          id?: number
          token_count?: number | null
          updated_at?: string
          url?: string | null
          user_id?: number | null
        }
        Update: {
          content?: string | null
          created_at?: string
          embedding?: unknown | null
          id?: number
          token_count?: number | null
          updated_at?: string
          url?: string | null
          user_id?: number | null
        }
      }
      payments: {
        Row: {
          amount: number | null
          created_at: string
          currency: string | null
          payment_id: number
          payment_method: string | null
          payment_status: string | null
          provider_payment_charge_id: string | null
          purchased_image_generations: number | null
          purchased_tokens: number | null
          telegram_payment_charge_id: string | null
          updated_at: string
          user_id: number | null
        }
        Insert: {
          amount?: number | null
          created_at?: string
          currency?: string | null
          payment_id?: number
          payment_method?: string | null
          payment_status?: string | null
          provider_payment_charge_id?: string | null
          purchased_image_generations?: number | null
          purchased_tokens?: number | null
          telegram_payment_charge_id?: string | null
          updated_at?: string
          user_id?: number | null
        }
        Update: {
          amount?: number | null
          created_at?: string
          currency?: string | null
          payment_id?: number
          payment_method?: string | null
          payment_status?: string | null
          provider_payment_charge_id?: string | null
          purchased_image_generations?: number | null
          purchased_tokens?: number | null
          telegram_payment_charge_id?: string | null
          updated_at?: string
          user_id?: number | null
        }
      }
      users: {
        Row: {
          created_at: string
          first_name: string | null
          image_generation_total: number | null
          image_generations_remaining: number | null
          last_name: string | null
          tokens: number | null
          updated_at: string
          user_id: number
        }
        Insert: {
          created_at?: string
          first_name?: string | null
          image_generation_total?: number | null
          image_generations_remaining?: number | null
          last_name?: string | null
          tokens?: number | null
          updated_at?: string
          user_id: number
        }
        Update: {
          created_at?: string
          first_name?: string | null
          image_generation_total?: number | null
          image_generations_remaining?: number | null
          last_name?: string | null
          tokens?: number | null
          updated_at?: string
          user_id?: number
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      increment_two_fields: {
        Args: {
          x1: number
          x2: number
          x3: number
          row_id: number
        }
        Returns: undefined
      }
      match_documents: {
        Args: {
          query_embedding: unknown
          similarity_threshold: number
          match_count: number
        }
        Returns: {
          id: number
          content: string
          url: string
          token_count: number
          similarity: number
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
