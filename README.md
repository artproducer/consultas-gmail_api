# consultas-gmail_api

Version adaptada para usar un backend con Supabase Edge Functions en lugar de autenticar Gmail 100% desde el navegador.

## Estructura nueva

- `script.js`: el frontend ya no usa Google Identity Services. Ahora llama a Edge Functions en Supabase.
- `supabase/functions/`: backend para OAuth, estado de sesion, consulta a Gmail y desconexion.
- `supabase/migrations/20260326_create_gmail_backend_tables.sql`: tablas para guardar la conexion Gmail y los estados OAuth.
- `supabase/.env.example`: variables necesarias para las funciones.
- `supabase/config.toml`: marca estas funciones como publicas (`verify_jwt = false`).

## 1. Configurar el frontend

En [script.js](./script.js) cambia:

```js
const SUPABASE_FUNCTIONS_BASE_URL = 'https://YOUR_PROJECT_REF.supabase.co/functions/v1';
```

Por la URL real de tu proyecto, por ejemplo:

```js
const SUPABASE_FUNCTIONS_BASE_URL = 'https://abcd1234.supabase.co/functions/v1';
```

## 2. Crear el proyecto en Supabase

1. Crea un proyecto en Supabase.
2. Copia tu `project ref`.
3. En el SQL Editor ejecuta el contenido de:

```text
supabase/migrations/20260326_create_gmail_backend_tables.sql
```

## 3. Configurar Google Cloud

Necesitas un cliente OAuth de tipo `Web application`.

### APIs a habilitar

- Gmail API

### Scopes usados

- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/userinfo.profile`
- `https://www.googleapis.com/auth/userinfo.email`

### Authorized redirect URIs

Agrega esta URI:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/google-auth-callback
```

Ejemplo:

```text
https://abcd1234.supabase.co/functions/v1/google-auth-callback
```

## 4. Configurar secretos de Supabase

Usa [supabase/.env.example](./supabase/.env.example) como base.

Variables necesarias:

```env
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI=https://YOUR_PROJECT_REF.supabase.co/functions/v1/google-auth-callback
ALLOWED_WEB_ORIGINS=https://mail.dsorak.com,https://mcuentas.cuenticas.com,https://artproducer.github.io,http://127.0.0.1:5500,http://127.0.0.1:5501,http://localhost:5500
```

`ALLOWED_WEB_ORIGINS` debe incluir todos los orígenes desde los que vas a abrir el frontend:

- GitHub Pages
- dominio personalizado
- localhost o Live Server

## 5. Instalar y enlazar Supabase CLI

Si no la tienes:

```bash
npm install -g supabase
```

Luego, en este repo:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

## 6. Subir los secretos

Puedes usar un `.env` local basado en `supabase/.env.example` y luego subirlo:

```bash
supabase secrets set --env-file supabase/.env
```

O uno por uno:

```bash
supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REDIRECT_URI=...
```

## 7. Desplegar las funciones

Desde la raiz del repo:

```bash
supabase functions deploy
```

Esto publica:

- `google-auth-start`
- `google-auth-callback`
- `gmail-session`
- `gmail-search`
- `gmail-disconnect`

## 8. Flujo de uso

1. Abres la pagina.
2. La pagina consulta `gmail-session` en segundo plano.
3. Si no hay conexion, no sale popup.
4. Cuando pulsas `Conectar con Google`, el navegador redirige a `google-auth-start`.
5. Google devuelve el `code` a `google-auth-callback`.
6. La funcion guarda `refresh_token` y `access_token` en Supabase.
7. El frontend ya consulta correos usando `gmail-search`.
8. `gmail-search` renueva el `access_token` con el `refresh_token` cuando hace falta.

## Desarrollo local

Si abres el frontend localmente, agrega ese origen a `ALLOWED_WEB_ORIGINS`, por ejemplo:

```text
http://127.0.0.1:5500
```

Tambien puedes trabajar con el frontend local y el backend desplegado en Supabase.

## Notas importantes

- El `service_role` nunca debe ir al navegador.
- El primer login de Google sigue requiriendo interaccion del usuario.
- Este backend guarda `refresh_token` para poder renovar acceso sin popup en busquedas futuras.
- Las funciones se publican sin JWT de Supabase a proposito, porque esta app no usa Supabase Auth.
