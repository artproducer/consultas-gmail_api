# consultas-gmail_api

Version para GitHub Pages con autenticacion 100% frontend usando Google Identity Services.

## Configuracion

Edita [script.js](./script.js) y coloca tu OAuth Client ID publico en:

```js
const HARDCODED_CLIENT_ID = 'TU_CLIENT_ID.apps.googleusercontent.com';
```

## Google Cloud

En tu cliente OAuth de tipo Web configura:

### Authorized JavaScript origins

```text
https://TU_USUARIO.github.io
```

Si publicas el proyecto en una ruta como `https://TU_USUARIO.github.io/consultas-gmail_api/`, el origin sigue siendo solo `https://TU_USUARIO.github.io`.

Si usas dominio personalizado en GitHub Pages, agrega tambien tu dominio real, por ejemplo:

```text
https://mail.dsorak.com
```

### Scopes usados

- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/userinfo.profile`
- `https://www.googleapis.com/auth/userinfo.email`

## Como funciona la sesion

- El login usa popup de Google Identity Services.
- El `access_token` se guarda en `localStorage` con su expiracion.
- La app intenta renovarlo silenciosamente antes de que expire.
- La app tambien reintenta renovar la sesion al volver a la pestaña o a la ventana.
- Si Google ya no permite renovacion silenciosa, tendras que iniciar sesion otra vez.

## Limite importante

Sin backend no existe un `refresh_token` seguro persistente para Gmail en GitHub Pages.
La app hace el mejor esfuerzo posible para que la sesion dure mucho, pero Google aun puede pedir reautenticacion.
