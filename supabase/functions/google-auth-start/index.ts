import { corsResponse, jsonResponse } from '../_shared/cors.ts';
import { assertAllowedRedirect, createServiceClient } from '../_shared/env.ts';
import { buildGoogleConsentUrl } from '../_shared/google.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse(req);
  if (req.method !== 'GET') return jsonResponse(req, { message: 'Method not allowed' }, 405);

  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get('session_id') ?? req.headers.get('x-session-id') ?? '';
    const redirectTo = url.searchParams.get('redirect_to') ?? '';

    if (!sessionId) return jsonResponse(req, { message: 'session_id requerido' }, 400);
    if (!redirectTo) return jsonResponse(req, { message: 'redirect_to requerido' }, 400);

    const safeRedirect = assertAllowedRedirect(redirectTo);
    const supabase = createServiceClient();
    const state = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabase.from('gmail_oauth_states').delete().eq('session_id', sessionId);

    const { error } = await supabase.from('gmail_oauth_states').insert({
      state,
      session_id: sessionId,
      redirect_to: safeRedirect.toString(),
      expires_at: expiresAt
    });

    if (error) throw error;

    return Response.redirect(buildGoogleConsentUrl(state), 302);
  } catch (err) {
    return jsonResponse(req, { message: err instanceof Error ? err.message : 'No se pudo iniciar OAuth' }, 500);
  }
});
