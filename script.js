/**
 * GMAIL QUERY TOOL - SCRIPT
 * Manages OAuth flow and Gmail API searching / rendering.
 */

// ─── CONFIGURATION ───────────────────────────────────────────────────────────
const HARDCODED_CLIENT_ID = '357370160811-p0fvc37cgrr5385olh07da3249pm8hl0.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email';
const SK_ACCESS = 'query_access_token';
const SK_EXPIRY = 'query_token_expiry';
const DEFAULT_MAX_RESULTS = 5;
const POLLING_INTERVAL_MS = 2 * 1000;
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

let accessToken = null;
let tokenClient = null;
let tokenExpiry = 0;
let tokenRefreshTimer = null;
let lastAuthError = '';
let sessionProfile = null;
let isSearching = false;
let pollingInterval = null;
let renderedMessageIds = new Set();
let latestSeenInternalDate = 0;
let defaultAuthBtnHtml = '';

// DOM Cache
let resultsContainer, submitBtn, filterInput, authBtn, authText, backToTopBtn, clearFilterBtn;

// AUTHENTICATION (GOOGLE IDENTITY SERVICES)
function getClientId() {
    return HARDCODED_CLIENT_ID.trim();
}

function isAuthed() {
    return !!accessToken && tokenExpiry > Date.now();
}

function clearStoredToken() {
    accessToken = null;
    tokenExpiry = 0;
    localStorage.removeItem(SK_ACCESS);
    localStorage.removeItem(SK_EXPIRY);
    if (tokenRefreshTimer) {
        window.clearTimeout(tokenRefreshTimer);
        tokenRefreshTimer = null;
    }
}

function restoreStoredToken() {
    const storedToken = localStorage.getItem(SK_ACCESS);
    const storedExpiry = parseInt(localStorage.getItem(SK_EXPIRY) || '0', 10);
    if (!storedToken || !storedExpiry || storedExpiry <= Date.now()) {
        clearStoredToken();
        return false;
    }

    accessToken = storedToken;
    tokenExpiry = storedExpiry;
    scheduleTokenRefresh();
    return true;
}

function scheduleTokenRefresh() {
    if (tokenRefreshTimer) window.clearTimeout(tokenRefreshTimer);
    if (!accessToken || !tokenExpiry) return;

    const refreshIn = Math.max(15000, tokenExpiry - Date.now() - TOKEN_REFRESH_BUFFER_MS);
    tokenRefreshTimer = window.setTimeout(async () => {
        try {
            await ensureAccessToken(false);
        } catch (_) {
            clearStoredToken();
            onLoggedOut();
        }
    }, refreshIn);
}

function persistToken(response) {
    accessToken = response.access_token;
    tokenExpiry = Date.now() + ((response.expires_in || 3600) * 1000);
    localStorage.setItem(SK_ACCESS, accessToken);
    localStorage.setItem(SK_EXPIRY, String(tokenExpiry));
    scheduleTokenRefresh();
}

async function waitForGoogleIdentity(maxAttempts = 40) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (window.google && window.google.accounts && window.google.accounts.oauth2) return true;
        await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    return false;
}

async function initTokenClient() {
    if (tokenClient) return true;
    if (!getClientId()) throw new Error('Configura HARDCODED_CLIENT_ID en script.js para GitHub Pages.');

    const loaded = await waitForGoogleIdentity();
    if (!loaded) throw new Error('Google Identity Services no carg� a tiempo.');

    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: getClientId(),
        scope: SCOPE,
        callback: () => {},
        error_callback: () => {}
    });
    return true;
}

async function requestAccessToken(promptValue) {
    await initTokenClient();

    return new Promise((resolve, reject) => {
        tokenClient.callback = (response) => {
            if (response.error) {
                const error = new Error(response.error);
                error.data = response;
                reject(error);
                return;
            }
            persistToken(response);
            resolve(response);
        };

        tokenClient.error_callback = (error) => {
            reject(new Error(error.type || 'popup_error'));
        };

        tokenClient.requestAccessToken({ prompt: promptValue });
    });
}

async function loadConnectedUserProfile() {
    if (!accessToken) return null;

    try {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!res.ok) throw new Error('profile_error');
        const data = await res.json();
        sessionProfile = {
            email: data.email || '',
            picture: data.picture || '',
            name: data.name || ''
        };
        return sessionProfile;
    } catch (_) {
        sessionProfile = sessionProfile || { email: 'connected' };
        return sessionProfile;
    }
}

function renderAuthStatus(isConnected) {
    if (!authText) return;
    authText.innerHTML = '';

    const label = document.createElement('span');
    label.textContent = isConnected ? 'Sesion Activa' : 'Desconectado';
    authText.appendChild(label);

    if (isConnected) {
        const btn = document.createElement('button');
        btn.className = 'disconnect-btn';
        btn.textContent = 'Cerrar';
        btn.onclick = (e) => {
            e.stopPropagation();
            logout();
        };
        authText.appendChild(btn);
    }
}

