/**
 * GitHub Gist Sync Service
 *
 * Syncs game saves, settings, and API key across devices using a private GitHub Gist.
 * Requires a GitHub Personal Access Token with 'gist' scope.
 *
 * Data is stored as JSON in a private Gist file. The Gist ID is saved locally
 * so subsequent syncs target the same Gist.
 */

const GIST_FILENAME = 'pathfinder-dm-sync.json';
const LOCAL_SYNC_KEY = 'pf-dm-gist-sync';
const GITHUB_API = 'https://api.github.com';

// ── Local sync metadata ──

function getSyncMeta() {
  try {
    const raw = localStorage.getItem(LOCAL_SYNC_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSyncMeta(meta) {
  localStorage.setItem(LOCAL_SYNC_KEY, JSON.stringify(meta));
}

/**
 * Get the stored GitHub token
 */
export function getGistToken() {
  return getSyncMeta().token || '';
}

/**
 * Check if Gist sync is configured and ready
 */
export function isSyncConfigured() {
  const meta = getSyncMeta();
  return !!(meta.token && meta.gistId);
}

/**
 * Get sync status info
 */
export function getSyncStatus() {
  const meta = getSyncMeta();
  return {
    configured: !!(meta.token && meta.gistId),
    hasToken: !!meta.token,
    gistId: meta.gistId || null,
    lastSync: meta.lastSync || null,
    lastPush: meta.lastPush || null,
    username: meta.username || null,
  };
}

// ── GitHub API helpers ──

async function ghFetch(path, token, options = {}) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Validate a GitHub token and return the username
 */
export async function validateToken(token) {
  if (!token || !token.trim()) throw new Error('Token is empty');
  const user = await ghFetch('/user', token.trim());
  return user.login;
}

/**
 * Link a GitHub token — validates it, finds or creates the sync Gist
 */
export async function linkToken(token) {
  const trimmed = token.trim();
  const username = await validateToken(trimmed);

  // Look for an existing sync Gist
  let gistId = null;
  try {
    const gists = await ghFetch('/gists?per_page=100', trimmed);
    const existing = gists.find(g => g.files && g.files[GIST_FILENAME]);
    if (existing) {
      gistId = existing.id;
    }
  } catch {
    // If listing fails, we'll create a new one
  }

  // Create a new Gist if none found
  if (!gistId) {
    const payload = {
      description: 'AI Pathfinder DM - Cloud Save (do not delete)',
      public: false,
      files: {
        [GIST_FILENAME]: {
          content: JSON.stringify({
            version: 1,
            createdAt: new Date().toISOString(),
            settings: {},
            saves: {},
          }, null, 2),
        },
      },
    };
    const created = await ghFetch('/gists', trimmed, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    gistId = created.id;
  }

  saveSyncMeta({
    token: trimmed,
    gistId,
    username,
    linkedAt: new Date().toISOString(),
  });

  return { username, gistId, isNew: !gistId };
}

/**
 * Unlink — remove sync config from this device (does NOT delete the Gist)
 */
export function unlinkSync() {
  localStorage.removeItem(LOCAL_SYNC_KEY);
}

// ── Sync operations ──

/**
 * Read the sync data from the Gist
 */
export async function pullFromCloud() {
  const meta = getSyncMeta();
  if (!meta.token || !meta.gistId) throw new Error('Sync not configured');

  const gist = await ghFetch(`/gists/${meta.gistId}`, meta.token);
  const file = gist.files?.[GIST_FILENAME];
  if (!file || !file.content) throw new Error('Sync file not found in Gist');

  let data;
  try {
    data = JSON.parse(file.content);
  } catch {
    throw new Error('Sync file is corrupted');
  }

  saveSyncMeta({ ...meta, lastSync: new Date().toISOString() });
  return data;
}

/**
 * Write sync data to the Gist
 */
export async function pushToCloud(data) {
  const meta = getSyncMeta();
  if (!meta.token || !meta.gistId) throw new Error('Sync not configured');

  const payload = {
    files: {
      [GIST_FILENAME]: {
        content: JSON.stringify({
          ...data,
          version: 1,
          updatedAt: new Date().toISOString(),
          updatedFrom: navigator.userAgent.includes('Mobile') ? 'mobile' : 'desktop',
        }, null, 2),
      },
    },
  };

  await ghFetch(`/gists/${meta.gistId}`, meta.token, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

  saveSyncMeta({ ...meta, lastPush: new Date().toISOString() });
}

/**
 * Push current local state (settings + saves) to cloud
 */
export async function pushCurrentState() {
  const meta = getSyncMeta();
  if (!meta.token || !meta.gistId) throw new Error('Sync not configured');

  // Gather local settings
  let settings = {};
  try {
    const raw = localStorage.getItem('pf-dm-settings');
    if (raw) settings = JSON.parse(raw);
  } catch {}

  // Gather local saves from IndexedDB via the save service
  // We store a lightweight manifest — full saves can be large
  let saves = {};
  try {
    const saveGame = await import('./saveGame.js');
    const saveList = await saveGame.listSaves();
    saves = { list: saveList };
  } catch {}

  const data = {
    settings,
    saves,
    syncedAt: new Date().toISOString(),
  };

  await pushToCloud(data);
  return data;
}

/**
 * Pull cloud state and merge into local — settings overwrite, saves merge
 */
export async function pullAndApply() {
  const data = await pullFromCloud();

  // Apply settings (API key, model, etc.)
  if (data.settings && Object.keys(data.settings).length > 0) {
    localStorage.setItem('pf-dm-settings', JSON.stringify(data.settings));
  }

  return data;
}

/**
 * Full sync: pull from cloud, then push local state back
 * Returns the merged cloud data
 */
export async function fullSync() {
  const meta = getSyncMeta();
  if (!meta.token || !meta.gistId) throw new Error('Sync not configured');

  // Pull first to get cloud state
  let cloudData = {};
  try {
    cloudData = await pullFromCloud();
  } catch {
    // If pull fails (new Gist, etc.), start fresh
  }

  // Merge: cloud settings take priority if they have an API key set
  let localSettings = {};
  try {
    const raw = localStorage.getItem('pf-dm-settings');
    if (raw) localSettings = JSON.parse(raw);
  } catch {}

  const mergedSettings = { ...localSettings };

  // If cloud has an API key and local doesn't, use cloud's
  if (cloudData.settings?.apiKey && !localSettings.apiKey) {
    Object.assign(mergedSettings, cloudData.settings);
  }
  // If local has a key but cloud doesn't, keep local (it'll get pushed)
  // If both have keys, keep local (most recent edit wins on push)

  localStorage.setItem('pf-dm-settings', JSON.stringify(mergedSettings));

  // Push merged state back
  await pushCurrentState();

  return { settings: mergedSettings, cloudData };
}
