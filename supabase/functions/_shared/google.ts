import { requireEnv } from './env.ts';

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

export interface GoogleProfile {
  sub?: string;
  email: string;
  name?: string;
  picture?: string;
}

async function parseGoogleResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const message = data.error_description || data.error?.message || data.error || 'Google request failed';
    throw new Error(message);
  }
  return data as T;
}

export function buildGoogleConsentUrl(state: string) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', requireEnv('GOOGLE_CLIENT_ID'));
  url.searchParams.set('redirect_uri', requireEnv('GOOGLE_REDIRECT_URI'));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set(
    'scope',
    [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email'
    ].join(' ')
  );
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeCodeForTokens(code: string) {
  const body = new URLSearchParams({
    client_id: requireEnv('GOOGLE_CLIENT_ID'),
    client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
    code,
    grant_type: 'authorization_code',
    redirect_uri: requireEnv('GOOGLE_REDIRECT_URI')
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  return parseGoogleResponse<GoogleTokenResponse>(res);
}

export async function refreshAccessToken(refreshToken: string) {
  const body = new URLSearchParams({
    client_id: requireEnv('GOOGLE_CLIENT_ID'),
    client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  return parseGoogleResponse<GoogleTokenResponse>(res);
}

export async function fetchGoogleProfile(accessToken: string) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  return parseGoogleResponse<GoogleProfile>(res);
}

async function fetchGoogleJson<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return parseGoogleResponse<T>(res);
}

export async function fetchGmailMessages(accessToken: string, filter: string, maxResults: number) {
  const query = encodeURIComponent(filter);
  const list = await fetchGoogleJson<{ messages?: Array<{ id: string }> }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=${maxResults}`,
    accessToken
  );

  const messageIds = list.messages ?? [];
  if (messageIds.length === 0) return [];

  return Promise.all(
    messageIds.map((message) =>
      fetchGoogleJson(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?format=full`,
        accessToken
      )
    )
  );
}

export async function revokeGoogleToken(token: string) {
  await fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token })
  });
}
