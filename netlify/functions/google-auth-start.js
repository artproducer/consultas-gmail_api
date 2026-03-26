const crypto = require('crypto');
const { buildAuthUrl } = require('./_lib/google');
const { buildStateCookie } = require('./_lib/session');

exports.handler = async (event) => {
    try {
        const state = crypto.randomBytes(24).toString('hex');
        return {
            statusCode: 302,
            headers: {
                Location: buildAuthUrl(state),
                'Cache-Control': 'no-store',
                'Set-Cookie': buildStateCookie(state, event)
            },
            body: ''
        };
    } catch (error) {
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({
                message: error.message || 'Could not start Google authentication.'
            })
        };
    }
};
