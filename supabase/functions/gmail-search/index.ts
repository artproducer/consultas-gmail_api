import { corsResponse, jsonResponse } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/env.ts';
import { fetchGmailMessages, refreshAccessToken } from '../_shared/google.ts';

type GmailConnection = {
  session_id: string;
  email: string;
  access_token: string | null;
  refresh_token: string;
  access_token_expires_at: string | null;
  display_name: string | null;
  picture_url: string | null;
  scope: string | null;
  token_type: string | null;
};

async function getValidAccessToken(supabase: ReturnType<typeof createServiceClient>, connection: GmailConnection) {
  const expiresAt = connection.access_token_expires_at ? Date.parse(connection.access_token_expires_at) : 0;
  const stillValid = connection.access_token && expiresAt > Date.now() + 60_000;
  if (stillValid) return { accessToken: connection.access_token as string, connection };

  const refreshed = await refreshAccessToken(connection.refresh_token);
  const nextExpiry = new Date(Date.now() + (refreshed.expires_in || 3600) * 1000).toISOString();
  const updatedFields = {
    access_token: refreshed.access_token,
    access_token_expires_at: nextExpiry,
    scope: refreshed.scope ?? connection.scope,
    token_type: refreshed.token_type ?? connection.token_type
  };

  const { error } = await supabase.from('gmail_connections').update(updatedFields).eq('session_id', connection.session_id);
  if (error) throw error;

  return {
    accessToken: refreshed.access_token,
    connection: {
      ...connection,
      ...updatedFields
    }
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse(req);
  if (req.method !== 'POST') return jsonResponse(req, { message: 'Method not allowed' }, 405);

  try {
    const body = await req.json();
    const sessionId = body?.sessionId ?? req.headers.get('x-session-id') ?? '';
    const filter = String(body?.filter ?? '').trim();
    const maxResults = Math.max(1, parseInt(String(body?.maxResults ?? 5), 10) || 5);

    if (!sessionId) return jsonResponse(req, { message: 'sessionId requerido' }, 400);
    if (!filter) return jsonResponse(req, { messages: [] });

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('gmail_connections')
      .select('session_id, email, access_token, refresh_token, access_token_expires_at, display_name, picture_url, scope, token_type')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return jsonResponse(req, { message: 'Cuenta no conectada' }, 401);

    let authState = await getValidAccessToken(supabase, data as GmailConnection);
    let messages: unknown[] = [];

    try {
      messages = await fetchGmailMessages(authState.accessToken, filter, maxResults);
    } catch (err) {
      const shouldRetry = err instanceof Error && /401|invalid_grant|invalid_token/i.test(err.message);
      if (!shouldRetry) throw err;
      authState = await getValidAccessToken(supabase, {
        ...(authState.connection as GmailConnection),
        access_token: null,
        access_token_expires_at: null
      });
      messages = await fetchGmailMessages(authState.accessToken, filter, maxResults);
    }

    return jsonResponse(req, {
      messages,
      profile: {
        email: authState.connection.email,
        name: authState.connection.display_name ?? '',
        picture: authState.connection.picture_url ?? ''
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo consultar Gmail';
    const status = /Cuenta no conectada|invalid_grant/i.test(message) ? 401 : 500;
    return jsonResponse(req, { message }, status);
  }
});
