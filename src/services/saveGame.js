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
 */

import db from '../db/database';
import dmEngine from './dmEngine';

export async function saveGame(name, { party, campaign, adventure, combat, gameLog, worldState }) {
  const saveData = {
    name: name || `Save - ${new Date().toLocaleString()}`,
    savedAt: new Date().toISOString(),
    version: 2,
    party: party || [],
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
    worldState: worldState || null,
  };

  const id = await db.savedGames.add(saveData);
  console.log(`[Save] Game saved: "${name}" (id: ${id})`);
  return id;
}

export async function loadGame(saveId) {
  const save = await db.savedGames.get(saveId);
  if (!save) throw new Error('Save not found');

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
