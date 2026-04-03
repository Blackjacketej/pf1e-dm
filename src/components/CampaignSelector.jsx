import React, { useState, useEffect } from 'react';
import useIsMobile from '../hooks/useIsMobile';
import db from '../db/database';
import dmEngine from '../services/dmEngine';

/**
 * CampaignSelector — simplified Campaign tab that lets users pick a
 * pre-built campaign or launch open-world (no campaign) mode.
 * Once selected, the user is sent to the Adventure tab.
 */
export default function CampaignSelector({
  campaign,
  setCampaign,
  party,
  addLog,
  onStartAdventure, // callback to switch to Adventure tab
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
    if (!party || party.length === 0) {
      addLog('Create a party first before starting a campaign!', 'danger');
      return;
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

    addLog(`=== ${campaignData.name} ===`, 'system');
    addLog(`Chapter ${firstChapter.number}: ${firstChapter.name}`, 'system');

    // AI narration for campaign start
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
    } catch (err) {
      addLog(firstChapter.synopsis, 'narration');
      addLog(firstPart.description, 'narration');
    }

    setStarting(false);
    onStartAdventure?.();
  };

  const startOpenWorld = () => {
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
