const DEFAULT_ALLOWED_HEADERS = 'authorization, x-client-info, apikey, content-type, x-session-id';
const DEFAULT_ALLOWED_METHODS = 'GET, POST, OPTIONS';

function getAllowedOrigins() {
  return (Deno.env.get('ALLOWED_WEB_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const allowedOrigins = getAllowedOrigins();
  let allowOrigin = '*';

  if (allowedOrigins.length > 0) {
    allowOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  } else if (origin) {
    allowOrigin = origin;
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': DEFAULT_ALLOWED_HEADERS,
    'Access-Control-Allow-Methods': DEFAULT_ALLOWED_METHODS,
    'Access-Control-Allow-Credentials': 'false',
    Vary: 'Origin'
  };
}

export function corsResponse(req: Request, status = 200) {
  return new Response('ok', {
    status,
    headers: getCorsHeaders(req)
  });
}

export function jsonResponse(req: Request, payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...getCorsHeaders(req),
      'Content-Type': 'application/json'
    }
  });
}
