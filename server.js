let userCache = {};
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { WebcastPushConnection } = require('tiktok-live-connector');
/** El conector no copia el nivel del club de fans (solo badges); sin esto el TTS no ve fansClubLevel. */
(function patchTiktokFansClubLevel() {
    try {
        const dc = require(path.join(__dirname, 'node_modules', 'tiktok-live-connector', 'dist', 'lib', '_legacy', 'data-converter.js'));
        const orig = dc.getUserAttributes;
        if (typeof orig !== 'function' || orig.__fansClubLevelPatched) return;
        dc.getUserAttributes = function (webcastUser) {
            const attrs = orig(webcastUser);
            try {
                const u = webcastUser || {};
                const fc = u.fansClub;
                if (fc && fc.data && fc.data.level != null && fc.data.level !== '' && fc.data.level !== 0) {
                    const n = parseInt(String(fc.data.level), 10);
                    if (!Number.isNaN(n)) attrs.fansClubLevel = n;
                }
                const fi = u.fansClubInfo;
                if (fi && fi.fansLevel != null && String(fi.fansLevel) !== '' && String(fi.fansLevel) !== '0') {
                    const n = parseInt(String(fi.fansLevel), 10);
                    if (!Number.isNaN(n) && (attrs.fansClubLevel == null || attrs.fansClubLevel === 0)) attrs.fansClubLevel = n;
                }
            } catch (e) {}
            return attrs;
        };
        dc.getUserAttributes.__fansClubLevelPatched = true;
    } catch (e) {
        console.warn('[tiktok] Parche fansClubLevel:', e.message);
    }
})();
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

function onnxPathUnderRoot(filePath, rootDir) {
    if (!filePath || !rootDir) return false;
    try {
        const f = path.resolve(String(filePath).trim());
        const r = path.resolve(String(rootDir).trim());
        if (!f.toLowerCase().endsWith('.onnx')) return false;
        if (!fs.existsSync(f) || !fs.statSync(f).isFile()) return false;
        if (process.platform === 'win32') {
            const fl = f.toLowerCase();
            const rl = r.toLowerCase();
            return fl === rl || fl.startsWith(rl + path.sep);
        }
        const rel = path.relative(r, f);
        return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
    } catch (e) {
        return false;
    }
}
const multer = require('multer');
const axios = require('axios');

// --- 1. DEFINICIÓN ÚNICA DE RUTAS (Solo una vez cada una) ---
const carpetaDatos = path.join(os.homedir(), 'AgenciaELArbol_Datos');
const dir = path.join(carpetaDatos, 'audios');
const dirVideos = path.join(carpetaDatos, 'videos');
/** Modelos Piper descargados desde la Tienda de Voces del panel */
const PIPER_USER_MODELS_DIR = path.join(carpetaDatos, 'piper_models');
/** Ejecutable Piper descargado automáticamente (Windows); las DLL van en la misma carpeta */
const PIPER_RUNTIME_DIR = path.join(carpetaDatos, 'piper_runtime');
const PIPER_WIN_RELEASE_TAG = '2023.11.14-2';
const PIPER_WIN_ZIP_URL = `https://github.com/rhasspy/piper/releases/download/${PIPER_WIN_RELEASE_TAG}/piper_windows_amd64.zip`;

// --- 2. CREACIÓN DE CARPETAS ---
if (!fs.existsSync(carpetaDatos)) fs.mkdirSync(carpetaDatos, { recursive: true });
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
if (!fs.existsSync(dirVideos)) fs.mkdirSync(dirVideos, { recursive: true });
if (!fs.existsSync(PIPER_USER_MODELS_DIR)) fs.mkdirSync(PIPER_USER_MODELS_DIR, { recursive: true });
if (!fs.existsSync(PIPER_RUNTIME_DIR)) fs.mkdirSync(PIPER_RUNTIME_DIR, { recursive: true });

const regalosDirUser = path.join(carpetaDatos, 'regalos');
const regalosDirBundled = path.join(__dirname, 'public', 'regalos');
if (!fs.existsSync(regalosDirUser)) fs.mkdirSync(regalosDirUser, { recursive: true });

/**
 * Clave YouTube Data API v3 (búsquedas). Orden: env YOUTUBE_API_KEY →
 * %UserProfile%\AgenciaELArbol_Datos\youtube_api_key.txt → carpeta del proyecto\youtube_api_key.txt (una sola línea).
 */
function getYoutubeApiKey() {
    const env = (process.env.YOUTUBE_API_KEY || '').trim();
    if (env) return env;
    const candidates = [
        path.join(carpetaDatos, 'youtube_api_key.txt'),
        path.join(__dirname, 'youtube_api_key.txt')
    ];
    for (const p of candidates) {
        try {
            if (fs.existsSync(p) && fs.statSync(p).isFile()) {
                const line = fs.readFileSync(p, 'utf8').split(/\r?\n/)[0].trim();
                if (line) return line;
            }
        } catch (e) {}
    }
    return '';
}

/**
 * ID de cliente OAuth de Google (público; no es secreto). Misma ruta que la clave API.
 * Necesario para que cada usuario pulse "Vincular cuenta" sin variable de entorno.
 */
function getYoutubeOAuthClientId() {
    const env = (process.env.YOUTUBE_OAUTH_CLIENT_ID || '').trim();
    if (env) return env;
    const candidates = [
        path.join(carpetaDatos, 'youtube_oauth_client_id.txt'),
        path.join(__dirname, 'youtube_oauth_client_id.txt')
    ];
    for (const p of candidates) {
        try {
            if (fs.existsSync(p) && fs.statSync(p).isFile()) {
                const line = fs.readFileSync(p, 'utf8').split(/\r?\n/)[0].trim();
                if (line) return line;
            }
        } catch (e) {}
    }
    return '';
}

/**
 * Secreto del cliente OAuth (solo servidor; no exponer al navegador).
 * Orden: YOUTUBE_OAUTH_CLIENT_SECRET → AgenciaELArbol_Datos/youtube_oauth_client_secret.txt → proyecto/youtube_oauth_client_secret.txt
 * Obligatorio si el ID de cliente en Google es tipo "Aplicación web"; con cliente "Escritorio" suele bastar PKCE sin secreto.
 */
function getYoutubeOAuthClientSecret() {
    const env = (process.env.YOUTUBE_OAUTH_CLIENT_SECRET || '').trim();
    if (env) return env;
    const candidates = [
        path.join(carpetaDatos, 'youtube_oauth_client_secret.txt'),
        path.join(__dirname, 'youtube_oauth_client_secret.txt')
    ];
    for (const p of candidates) {
        try {
            if (fs.existsSync(p) && fs.statSync(p).isFile()) {
                const line = fs.readFileSync(p, 'utf8').split(/\r?\n/)[0].trim();
                if (line) return line;
            }
        } catch (e) {}
    }
    return '';
}

// --- 3. CONFIGURACIÓN DEL SERVIDOR ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);

