import { createClient, SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// supabase is null when env vars aren't configured — the app degrades gracefully
// to local-only mode. The anon key is intentionally public (Supabase's security
// model is Row Level Security, not key secrecy).
export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key) : null;

export const hasSupabase = !!supabase;
