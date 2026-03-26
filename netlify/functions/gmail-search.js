const {
    gmailGetMessage,
    gmailListMessages,
    refreshAccessToken
} = require('./_lib/google');
const {
    buildSessionCookie,
    clearSessionCookie,
    readSession
} = require('./_lib/session');

const MAX_RESULTS_CAP = 5;

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
    if (event.httpMethod !== 'GET') {
        return json(405, { message: 'Method not allowed.' });
    }

    const session = readSession(event);
    if (!session || !session.refreshToken) {
        return json(401, { message: 'No hay una sesion activa.' }, [clearSessionCookie(event)]);
    }

    const query = (event.queryStringParameters?.q || '').trim();
    const rawMax = parseInt(event.queryStringParameters?.maxResults || `${MAX_RESULTS_CAP}`, 10);
    const maxResults = Math.min(MAX_RESULTS_CAP, Math.max(1, Number.isNaN(rawMax) ? MAX_RESULTS_CAP : rawMax));

    if (!query) {
        return json(400, { message: 'Debes enviar un filtro de correo.' }, [buildSessionCookie(session, event)]);
    }

    try {
        const tokens = await refreshAccessToken(session.refreshToken);
        const listData = await gmailListMessages(tokens.access_token, query, maxResults);
        const listedMessages = Array.isArray(listData.messages) ? listData.messages : [];
        const fullMessages = await Promise.all(
            listedMessages.slice(0, maxResults).map((message) => gmailGetMessage(tokens.access_token, message.id))
        );

        return json(200, { messages: fullMessages }, [buildSessionCookie(session, event)]);
    } catch (error) {
        const errorCode = error.body?.error || error.message;
        if (errorCode === 'invalid_grant') {
            return json(401, { message: 'La sesion de Google expiro. Conecta de nuevo.' }, [clearSessionCookie(event)]);
        }

        return json(error.status || 500, {
            message: error.message || 'No se pudo consultar Gmail.'
        }, [buildSessionCookie(session, event)]);
    }
};
