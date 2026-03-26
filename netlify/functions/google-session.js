const { refreshAccessToken } = require('./_lib/google');
const { buildSessionCookie, clearSessionCookie, readSession } = require('./_lib/session');

function json(statusCode, payload, cookies = []) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
        },
        multiValueHeaders: cookies.length ? { 'Set-Cookie': cookies } : undefined,
        body: JSON.stringify(payload)
    };
}

exports.handler = async (event) => {
    const session = readSession(event);

    if (!session || !session.refreshToken) {
        return json(200, { authenticated: false }, [clearSessionCookie(event)]);
    }

    try {
        await refreshAccessToken(session.refreshToken);
        return json(200, {
            authenticated: true,
            profile: session.profile || {}
        }, [buildSessionCookie(session, event)]);
    } catch (error) {
        const errorCode = error.body?.error || error.message;
        if (errorCode === 'invalid_grant') {
            return json(200, { authenticated: false }, [clearSessionCookie(event)]);
        }

        return json(error.status || 500, {
            authenticated: false,
            message: error.message || 'No se pudo validar la sesion.'
        }, [buildSessionCookie(session, event)]);
    }
};
