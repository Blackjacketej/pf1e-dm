/**
 * Save/Load Game System
 *
 * Persists full game state to IndexedDB:
 * - Party (characters, equipment, gold, spells, etc.)
 * - Campaign progress (current chapter, part, completed encounters)
 * - Adventure state (location, room)
 * - Combat state (if mid-combat)
 * - Game log (last 200 entries)
 * - DM engine conversation history
 *
 * Save format versions are defined in ./saveMigration.js along with the
 * pure migrateSaveData helper — kept separate so tests can import it
 * without pulling in Dexie / dmEngine.
 */

import db from '../db/database';
import dmEngine from './dmEngine';
import { SAVE_FORMAT_VERSION, migrateSaveData, applyFamiliarDefaults } from './saveMigration';
import { exportJournalData, importJournalData } from './journalReset';
import { setActiveCampaignDataId } from './campaignScope';

export { SAVE_FORMAT_VERSION, migrateSaveData };

export async function saveGame(name, { party, campaign, adventure, combat, gameLog, worldState }) {
  // Phase 7.7 audit — normalize on write so saves created by a fresh session
  // (e.g. characters built before Phase 7 shipped the familiar field) already
  // obey the v3 contract rather than relying on migration-on-load.
  const normalized = applyFamiliarDefaults({ party: party || [], worldState: worldState || null });

  // v4 — capture the adventurer's journal (six tracker tables) so the save
  // includes "what the party has discovered" alongside party/campaign/world
  // state. Without this, a Load would restore party + campaign but leave
  // the journal reflecting whatever game the operator had loaded last.
  //
  // v11 — pass the campaign's dataId as an explicit scope override so the
  // snapshot contains ONLY this campaign's rows, independent of whatever
  // the module-level campaignScope currently holds. (Belt-and-braces: the
  // scope should already match `campaign.data.id`, but explicitly threading
  // it means a save in-flight can't be contaminated by a mid-flight
  // scope change.)
  const journalScope = campaign?.data?.id || null;
  const journal = await exportJournalData(journalScope);

  const saveData = {
    name: name || `Save - ${new Date().toLocaleString()}`,
    savedAt: new Date().toISOString(),
    version: SAVE_FORMAT_VERSION,
    party: normalized.party,
    campaign: campaign ? {
      // Store campaign state but reference the campaign data by ID to save space
      dataId: campaign.data?.id,
      currentChapter: campaign.currentChapter,
      currentPart: campaign.currentPart,
      completedEncounters: campaign.completedEncounters || [],
      partyLevel: campaign.partyLevel || 1,
      started: campaign.started,
    } : null,
    adventure: adventure || null,
    combat: combat || null,
    gameLog: (gameLog || []).slice(-200), // Keep last 200 log entries
    dmHistory: dmEngine.conversationHistory?.slice(-20) || [],
    worldState: normalized.worldState,
    journal,
  };

  const id = await db.savedGames.add(saveData);
  console.log(`[Save] Game saved: "${name}" (id: ${id})`);
  return id;
}

export async function loadGame(saveId) {
  const raw = await db.savedGames.get(saveId);
  if (!raw) throw new Error('Save not found');

  // Phase 7.7 — normalize legacy saves (v1/v2) before returning to the UI.
  const save = migrateSaveData(raw);

  // Restore campaign data reference
  let campaign = null;
  if (save.campaign) {
    const campaignData = await db.campaignData.get(save.campaign.dataId);
    if (campaignData) {
      campaign = {
        data: campaignData,
        currentChapter: save.campaign.currentChapter,
        currentPart: save.campaign.currentPart,
        completedEncounters: save.campaign.completedEncounters || [],
        partyLevel: save.campaign.partyLevel || 1,
        started: save.campaign.started,
      };
    }
  }

  // Restore DM conversation history
  if (save.dmHistory && save.dmHistory.length > 0) {
    dmEngine.conversationHistory = save.dmHistory;
  }

  // v4 — restore the adventurer's journal tables from the snapshot. Replace
  // semantics: only THIS campaign's journal rows are wiped and swapped to
  // the save's snapshot — other campaigns' rows stay untouched.
  //
  // v11 — two important wrinkles:
  //   1. We push the loading save's campaign id into the active scope
  //      BEFORE importJournalData so the import resolves to the correct
  //      scope. App.jsx will subsequently re-set this via its useEffect on
  //      `campaign`, but we can't wait for React — the import has to know
  //      its target scope synchronously.
  //   2. We also pass the scope explicitly to importJournalData (rather
  //      than relying on the global) so a stale scope from a prior load
  //      can't sneak rows into the wrong campaign.
  // Pre-v4 saves have no `journal` field — importJournalData is a no-op
  // in that case and the existing journal is left intact.
  if (campaign?.data?.id) {
    setActiveCampaignDataId(campaign.data.id);
  }
  try {
    await importJournalData(save.journal, campaign?.data?.id || null);
  } catch (err) {
    console.warn('[Load] Journal restore failed (party/campaign/world still loaded):', err);
  }

  return {
    party: save.party || [],
    campaign,
    adventure: save.adventure || null,
    combat: save.combat || null,
    gameLog: save.gameLog || [],
    worldState: save.worldState || null,
  };
}

export async function listSaves() {
  const saves = await db.savedGames.orderBy('savedAt').reverse().toArray();
  return saves.map(s => ({
    id: s.id,
    name: s.name,
    savedAt: s.savedAt,
    partySize: s.party?.length || 0,
    campaignName: s.campaign ? 'Rise of the Runelords' : null,
    chapter: s.campaign?.currentChapter || null,
  }));
}

export async function deleteSave(saveId) {
  await db.savedGames.delete(saveId);
}

export async function autoSave({ party, campaign, adventure, combat, gameLog, worldState }) {
  // Check if autosave exists
  const existing = await db.savedGames.where('name').equals('Autosave').first();
  if (existing) {
    await db.savedGames.delete(existing.id);
  }
  return saveGame('Autosave', { party, campaign, adventure, combat, gameLog, worldState });
}
