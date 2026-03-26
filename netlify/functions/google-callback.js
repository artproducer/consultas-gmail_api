const { exchangeCodeForTokens, fetchGoogleProfile } = require('./_lib/google');
const {
    buildSessionCookie,
    clearStateCookie,
    readState
} = require('./_lib/session');

function redirect(location, cookies = []) {
    return {
        statusCode: 302,
        headers: {
            Location: location,
            'Cache-Control': 'no-store'
        },
        multiValueHeaders: cookies.length ? { 'Set-Cookie': cookies } : undefined,
        body: ''
    };
}

exports.handler = async (event) => {
    const query = event.queryStringParameters || {};
    const state = query.state;
    const code = query.code;
    const storedState = readState(event);

    if (!code || !state || !storedState || state !== storedState) {
        return redirect('/?auth=error', [clearStateCookie(event)]);
    }

    try {
        const tokens = await exchangeCodeForTokens(code);
        if (!tokens.refresh_token) {
            return redirect('/?auth=error', [clearStateCookie(event)]);
        }

        const profile = await fetchGoogleProfile(tokens.access_token);
        const session = {
            refreshToken: tokens.refresh_token,
            profile: {
                email: profile.email || '',
                name: profile.name || '',
                picture: profile.picture || ''
            },
            createdAt: Date.now()
        };

        return redirect('/?auth=connected', [
            buildSessionCookie(session, event),
            clearStateCookie(event)
        ]);
    } catch (_) {
        return redirect('/?auth=error', [clearStateCookie(event)]);
    }
};
