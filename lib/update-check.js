/**
 * Comprueba si hay versión nueva comparando app.getVersion() con un JSON remoto (HTTPS).
 * El instalador sigue siendo descarga manual; el usuario solo ve el aviso y el enlace.
 */
const fs = require('fs');
const path = require('path');

/** Compara semver simple tipo 1.0.61 vs 1.0.9 → mayor gana. */
function compareSemver(a, b) {
    const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0);
    const pb = String(b || '0').split('.').map((x) => parseInt(x, 10) || 0);
    const n = Math.max(pa.length, pb.length);
    for (let i = 0; i < n; i++) {
        const da = pa[i] || 0;
        const db = pb[i] || 0;
        if (da > db) return 1;
        if (da < db) return -1;
    }
    return 0;
}

function readJsonSafe(p) {
    try {
        if (!fs.existsSync(p)) return null;
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
        return null;
    }
}

function resolveManifestUrl(app) {
    const userPath = path.join(app.getPath('userData'), 'update-channel.json');
    const userJ = readJsonSafe(userPath);
    if (userJ && typeof userJ.manifestUrl === 'string' && userJ.manifestUrl.trim()) {
        return userJ.manifestUrl.trim();
    }
    const bundled = path.join(__dirname, '..', 'config', 'update-channel.json');
    const bundledJ = readJsonSafe(bundled);
    if (bundledJ && typeof bundledJ.manifestUrl === 'string' && bundledJ.manifestUrl.trim()) {
        return bundledJ.manifestUrl.trim();
    }
    const env = process.env.MITIKFINITY_UPDATE_MANIFEST_URL;
    return env && String(env).trim() ? String(env).trim() : '';
}

function dismissPath(app) {
    return path.join(app.getPath('userData'), 'update-dismiss.json');
}

function readDismissedVersion(app) {
    const j = readJsonSafe(dismissPath(app));
    if (j && typeof j.version === 'string') return j.version.trim();
    return '';
}

function writeDismissedVersion(app, version) {
    try {
        fs.writeFileSync(dismissPath(app), JSON.stringify({ version, at: new Date().toISOString() }, null, 0), 'utf8');
    } catch (e) {}
}

/**
 * @param {import('electron').BrowserWindow | null} mainWindow
 * @param {import('electron').App} app
 * @param {typeof import('electron').dialog} dialog
 * @param {typeof import('electron').shell} shell
 */
async function checkForUpdateOnce(mainWindow, app, dialog, shell) {
    const manifestUrl = resolveManifestUrl(app);
    if (!manifestUrl || !/^https:\/\//i.test(manifestUrl)) return;

    let manifest;
    try {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 15000);
        const r = await fetch(manifestUrl, { cache: 'no-store', signal: ac.signal });
        clearTimeout(t);
        if (!r.ok) return;
        manifest = await r.json();
    } catch (e) {
        return;
    }

    const latest = (manifest.version || manifest.latestVersion || '').trim();
    const downloadUrl = (manifest.downloadUrl || manifest.url || '').trim();
    if (!latest || !downloadUrl || !/^https:\/\//i.test(downloadUrl)) return;

    const current = app.getVersion();
    if (compareSemver(latest, current) <= 0) return;

    const dismissed = readDismissedVersion(app);
    if (dismissed && dismissed === latest) return;

    const notes = typeof manifest.notes === 'string' ? manifest.notes.trim() : '';
    const detail = notes
        ? `${notes}\n\nTu versión: ${current} · Disponible: ${latest}`
        : `Tu versión: ${current} · Disponible: ${latest}\n\nDescarga el instalador e instala encima de la versión actual.`;

    const { response } = await dialog.showMessageBox(mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined, {
        type: 'info',
        buttons: ['Abrir descarga', 'Recordar más tarde'],
        defaultId: 0,
        cancelId: 1,
        title: 'Actualización disponible',
        message: `Hay una versión nueva del panel (${latest}).`,
        detail
    });

    if (response === 0) {
        await shell.openExternal(downloadUrl);
    } else {
        writeDismissedVersion(app, latest);
    }
}

module.exports = {
    compareSemver,
    checkForUpdateOnce
};
