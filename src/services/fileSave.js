/**
 * File-based Save System
 *
 * Exports/imports ALL game state as a single JSON file on the user's machine.
 * Also supports persistent auto-save via the File System Access API (Chrome/Edge).
 *
 * Data bundled in the save file:
 *   - party, campaign, adventure, combat, gameLog, worldState  (live state)
 *   - gmMapData  (from localStorage 'pf-gm-map-data')
 *   - dmSettings (from localStorage 'dm-settings')
 *   - savedGames (all IndexedDB save slots)
 *   - metadata   (version, timestamp, app version)
 */

import db from '../db/database';
import dmEngine from './dmEngine';

const FILE_VERSION = 1;
const APP_ID = 'pf1e-dm-app';

// ── Gather all data ──

export async function gatherAllData({ party, campaign, adventure, combat, gameLog, worldState }) {
  // Collect all IndexedDB saved games
  let savedGames = [];
  try {
    savedGames = await db.savedGames.toArray();
  } catch (e) { console.warn('Could not read saved games:', e); }

  // Collect localStorage items
  let gmMapData = {};
  let dmSettings = {};
  try {
    const raw = localStorage.getItem('pf-gm-map-data');
    if (raw) gmMapData = JSON.parse(raw);
  } catch (e) { /* ignore */ }
  try {
    const raw = localStorage.getItem('dm-settings');
    if (raw) dmSettings = JSON.parse(raw);
  } catch (e) { /* ignore */ }

  return {
    _appId: APP_ID,
    _fileVersion: FILE_VERSION,
    _savedAt: new Date().toISOString(),
    // Live game state
    party: party || [],
    campaign: campaign ? {
      dataId: campaign.data?.id,
      currentChapter: campaign.currentChapter,
      currentPart: campaign.currentPart,
      completedEncounters: campaign.completedEncounters || [],
      partyLevel: campaign.partyLevel || 1,
      started: campaign.started,
    } : null,
    adventure: adventure || null,
    combat: combat || null,
    gameLog: (gameLog || []).slice(-500),
    worldState: worldState || null,
    dmHistory: dmEngine.conversationHistory?.slice(-20) || [],
    // Persistent stores
    gmMapData,
    dmSettings,
    savedGames,
  };
}

// ── Export: download as JSON file ──

export async function exportToFile(liveState) {
  const data = await gatherAllData(liveState);
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });

  // Generate filename with date
  const date = new Date().toISOString().slice(0, 10);
  const campaignName = liveState.campaign?.data?.name || 'pathfinder';
  const safeName = campaignName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const filename = `${safeName}_save_${date}.json`;

  // Trigger download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return filename;
}

// ── Import: read JSON file ──

export async function importFromFile(file) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('Invalid save file — not valid JSON');
  }

  if (data._appId !== APP_ID) {
    throw new Error('This file is not a Pathfinder DM save file');
  }

  // Restore localStorage data
  if (data.gmMapData && Object.keys(data.gmMapData).length > 0) {
    localStorage.setItem('pf-gm-map-data', JSON.stringify(data.gmMapData));
  }
  if (data.dmSettings && Object.keys(data.dmSettings).length > 0) {
    localStorage.setItem('dm-settings', JSON.stringify(data.dmSettings));
  }

  // Restore saved games to IndexedDB (merge — don't delete existing)
  if (data.savedGames && data.savedGames.length > 0) {
    for (const save of data.savedGames) {
      // Avoid duplicates by checking name+savedAt
      const existing = await db.savedGames
        .where('name').equals(save.name)
        .filter(s => s.savedAt === save.savedAt)
        .first();
      if (!existing) {
        const { id, ...saveWithoutId } = save; // strip old ID so Dexie assigns new one
        await db.savedGames.add(saveWithoutId);
      }
    }
  }

  // Restore DM conversation history
  if (data.dmHistory && data.dmHistory.length > 0) {
    dmEngine.conversationHistory = data.dmHistory;
  }

  // Resolve campaign data reference (same as loadGame)
  let campaign = null;
  if (data.campaign) {
    const campaignData = await db.campaignData.get(data.campaign.dataId);
    if (campaignData) {
      campaign = {
        data: campaignData,
        currentChapter: data.campaign.currentChapter,
        currentPart: data.campaign.currentPart,
        completedEncounters: data.campaign.completedEncounters || [],
        partyLevel: data.campaign.partyLevel || 1,
        started: data.campaign.started,
      };
    }
  }

  // Merge worldState with gmMapData from the file
  let worldState = data.worldState || {};
  if (data.gmMapData) {
    worldState = {
      ...worldState,
      gmPins: data.gmMapData.gmPins || worldState.gmPins || {},
      gmPinOverrides: data.gmMapData.gmPinOverrides || worldState.gmPinOverrides || {},
      gmHiddenPins: data.gmMapData.gmHiddenPins || worldState.gmHiddenPins || {},
      gmRegions: data.gmMapData.gmRegions || worldState.gmRegions || {},
      gmHexTerrain: data.gmMapData.gmHexTerrain || worldState.gmHexTerrain || {},
    };
  }

  return {
    party: data.party || [],
    campaign,
    adventure: data.adventure || null,
    combat: data.combat || null,
    gameLog: data.gameLog || [],
    worldState,
  };
}

// ── File System Access API: persistent auto-save handle ──
// (Chrome/Edge only — allows saving to a specific file without download dialog)

let _fileHandle = null;

export function hasFileHandle() {
  return !!_fileHandle;
}

export async function pickSaveFile() {
  if (!window.showSaveFilePicker) {
    throw new Error('File System Access API not supported in this browser. Use Export instead.');
  }
  try {
    _fileHandle = await window.showSaveFilePicker({
      suggestedName: 'pathfinder_autosave.json',
      types: [{
        description: 'Pathfinder Save File',
        accept: { 'application/json': ['.json'] },
      }],
    });
    return _fileHandle.name;
  } catch (e) {
    if (e.name === 'AbortError') return null; // user cancelled
    throw e;
  }
}

export async function autoSaveToFile(liveState) {
  if (!_fileHandle) return false;
  try {
    const data = await gatherAllData(liveState);
    const json = JSON.stringify(data, null, 2);
    const writable = await _fileHandle.createWritable();
    await writable.write(json);
    await writable.close();
    return true;
  } catch (e) {
    console.warn('[FileSave] Auto-save to file failed:', e);
    // If permission was revoked, clear the handle
    if (e.name === 'NotAllowedError') _fileHandle = null;
    return false;
  }
}

export async function loadFromFileHandle() {
  if (!_fileHandle) return null;
  try {
    const file = await _fileHandle.getFile();
    return importFromFile(file);
  } catch (e) {
    console.warn('[FileSave] Load from file handle failed:', e);
    return null;
  }
}