function onAuthed(profile = null) {
    if (profile) sessionProfile = profile;
    const card = document.getElementById('authCard');
    card.classList.add('connected');

    renderAuthStatus(true);
    if (sessionProfile && sessionProfile.picture) setAuthAvatar(sessionProfile.picture);
    else setAuthDefaultIcon();

    authBtn.onclick = (e) => {
        e.stopPropagation();
        authText.style.opacity = authText.style.opacity === '1' ? '0' : '1';
        authText.style.pointerEvents = authText.style.opacity === '1' ? 'auto' : 'none';
    };
}

function onLoggedOut() {
    sessionProfile = null;
    if (pollingInterval) clearInterval(pollingInterval);
    const live = document.getElementById('liveStatus');
    if (live) live.classList.remove('is-live');
    const card = document.getElementById('authCard');
    card.classList.remove('connected');
    authText.style.opacity = '';
    authText.style.pointerEvents = '';
    renderAuthStatus(false);
    setAuthDefaultIcon();
    authBtn.onclick = startAuth;
}

function setAuthDefaultIcon() {
    if (!authBtn) return;
    authBtn.classList.remove('has-avatar');
    if (defaultAuthBtnHtml) authBtn.innerHTML = defaultAuthBtnHtml;
}

function setAuthAvatar(photoUrl) {
    if (!authBtn || !photoUrl) return;
    authBtn.classList.add('has-avatar');
    authBtn.innerHTML = `<img class="auth-avatar" src="${photoUrl}" alt="Perfil">`;
}

