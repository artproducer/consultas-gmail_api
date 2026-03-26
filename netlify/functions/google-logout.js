const { clearSessionCookie } = require('./_lib/session');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: { Allow: 'POST' },
            body: ''
        };
    }

    return {
        statusCode: 204,
        headers: {
            'Cache-Control': 'no-store',
            'Set-Cookie': clearSessionCookie(event)
        },
        body: ''
    };
};
