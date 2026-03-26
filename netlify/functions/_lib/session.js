const crypto = require('crypto');

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'gmail_query_session';
const AUTH_STATE_COOKIE_NAME = `${SESSION_COOKIE_NAME}_state`;
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const TEN_MINUTES_SECONDS = 60 * 10;

function getSecretKey() {
    const secret = process.env.SESSION_SECRET || '';
    if (secret.length < 32) {
        throw new Error('SESSION_SECRET must be set and should be at least 32 characters long.');
    }
    return crypto.createHash('sha256').update(secret).digest();
}

function toBase64Url(buffer) {
    return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    return Buffer.from(normalized + padding, 'base64');
}

function encryptSession(payload) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getSecretKey(), iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return toBase64Url(Buffer.concat([iv, tag, encrypted]));
}

function decryptSession(value) {
    try {
        const payload = fromBase64Url(value);
        const iv = payload.subarray(0, 12);
        const tag = payload.subarray(12, 28);
        const encrypted = payload.subarray(28);
        const decipher = crypto.createDecipheriv('aes-256-gcm', getSecretKey(), iv);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return JSON.parse(decrypted.toString('utf8'));
    } catch (_) {
        return null;
    }
}

function parseCookies(cookieHeader = '') {
    return cookieHeader.split(';').reduce((acc, chunk) => {
        const [rawName, ...rest] = chunk.trim().split('=');
        if (!rawName) return acc;
        acc[rawName] = rest.join('=');
        return acc;
    }, {});
}

function shouldUseSecureCookies(event) {
    const forwardedProto = event.headers['x-forwarded-proto'] || event.headers['X-Forwarded-Proto'];
    if (forwardedProto) return forwardedProto !== 'http';
    return process.env.CONTEXT !== 'dev';
}

function serializeCookie(name, value, options = {}) {
    const parts = [`${name}=${value}`, `Path=${options.path || '/'}`];
    if (Number.isFinite(options.maxAge)) parts.push(`Max-Age=${options.maxAge}`);
    if (options.httpOnly !== false) parts.push('HttpOnly');
    if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
    if (options.secure) parts.push('Secure');
    return parts.join('; ');
}

function buildSessionCookie(session, event) {
    return serializeCookie(SESSION_COOKIE_NAME, encryptSession(session), {
        maxAge: ONE_YEAR_SECONDS,
        httpOnly: true,
        sameSite: 'Lax',
        secure: shouldUseSecureCookies(event)
    });
}

function clearSessionCookie(event) {
    return serializeCookie(SESSION_COOKIE_NAME, '', {
        maxAge: 0,
        httpOnly: true,
        sameSite: 'Lax',
        secure: shouldUseSecureCookies(event)
    });
}

function buildStateCookie(state, event) {
    return serializeCookie(AUTH_STATE_COOKIE_NAME, state, {
        maxAge: TEN_MINUTES_SECONDS,
        httpOnly: true,
        sameSite: 'Lax',
        secure: shouldUseSecureCookies(event)
    });
}

function clearStateCookie(event) {
    return serializeCookie(AUTH_STATE_COOKIE_NAME, '', {
        maxAge: 0,
        httpOnly: true,
        sameSite: 'Lax',
        secure: shouldUseSecureCookies(event)
    });
}

function readSession(event) {
    const cookies = parseCookies(event.headers.cookie || '');
    if (!cookies[SESSION_COOKIE_NAME]) return null;
    return decryptSession(cookies[SESSION_COOKIE_NAME]);
}

function readState(event) {
    const cookies = parseCookies(event.headers.cookie || '');
    return cookies[AUTH_STATE_COOKIE_NAME] || null;
}

module.exports = {
    buildSessionCookie,
    buildStateCookie,
    clearSessionCookie,
    clearStateCookie,
    readSession,
    readState
};