async function apiFetchJson(url, options = {}) {
    const hasToken = await ensureAccessToken(false);
    if (!hasToken) {
        const err = new Error('Sesion expirada. Inicia sesion de nuevo.');
        err.status = 401;
        throw err;
    }

    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${accessToken}`);

    const res = await fetch(url, {
        ...options,
        headers
    });

    let data = null;
    try {
        data = await res.json();
    } catch (_) {
        data = null;
    }

    if (!res.ok) {
        const err = new Error((data && (data.message || data.error?.message)) || 'Error en la solicitud');
        err.status = res.status;
        err.data = data;
        throw err;
    }

    return data;
}

async function ensureAccessToken(interactive = false) {
    if (isAuthed() && tokenExpiry > Date.now() + TOKEN_REFRESH_BUFFER_MS) return true;
    if (restoreStoredToken() && tokenExpiry > Date.now() + TOKEN_REFRESH_BUFFER_MS) return true;

    try {
        lastAuthError = '';
        await requestAccessToken(interactive ? 'consent' : '');
        await loadConnectedUserProfile();
        onAuthed(sessionProfile);
        return true;
    } catch (err) {
        lastAuthError = err && err.message ? err.message : 'No se pudo conectar con Google';
        if (!interactive) clearStoredToken();
        return false;
    }
}

async function ensureSession() {
    if (restoreStoredToken()) {
        await loadConnectedUserProfile();
        onAuthed(sessionProfile);
        return true;
    }

    const refreshed = await ensureAccessToken(false);
    if (refreshed) return true;

    onLoggedOut();
    return false;
}

async function startAuth() {
    if (isAuthed()) return;
    if (!getClientId()) {
        showToast('Falta configurar HARDCODED_CLIENT_ID', 'error');
        return;
    }
    const connected = await ensureAccessToken(true);
    if (connected) {
        showToast('Sesion conectada', 'success');
        return;
    }
    showToast(lastAuthError || 'No se pudo conectar con Google', 'error');
}

async function logout() {
    const tokenToRevoke = accessToken;
    clearStoredToken();
    sessionProfile = null;

    if (window.google && google.accounts && google.accounts.oauth2 && tokenToRevoke) {
        google.accounts.oauth2.revoke(tokenToRevoke, () => location.reload());
        return;
    }

    location.reload();
}
// ─── SEARCH & RENDER ─────────────────────────────────────────────────────────

async function searchMails(isSilent = false) {
    if (isSearching) return;

    const filter = filterInput.value.trim();
    if (!filter) return;

    if (!isAuthed()) {
        const hasSession = await ensureSession();
        if (!hasSession) {
            if (!isSilent) {
                showToast('Conecta con Google primero', 'error');
                startAuth();
            }
            return;
        }
    }

    if (!isSilent) {
        if (pollingInterval) clearInterval(pollingInterval);
        setLoading(true);
        resultsContainer.innerHTML = '';
        renderedMessageIds.clear();
        latestSeenInternalDate = 0;
        const live = document.getElementById('liveStatus');
        if (live) live.classList.remove('is-live');
    } else {
        // Silent polling must also lock to avoid overlapping requests
        isSearching = true;
    }

    try {
        const maxInput = document.getElementById('maxResultsInput');
        const rawMax = parseInt(maxInput?.value || DEFAULT_MAX_RESULTS, 10);
        const maxLimit = Math.max(1, Number.isNaN(rawMax) ? DEFAULT_MAX_RESULTS : rawMax);
        if (maxInput) maxInput.value = String(maxLimit);
        const query = encodeURIComponent(`${filter}`);
        updateResultsMaxInfo(maxLimit);
        const listData = await apiFetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=${maxLimit}`);

        if (!listData.messages || listData.messages.length === 0) {
            if (!isSilent) {
                resultsContainer.innerHTML = `
                    <div style="text-align:center; padding:40px; border-radius:18px; border:1px dashed var(--border);">
                        <div style="font-size:0.9rem; font-weight:600; color:var(--text); margin-bottom:8px;">No se encontraron resultados</div>
                    </div>
                `;
            }
            return;
        }

        const newBatch = listData.messages.filter(m => !renderedMessageIds.has(m.id)).reverse();
        const detailedMessages = await Promise.all(
            newBatch.map((message) =>
                apiFetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?format=full`)
            )
        );

        for (let i = 0; i < detailedMessages.length; i++) {
            const data = detailedMessages[i];
            const msgInternalDate = Number(data.internalDate || 0);
            const shouldHighlightNew = isSilent && msgInternalDate > latestSeenInternalDate;
            latestSeenInternalDate = Math.max(latestSeenInternalDate, msgInternalDate);
            renderedMessageIds.add(data.id);
            renderEmail(data, true, i, shouldHighlightNew);
        }

    } catch (err) {
        if (err.status === 401) onLoggedOut();
        if (!isSilent) showToast(err.message, 'error');
    } finally {
        if (!isSilent) setLoading(false);
        else isSearching = false;
        if (!isSilent) startPolling();
    }
}
function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    const live = document.getElementById('liveStatus');
    if (live) live.classList.add('is-live');
    pollingInterval = setInterval(() => {
        const filter = filterInput.value.trim();
        if (filter && !isSearching) searchMails(true);
    }, POLLING_INTERVAL_MS);
}

function renderEmail(msg, prepend = false, animIndex = 0, highlightAsNew = false) {
    const headers = msg.payload.headers;
    const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '(Sin asunto)';
    const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
    const dateStr = headers.find(h => h.name.toLowerCase() === 'date')?.value || '';
    const date = new Date(dateStr).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase();

    const { content, isHtml } = extractBody(msg.payload);

    // Advanced Code Detection with DOM Parsing (Disney+, Netflix, etc.)
    let foundCode = null;
    let pureText = content;

    let doc = null;
    // Crucial: DOMParser completely ignores HTML attributes and tags
    if (isHtml) {
        const parser = new DOMParser();
        doc = parser.parseFromString(content, 'text/html');

        // Remove style and script tags which contain code, not text
        doc.querySelectorAll('style, script').forEach(s => s.remove());

        pureText = doc.body.textContent || "";
    }

    // Normalize text: remove tabs, newlines and extra spaces
    const searchContext = `${subject} | ${msg.snippet} | ${pureText}`.replace(/[\n\r\t]/g, ' ').replace(/\s+/g, ' ');

    const isInvalidCode = (c, context, raw = null) => {
        if (/^(202[4-9]|2030)$/.test(c)) return true; // Common years
        if (/^[0-9]{5}$/.test(c)) return true; // ZIP codes
        if (/^(.)\1+$/.test(c)) return true; // Repeated digits (0000)
        if (c.includes('1570') || c.startsWith('01800')) return true; // Phone fragments

        // Use raw (spaced) version if provided to find correct position in context
        const searchStr = raw || c;
        const pos = context.indexOf(searchStr);
        if (pos === -1) return false;

        // Anti-Tracking/SRC ID check: if number is surrounded by hyphens or hex-like chars
        const surrounding = context.substring(Math.max(0, pos - 15), Math.min(context.length, pos + searchStr.length + 15));
        if (/[0-9a-fA-F]{4,}[-_]|[-_][0-9a-fA-F]{4,}/.test(surrounding)) return true; // e.g., 1234-ABCD, ABCD-1234
        if (surrounding.includes('SRC:') || surrounding.includes('ID:') || /src/i.test(surrounding) || surrounding.includes('UUID')) return true; // e.g., SRC:1234, ID:5678, UUID-9012

        const lookbehind = context.substring(Math.max(0, pos - 50), pos).toLowerCase();
        const lookahead = context.substring(pos + searchStr.length, Math.min(context.length, pos + searchStr.length + 30)).toLowerCase();

        if (lookbehind.includes('llama') || lookbehind.includes('llámanos') || lookbehind.includes('tel') || lookbehind.includes('phone') || lookbehind.includes('01 800') || lookbehind.includes('800')) return true;
        if (lookahead.includes('way') || lookahead.includes('ave') || lookahead.includes('st') || lookahead.includes('calle') || lookahead.includes('road')) return true;

        // Check for common footer terms around the code to avoid 1570121-like leaks
        const footerTerms = ['derechos reservados', 'unsubscribe', 'privacidad', 'términos', 'copyright', 'inc.', 'privacy', 'src:', 'id:', 'uuid', '121 albright'];
        const contextAroundCode = context.substring(Math.max(0, pos - 150), Math.min(context.length, pos + searchStr.length + 150)).toLowerCase();
        if (footerTerms.some(term => contextAroundCode.includes(term))) return true;

        return false;
    };

    // 0. HTML Specific Search (High Confidence)
    if (isHtml) {
        const potentialCodes = Array.from(doc.querySelectorAll('td, span, div, b, strong, font'))
            .filter(el => {
                const txt = el.textContent.trim().replace(/\s+/g, '');
                const style = el.getAttribute('style') || '';
                const cls = el.className || '';
                // Look for common code classes or letter-spacing
                return (cls.includes('number') || cls.includes('code') || style.includes('letter-spacing')) && /^\d{4,8}$/.test(txt);
            });
        if (potentialCodes.length > 0) {
            foundCode = potentialCodes[0].textContent.trim().replace(/\s+/g, '');
        }
    }

    // 1. Proximity Match: Code AFTER keyword (High Priority)
    const afterRegex = /(?:código|code|confirmación|verific|acceso|pin|confirma|cambio).{0,400}?\b(\d{4,8})\b/i;
    const afterMatch = searchContext.match(afterRegex);
    if (afterMatch && !foundCode && !isInvalidCode(afterMatch[1], searchContext)) {
        foundCode = afterMatch[1];
    }

    // 2. Proximity Match: Code BEFORE keyword
    if (!foundCode) {
        const beforeRegex = /\b(\d{4,8})\b.{0,60}?(?:código|code|confirmación|verific|es tu|is tu|confirma)/i;
        const beforeMatch = searchContext.match(beforeRegex);
        if (beforeMatch && !isInvalidCode(beforeMatch[1], searchContext)) {
            foundCode = beforeMatch[1];
        }
    }

    // 3. Fallback for spaced codes (Netflix: 1 2 3 4)
    if (!foundCode) {
        const spacedMatch = searchContext.match(/(?:código|code|confirmación|verific|confirma|cambio).{0,250}?\b((\d\s*){4,8})\b/i);
        if (spacedMatch) {
            const rawCode = spacedMatch[1];
            const joined = rawCode.replace(/\s+/g, '');
            if (joined.length >= 4 && !isInvalidCode(joined, searchContext, rawCode)) foundCode = joined;
        }
    }

    // 4. Final Fallback: If email subject screams "code", grab the first valid 4-8 digit number
    if (!foundCode && /(código|code|verific|acceso|inicio|sesión|login|confirma|cambio)/i.test(subject)) {
        const allNums = searchContext.match(/\b\d{4,8}\b/g) || [];
        const valid = allNums.find(n => !isInvalidCode(n, searchContext));
        if (valid) foundCode = valid;
    }

    // Smart Summary
    let displaySnippet = msg.snippet;
    const lowerSub = subject.toLowerCase();

    // Protection/Security alerts (Crunchyroll, Google, Vix, etc.)
    if (lowerSub.includes('accedida') || lowerSub.includes('inicio de sesión') || lowerSub.includes('inicia sesión') || lowerSub.includes('seguridad') || lowerSub.includes('verific') || lowerSub.includes('contraseña')) {
        // Strict regex for Geography (excludes CSS media query leaks)
        const locationMatch = searchContext.match(/(?:Cerca de|Cerca|En)\s+(?!(?:and|min|max|width))\b([^,\|]{3,50}, [^,\|]{3,50}(?:, [^,\|]{3,50})?)/i);
        const accountMatch = searchContext.match(/(?:Cuenta de Google|la cuenta)\s+([^\s]+@gmail\.com)/i);

        if (accountMatch) {
            displaySnippet = `Verificando cuenta: <strong>${accountMatch[1].trim()}</strong>`;
        } else if (locationMatch && locationMatch[1].includes(',')) {
            displaySnippet = `Inicio detectado en: <strong>${locationMatch[1].trim()}</strong>`;
        } else if (lowerSub.includes('contraseña') || lowerSub.includes('password')) {
            displaySnippet = `Actualización de seguridad confirmada`;
        } else if (lowerSub.includes('verific')) {
            displaySnippet = `Confirmación: <strong>Escribe el código para validar</strong>`;
        }
    }

    // Household/Access/Invitation specific logic (Netflix, Vix, etc.)
    if (lowerSub.includes('hogar') || lowerSub.includes('viaje') || lowerSub.includes('dispositivo') || lowerSub.includes('solicitaste') || lowerSub.includes('vix') || lowerSub.includes('unirse') || lowerSub.includes('tienes') || lowerSub.includes('inicio') || lowerSub.includes('temporal')) {
        const netflixMatch = searchContext.match(/(\w+) ha enviado una solicitud desde (?:el dispositivo )?([^|]+?)(?= a las| \||$)/i);
        const newNetflixMatch = searchContext.match(/Solicitud de (.*?), enviada desde:\s*([^,]+)/i);
        const inviteMatch = searchContext.match(/(\w+) te ha invitado(?: [^ ]+){0,5} a (?:unirse|su plan)/i);
        const deviceMatch = searchContext.match(/([A-Z][a-z0-9 ]+-[^|]+)/i) || searchContext.match(/([A-Z][a-z]+ Smart TV|Samsung|LG|Apple TV|Roku)/i);

        if (subject.includes('Solicitud de inicio') || subject.includes('solicitud de inicio')) {
            const dev = deviceMatch ? deviceMatch[1].trim() : 'Dispositivo';
            displaySnippet = `Aprobar acceso: <strong>${dev}</strong>`;
        } else if (subject.includes('¡Casi lo tienes!')) {
            displaySnippet = `Suscripción pendiente: <strong>Crea tu cuenta ahora</strong>`;
        } else if (inviteMatch) {
            displaySnippet = `Invitación de: <strong>${inviteMatch[1].trim()}</strong>`;
        } else if (newNetflixMatch) {
            displaySnippet = `<strong>${newNetflixMatch[1].trim()}</strong> solicitó desde <strong>${newNetflixMatch[2].trim()}</strong>`;
        } else if (netflixMatch) {
            displaySnippet = `<strong>${netflixMatch[1].trim()}</strong> solicitó desde <strong>${netflixMatch[2].trim()}</strong>`;
        } else if (!displaySnippet.includes('Inicio detectado') && !displaySnippet.includes('Verificando')) {
            const deviceMatch = searchContext.match(/Dispositivo\s*(.*?)(?=\sFecha|\sHora|$)/i);
            if (deviceMatch) displaySnippet = `Nuevo acceso en: <strong>${deviceMatch[1].trim()}</strong>`;
        }
    }

    if (!displaySnippet.includes('Inicio detectado') && !displaySnippet.includes('Verificando')) {
        const removedFromPlanMatch = searchContext.match(/([^\s|]+@[^\s|]+)\s+te ha quitado de su plan/i);
        if (lowerSub.includes('suscripci') && lowerSub.includes('termin') && removedFromPlanMatch) {
            displaySnippet = `Sin acceso: <strong>${removedFromPlanMatch[1].trim()}</strong> te quitó del plan`;
        } else if (lowerSub.includes('suscripci') && lowerSub.includes('termin')) {
            displaySnippet = `Suscripción terminada: <strong>Configura tu propio plan</strong>`;
        }
    }

    const isAmazonLoginAlert = /amazon/i.test(from) && /inicio de sesi[oó]n/i.test(subject);
    if (isAmazonLoginAlert) {
        const dateMatch = searchContext.match(/Fecha:\s*([^|]+?)(?=\s+Dispositivo:|$)/i);
        const deviceMatch = searchContext.match(/Dispositivo:\s*([^|]+?)(?=\s+Cerca de:|$)/i);
        const locationMatch = searchContext.match(/Cerca de:\s*([^|]+?)(?=\s+Si fuiste t[uú]|$)/i);
        const summaryParts = [];

        if (dateMatch) summaryParts.push(`<strong>${dateMatch[1].trim()}</strong>`);
        if (deviceMatch) summaryParts.push(deviceMatch[1].trim());
        if (locationMatch) summaryParts.push(locationMatch[1].trim());

        if (summaryParts.length > 0) {
            displaySnippet = `Inicio detectado: ${summaryParts.join(' · ')}`;
        } else {
            displaySnippet = `Inicio detectado: <strong>Revisa la alerta de Amazon</strong>`;
        }
    }

    // Fallback: If snippet is empty or looks like placeholder, show full sender address
    let useFromAction = false;
    const cleanSnippet = displaySnippet.replace(/&nbsp;/g, ' ').trim();
    if (!cleanSnippet || cleanSnippet === '...' || cleanSnippet.toLowerCase() === 'no snippet') {
        displaySnippet = `<span style="opacity:0.6; font-size:0.75rem;">Remitente: ${from.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`;
        useFromAction = true;
    }

    let mainAction = findMainAction(content, isHtml);

    if (isAmazonLoginAlert) {
        mainAction = null;
    }

    // If body was empty, force a "Copy Email" action
    if (useFromAction && !mainAction) {
        const emailOnly = from.match(/[^ <]+@[^ >]+/);
        if (emailOnly) {
            mainAction = { label: 'COPIAR CORREO', url: 'javascript:void(0)', isCopyEmail: true, email: emailOnly[0] };
        }
    }

    const item = document.createElement('div');
    item.className = 'email-item';
    item.onclick = (e) => {
        if (!e.target.closest('a') && !e.target.closest('.copy-mini')) {
            item.classList.remove('email-item-new-live');
            toggleBody(item);
        }
    };

    let codeHtml = '';
    if (foundCode) {
        // Code box is now directly clickable to copy, no extra button needed
        codeHtml = `
            <div class="code-box click-to-copy" style="background:rgba(18,140,126,0.3); border:1px solid rgba(18,140,126,0.8); cursor:pointer; display:inline-flex; align-items:center; height:30px; padding:0 12px; border-radius:8px;" title="Clic para copiar" onclick="event.stopPropagation(); copyToClipboard('${foundCode}', 'Código copiado')">
                <span class="code-value" style="color:#fff; font-size:1.1rem; letter-spacing:3px;">${foundCode}</span>
            </div>
        `;
    }

    let actionHtml = '';
    if (mainAction) {
        const isProtection = mainAction.label === 'PROTEGER CUENTA';
        const isBilling = mainAction.label === 'GESTIONAR PAGO';
        const isRenew = mainAction.label === 'RENOVAR';
        const isLogin = mainAction.label === 'INICIAR SESIÓN';
        const isCreate = mainAction.label === 'CREAR CUENTA';
        const isApprove = mainAction.label === 'APROBAR INICIO';
        const isRequest = mainAction.label === 'SOLICITAR CÓDIGO';
        const isFirstSteps = mainAction.label === 'PRIMEROS PASOS';
        const isCopy = mainAction.isCopyEmail;

        let btnColor = 'var(--green)';
        let btnShadow = 'var(--green-glow)';
        let txtColor = '#000';
        let clickAction = `event.stopPropagation()`;

        if (mainAction.label === 'SÍ, LO SOLICITÉ YO' || mainAction.label === 'ACEPTAR INVITACIÓN' || isCreate || isApprove || isRequest || isFirstSteps) {
            btnColor = '#e50914'; // Netflix Red
            btnShadow = 'rgba(229,9,20,0.4)';
        } else if (isProtection) {
            btnColor = '#ff6600'; // Crunchyroll/Security Orange
            btnShadow = 'rgba(255,102,0,0.4)';
        } else if (isBilling) {
            btnColor = '#7d2ae8'; // Canva Purple
            btnShadow = 'rgba(125,42,232,0.4)';
            txtColor = '#fff';
        } else if (isRenew) {
            btnColor = '#00c9db'; // CapCut Cyan
            btnShadow = 'rgba(0,201,219,0.4)';
        } else if (isLogin) {
            btnColor = '#f35400'; // Vix Orange
            btnShadow = 'rgba(243,84,0,0.4)';
        } else if (isCopy) {
            btnColor = '#3498db'; // Google Blue
            btnShadow = 'rgba(52,152,219,0.4)';
            txtColor = '#000';
            clickAction = `event.stopPropagation(); copyToClipboard('${mainAction.email}', 'Correo copiado')`;
        }

        const href = isCopy ? 'javascript:void(0)' : mainAction.url;

        actionHtml = `
            <a href="${href}" target="${isCopy ? '' : '_blank'}" onclick="${clickAction}" style="display:inline-flex; align-items:center; justify-content:center; white-space:nowrap; height:30px; padding:0 12px; background:${btnColor}; border-radius:8px; font-size:0.7rem; font-weight:800; color:${txtColor}; text-decoration:none; box-shadow: 0 4px 10px ${btnShadow}; flex-shrink:0;">
                ${mainAction.label.toUpperCase()}
            </a>
        `;
    }

    item.innerHTML = `
        <div class="email-top-row">
            <span class="email-from">${from.split('<')[0].trim().replace(/['"]/g, '') || from}</span>
            <div class="email-top-actions">
                <span class="email-date">${date}</span>
            </div>
        </div>
        <div class="email-subject" style="pointer-events:none;">${subject}</div>
        
        <div class="card-summary">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:nowrap;">
                <div class="email-snippet" style="pointer-events:none; margin-bottom:0; flex-grow:1; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${displaySnippet}</div>
                <div style="display:flex; gap:8px; align-items:center; flex-shrink:0; margin-right:20px;">
                    ${codeHtml}
                    ${actionHtml}
                </div>
            </div>
        </div>
        
        <div class="msg-body">
            <div class="msg-frame-shell">
                ${isHtml ?
                `<iframe id="iframe-${msg.id}"></iframe>` :
                `<div class="msg-body-content">${formatBodyWithLinks(content)}</div>`
            }
            </div>
        </div>
        <div class="card-indicator">▼</div>
    `;

    if (highlightAsNew) {
        document.querySelectorAll('.email-item-new-live').forEach(el => el.classList.remove('email-item-new-live'));
        item.classList.add('email-item-new-live');
    }

    if (prepend) resultsContainer.prepend(item);
    else resultsContainer.appendChild(item);

    if (isHtml) {
        const iframe = document.getElementById('iframe-' + msg.id);
        const doc = iframe.contentWindow.document;
        doc.open();
        doc.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <base target="_blank">
                <style>
                    body { font-family: sans-serif; margin: 15px; color: #333; line-height: 1.5; background: #fff; }
                    img { max-width: 100% !important; height: auto !important; }
                    a { color: #128c7e; }
                </style>
            </head>
            <body>${content}</body>
            </html>
        `);
        doc.close();
    }
}

// ─── UTILS ───────────────────────────────────────────────────────────────────

function extractBody(payload) {
    // Collect all parts
    let htmlPart = null;
    let plainPart = null;

    function findParts(p) {
        if (p.mimeType === 'text/html') htmlPart = p.body.data;
        if (p.mimeType === 'text/plain') plainPart = p.body.data;
        if (p.parts) p.parts.forEach(findParts);
    }

    findParts(payload);

    if (htmlPart) return { content: decodeB64(htmlPart), isHtml: true };
    if (plainPart) return { content: decodeB64(plainPart), isHtml: false };

    return { content: 'Cuerpo del mensaje no disponible.', isHtml: false };
}

function decodeB64(str) {
    try {
        const raw = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        return new TextDecoder().decode(bytes);
    } catch (e) { return 'Error de decodificación.'; }
}

function formatBodyWithLinks(text) {
    const urlPattern = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlPattern, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

function toggleBody(item) {
    const body = item.querySelector('.msg-body');
    const summary = item.querySelector('.card-summary');
    const indicator = item.querySelector('.card-indicator');

    const isExpanded = body.style.display === 'block';

    if (isExpanded) {
        body.style.display = 'none';
        summary.style.display = 'block';
        indicator.style.transform = 'rotate(0deg)';
    } else {
        body.style.display = 'block';
        summary.style.display = 'none';
        indicator.style.transform = 'rotate(180deg)';
    }
}

function updateBackToTopVisibility() {
    if (!backToTopBtn) return;
    const shouldShow = window.scrollY > 240;
    backToTopBtn.classList.toggle('show', shouldShow);
}

function updateResultsMaxInfo(maxValue) {
    const info = document.getElementById('resultsMaxInfo');
    if (!info) return;
    info.textContent = `MAX: ${maxValue}`;
}

function normalizeMaxResultsInput() {
    const maxResultsInput = document.getElementById('maxResultsInput');
    if (!maxResultsInput) return DEFAULT_MAX_RESULTS;
    const rawValue = (maxResultsInput.value || '').trim();
    if (!rawValue) {
        updateResultsMaxInfo(DEFAULT_MAX_RESULTS);
        return DEFAULT_MAX_RESULTS;
    }

    const parsed = parseInt(rawValue, 10);
    const normalized = Math.max(1, Number.isNaN(parsed) ? DEFAULT_MAX_RESULTS : parsed);
    maxResultsInput.value = String(normalized);
    updateResultsMaxInfo(normalized);
    return normalized;
}

function applyMaxResultsChange() {
    const normalized = normalizeMaxResultsInput();
    if (filterInput && filterInput.value.trim() && !isSearching) {
        searchMails();
    }
    return normalized;
}

// Manual extractor based on keywords
function findMainAction(content, isHtml) {
    const rules = [
        { label: 'SÍ, LO SOLICITÉ YO', regex: /sí, lo solicit[eé] yo|sí, he sido yo|sí, la envi[eé] yo|confirmar solicitud/i },
        { label: 'APROBAR INICIO', regex: /aprobar inicio|aprobar acceso|approve login/i },
        { label: 'VERIFICAR CUENTA', regex: /verificar cuenta|confirmar correo|verificar correo electr[oó]nico|verify account|confirm email/i },
        { label: 'ACEPTAR INVITACIÓN', regex: /comenzar|unirse|aceptar invitaci[oó]n|get started/i },
        { label: 'PRIMEROS PASOS', regex: /primeros pasos|first steps/i },
        { label: 'INICIAR SESIÓN', regex: /inicia[r]? sesi[oó]n|log[ -]?in|acceder|sign[ -]?in|mi cuenta/i },
        { label: 'CREAR CUENTA', regex: /crea[r]? cuenta|iniciar mi membres[ií]a|sign[ -]?up|create account/i },
        { label: 'SOLICITAR CÓDIGO', regex: /solicitar c[oó]digo|get code|enviar c[oó]digo/i },
        { label: 'PROTEGER CUENTA', regex: /esto no fui yo|not me|security alert|seguridad/i },
        { label: 'GESTIONAR PAGO', regex: /actualizar método|método de pago|update payment|billing|pago/i },
        { label: 'CAMBIAR CONTRASEÑA', regex: /cambi.* contraseña|change password|reset password/i },
        { label: 'GESTIONAR HOGAR', regex: /administrar hogar|configurar hogar|manage household|gestion de hogar/i },
        { label: 'GESTIONAR ACCESO', regex: /gestionar el acceso|comprueba qué dispositivos|manage access/i },
        { label: 'VERIFICAR CUENTA', regex: /verificar cuenta|confirmar correo|verify account|confirm email/i },
        { label: 'REESTABLECER', regex: /restablecer|recuperar|reset|recover/i }
    ];

    if (isHtml) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'text/html');
        const links = Array.from(doc.querySelectorAll('a'));

        for (const rule of rules) {
            const match = links.find(l => {
                const text = (l.textContent || l.innerText || '').trim();
                const title = (l.getAttribute('title') || l.getAttribute('aria-label') || '').trim();
                return rule.regex.test(text) || rule.regex.test(title);
            });

            if (match && match.href && match.href.startsWith('http')) {
                return { label: rule.label, url: match.href };
            }
        }
    } else {
        const lines = content.split('\n');
        for (const rule of rules) {
            const lineIdx = lines.findIndex(l => rule.regex.test(l));
            if (lineIdx !== -1) {
                for (let i = lineIdx; i < Math.min(lineIdx + 6, lines.length); i++) {
                    const linkMatch = lines[i].match(/(https?:\/\/[^\s]+)/);
                    if (linkMatch) return { label: rule.label, url: linkMatch[0] };
                }
            }
        }
    }
    return null;
}

function copyToClipboard(text, successMsg) {
    navigator.clipboard.writeText(text)
        .then(() => showToast(successMsg, 'success'))
        .catch(() => showToast('Error al copiar', 'error'));
}

function setLoading(on) {
    isSearching = on;
    submitBtn.disabled = on;
    submitBtn.classList.toggle('is-loading', on);
}

function showToast(text, type = 'error') {
    const t = document.getElementById('toast');
    t.textContent = text;
    t.className = `show ${type}`;
    setTimeout(() => t.classList.remove('show'), 3500);
}

// INITIALIZATION

document.addEventListener('DOMContentLoaded', () => {
    // Cache DOM
    resultsContainer = document.getElementById('resultsContainer');
    submitBtn = document.getElementById('submitBtn');
    filterInput = document.getElementById('filterEmail');
    authBtn = document.getElementById('authBtn');
    defaultAuthBtnHtml = authBtn ? authBtn.innerHTML : '';
    authText = document.getElementById('authStatus');
    backToTopBtn = document.getElementById('backToTopBtn');
    clearFilterBtn = document.getElementById('clearFilterBtn');
    const maxResultsInput = document.getElementById('maxResultsInput');

    renderAuthStatus(false);
    authBtn.onclick = startAuth;

    if (backToTopBtn) {
        backToTopBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
    if (filterInput && clearFilterBtn) {
        filterInput.addEventListener('input', updateClearFilterVisibility);
        updateClearFilterVisibility();
    }
    if (maxResultsInput) {
        maxResultsInput.addEventListener('input', () => updateResultsMaxInfo(maxResultsInput.value || DEFAULT_MAX_RESULTS));
        maxResultsInput.addEventListener('blur', normalizeMaxResultsInput);
        maxResultsInput.addEventListener('change', applyMaxResultsChange);
        normalizeMaxResultsInput();
    }
    window.addEventListener('scroll', updateBackToTopVisibility, { passive: true });
    window.addEventListener('focus', () => {
        ensureSession();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') ensureSession();
    });
    updateBackToTopVisibility();

    ensureSession();
});
// Helper for UI paste
window.pasteFromClipboard = function () {
    navigator.clipboard.readText().then(text => {
        const clean = text.trim();
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
            filterInput.value = clean;
            updateClearFilterVisibility();
            showToast('Correo pegado', 'success');
            searchMails();
        } else {
            showToast('No es un correo válido', 'error');
        }
    }).catch(() => showToast('Permiso denegado', 'error'));
};

window.clearFilterInput = function () {
    filterInput.value = '';
    filterInput.focus();
    updateClearFilterVisibility();
};

function updateClearFilterVisibility() {
    if (!clearFilterBtn || !filterInput) return;
    const show = filterInput.value.trim().length > 0;
    clearFilterBtn.classList.toggle('show', show);
}

document.getElementById('filterEmail').addEventListener('paste', () => {
    setTimeout(() => {
        updateClearFilterVisibility();
        const clean = filterInput.value.trim();
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
            searchMails();
        }
    }, 100);
});

