import React, { useState, useEffect } from 'react';
import useIsMobile from '../hooks/useIsMobile';
import db from '../db/database';
import dmEngine from '../services/dmEngine';
import { countJournalEntries, resetJournalData } from '../services/journalReset';
import { traceEngine } from '../services/engineTrace';
import { getCampaignStartDate } from '../services/calendar';

/**
 * CampaignSelector — simplified Campaign tab that lets users pick a
 * pre-built campaign or launch open-world (no campaign) mode.
 * Once selected, the user is sent to the Adventure tab.
 */
export default function CampaignSelector({
  campaign,
  setCampaign,
  setWorldState,    // Bug #44: seed in-world date when a campaign starts
  party,
  addLog,
  onStartAdventure, // callback to switch to Adventure tab
  onChapterIntroFired, // Bug #38 follow-up (2026-04-18): flag to suppress the
                       // next arrival narrate in AdventureTab.startAdventure,
                       // so we don't stack two AI intro paragraphs when the
                       // operator picks a town right after campaign start.
  stashChapterIntroResult, // Bug #58 (2026-04-18): stash the full chapter_intro
                           // narrate result (text + newEntities) for AdventureTab
                           // to drain + run processNewEntities against. Without
                           // this, the opening paragraph's NPCs/clues/rumors/
                           // locations stay invisible until the first action.
}) {
  const isMobile = useIsMobile();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    (async () => {
      const data = await db.campaignData.toArray();
      setCampaigns(data);
      setLoading(false);
    })();
  }, []);

  const startCampaign = async (campaignData) => {
    traceEngine('startCampaign', {
      campaignId: campaignData?.id || null,
      campaignName: campaignData?.name || null,
      partyLen: party?.length || 0,
    });
    if (!party || party.length === 0) {
      addLog('Create a party first before starting a campaign!', 'danger');
      return;
    }
    // Bug #18 + cross-campaign leak fix (2026-04-17 — Tom: "journal from the
    // previous game was still filled"): starting a campaign must wipe the
    // NEW campaign's scope, not the currently-active one.
    //
    // Old bug: we called resetJournalData() with no override, so it resolved
    // scope via getActiveCampaignDataId() — still the PREVIOUS campaign at
    // this point in the flow (setCampaign(newCampaign) hadn't fired yet,
    // and the App.jsx useEffect that flips campaignScope only runs on the
    // next render). Net effect: we wiped the wrong campaign's journal and
    // the new campaign still showed whatever rows it had from a prior run.
    //
    // Fix: explicitly target campaignData.id so the wipe always lands on
    // the campaign we're about to start. resetJournalData + countJournalEntries
    // both accept a scope override argument (see services/journalReset.js).
    //
    // v11 context: every journal table is campaignDataId-indexed. Two plays
    // of the same AP share the same template id and therefore the same
    // scope — "new game" semantics for that AP require wiping its scope.
    // If the operator wants per-run persistence of multiple plays of the
    // same AP, that's a larger refactor (per-run id) tracked separately.
    const newCampaignDataId = campaignData?.id || null;
    try {
      if (newCampaignDataId) {
        const { total } = await countJournalEntries(newCampaignDataId);
        if (total > 0) {
          await resetJournalData(newCampaignDataId);
          traceEngine('journal:reset', {
            source: 'CampaignSelector.startCampaign',
            scope: newCampaignDataId,
            cleared: total,
          });
        }
      }
    } catch (err) {
      console.warn('[CampaignSelector] journal reset check failed:', err);
    }

    setStarting(true);
    const firstChapter = campaignData.chapters[0];
    const firstPart = firstChapter.parts[0];
    const newCampaign = {
      data: campaignData,
      currentChapter: firstChapter.id,
      currentPart: firstPart.id,
      completedEncounters: [],
      partyLevel: 1,
      started: new Date().toISOString(),
    };
    setCampaign(newCampaign);

    // Bug #44 (2026-04-17): seed in-world date from the campaign's canonical
    // start so the HUD doesn't render Abadius 1, 4716 AR for every AP. For
    // Rise of the Runelords this becomes Rova 23, 4707 AR @ 10:00 (Swallowtail
    // Festival morning). Unknown campaign ids fall back to DEFAULT_START,
    // preserving prior behavior. Mark _dateSeededFromCampaign so the one-time
    // migration in App.jsx doesn't double-seed this save.
    if (typeof setWorldState === 'function') {
      const seed = getCampaignStartDate(campaignData?.id);
      setWorldState(prev => ({
        ...(prev || {}),
        currentYear: seed.year,
        currentMonth: seed.month,
        currentDay: seed.day,
        currentHour: seed.hour,
        currentMinute: seed.minute,
        // Task #79 — sub-minute clock field. seed.second is present on the
        // canonical start-date objects; fall back to 0 for resilience so a
        // hand-rolled campaign seed without the field still loads cleanly.
        currentSecond: Number.isFinite(seed.second) ? seed.second : 0,
        _dateSeededFromCampaign: true,
      }));
      traceEngine('calendar:seed', {
        source: 'CampaignSelector.startCampaign',
        campaignId: campaignData?.id || null,
        seed,
      });
    }

    addLog(`=== ${campaignData.name} ===`, 'system');
    addLog(`Chapter ${firstChapter.number}: ${firstChapter.name}`, 'system');

    // AI narration for campaign start.
    //
    // Bug #38 (2026-04-17): the catch block used to log BOTH firstChapter.synopsis
    // AND firstPart.description as narrations, producing two paragraphs on AI
    // failure — compounding the duplicate-paragraph problem the operator sees
    // on the Adventure-tab side. We now log a single fallback narration (the
    // chapter synopsis, which is the richer, higher-level opener) and relegate
    // the part description to a follow-up system line so the log doesn't stack
    // two narration paragraphs even when the AI is unreachable.
    //
    // Bug #47 redux (2026-04-18): the flag used to be set AFTER the awaited
    // narrate below. chapter_intro takes ~2–3s to resolve; if ANY codepath
    // fires startAdventure during that window (auto-trigger, stale mount,
    // user clicking through quickly) the flag is still false and the arrival
    // narrate stacks a second intro paragraph on top. Flipping the flag BEFORE
    // the await makes the suppression preemptive: whether the narrate succeeds,
    // fails (fallback branch logs), or is still in flight when startAdventure
    // runs, the flag is already set. One-shot consumption clears it after the
    // first arrival-narrate suppression, so later town-hop startAdventure
    // calls get their normal arrival narrate back.
    onChapterIntroFired?.();

    dmEngine.clearHistory();
    try {
      const firstEvent = firstPart.events?.[0] || firstPart.encounters?.find(e => e.type === 'roleplay' || e.type === 'story');
      const result = await dmEngine.narrate('chapter_intro', {
        campaign: newCampaign,
        party,
        chapter: firstChapter,
        part: firstPart,
        encounter: firstEvent || { name: firstPart.name, description: firstPart.description, type: 'story' },
      });
      addLog(result.text, 'narration');
      // Bug #58 (2026-04-18): stash the full narrate result so AdventureTab
      // can run processNewEntities(result.newEntities, loc.name, result.text)
      // once it mounts + the world tree is ready. Without this, any NPCs /
      // clues / rumors / locations / lore mentioned in the opening paragraph
      // stay invisible to the journal + Nearby NPCs panel until the first
      // action. Stash AFTER addLog so the narration is already committed —
      // AdventureTab's extraction is idempotent per-turn via its own dedup.
      stashChapterIntroResult?.(result);
    } catch (err) {
      addLog(firstChapter.synopsis || firstPart.description || `Chapter ${firstChapter.number}: ${firstChapter.name} begins.`, 'narration');
      // No narrate result to stash in the fallback branch — the static
      // synopsis text isn't an LLM response so there's no newEntities / no
      // scene text worth extraction. Arrival narrate is still suppressed via
      // the onChapterIntroFired flag above, matching the happy-path contract.
    }

    setStarting(false);
    onStartAdventure?.();
  };

  const startOpenWorld = async () => {
    // Cross-campaign leak fix (2026-04-17): open-world no longer wipes a
    // scope. Previously we called resetJournalData() with no override, which
    // resolved to the currently-active campaign and wiped ITS journal when
    // the operator clicked "Open World" — clearly wrong if the operator
    // then returns to that campaign later and expects their journal intact.
    // Open-world has no scope (getActiveCampaignDataId → null), so scoped
    // reads return [] regardless: nothing can bleed into an open-world run.
    // The canonical "fresh slate" path remains App.handleMenuNewGame.
    setCampaign(null);
    addLog('Open-world mode — explore freely without a set campaign.', 'system');
    onStartAdventure?.();
  };

  const leaveCampaign = () => {
    setCampaign(null);
    addLog('Campaign deselected. You are now in open-world mode.', 'system');
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#ffd700' }}>
        Loading campaigns...
      </div>
    );
  }

  // ── Active campaign summary ──
  if (campaign) {
    const ch = campaign.data?.chapters?.find(c => c.id === campaign.currentChapter);
    const pt = ch?.parts?.find(p => p.id === campaign.currentPart);
    const completed = campaign.completedEncounters?.length || 0;
    const totalEncounters = campaign.data?.chapters?.reduce((s, c) => s + c.parts.reduce((s2, p) => s2 + (p.encounters?.length || 0), 0), 0) || 0;

    return (
      <div style={{ padding: isMobile ? 12 : 32, maxWidth: 700, margin: '0 auto' }}>
        <div style={{
          background: 'linear-gradient(135deg, #2d1b00, #1a1a2e)',
          border: '2px solid #ffd700',
          borderRadius: 12,
          padding: isMobile ? 20 : 32,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 14, color: '#8b6914', textTransform: 'uppercase', letterSpacing: 3, marginBottom: 8 }}>
            Active Campaign
          </div>
          <h2 style={{ color: '#ffd700', fontSize: 28, margin: '0 0 4px' }}>{campaign.data?.name}</h2>
          <div style={{ color: '#b8860b', fontSize: 13, marginBottom: 20 }}>{campaign.data?.subtitle}</div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: isMobile ? 16 : 32, marginBottom: 20, flexDirection: isMobile ? 'column' : 'row' }}>
            <div>
              <div style={{ color: '#8b949e', fontSize: 10, textTransform: 'uppercase' }}>Chapter</div>
              <div style={{ color: '#e0d6c8', fontWeight: 700 }}>{ch?.name || '—'}</div>
            </div>
            <div>
              <div style={{ color: '#8b949e', fontSize: 10, textTransform: 'uppercase' }}>Section</div>
              <div style={{ color: '#e0d6c8', fontWeight: 700 }}>{pt?.name || '—'}</div>
            </div>
            <div>
              <div style={{ color: '#8b949e', fontSize: 10, textTransform: 'uppercase' }}>Progress</div>
              <div style={{ color: '#e0d6c8', fontWeight: 700 }}>{completed} / {totalEncounters} encounters</div>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ background: '#0d1117', borderRadius: 6, height: 8, marginBottom: 24, overflow: 'hidden' }}>
            <div style={{
              width: `${totalEncounters > 0 ? (completed / totalEncounters) * 100 : 0}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #ffd700, #ff8c00)',
              borderRadius: 6,
              transition: 'width 0.5s ease',
            }} />
          </div>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexDirection: isMobile ? 'column' : 'row' }}>
            <button
              onClick={onStartAdventure}
              style={{
                padding: isMobile ? '14px 20px' : '12px 32px', background: 'linear-gradient(135deg, #2d5016, #1a4010)',
                border: '1px solid #7fff00', borderRadius: 8, color: '#7fff00',
                cursor: 'pointer', fontSize: 15, fontWeight: 600,
                width: isMobile ? '100%' : 'auto',
                minHeight: isMobile ? '44px' : 'auto',
                touchAction: 'manipulation',
              }}
            >
              Continue Adventure
            </button>
            <button
              onClick={leaveCampaign}
              style={{
                padding: isMobile ? '14px 20px' : '12px 24px', background: 'transparent',
                border: '1px solid #8b949e', borderRadius: 8, color: '#8b949e',
                cursor: 'pointer', fontSize: 13,
                width: isMobile ? '100%' : 'auto',
                minHeight: isMobile ? '44px' : 'auto',
                touchAction: 'manipulation',
              }}
            >
              Leave Campaign
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Campaign selection screen ──
  return (
    <div style={{ padding: isMobile ? 12 : 32, maxWidth: 800, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <h2 style={{ color: '#ffd700', fontSize: 24, margin: '0 0 8px' }}>Choose Your Path</h2>
        <p style={{ color: '#8b949e', fontSize: 14 }}>Select a campaign to follow its story, or venture into the open world.</p>
      </div>

      {/* Open World card */}
      <div
        onClick={startOpenWorld}
        style={{
          background: 'linear-gradient(135deg, #1a2a4e, #0f3460)',
          border: '2px solid #4a6fa5',
          borderRadius: 12, padding: isMobile ? 16 : 24, marginBottom: 16,
          cursor: 'pointer', transition: 'all 0.2s',
          touchAction: 'manipulation',
        }}
        onMouseOver={e => e.currentTarget.style.borderColor = '#7b9fd4'}
        onMouseOut={e => e.currentTarget.style.borderColor = '#4a6fa5'}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexDirection: isMobile ? 'column' : 'row' }}>
          <div style={{ fontSize: 36 }}>{'\u{1F30D}'}</div>
          <div>
            <h3 style={{ color: '#7b9fd4', margin: '0 0 4px', fontSize: 18 }}>Open World</h3>
            <p style={{ color: '#8b949e', margin: 0, fontSize: 13, lineHeight: 1.5 }}>
              Explore freely across Varisia. Visit towns, delve into dungeons, and forge your own story
              with no predetermined path. The AI DM generates encounters and narrative dynamically.
            </p>
          </div>
        </div>
      </div>

      {/* Campaign cards */}
      {campaigns.map(c => (
        <div
          key={c.id}
          onClick={() => !starting && startCampaign(c)}
          style={{
            background: 'linear-gradient(135deg, #2d1b00, #4a2800)',
            border: '2px solid #8b6914',
            borderRadius: 12, padding: isMobile ? 16 : 24, marginBottom: 16,
            cursor: starting ? 'wait' : 'pointer', transition: 'all 0.2s',
            opacity: starting ? 0.7 : 1,
            touchAction: 'manipulation',
          }}
          onMouseOver={e => { if (!starting) e.currentTarget.style.borderColor = '#ffd700'; }}
          onMouseOut={e => e.currentTarget.style.borderColor = '#8b6914'}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexDirection: isMobile ? 'column' : 'row' }}>
            <div style={{ fontSize: 36 }}>{'\u{1F4DC}'}</div>
            <div style={{ flex: 1 }}>
              <h3 style={{ color: '#ffd700', margin: '0 0 2px', fontSize: 18 }}>{c.name}</h3>
              {c.subtitle && <div style={{ color: '#b8860b', fontSize: 12, marginBottom: 8 }}>{c.subtitle}</div>}
              <p style={{ color: '#d4c5a9', margin: '0 0 8px', fontSize: 13, lineHeight: 1.5 }}>
                {c.description}
              </p>
              <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#8b949e' }}>
                <span>Levels {c.levelRange}</span>
                <span>{c.chapters?.length || 0} chapters</span>
                <span>
                  {c.chapters?.reduce((s, ch) => s + ch.parts.reduce((s2, p) => s2 + (p.encounters?.length || 0), 0), 0) || 0} encounters
                </span>
              </div>
            </div>
          </div>
        </div>
      ))}

      {campaigns.length === 0 && (
        <div style={{ textAlign: 'center', color: '#8b949e', padding: 24 }}>
          No campaigns available yet. More coming soon!
        </div>
      )}
    </div>
  );
}
