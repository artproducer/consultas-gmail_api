const GMAIL_SCOPE = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email'
].join(' ');

function getEnv(name) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
}

function getOAuthConfig() {
    return {
        clientId: getEnv('GOOGLE_CLIENT_ID'),
        clientSecret: getEnv('GOOGLE_CLIENT_SECRET'),
        redirectUri: getEnv('GOOGLE_REDIRECT_URI')
    };
}

function buildAuthUrl(state) {
    const { clientId, redirectUri } = getOAuthConfig();
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        access_type: 'offline',
        include_granted_scopes: 'true',
        prompt: 'consent',
        scope: GMAIL_SCOPE,
        state
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function fetchJson(url, options, fallbackMessage) {
    const response = await fetch(url, options);
    const text = await response.text();
    let data = {};

    try {
        data = text ? JSON.parse(text) : {};
    } catch (_) {
        data = { raw: text };
    }

    if (!response.ok) {
        const error = new Error(
            data.error_description ||
            data.error?.message ||
            data.error ||
            fallbackMessage ||
            'Google request failed'
        );
        error.status = response.status;
        error.body = data;
        throw error;
    }

    return data;
}

async function exchangeCodeForTokens(code) {
    const { clientId, clientSecret, redirectUri } = getOAuthConfig();
    const body = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
    });

    return fetchJson('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
    }, 'Could not exchange authorization code.');
}

async function refreshAccessToken(refreshToken) {
    const { clientId, clientSecret } = getOAuthConfig();
    const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
    });

    return fetchJson('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
    }, 'Could not refresh access token.');
}

async function fetchGoogleProfile(accessToken) {
    return fetchJson('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
    }, 'Could not fetch Google profile.');
}

async function gmailListMessages(accessToken, query, maxResults) {
    const params = new URLSearchParams({
        q: query,
        maxResults: String(maxResults)
    });

    return fetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    }, 'Could not list Gmail messages.');
}

async function gmailGetMessage(accessToken, messageId) {
    return fetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    }, 'Could not fetch Gmail message.');
}

module.exports = {
    buildAuthUrl,
    exchangeCodeForTokens,
    fetchGoogleProfile,
    gmailGetMessage,
    gmailListMessages,
    refreshAccessToken
};
