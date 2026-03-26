# consultas-gmail_api

Version lista para Netlify con OAuth server-side y Gmail API mediante Netlify Functions.

## Que cambia

- El navegador ya no guarda `access_token` en `localStorage`.
- Netlify Functions hace el flujo OAuth de Google en backend.
- La sesion se guarda en una cookie `HttpOnly` cifrada con `SESSION_SECRET`.
- Google renueva el `access_token` usando `refresh_token` cuando hace falta.

## Variables de entorno en Netlify

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `SESSION_SECRET`

`SESSION_SECRET` deberia tener al menos 32 caracteres.

## Redirect URI en Google Cloud

En tu credencial OAuth de tipo Web agrega exactamente:

```text
https://TU-SITIO.netlify.app/.netlify/functions/google-callback
```

Y usa ese mismo valor en `GOOGLE_REDIRECT_URI`.

## Scope usado

- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/userinfo.profile`
- `https://www.googleapis.com/auth/userinfo.email`

## Despliegue

1. Sube este repo a Netlify.
2. Configura las 4 variables de entorno.
3. En Google Cloud habilita Gmail API.
4. En la pantalla OAuth agrega tu usuario como usuario de prueba si la app sigue en Testing.
5. Abre el sitio y conecta tu cuenta.

## Nota importante para uso personal

La cookie del sitio queda configurada hasta por 365 dias, pero Google no garantiza que el `refresh_token` dure exactamente ese tiempo.

Puede dejar de servir si, por ejemplo:

- revocas el acceso manualmente
- cambias la contrasena
- el token pasa mucho tiempo sin usarse
- la app sigue en modo Testing y Google aplica expiracion corta