/** Enlace HTTPS de pago o suscripción PayPal (botón alojado, PayPal.Me, plan, etc.). Ver GET /api/public-config */
function sanitizePublicPaymentUrl(u) {
    if (!u || typeof u !== 'string') return '';
    const t = u.trim();
    if (t.length > 2048) return '';
    if (!/^https:\/\//i.test(t)) return '';
    return t;
}
/** PayPal.Me: añade /monto al final para fijar importe (p. ej. /10 = 10 USD si la cuenta es en USD). */
const PAYPAL_DEFAULT_ME = 'https://paypal.me/jesuscalvo1995/10';
const PAYPAL_PAYMENT_URL = sanitizePublicPaymentUrl(process.env.PAYPAL_PAYMENT_URL || PAYPAL_DEFAULT_ME);

app.use(express.json({ limit: '128kb' }));

/** Configuración pública para el panel (enlaces de pago). Sin autenticación. */
app.get('/api/public-config', (req, res) => {
    res.json({
        ok: true,
        paypalPaymentUrl: PAYPAL_PAYMENT_URL,
        paypalConfigured: !!PAYPAL_PAYMENT_URL
    });
});

/**
 * Client ID de OAuth 2.0 (Google Cloud) para YouTube Data API v3 — solo el ID es público.
 * Crea credenciales: Consola Google → APIs y servicios → Credenciales → ID de cliente OAuth → Aplicación web.
 * URI de redirección autorizada: https://TU_DOMINIO/youtube-music-callback.html (y http://127.0.0.1:3000/... en local).
 * Habilita "YouTube Data API v3" en la misma consola.
 */
app.get('/api/youtube-oauth-config', (req, res) => {
    const clientId = getYoutubeOAuthClientId();
    const hasApiKey = !!getYoutubeApiKey();
    const hasClientSecret = !!getYoutubeOAuthClientSecret();
    res.json({
        ok: true,
        clientId,
        configured: !!clientId,
        /** Clave YouTube Data API solo en servidor; nunca se envía al cliente. */
        hasApiKey,
        /** Indica si el servidor tiene secreto (necesario para cliente OAuth "Aplicación web"). */
        hasClientSecret
    });
});

/**
 * Búsqueda YouTube Data API v3 usando YOUTUBE_API_KEY (servidor).
 * Evita exponer la clave en el navegador. Cuota compartida del proyecto.
 */
app.get('/api/youtube-search', async (req, res) => {
    try {
        const key = getYoutubeApiKey();
        if (!key) {
            return res.status(503).json({ ok: false, error: 'Sin clave API: define YOUTUBE_API_KEY o crea youtube_api_key.txt (ver server.js).' });
        }
        const q = (req.query.q != null ? String(req.query.q) : '').trim();
        if (!q || q.length > 240) {
            return res.status(400).json({ ok: false, error: 'Consulta vacía o demasiado larga.' });
        }
        const u = new URL('https://www.googleapis.com/youtube/v3/search');
        u.searchParams.set('part', 'snippet');
        u.searchParams.set('type', 'video');
        u.searchParams.set('maxResults', '1');
        u.searchParams.set('q', q);
        u.searchParams.set('key', key);
        const r = await fetch(u.toString());
        const data = await r.json();
        return res.status(r.ok ? 200 : 502).json(data);
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
    }
});

/**
 * Intercambia el código OAuth por tokens (YouTube Data API).
 * Usa getYoutubeOAuthClientSecret() para cliente "Web"; si está vacío, solo PKCE (cliente "Escritorio").
 */
app.post('/api/youtube-token', async (req, res) => {
    try {
        const code = req.body && req.body.code ? String(req.body.code).trim() : '';
        const redirect_uri = req.body && req.body.redirect_uri ? String(req.body.redirect_uri).trim() : '';
        const code_verifier = req.body && req.body.code_verifier ? String(req.body.code_verifier).trim() : '';
        const clientId = getYoutubeOAuthClientId();
        const clientSecret = getYoutubeOAuthClientSecret();
        if (!clientId || !code || !redirect_uri || !code_verifier) {
            return res.status(400).json({ ok: false, error: 'Faltan code, redirect_uri o code_verifier.' });
        }
        const params = new URLSearchParams({
            code,
            client_id: clientId,
            redirect_uri,
            grant_type: 'authorization_code',
            code_verifier
        });
        if (clientSecret) {
            params.set('client_secret', clientSecret);
        }
        const r = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
        });
        const data = await r.json();
        if (data.error) {
            return res.status(400).json({ ok: false, error: data.error, error_description: data.error_description || '' });
        }
        return res.json({ ok: true, access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
    }
});

app.post('/api/youtube-refresh', async (req, res) => {
    try {
        const refresh_token = req.body && req.body.refresh_token ? String(req.body.refresh_token).trim() : '';
        const clientId = getYoutubeOAuthClientId();
        const clientSecret = getYoutubeOAuthClientSecret();
        if (!clientId || !refresh_token) {
            return res.status(400).json({ ok: false, error: 'Falta refresh_token o client ID.' });
        }
        const params = new URLSearchParams({
            client_id: clientId,
            grant_type: 'refresh_token',
            refresh_token
        });
        if (clientSecret) {
            params.set('client_secret', clientSecret);
        }
        const r = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
        });
        const data = await r.json();
        if (data.error) {
            return res.status(400).json({ ok: false, error: data.error, error_description: data.error_description || '' });
        }
        return res.json({ ok: true, access_token: data.access_token, expires_in: data.expires_in });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
    }
});

// --- Panel de administración (planes Premium / cuentas activas) ---
// Requiere: 1) PANEL_ADMIN_SECRET en el entorno  2) JSON de cuenta de servicio Firebase
// (Firebase Console → Configuración del proyecto → Cuentas de servicio → Generar nueva clave)
// JSON de cuenta de servicio: variable FIREBASE_SERVICE_ACCOUNT_PATH, o uno de los rutas por defecto (ver findServiceAccountFile)
const PANEL_ADMIN_SECRET = process.env.PANEL_ADMIN_SECRET || '';
const FIREBASE_DATABASE_URL = process.env.FIREBASE_DATABASE_URL || 'https://neobound-d550c-default-rtdb.firebaseio.com';

/** Rutas donde se busca el JSON (Firebase Console → Cuentas de servicio → Generar clave). */
function getServiceAccountPathCandidates() {
    const envP = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (envP && String(envP).trim()) {
        return [path.resolve(String(envP).trim())];
    }
    return [
        path.join(carpetaDatos, 'firebase-service-account.json'),
        path.join(__dirname, 'firebase-service-account.json')
    ];
}

function findServiceAccountFile() {
    for (const p of getServiceAccountPathCandidates()) {
        try {
            if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
        } catch (e) {}
    }
    return null;
}

let firebaseAdminApp = null;
let firebaseAdminInitAttempted = false;

function getFirebaseAdminApp() {
    if (firebaseAdminInitAttempted) return firebaseAdminApp;
    firebaseAdminInitAttempted = true;
    try {
        const saPath = findServiceAccountFile();
        if (!saPath) {
            console.warn('[panel-admin] No se encontró firebase-service-account.json. Colócalo en:', getServiceAccountPathCandidates().join(' | '));
            return null;
        }
        const admin = require('firebase-admin');
        if (admin.apps.length) {
            firebaseAdminApp = admin.app();
            return firebaseAdminApp;
        }
        const serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf8'));
        firebaseAdminApp = admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: FIREBASE_DATABASE_URL
        });
        console.log('[panel-admin] Firebase Admin inicializado (usuarios desde RTDB).');
        return firebaseAdminApp;
    } catch (e) {
        console.warn('[panel-admin] Error al inicializar Firebase Admin:', e.message);
        firebaseAdminApp = null;
        return null;
    }
}

const panelAdminSessions = new Map();

function panelAdminRandomToken() {
    return crypto.randomBytes(32).toString('hex');
}

function middlewarePanelAdminAuth(req, res, next) {
    const auth = req.headers.authorization || '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ ok: false, error: 'Falta token de sesión.' });
    const token = m[1];
    const exp = panelAdminSessions.get(token);
    if (!exp || Date.now() > exp) {
        panelAdminSessions.delete(token);
        return res.status(401).json({ ok: false, error: 'Sesión expirada o inválida.' });
    }
    next();
}

