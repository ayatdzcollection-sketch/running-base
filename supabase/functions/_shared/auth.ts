// Shared helpers for the token-authenticated edge functions (the watch
// Shortcut and the Claude connector). Both are called without a Supabase
// session, so they check a personal token instead and then act as that
// runner through the service role, always filtering by user_id.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

/** Finds the token in the Authorization header or as the last path segment. */
export function tokenFrom(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) {
    const t = auth.slice(7).trim();
    if (t.startsWith('bb_')) return t;
  }
  const last = new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? '';
  return last.startsWith('bb_') ? last : null;
}

/** Returns the runner's user id for a live token of the given kind, or null. */
export async function userForToken(
  db: SupabaseClient,
  token: string | null,
  kind: 'shortcut' | 'mcp',
): Promise<string | null> {
  if (!token) return null;
  const hash = await sha256Hex(token);
  const { data } = await db
    .from('bb_tokens')
    .select('id, user_id')
    .eq('token_hash', hash)
    .eq('kind', kind)
    .is('revoked_at', null)
    .maybeSingle();
  if (!data) return null;
  await db.from('bb_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);
  return data.user_id as string;
}

export const cors: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, mcp-session-id, mcp-protocol-version',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...cors, ...extra },
  });
}
