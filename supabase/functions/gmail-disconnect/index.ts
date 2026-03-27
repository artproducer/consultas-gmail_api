import { corsResponse, jsonResponse } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/env.ts';
import { revokeGoogleToken } from '../_shared/google.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse(req);
  if (req.method !== 'POST') return jsonResponse(req, { message: 'Method not allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const sessionId = body?.sessionId ?? req.headers.get('x-session-id') ?? '';
    if (!sessionId) return jsonResponse(req, { message: 'sessionId requerido' }, 400);

    const supabase = createServiceClient();
    const { data } = await supabase
      .from('gmail_connections')
      .select('refresh_token')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (data?.refresh_token) {
      try {
        await revokeGoogleToken(data.refresh_token);
      } catch (_) {
        // Revoke failures should not block local cleanup.
      }
    }

    const { error } = await supabase.from('gmail_connections').delete().eq('session_id', sessionId);
    if (error) throw error;

    await supabase.from('gmail_oauth_states').delete().eq('session_id', sessionId);

    return jsonResponse(req, { success: true });
  } catch (err) {
    return jsonResponse(req, { message: err instanceof Error ? err.message : 'No se pudo cerrar la sesion' }, 500);
  }
});