app.get('/api/panel-admin/status', (req, res) => {
    const hasDb = !!getFirebaseAdminApp();
    const found = findServiceAccountFile();
    res.json({
        ok: true,
        hasSecret: !!PANEL_ADMIN_SECRET,
        firebaseAdminReady: hasDb,
        serviceAccountPath: found || getServiceAccountPathCandidates()[0],
        serviceAccountPathsHint: getServiceAccountPathCandidates()
    });
});

app.post('/api/panel-admin/login', (req, res) => {
    if (!PANEL_ADMIN_SECRET) {
        return res.status(503).json({
            ok: false,
            error: 'Configura la variable de entorno PANEL_ADMIN_SECRET en el servidor (o en el .bat de arranque).'
        });
    }
    const secret = (req.body && String(req.body.secret || '').trim()) || '';
    if (secret !== PANEL_ADMIN_SECRET) {
        return res.status(401).json({ ok: false, error: 'Clave de administrador incorrecta.' });
    }
    const token = panelAdminRandomToken();
    const ttlMs = 12 * 60 * 60 * 1000;
    panelAdminSessions.set(token, Date.now() + ttlMs);
    res.json({ ok: true, token, expiresIn: ttlMs });
});

app.get('/api/panel-admin/users', middlewarePanelAdminAuth, async (req, res) => {
    if (!getFirebaseAdminApp()) {
        return res.status(503).json({
            ok: false,
            error:
                'Coloca el archivo JSON de cuenta de servicio en una de estas rutas:\n' +
                getServiceAccountPathCandidates().join('\n')
        });
    }
    try {
        const admin = require('firebase-admin');
        const snap = await admin.database().ref('usuarios_vip').once('value');
        const val = snap.val() || {};
        const users = Object.keys(val).map((key) => {
            const u = val[key] || {};
            const exp = u.premium_expires_at;
            return {
                username: key,
                plan: u.plan === 'premium' ? 'premium' : 'gratis',
                activo: u.activo === true,
                premium_expires_at:
                    exp != null && exp !== '' ? Number(exp) : null
            };
        });
        users.sort((a, b) => a.username.localeCompare(b.username));
        res.json({ ok: true, users });
    } catch (e) {
        res.status(500).json({ ok: false, error: String(e.message || e) });
    }
});

const MS_PREMIUM_DIA_SRV = 86400000;

app.patch('/api/panel-admin/user/:username', middlewarePanelAdminAuth, async (req, res) => {
    if (!getFirebaseAdminApp()) {
        return res.status(503).json({ ok: false, error: 'Firebase Admin no disponible.' });
    }
    const username = String(req.params.username || '').trim().toLowerCase();
    if (!username || username.length > 64 || /[.#$\[\]]/.test(username)) {
        return res.status(400).json({ ok: false, error: 'Nombre de usuario inválido.' });
    }
    const body = req.body || {};
    try {
        const admin = require('firebase-admin');
        const ref = admin.database().ref('usuarios_vip/' + username);
        const snap = await ref.once('value');
        const prev = snap.val() || {};

        const updates = {};
        if (body.plan === 'premium' || body.plan === 'gratis') updates.plan = body.plan;
        if (typeof body.activo === 'boolean') updates.activo = body.activo;
        if (body.premium_expires_at !== undefined) {
            updates.premium_expires_at =
                body.premium_expires_at === null ? null : Number(body.premium_expires_at);
        }

        if (updates.plan === 'gratis') {
            updates.premium_expires_at = null;
        } else if (
            body.premium_expires_at === undefined &&
            updates.plan === 'premium' &&
            prev.plan !== 'premium'
        ) {
            updates.premium_expires_at = Date.now() + 30 * MS_PREMIUM_DIA_SRV;
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                ok: false,
                error:
                    'Envía plan ("premium"|"gratis"), activo (true|false) y/o premium_expires_at (número ms o null).'
            });
        }
        await ref.update(updates);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: String(e.message || e) });
    }
});

/** Piper TTS (Rhasspy): en Windows el panel puede descargar piper.exe solo; opcionalmente:
 *  PIPER_PATH  = anula y usa tu propio piper.exe
 *  PIPER_MODEL = modelo .onnx por defecto (opcional)
 *  PIPER_MODELS_DIR = carpeta extra de .onnx (opcional) */
const PIPER_PATH_ENV = process.env.PIPER_PATH || '';
const PIPER_MODEL = process.env.PIPER_MODEL || '';
const PIPER_MODELS_DIR = process.env.PIPER_MODELS_DIR || '';

function findPiperExeUnder(rootDir, depth) {
    const d = depth || 0;
    if (!rootDir || d > 10) return '';
    try {
        const entries = fs.readdirSync(rootDir, { withFileTypes: true });
        for (const e of entries) {
            const full = path.join(rootDir, e.name);
            if (e.isFile() && e.name.toLowerCase() === 'piper.exe') return path.resolve(full);
        }
        for (const e of entries) {
            if (e.isDirectory()) {
                const sub = findPiperExeUnder(path.join(rootDir, e.name), d + 1);
                if (sub) return sub;
            }
        }
    } catch (err) {}
    return '';
}

/** Ejecutable: variable PIPER_PATH si existe; si no, piper instalado en AgenciaELArbol_Datos/piper_runtime (Windows). */
function getPiperExecutablePath() {
    if (PIPER_PATH_ENV) {
        const p = path.resolve(String(PIPER_PATH_ENV).trim());
        try {
            if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
        } catch (e) {}
    }
    if (process.platform === 'win32' && fs.existsSync(PIPER_RUNTIME_DIR)) {
        const local = findPiperExeUnder(PIPER_RUNTIME_DIR);
        if (local) return local;
    }
    return '';
}

let piperRuntimeDownloadInflight = null;

async function downloadPiperWindowsRuntime() {
    if (process.platform !== 'win32') {
        throw new Error('La descarga automática del motor solo está disponible en Windows.');
    }
    const AdmZip = require('adm-zip');
    const extractTo = path.join(PIPER_RUNTIME_DIR, 'windows_bundle');
    if (fs.existsSync(extractTo)) {
        try {
            fs.rmSync(extractTo, { recursive: true, force: true });
        } catch (e) {}
    }
    fs.mkdirSync(extractTo, { recursive: true });
    const zipPath = path.join(PIPER_RUNTIME_DIR, '_piper_windows_amd64.zip');
    const r = await axios.get(PIPER_WIN_ZIP_URL, {
        responseType: 'arraybuffer',
        timeout: 600000,
        maxContentLength: 80 * 1024 * 1024,
        headers: { 'User-Agent': 'mitikfinity-panel/1.0' }
    });
    if (r.status !== 200) throw new Error('Descarga fallida HTTP ' + r.status);
    fs.writeFileSync(zipPath, Buffer.from(r.data));
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractTo, true);
    try {
        fs.unlinkSync(zipPath);
    } catch (e) {}
    const exe = findPiperExeUnder(extractTo);
    if (!exe) {
        throw new Error('No se encontró piper.exe tras descomprimir el paquete oficial.');
    }
    return { ok: true, path: exe };
}

function ensurePiperWindowsRuntimeDownload() {
    if (process.platform !== 'win32') {
        return Promise.reject(new Error('Solo Windows'));
    }
    if (getPiperExecutablePath()) {
        return Promise.resolve({ ok: true, already: true });
    }
    if (!piperRuntimeDownloadInflight) {
        piperRuntimeDownloadInflight = downloadPiperWindowsRuntime().finally(() => {
            piperRuntimeDownloadInflight = null;
        });
    }
    return piperRuntimeDownloadInflight;
}

function piperModelsRootDir() {
    if (PIPER_MODELS_DIR && fs.existsSync(PIPER_MODELS_DIR)) return path.resolve(PIPER_MODELS_DIR);
    if (PIPER_MODEL && fs.existsSync(PIPER_MODEL)) return path.dirname(path.resolve(PIPER_MODEL));
    return '';
}

