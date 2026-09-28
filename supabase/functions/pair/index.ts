// Trade a 6-digit pairing code (made in an already signed-in browser) for a
// one-time sign-in token the Home Screen app can use. No email needed.
import { adminClient, cors, json } from '../_shared/auth.ts';

async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  let body: { email?: string; code?: string };
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Bad request' }, 400); }
  const email = String(body.email ?? '').trim().toLowerCase();
  const code = String(body.code ?? '').replace(/\D/g, '');
  const nope = json({ ok: false, error: 'That code didn’t work. Tap the email link again for a new one.' }, 400);
  if (!email || code.length !== 6) return nope;

  const db = adminClient();
  const { data: row } = await db.from('bb_pairing').select('*').eq('email', email).maybeSingle();
  if (!row || row.attempts >= 5 || new Date(row.expires_at).getTime() < Date.now()) return nope;
  if ((await sha256Hex(code)) !== row.code_hash) {
    await db.from('bb_pairing').update({ attempts: row.attempts + 1 }).eq('user_id', row.user_id);
    return nope;
  }
  await db.from('bb_pairing').delete().eq('user_id', row.user_id);   // one use only
  const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email });
  if (error || !data?.properties?.hashed_token) return json({ ok: false, error: 'Couldn’t sign in. Try again.' }, 500);
  return json({ ok: true, token_hash: data.properties.hashed_token });
});
