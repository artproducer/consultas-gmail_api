import { corsResponse, jsonResponse } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/env.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse(req);
  if (req.method !== 'GET') return jsonResponse(req, { message: 'Method not allowed' }, 405);

  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get('session_id') ?? req.headers.get('x-session-id') ?? '';
    if (!sessionId) return jsonResponse(req, { connected: false });

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('gmail_connections')
      .select('email, display_name, picture_url')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return jsonResponse(req, { connected: false });

    return jsonResponse(req, {
      connected: true,
      profile: {
        email: data.email,
        name: data.display_name ?? '',
        picture: data.picture_url ?? ''
      }
    });
  } catch (err) {
    return jsonResponse(req, { message: err instanceof Error ? err.message : 'No se pudo consultar la sesion' }, 500);
  }
});