function piperModelAllowedRoots() {
    const roots = [];
    const r = piperModelsRootDir();
    if (r) roots.push(path.resolve(r));
    if (PIPER_USER_MODELS_DIR && fs.existsSync(PIPER_USER_MODELS_DIR)) roots.push(path.resolve(PIPER_USER_MODELS_DIR));
    return roots;
}

function isPathInsideOnnxModel(filePath, rootDir) {
    return onnxPathUnderRoot(filePath, rootDir);
}

function listPiperOnnxModels() {
    const roots = piperModelAllowedRoots();
    const out = [];
    const seen = new Set();
    for (const root of roots) {
        if (!root || !fs.existsSync(root)) continue;
        try {
            fs.readdirSync(root).forEach((name) => {
                if (!name.toLowerCase().endsWith('.onnx')) return;
                const full = path.join(root, name);
                try {
                    if (!fs.statSync(full).isFile()) return;
                    const key = full.toLowerCase();
                    if (seen.has(key)) return;
                    seen.add(key);
                    out.push({ path: full, name: name.replace(/\.onnx$/i, '') });
                } catch (e) {}
            });
        } catch (e) {}
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
}

function resolvePiperModelFromBody(body) {
    const models = listPiperOnnxModels();
    const fallback =
        PIPER_MODEL && fs.existsSync(PIPER_MODEL)
            ? path.resolve(PIPER_MODEL)
            : models[0]
              ? models[0].path
              : '';
    if (!body || typeof body.model !== 'string' || !body.model.trim()) return fallback;
    const requested = path.resolve(body.model.trim());
    for (const root of piperModelAllowedRoots()) {
        if (root && onnxPathUnderRoot(requested, root)) return requested;
    }
    if (fs.existsSync(requested) && requested.toLowerCase().endsWith('.onnx')) {
        for (const m of models) {
            if (path.resolve(m.path) === requested) return requested;
        }
    }
    return fallback;
}

function piperConfigured() {
    try {
        const exe = getPiperExecutablePath();
        if (!exe) return false;
        if (PIPER_MODEL && fs.existsSync(PIPER_MODEL)) return true;
        return listPiperOnnxModels().length > 0;
    } catch (e) {
        return false;
    }
}

const PIPER_CATALOG_PATH = path.join(__dirname, 'public', 'piper-voice-catalog.json');

app.post('/api/piper-voices/download', async (req, res) => {
    const id = req.body && req.body.id;
    if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_\-]+$/.test(id)) {
        return res.status(400).json({ error: 'id no válido' });
    }
    let catalog;
    try {
        catalog = JSON.parse(fs.readFileSync(PIPER_CATALOG_PATH, 'utf8'));
    } catch (e) {
        return res.status(500).json({ error: 'Catálogo no disponible' });
    }
    const voice = (catalog.voices || []).find((v) => v.id === id);
    if (!voice || !voice.onnx || !voice.json) return res.status(404).json({ error: 'Voz no encontrada en el catálogo' });
    const baseOnnx = `${id}.onnx`;
    const onnxDest = path.join(PIPER_USER_MODELS_DIR, baseOnnx);
    const jsonDest = path.join(PIPER_USER_MODELS_DIR, `${id}.onnx.json`);
    try {
        const r1 = await axios.get(voice.onnx, {
            responseType: 'arraybuffer',
            timeout: 420000,
            maxContentLength: 500 * 1024 * 1024,
            headers: { 'User-Agent': 'livecoins-panel/1.0' }
        });
        if (r1.status !== 200) throw new Error('Descarga .onnx fallida: HTTP ' + r1.status);
        fs.writeFileSync(onnxDest, Buffer.from(r1.data));
        const r2 = await axios.get(voice.json, {
            responseType: 'arraybuffer',
            timeout: 120000,
            maxContentLength: 10 * 1024 * 1024,
            headers: { 'User-Agent': 'livecoins-panel/1.0' }
        });
        if (r2.status !== 200) throw new Error('Descarga .json fallida: HTTP ' + r2.status);
        fs.writeFileSync(jsonDest, Buffer.from(r2.data));
        res.json({ ok: true, path: onnxDest, id });
    } catch (e) {
        try {
            fs.unlinkSync(onnxDest);
        } catch (e2) {}
        try {
            fs.unlinkSync(jsonDest);
        } catch (e3) {}
        res.status(500).json({ error: String(e.message || e) });
    }
});

app.post('/api/tts/piper/download-runtime', async (req, res) => {
    if (process.platform !== 'win32') {
        return res.status(501).json({
            error: 'La instalación automática del motor Piper solo está disponible en Windows. En Linux/macOS define PIPER_PATH.'
        });
    }
    try {
        const result = await ensurePiperWindowsRuntimeDownload();
        return res.json(result);
    } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
    }
});

app.get('/api/tts/piper/status', (req, res) => {
    const models = listPiperOnnxModels();
    const hasPiperExe = !!getPiperExecutablePath();
    const def =
        PIPER_MODEL && fs.existsSync(PIPER_MODEL)
            ? path.resolve(PIPER_MODEL)
            : models[0]
              ? models[0].path
              : null;
    const ok = piperConfigured();
    let hint = '';
    if (ok) {
        hint = 'Piper listo: elige la voz neuronal abajo. Las voces de Windows no se usan con Piper activo.';
    } else if (!hasPiperExe && models.length > 0) {
        hint =
            process.platform === 'win32'
                ? 'Tienes voces .onnx; pulsa «Descargar motor Piper» abajo para instalar el ejecutable (una sola vez).'
                : 'Tienes modelos .onnx pero falta el ejecutable Piper. Define la variable de entorno PIPER_PATH.';
    } else if (!hasPiperExe) {
        hint =
            process.platform === 'win32'
                ? 'Pulsa «Descargar motor Piper» (~22 MB) y luego «+ Voces» para bajar una voz neuronal. No hace falta instalar nada a mano.'
                : 'Instala Piper en el sistema y define PIPER_PATH, o coloca los binarios en una carpeta accesible.';
    } else if (models.length === 0) {
        hint = 'Motor Piper listo; descarga al menos una voz con «+ Voces».';
    } else {
        hint = 'Revisa la carpeta de modelos.';
    }
    res.json({
        configured: ok,
        hasPiperExe,
        autoInstallPiperAvailable: process.platform === 'win32',
        modelCount: models.length,
        models,
        modelsDir: piperModelsRootDir() || null,
        userModelsDir: PIPER_USER_MODELS_DIR,
        defaultModel: def,
        hint
    });
});

