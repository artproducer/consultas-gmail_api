import { buildRedirectUrl, createServiceClient, getDefaultAppUrl } from '../_shared/env.ts';
import { exchangeCodeForTokens, fetchGoogleProfile } from '../_shared/google.ts';

function redirectWithStatus(redirectTo: string, params: Record<string, string>) {
  return Response.redirect(buildRedirectUrl(redirectTo, params), 302);
}

Deno.serve(async (req) => {
  const reqUrl = new URL(req.url);
  const state = reqUrl.searchParams.get('state') ?? '';
  const code = reqUrl.searchParams.get('code') ?? '';
  const oauthError = reqUrl.searchParams.get('error') ?? '';
  const fallbackRedirect = getDefaultAppUrl();
  const supabase = createServiceClient();

  let redirectTo = fallbackRedirect;
  let storedState:
    | {
        session_id: string;
        redirect_to: string;
        expires_at: string;
      }
    | null = null;

  if (state) {
    const { data } = await supabase
      .from('gmail_oauth_states')
      .select('session_id, redirect_to, expires_at')
      .eq('state', state)
      .maybeSingle();

    if (data) {
      storedState = data;
      redirectTo = data.redirect_to;
    }
  }

  if (oauthError) {
    if (state) await supabase.from('gmail_oauth_states').delete().eq('state', state);
    return redirectWithStatus(redirectTo, { gmail_error: oauthError });
  }

  if (!storedState || !code) {
    if (state) await supabase.from('gmail_oauth_states').delete().eq('state', state);
    return redirectWithStatus(redirectTo, { gmail_error: 'Callback invalido' });
  }

  if (new Date(storedState.expires_at).getTime() < Date.now()) {
    await supabase.from('gmail_oauth_states').delete().eq('state', state);
    return redirectWithStatus(redirectTo, { gmail_error: 'OAuth expirado, vuelve a conectar' });
  }

  try {
    const existing = await supabase
      .from('gmail_connections')
      .select('refresh_token')
      .eq('session_id', storedState.session_id)
      .maybeSingle();

    const tokens = await exchangeCodeForTokens(code);
    const profile = await fetchGoogleProfile(tokens.access_token);
    const refreshToken = tokens.refresh_token ?? existing.data?.refresh_token ?? '';
    if (!refreshToken) throw new Error('Google no devolvio refresh_token');

    const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();

    const { error } = await supabase.from('gmail_connections').upsert(
      {
        session_id: storedState.session_id,
        email: profile.email,
        google_user_id: profile.sub ?? null,
        access_token: tokens.access_token,
        refresh_token: refreshToken,
        scope: tokens.scope ?? null,
        token_type: tokens.token_type ?? null,
        access_token_expires_at: expiresAt,
        display_name: profile.name ?? null,
        picture_url: profile.picture ?? null
      },
      { onConflict: 'session_id' }
    );

    if (error) throw error;

    await supabase.from('gmail_oauth_states').delete().eq('state', state);

    return redirectWithStatus(redirectTo, {
      gmail_connected: '1',
      gmail_email: profile.email
    });
  } catch (err) {
    await supabase.from('gmail_oauth_states').delete().eq('state', state);
    return redirectWithStatus(redirectTo, {
      gmail_error: err instanceof Error ? err.message : 'No se pudo completar OAuth'
    });
  }
});
