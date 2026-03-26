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

function popupResponse(status, cookies = []) {
    const body = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Google Auth</title>
</head>
<body>
  <script>
    (function () {
      var payload = { type: 'google-auth-finished', status: '${status}' };
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(payload, window.location.origin);
        window.close();
        return;
      }
      window.location.replace('/?auth=${status}');
    }());
  </script>
</body>
</html>`;

    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store'
        },
        multiValueHeaders: cookies.length ? { 'Set-Cookie': cookies } : undefined,
        body
    };
}

exports.handler = async (event) => {
    const query = event.queryStringParameters || {};
    const state = query.state;
    const code = query.code;
    const storedState = readState(event);

    if (!code || !state || !storedState || state !== storedState) {
        return popupResponse('error', [clearStateCookie(event)]);
    }

    try {
        const tokens = await exchangeCodeForTokens(code);
        if (!tokens.refresh_token) {
            return popupResponse('error', [clearStateCookie(event)]);
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

        return popupResponse('connected', [
            buildSessionCookie(session, event),
            clearStateCookie(event)
        ]);
    } catch (_) {
        return popupResponse('error', [clearStateCookie(event)]);
    }
};