app.post('/api/tts/piper', (req, res) => {
    const text = String(req.body && req.body.text != null ? req.body.text : '')
        .trim()
        .slice(0, 8000);
    if (!text) return res.status(400).json({ error: 'Texto vacío' });
    if (!piperConfigured()) {
        const hasPiperExe = !!getPiperExecutablePath();
        const n = listPiperOnnxModels().length;
        let err = 'Piper no está listo: necesitas el motor y al menos un modelo .onnx.';
        if (!hasPiperExe) {
            err =
                process.platform === 'win32'
                    ? 'Falta el motor Piper. Pulsa «Descargar motor Piper» en TTS (o define PIPER_PATH si lo instalas tú).'
                    : 'Falta el ejecutable Piper. Define la variable de entorno PIPER_PATH con la ruta a piper.';
        } else if (n === 0) {
            err =
                'El motor Piper está instalado, pero no hay ningún modelo .onnx. Pulsa «+ Voces» para descargar una voz.';
        }
        return res.status(503).json({ error: err });
    }
    const modelPath = resolvePiperModelFromBody(req.body || {});
    if (!modelPath || !fs.existsSync(modelPath)) {
        return res.status(400).json({ error: 'Modelo Piper no válido' });
    }
    const piperExe = getPiperExecutablePath();
    if (!piperExe) {
        return res.status(503).json({ error: 'No se encontró piper.exe' });
    }
    const tmpWav = path.join(os.tmpdir(), `piper-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
    const args = ['--model', modelPath, '--output_file', tmpWav];
    const child = spawn(piperExe, args, {
        stdio: ['pipe', 'ignore', 'pipe'],
        cwd: path.dirname(piperExe)
    });
    let stderr = '';
    let responded = false;
    child.stderr.on('data', (d) => {
        stderr += d.toString();
    });
    const timeout = setTimeout(() => {
        try {
            child.kill('SIGKILL');
        } catch (e) {}
        try {
            fs.unlinkSync(tmpWav);
        } catch (e2) {}
        if (!responded) {
            responded = true;
            res.status(504).json({ error: 'Piper timeout' });
        }
    }, 60000);
    child.stdin.write(text + '\n', 'utf8', (err) => {
        if (err) {
            clearTimeout(timeout);
            try {
                fs.unlinkSync(tmpWav);
            } catch (e) {}
            if (!responded) {
                responded = true;
                res.status(500).json({ error: 'No se pudo enviar texto a Piper' });
            }
            try {
                child.kill();
            } catch (e2) {}
        } else {
            child.stdin.end();
        }
    });
    child.on('error', (err) => {
        clearTimeout(timeout);
        try {
            fs.unlinkSync(tmpWav);
        } catch (e) {}
        if (!responded) {
            responded = true;
            res.status(500).json({ error: String(err.message || err) });
        }
    });
    child.on('close', (code) => {
        clearTimeout(timeout);
        if (responded) {
            try {
                fs.unlinkSync(tmpWav);
            } catch (e) {}
            return;
        }
        if (code !== 0) {
            try {
                fs.unlinkSync(tmpWav);
            } catch (e) {}
            responded = true;
            return res.status(500).json({
                error: 'Piper terminó con error',
                detail: stderr.slice(0, 800)
            });
        }
        if (!fs.existsSync(tmpWav)) {
            responded = true;
            return res.status(500).json({ error: 'Sin archivo de audio' });
        }
        responded = true;
        res.setHeader('Content-Type', 'audio/wav');
        const stream = fs.createReadStream(tmpWav);
        stream.on('end', () => {
            try {
                fs.unlink(tmpWav, () => {});
            } catch (e) {}
        });
        stream.on('error', () => {
            try {
                fs.unlink(tmpWav, () => {});
            } catch (e) {}
        });
        stream.pipe(res);
    });
});

// Regalos subidos por el usuario (ruta real en disco; antes que public/ para poder sobrescribir)
app.use('/regalos', express.static(regalosDirUser));

// Sin ETag / sin maxAge: OBS a veces seguía sirviendo HTML viejo desde caché.
app.use(express.static(path.join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    maxAge: 0,
    setHeaders(res, filePath) {
        if (filePath.endsWith('.html') || filePath.endsWith('.js')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
            res.setHeader('Pragma', 'no-cache');
        }
    }
}));
app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use('/audios', express.static(dir));
app.use('/videos', express.static(dirVideos));

// --- 4. CONFIGURACIÓN DE ALMACENAMIENTO (AUDIOS) ---
const storage = multer.diskStorage({
    destination: dir,
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

app.post('/upload', upload.single('audio'), (req, res) => {
    if (req.file) res.json({ url: `/audios/${req.file.filename}`, name: req.file.originalname });
    else res.status(400).send('Error');
});

// --- 5. CONFIGURACIÓN DE ALMACENAMIENTO (VIDEOS) ---
// (Nota: Aquí ya no pongas "const dirVideos = ...", ya lo hicimos arriba)
const storageVideos = multer.diskStorage({
    destination: dirVideos,
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const uploadVideos = multer({ storage: storageVideos });

app.post('/upload-video', uploadVideos.single('video'), (req, res) => {
    if (req.file) res.json({ url: `/videos/${req.file.filename}`, name: req.file.originalname });
    else res.status(400).send('Error');
});

// --- Iconos personalizados Minecraft (panel → mc_custom) ---
// Fuera de app.asar (Electron): __dirname dentro del .asar no permite mkdir → ENOTDIR
const dirMcCustom = path.join(carpetaDatos, 'mc_custom');
if (!fs.existsSync(dirMcCustom)) fs.mkdirSync(dirMcCustom, { recursive: true });
app.use('/mc_custom', express.static(dirMcCustom));
const storageMcIcon = multer.diskStorage({
    destination: dirMcCustom,
    filename: (req, file, cb) => {
        const safe = String(file.originalname || 'icon.png').replace(/[^\w.\-]/g, '_');
        cb(null, Date.now() + '-' + safe);
    }
});
const uploadMcIcon = multer({
    storage: storageMcIcon,
    limits: { fileSize: 4 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (/^image\/(png|jpe?g|gif|webp)$/i.test(file.mimetype)) cb(null, true);
        else cb(new Error('Solo PNG, JPG, GIF o WebP'));
    }
});
app.post('/upload-mc-icon', (req, res) => {
    uploadMcIcon.single('icon')(req, res, (err) => {
        if (err) return res.status(400).json({ error: String(err.message || err) });
        if (req.file) return res.json({ url: `/mc_custom/${req.file.filename}`, name: req.file.originalname });
        res.status(400).send('Error');
    });
});

// --- 6. SISTEMA DE LISTA DE REGALOS (PARA QUE SE VEAN EN EL PANEL) ---
function listarRegalosLocales(cb) {
    const seen = new Set();
    const out = [];
    function addDir(dir, done) {
        fs.readdir(dir, (err, files) => {
            if (err || !files) return done();
            files.filter((f) => f.match(/\.(png|jpe?g|gif|webp)$/i)).forEach((file) => {
                const key = file.toLowerCase();
                if (seen.has(key)) return;
                seen.add(key);
                out.push({
                    archivo: path.parse(file).name.toLowerCase(),
                    url: `/regalos/${file}`
                });
            });
            done();
        });
    }
    addDir(regalosDirUser, () => addDir(regalosDirBundled, () => cb(out)));
}

app.get('/lista-regalos-locales', (req, res) => {
    listarRegalosLocales((lista) => res.json(lista));
});
// =========================================================

const pyScriptPath = path.join(os.tmpdir(), 'roblox_key.py');

// TODO lo que es Python debe estar DENTRO de estas comillas invertidas ``
const pyCode = `
import sys, time
from pynput.keyboard import Key, Controller
keyboard = Controller()
try:
    input_data = sys.argv[1].lower().split('+')
    special_keys = {'ctrl': Key.ctrl, 'shift': Key.shift, 'alt': Key.alt, 'espacio': Key.space, 'enter': Key.enter, 'tab': Key.tab, 'arriba': Key.up, 'abajo': Key.down, 'izquierda': Key.left, 'derecha': Key.right}
    keys_to_press = [special_keys.get(k.strip(), k.strip()[0]) for k in input_data]
    for k in keys_to_press: keyboard.press(k)
    time.sleep(0.15)
    for k in reversed(keys_to_press): keyboard.release(k)
except:
    pass
`;

// Esta línea de abajo debe ir UNA SOLA VEZ después de cerrar las comillas
fs.writeFileSync(pyScriptPath, pyCode);
// =========================================================
// =========================================================
// SISTEMA DEL ATAJO GLOBAL (F9) - CORREGIDO
// =========================================================
const pyHotkeyPath = path.join(os.tmpdir(), 'hotkey_listener.py'); 

const pyHotkeyCode = `
import sys
try:
    from pynput import keyboard
except ImportError:
    sys.exit(0)

def on_press(key):
    try:
        if hasattr(key, 'name') and key.name == 'f9':
            print("TOGGLE_TTS", flush=True)
    except Exception:
        pass

with keyboard.Listener(on_press=on_press) as listener:
    listener.join()
`; // <--- Asegúrate de cerrar con `;` aquí

fs.writeFileSync(pyHotkeyPath, pyHotkeyCode);

const pythonPath = path.join(process.cwd(), 'python-bin', 'pythonw.exe');

// DETECTOR INTELIGENTE DE SISTEMA
if (os.platform() === 'win32') {
    try {
        const hotkeyProcess = spawn(pythonPath, ['-u', pyHotkeyPath]);
        hotkeyProcess.stdout.on('data', (data) => {
            if (data.toString().includes('TOGGLE_TTS')) {
                io.emit('toggle_tts_global');
            }
        });
        console.log("⌨️ Atajo de teclado (F9) activado para Windows.");
    } catch (e) {
        console.log("⚠️ No se pudo iniciar el teclado local.");
    }
} else {
    console.log("☁️ Modo Nube detectado: Atajos de teclado físico desactivados por seguridad.");
}
// =========================================================

let keyQueue = [];
let isPressing = false;
function normalizarRoomUsuario(valor = '') {
    return String(valor).trim().toLowerCase().replace(/^@+/, '');
}

/** Avatar y nombre del streamer desde roomInfo del conector (tras connect). */
function extractStreamerMeta(connection, roomUser) {
    let nickname = roomUser;
    let profilePictureUrl = null;
    try {
        const ri = connection && connection.roomInfo;
        if (!ri) return { uniqueId: roomUser, nickname, profilePictureUrl };
        const owner = ri.owner || ri.data?.owner || ri.data?.user;
        if (!owner) return { uniqueId: roomUser, nickname, profilePictureUrl };
        nickname = owner.nickname || owner.nick_name || owner.display_id || nickname;
        const av = owner.avatar_thumb || owner.avatar_medium || owner.avatar_larger || owner.avatar_jpg;
        if (av && typeof av === 'object' && Array.isArray(av.url_list) && av.url_list.length) {
            profilePictureUrl = av.url_list[0];
        } else if (typeof owner.profile_picture_url === 'string') {
            profilePictureUrl = owner.profile_picture_url;
        }
    } catch (e) {
        console.warn('extractStreamerMeta:', e && e.message);
    }
    return { uniqueId: roomUser, nickname, profilePictureUrl };
}

function processQueue() {
    if (keyQueue.length === 0) { isPressing = false; return; }
    isPressing = true;
    const tecla = keyQueue.shift();
    
    // DETECTOR: Solo presiona si estamos en Windows
    if (os.platform() === 'win32') {
        const py = spawn(pythonPath, [pyScriptPath, tecla]);
        py.on('close', () => setTimeout(processQueue, 50)); 
    } else {
        console.log(`☁️ (Tecla bloqueada en la nube: ${tecla})`);
        setTimeout(processQueue, 50); // Pasa a la siguiente tecla sin hacer nada
    }
}

/** Una conexión TikTok por cliente web; si es global, un segundo usuario desconecta al primero. */
const tiktokBySocket = new Map();
const panelRoomBySocket = new Map();
/** Sala join_room del overlay (mismo socket puede cambiar de user sin recargar). */
const overlayRoomBySocket = new Map();

io.on('connection', (socket) => {
	// NUEVO: El portero que asigna las salas a los overlays de OBS
    socket.on('join_room', (roomName) => {
        const room = normalizarRoomUsuario(roomName);
        if (!room) return;
        const prevOv = overlayRoomBySocket.get(socket.id);
        if (prevOv && prevOv !== room) {
            try { socket.leave(prevOv); } catch (e) {}
        }
        socket.join(room);
        overlayRoomBySocket.set(socket.id, room);
        console.log(`🚪 Overlay conectado a la sala de: @${room}`);
    });
    socket.on('simular_tecla', (tecla) => {
        keyQueue.push(tecla);
        if (!isPressing) processQueue();
    });
    socket.on('limpiar_cola', () => { keyQueue = []; });

    // ==========================================
    // PUENTES DE BOTONES DEL PANEL
    // ==========================================
    socket.on('timer_control', (data) => {
        console.log(`⏱️ BOTÓN PRESIONADO EN PANEL: ${data.action.toUpperCase()}`);
        io.emit('timer_control', data);
    });
    socket.on('timer_settings', (data) => {
        console.log(`⚙️ NUEVA CONFIGURACIÓN GUARDADA`);
        io.emit('timer_settings', data);
    });
    socket.on('goal_cut', (data) => {
        io.emit('goal_cut', data || {});
    });
    socket.on('test_follow', () => {
        console.log(`🔔 ALERTA DE PRUEBA ENVIADA DESDE EL PANEL`);
        io.emit('test_follow');
    });

    /** Prueba overlays Mejor regalo / Mejor racha (misma lógica global que test_follow). */
    socket.on('test_top_gift', () => {
        console.log(`🎁 Prueba Mejor regalo (broadcast)`);
        io.emit('test_top_gift');
    });
    socket.on('test_top_streak', () => {
        console.log(`🔥 Prueba Mejor racha (broadcast)`);
        io.emit('test_top_streak');
    });

    /** Gift VS Gift: ajuste manual y reset hacia overlays (broadcast con filtro por room en cliente). */
    socket.on('gift_vs_manual', (data) => {
        const room = normalizarRoomUsuario(data && data.user);
        if (!room) return;
        io.emit('gift_vs_manual', {
            room,
            side: data && data.side === 'R' ? 'R' : 'L',
            delta: Number(data && data.delta) || 0
        });
    });
    socket.on('gift_vs_reset', (data) => {
        const room = normalizarRoomUsuario(data && data.user);
        if (!room) return;
        io.emit('gift_vs_reset', { room });
    });
    socket.on('test_gift_vs_gift', () => {
        console.log(`⚔️ Prueba Gift VS Gift (broadcast)`);
        io.emit('test_gift_vs_gift');
    });

    socket.on('gift_vs_multi_manual', (data) => {
        const room = normalizarRoomUsuario(data && data.user);
        if (!room) return;
        io.emit('gift_vs_multi_manual', {
            room,
            row: data && data.row,
            side: data && data.side === 'R' ? 'R' : 'L',
            delta: Number(data && data.delta) || 0
        });
    });
    socket.on('gift_vs_multi_reset', (data) => {
        const room = normalizarRoomUsuario(data && data.user);
        if (!room) return;
        io.emit('gift_vs_multi_reset', { room });
    });
    socket.on('test_gift_vs_multi', () => {
        console.log(`⚔️ Prueba Gift VS multi (broadcast)`);
        io.emit('test_gift_vs_multi');
    });

    /** Paneles embebidos → overlays en OBS / TikTok Live Studio (misma sala que join_room). */
    socket.on('panel_broadcast_alerta_config', (data) => {
        const room = normalizarRoomUsuario(data && data.user);
        if (!room || !data || !data.config) return;
        io.to(room).emit('alerta_overlay_config', { config: data.config });
    });
    socket.on('panel_broadcast_ranking_config', (data) => {
        const room = normalizarRoomUsuario(data && data.user);
        if (!room || !data || !data.kind || !data.config) return;
        io.to(room).emit('ranking_overlay_config', { kind: data.kind, config: data.config });
    });
    socket.on('panel_broadcast_top_gift_style', (data) => {
        const room = normalizarRoomUsuario(data && data.user);
        if (!room || !data || !data.style) return;
        io.to(room).emit('top_gift_style_live', { style: data.style });
    });
    socket.on('panel_broadcast_top_streak_style', (data) => {
        const room = normalizarRoomUsuario(data && data.user);
        if (!room || !data || !data.style) return;
        io.to(room).emit('top_streak_style_live', { style: data.style });
    });

    // ¡AQUÍ ESTÁ EL PUENTE NUEVO PARA EL CHAT/TTS!
    socket.on('chat_settings', (data) => {
        console.log(`💬 CONFIGURACIÓN DE CHAT/TTS ACTUALIZADA`);
        io.emit('chat_settings', data);
    });
    
    // ⬇️ PEGA EXACTAMENTE AQUÍ ABAJO LA PARTE 2 ⬇️
    // Puentes para el control de videos
    socket.on('play_video', (url) => {
        console.log(`🎬 REPRODUCIENDO VIDEO EN OBS`);
        io.emit('play_video', url);
    });
    socket.on('stop_video', () => {
        console.log(`🛑 VIDEO CORTADO (BOTÓN DE PÁNICO)`);
        io.emit('stop_video');
    });

    socket.on('conectar_tiktok', async (username) => {
        const prevRoom = panelRoomBySocket.get(socket.id);
        if (prevRoom) {
            try { socket.leave(prevRoom); } catch (e) {}
            panelRoomBySocket.delete(socket.id);
        }
        const prevConn = tiktokBySocket.get(socket.id);
        if (prevConn) {
            tiktokBySocket.delete(socket.id);
            try { prevConn.disconnect(); } catch (e) {}
        }

        const room = normalizarRoomUsuario(username);
        if (!room) {
            socket.emit('estado', "🔴 Usuario inválido");
            return;
        }

        socket.join(room);
        panelRoomBySocket.set(socket.id, room);
        console.log(`📡 Panel unido a la sala de: ${room} (socket ${socket.id})`);

        const tiktokConnection = new WebcastPushConnection(room, {
            processInitialData: true,
            fetchRoomInfoOnConnect: true,
            enableExtendedGiftInfo: true,
            enableWebsocketUpgrade: true,
            clientParams: { "app_language": "es-MX", "device_platform": "web", "region": "MX" }
        });
        tiktokBySocket.set(socket.id, tiktokConnection);

        try {
            await tiktokConnection.connect();
            socket.emit('estado', `✅ @${room} Conectado`);
            const meta = extractStreamerMeta(tiktokConnection, room);
            socket.emit('streamer_info', meta);
            socket.emit('conexion_exitosa');

            io.to(room).emit('nuevo_live');

            tiktokConnection.on('chat', data => {
                const c = data && data.comment != null ? String(data.comment) : '';
                if (c.startsWith('!play ')) io.to(room).emit('spotify_request', { user: data.uniqueId, query: c.replace('!play ', '').trim() });
                if (c === '!skip') io.to(room).emit('spotify_skip', { user: data.uniqueId });
                io.to(room).emit('chat', data);
            });

            tiktokConnection.on('like', data => {
                console.log(`❤️ Like de @${data.uniqueId} enviado a sala ${room}`);
                io.to(room).emit('like', data);
            });

            tiktokConnection.on('follow', data => io.to(room).emit('follow', data));
            tiktokConnection.on('share', data => io.to(room).emit('share', { uniqueId: data.uniqueId || (data.user && data.user.uniqueId) }));
            tiktokConnection.on('subscribe', data => io.to(room).emit('subscribe', { uniqueId: data.uniqueId || (data.user && data.user.uniqueId) }));

            tiktokConnection.on('roomUser', data => io.to(room).emit('room_user', data));
            tiktokConnection.on('member', data => io.to(room).emit('member', data));

            tiktokConnection.on('gift', data => {
                const uid = data.uniqueId || (data.user && data.user.uniqueId);
                const giftImgFromDetails = data.giftDetails && data.giftDetails.giftImage && data.giftDetails.giftImage.url
                    ? (Array.isArray(data.giftDetails.giftImage.url) ? data.giftDetails.giftImage.url[0] : data.giftDetails.giftImage.url)
                    : '';
                io.to(room).emit('gift', {
                    giftName: (data.giftName || '').toLowerCase(),
                    diamondCount: data.diamondCount,
                    repeatCount: data.repeatCount,
                    uniqueId: uid,
                    nickname: data.nickname || (data.user && data.user.nickname) || '',
                    profilePictureUrl: data.profilePictureUrl || (data.user && data.user.profilePictureUrl) || '',
                    giftPictureUrl: data.giftPictureUrl || (data.user && data.user.giftPictureUrl) || giftImgFromDetails || '',
                    giftId: data.giftId,
                    groupId: data.groupId,
                    giftType: data.giftType,
                    repeatEnd: data.repeatEnd
                });
            });

            tiktokConnection.on('disconnected', () => {
                if (tiktokBySocket.get(socket.id) !== tiktokConnection) return;
                tiktokBySocket.delete(socket.id);
                const r = panelRoomBySocket.get(socket.id);
                if (r) {
                    try { socket.leave(r); } catch (e) {}
                    panelRoomBySocket.delete(socket.id);
                }
                socket.emit('estado', '🔴 Live Finalizado');
                socket.emit('desconectado_forzado');
            });
        } catch (e) {
            tiktokBySocket.delete(socket.id);
            panelRoomBySocket.delete(socket.id);
            try { socket.leave(room); } catch (e2) {}
            try { tiktokConnection.disconnect(); } catch (e3) {}
            socket.emit('estado', "🔴 Error");
            socket.emit('desconectado_forzado');
        }
    });

    socket.on('desconectar_tiktok', () => {
        const c = tiktokBySocket.get(socket.id);
        if (c) {
            tiktokBySocket.delete(socket.id);
            try { c.disconnect(); } catch (e) {}
        }
        const r = panelRoomBySocket.get(socket.id);
        if (r) {
            try { socket.leave(r); } catch (e) {}
            panelRoomBySocket.delete(socket.id);
        }
        socket.emit('estado', '🔴 Desconectado');
        socket.emit('desconectado_forzado');
    });

    socket.on('disconnect', () => {
        const c = tiktokBySocket.get(socket.id);
        if (c) {
            tiktokBySocket.delete(socket.id);
            try { c.disconnect(); } catch (e) {}
        }
        const r = panelRoomBySocket.get(socket.id);
        if (r) {
            try { socket.leave(r); } catch (e) {}
            panelRoomBySocket.delete(socket.id);
        }
        overlayRoomBySocket.delete(socket.id);
    });
});
// =========================================================
// PUENTE DE COMANDOS PARA MINECRAFT (RCON)
// =========================================================
const { Rcon } = require('rcon-client');
const { OBSWebSocket } = require('obs-websocket-js');
const { StreamerbotClient } = require('@streamerbot/client');

io.on('connection', (socket) => {
    /**
     * Mismo canal que las acciones Minecraft. Si data.expectReply === true (Probar Conexión en Configuración),
     * responde con comando_mc_reply — así el panel recibe el resultado por el mismo flujo que ya funciona.
     */
    socket.on('comando_mc', async (data) => {
        let rcon = null;
        const wantReply = !!(data && data.expectReply === true);
        const CMD_TEST_MS = 15000;
        try {
            if (!data || !String(data.pass || '').trim()) {
                if (wantReply) socket.emit('comando_mc_reply', { ok: false, error: 'Falta la contraseña RCON.' });
                return;
            }
            console.log(`⛏️ Conectando a Minecraft RCON: ${data.ip}:${data.port}...`);
            rcon = await Rcon.connect({
                host: data.ip,
                port: parseInt(data.port, 10),
                password: data.pass
            });

            const cmd = String(data.cmd != null ? data.cmd : '');
            let respuesta;

            if (wantReply) {
                try {
                    respuesta = await Promise.race([
                        rcon.send(cmd || 'list'),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('__MC_CMD_TIMEOUT__')), CMD_TEST_MS)
                        ),
                    ]);
                } catch (e) {
                    if (e && e.message === '__MC_CMD_TIMEOUT__') {
                        respuesta =
                            'Conexión y contraseña RCON correctas. El comando de prueba no respondió a tiempo (servidor lento o comando bloqueado); el enlace RCON sí funcionó.';
                    } else {
                        throw e;
                    }
                }
            } else {
                respuesta = await rcon.send(cmd);
            }

            console.log(`✅ [MC] Comando ejecutado: ${cmd} | Respuesta: ${respuesta}`);
            try {
                rcon.end();
            } catch (e) {
                /* ignore */
            }
            if (wantReply) {
                socket.emit('comando_mc_reply', { ok: true, response: String(respuesta != null ? respuesta : '') });
            }
        } catch (error) {
            try {
                if (rcon) rcon.end();
            } catch (e) {
                /* ignore */
            }
            console.log(`❌ [MC ERROR] Falló la conexión RCON: ${error.message}`);
            if (wantReply) {
                socket.emit('comando_mc_reply', { ok: false, error: error.message || String(error) });
            }
        }
    });

    /** Prueba conexión a OBS Studio (WebSocket 5.x, puerto por defecto 4455). */
    socket.on('probar_obs', async (data) => {
        let obs = null;
        try {
            const host = data && String(data.host || '').trim() ? String(data.host).trim() : '127.0.0.1';
            const port = data && data.port != null ? parseInt(data.port, 10) : 4455;
            if (!Number.isFinite(port) || port < 1 || port > 65535) {
                socket.emit('probar_obs_reply', { ok: false, error: 'Puerto inválido.' });
                return;
            }
            const password = data && data.password != null ? String(data.password) : '';
            const url = `ws://${host}:${port}`;
            obs = new OBSWebSocket();
            await obs.connect(url, password);
            let versionInfo = null;
            try {
                versionInfo = await obs.call('GetVersion');
            } catch (e) {
                /* conectado aunque falle una petición puntual */
            }
            try {
                await obs.disconnect();
            } catch (e) {
                /* ignore */
            }
            socket.emit('probar_obs_reply', {
                ok: true,
                obsVersion: versionInfo && versionInfo.obsVersion ? String(versionInfo.obsVersion) : '',
                obsWebSocketVersion:
                    versionInfo && versionInfo.obsWebSocketVersion ? String(versionInfo.obsWebSocketVersion) : ''
            });
        } catch (error) {
            try {
                if (obs) await obs.disconnect();
            } catch (e) {
                /* ignore */
            }
            socket.emit('probar_obs_reply', { ok: false, error: error.message || String(error) });
        }
    });

    /** Prueba conexión al servidor WebSocket de Streamer.bot (por defecto 127.0.0.1:8080/). */
    socket.on('probar_streamerbot', async (data) => {
        let sb = null;
        try {
            const host = data && String(data.host || '').trim() ? String(data.host).trim() : '127.0.0.1';
            const port = data && data.port != null ? parseInt(data.port, 10) : 8080;
            if (!Number.isFinite(port) || port < 1 || port > 65535) {
                socket.emit('probar_streamerbot_reply', { ok: false, error: 'Puerto inválido.' });
                return;
            }
            let endpoint = data && data.endpoint != null ? String(data.endpoint).trim() : '/';
            if (!endpoint.startsWith('/')) endpoint = '/' + endpoint;
            if (endpoint === '') endpoint = '/';
            const passwordRaw = data && data.password != null ? String(data.password) : '';
            const password = passwordRaw.length > 0 ? passwordRaw : undefined;

            let connectInfo = null;
            sb = new StreamerbotClient({
                host,
                port,
                endpoint,
                password,
                scheme: 'ws',
                immediate: false,
                autoReconnect: false,
                retries: 0,
                logLevel: 'none',
                onConnect: (info) => {
                    connectInfo = info;
                }
            });
            await sb.connect(20000);
            const info = connectInfo || {};
            const name = info.name != null ? String(info.name) : '';
            const version = info.version != null ? String(info.version) : '';
            const os = info.os != null ? String(info.os) : '';
            try {
                await sb.disconnect();
            } catch (e) {
                /* ignore */
            }
            sb = null;
            socket.emit('probar_streamerbot_reply', {
                ok: true,
                name,
                version,
                os
            });
        } catch (error) {
            try {
                if (sb) await sb.disconnect();
            } catch (e) {
                /* ignore */
            }
            socket.emit('probar_streamerbot_reply', { ok: false, error: error.message || String(error) });
        }
    });

    /**
     * Cambia la escena de programa en OBS (mismo patrón que acciones MC: el panel emite con credenciales de Configuración).
     */
    socket.on('obs_ejecutar', async (data) => {
        let obs = null;
        try {
            const sceneName = data && String(data.sceneName || '').trim();
            if (!sceneName) return;
            const host = data && String(data.host || '').trim() ? String(data.host).trim() : '127.0.0.1';
            const port = data && data.port != null ? parseInt(data.port, 10) : 4455;
            if (!Number.isFinite(port) || port < 1 || port > 65535) return;
            const password = data && data.password != null ? String(data.password) : '';
            const url = `ws://${host}:${port}`;
            obs = new OBSWebSocket();
            await obs.connect(url, password);
            await obs.call('SetCurrentProgramScene', { sceneName });
            try {
                await obs.disconnect();
            } catch (e) {
                /* ignore */
            }
        } catch (error) {
            console.warn('[OBS] obs_ejecutar:', error.message || error);
            try {
                if (obs) await obs.disconnect();
            } catch (e) {
                /* ignore */
            }
        }
    });

    /** Ejecuta una acción de Streamer.bot por ID (UUID). */
    socket.on('streamerbot_ejecutar', async (data) => {
        let sb = null;
        try {
            const actionId = data && String(data.actionId || '').trim();
            if (!actionId) return;
            const host = data && String(data.host || '').trim() ? String(data.host).trim() : '127.0.0.1';
            const port = data && data.port != null ? parseInt(data.port, 10) : 8080;
            if (!Number.isFinite(port) || port < 1 || port > 65535) return;
            let endpoint = data && data.endpoint != null ? String(data.endpoint).trim() : '/';
            if (!endpoint.startsWith('/')) endpoint = '/' + endpoint;
            if (endpoint === '') endpoint = '/';
            const passwordRaw = data && data.password != null ? String(data.password) : '';
            const password = passwordRaw.length > 0 ? passwordRaw : undefined;
            sb = new StreamerbotClient({
                host,
                port,
                endpoint,
                password,
                scheme: 'ws',
                immediate: false,
                autoReconnect: false,
                retries: 0,
                logLevel: 'none'
            });
            await sb.connect(15000);
            await sb.doAction(actionId);
            try {
                await sb.disconnect();
            } catch (e) {
                /* ignore */
            }
        } catch (error) {
            console.warn('[Streamer.bot] streamerbot_ejecutar:', error.message || error);
            try {
                if (sb) await sb.disconnect();
            } catch (e) {
                /* ignore */
            }
        }
    });
});
// =========================================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('🚀 Servidor ELArbol en puerto ' + PORT);
    console.log('[youtube-oauth] POST /api/youtube-token y /api/youtube-refresh activos');
    if (PAYPAL_PAYMENT_URL) {
        console.log('[paypal] Enlace de pago: ' + PAYPAL_PAYMENT_URL);
    } else {
        console.warn('[paypal] Sin enlace de pago válido; revisa PAYPAL_PAYMENT_URL.');
    }
});