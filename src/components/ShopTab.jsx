import React, { useState, useMemo, useCallback } from 'react';
import {
  listSettlements, getSettlement, generateMerchantInventory,
  getSpellcastingServices, resolveHaggle, estimateSpecialOrder,
  getShopTypeInfo, getMagicItemTiers, resolveSettlementFromLocation,
  getTaverns, getFoodAndDrink, getLodgingPrices,
} from '../services/shopService';
import {
  generateTavernVisit, resolveEvent, gatherInformation,
  drinkingContestRound, getIntoxicationLevel, getSafeDrinkCount,
  calculateRest, gambleRound,
} from '../services/tavernService';
import advancedService from '../services/advancedService';
import gameEvents from '../services/gameEventEngine';

const TIER_COLORS = { mundane: '#8b949e', minor: '#7b68ee', medium: '#ffa500', major: '#ff4444' };
const TIER_LABELS = { mundane: '', minor: 'Minor Magic', medium: 'Medium Magic', major: 'Major Magic' };

const ITEM_CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'weapon', label: 'Weapons' },
  { key: 'armor', label: 'Armor' },
  { key: 'shield', label: 'Shields' },
  { key: 'gear', label: 'Gear' },
  { key: 'alchemical', label: 'Alchemical' },
  { key: 'potion', label: 'Potions' },
  { key: 'scroll', label: 'Scrolls' },
  { key: 'wand', label: 'Wands' },
  { key: 'rod', label: 'Rods' },
  { key: 'staff', label: 'Staves' },
  { key: 'wondrous', label: 'Wondrous' },
  { key: 'ring', label: 'Rings' },
];

const MEAL_LABELS = { poor: 'Poor Meal', common: 'Common Meal', good: 'Good Meal', banquet: 'Banquet', exotic: 'Exotic Fare' };
const ROOM_LABELS = { poor: 'Poor Room (floor)', common: 'Common Room', good: 'Good Room', suite: 'Suite' };
const QUALITY_COLORS = { squalid: '#6b4423', poor: '#8b6914', average: '#d4a574', good: '#7b68ee', extravagant: '#ffd700' };

export default function ShopTab({ party, setParty, addLog, combat, campaign, worldState, setWorldState }) {
  const [merchantId, setMerchantId] = useState(null);
  const [charId, setCharId] = useState(party[0]?.id || null);
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [view, setView] = useState('merchants'); // 'merchants' | 'shop' | 'services' | 'taverns'
  const [inventorySeed, setInventorySeed] = useState(Math.floor(Date.now() / (1000 * 60 * 60 * 24 * 7)));
  const [haggleResult, setHaggleResult] = useState(null);
  const [selectedTavern, setSelectedTavern] = useState(null);
  // Tavern activity state
  const [tavernVisit, setTavernVisit] = useState(null);
  const [tavernActivity, setTavernActivity] = useState(null); // 'patrons'|'event'|'drink'|'gather'|'gamble'|'rest'
  const [eventResult, setEventResult] = useState(null);
  const [gatherResult, setGatherResult] = useState(null);
  const [drinkingState, setDrinkingState] = useState(null); // { round, intoxication, log }
  const [gambleResult, setGambleResult] = useState(null);
  const [restResult, setRestResult] = useState(null);
  const [bargainMode, setBargainMode] = useState(false);
  const [bargainResult, setBargainResult] = useState(null);

  const char = party.find(c => c.id === charId);

  // ─── Location lock: derive settlement from campaign state ──────
  const currentLocation = useMemo(() => {
    if (!campaign?.data?.chapters) return null;
    const ch = campaign.data.chapters.find(c => c.number === campaign.currentChapter);
    if (!ch?.parts) return null;
    const part = ch.parts[campaign.currentPart];
    return part?.location || null;
  }, [campaign]);

  const derivedSettlementId = useMemo(() => {
    return resolveSettlementFromLocation(currentLocation);
  }, [currentLocation]);

  // If campaign is active, lock to current location. Otherwise require manual selection.
  const campaignActive = !!(campaign?.data && campaign.started !== false);
  const settlementId = campaignActive ? derivedSettlementId : null;
  const [browseSettlementId, setBrowseSettlementId] = useState(null);
  const activeSettlementId = campaignActive ? settlementId : browseSettlementId;

  const settlement = useMemo(() => activeSettlementId ? getSettlement(activeSettlementId) : null, [activeSettlementId]);
  const settlements = useMemo(() => listSettlements(), []);
  const taverns = useMemo(() => activeSettlementId ? getTaverns(activeSettlementId) : [], [activeSettlementId]);

  // Generate merchant inventory
  const shopData = useMemo(() => {
    if (!merchantId || !activeSettlementId) return null;
    return generateMerchantInventory(activeSettlementId, merchantId, { seed: inventorySeed });
  }, [activeSettlementId, merchantId, inventorySeed]);

  const filtered = useMemo(() => {
    if (!shopData) return [];
    return shopData.items.filter(i => {
      if (category !== 'all' && i.category !== category) return false;
      if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [shopData, category, search]);

  const services = useMemo(() => {
    if (!merchantId || !activeSettlementId) return [];
    return getSpellcastingServices(activeSettlementId, merchantId);
  }, [activeSettlementId, merchantId]);

  const handleBuy = useCallback((item) => {
    if (!char) return;
    const price = item.shopPrice || item.price;
    // Settlement item availability check via game event engine
    const txnCheck = gameEvents.onShopTransaction({ worldState, item: { ...item, price: price }, settlement: settlement || worldState?.currentSettlement });
    if (!txnCheck.allowed) {
      addLog(txnCheck.reason, 'danger');
      txnCheck.events.forEach(e => addLog(e.text, e.severity || 'warning'));
      return;
    }
    // Log any warnings (e.g., item rarity, availability roll succeeded)
    txnCheck.events.forEach(e => addLog(e.text, e.severity || 'info'));
    if ((char.gold || 0) < price) {
      addLog(`${char.name} can't afford ${item.name} (${price} gp).`, 'danger');
      return;
    }
    const merchantName = shopData?.merchant?.npc || 'the merchant';
    setParty(prev => prev.map(c => {
      if (c.id !== charId) return c;
      const inv = [...(c.inventory || [])];
      const existing = inv.find(x => x.name === item.name);
      if (existing) {
        existing.quantity = (existing.quantity || 1) + 1;
      } else {
        inv.push({ name: item.name, price: item.price, shopPrice: price, weight: item.weight, category: item.category, stat: item.stat, desc: item.desc, tier: item.tier, quantity: 1 });
      }
      return { ...c, gold: (c.gold || 0) - price, inventory: inv };
    }));
    addLog(`${char.name} bought ${item.name} from ${merchantName} for ${price} gp.`, 'loot');
  }, [char, charId, shopData, setParty, addLog, worldState, settlement]);

  const handleBuyService = useCallback((service) => {
    if (!char) return;
    if ((char.gold || 0) < service.cost) {
      addLog(`${char.name} can't afford ${service.name} (${service.cost} gp).`, 'danger');
      return;
    }
    const merchantName = shopData?.merchant?.npc || 'the priest';
    setParty(prev => prev.map(c => {
      if (c.id !== charId) return c;
      return { ...c, gold: (c.gold || 0) - service.cost };
    }));
    addLog(`${merchantName} casts ${service.name} on ${char.name} for ${service.cost} gp. ${service.description}`, 'healing');
  }, [char, charId, shopData, setParty, addLog]);

  const handleSell = useCallback((item, idx) => {
    if (!char) return;
    const sellPrice = item.sellPrice || Math.floor((item.price || 0) / 2);
    const purchaseLimit = shopData?.purchaseLimit || 99999;
    if (sellPrice > purchaseLimit) {
      addLog(`${settlement?.name || 'This settlement'} can't afford to buy ${item.name} (purchase limit: ${purchaseLimit} gp).`, 'danger');
      return;
    }
    const merchantName = shopData?.merchant?.npc || 'the merchant';
    setParty(prev => prev.map(c => {
      if (c.id !== charId) return c;
      const inv = [...(c.inventory || [])];
      if (inv[idx]?.quantity > 1) {
        inv[idx] = { ...inv[idx], quantity: inv[idx].quantity - 1 };
      } else {
        inv.splice(idx, 1);
      }
      return { ...c, gold: (c.gold || 0) + sellPrice, inventory: inv };
    }));
    addLog(`${char.name} sold ${item.name} to ${merchantName} for ${sellPrice} gp.`, 'loot');
  }, [char, charId, shopData, settlement, setParty, addLog]);

  const handleHaggle = useCallback((item) => {
    const dipVal = char?.skills?.diplomacy || 0;
    const bluffVal = char?.skills?.bluff || 0;
    const mods = settlement?.modifiers || {};
    const dipTotal = dipVal + (mods.society || 0);
    const bluffTotal = bluffVal + (mods.corruption || 0);
    const useBluff = bluffTotal > dipTotal;
    const skillMod = useBluff ? bluffVal : dipVal;
    const skillName = useBluff ? 'Bluff' : 'Diplomacy';
    const result = resolveHaggle(skillMod, item.shopPrice || item.price, mods, useBluff ? 'bluff' : 'diplomacy');
    setHaggleResult({ ...result, item, skillName });
    const bonusParts = [`d20: ${result.roll}`, `${skillName}: ${result.skillMod >= 0 ? '+' : ''}${result.skillMod}`];
    if (result.settlementBonus !== 0) bonusParts.push(`${useBluff ? 'Corruption' : 'Society'}: ${result.settlementBonus >= 0 ? '+' : ''}${result.settlementBonus}`);
    const breakdown = bonusParts.join(', ');
    if (result.success) {
      addLog(`${char.name} haggles (${skillName}): ${breakdown} = ${result.total} vs DC ${result.dc}. ${result.message} (${result.saved} gp saved)`, 'system');
    } else {
      addLog(`${char.name} haggles (${skillName}): ${breakdown} = ${result.total} vs DC ${result.dc}. ${result.message}`, 'danger');
    }
  }, [char, settlement, addLog]);

  const handleBargain = useCallback((item) => {
    if (!char || !bargainMode) return;
    const price = item.shopPrice || item.price;
    const result = advancedService.attemptBargain(char, price, 'Diplomacy', 5);
    setBargainResult({ ...result, item });
    const breakdown = `d20: ${result.roll} + Diplomacy: ${char.skills?.diplomacy || 0} = ${result.total} vs DC ${result.dc}`;
    if (result.success) {
      addLog(`${char.name} bargains: ${breakdown}. ${result.description}`, 'system');
    } else {
      addLog(`${char.name} bargains: ${breakdown}. ${result.description}`, 'danger');
    }
  }, [char, bargainMode, addLog]);

  const handleRefreshInventory = useCallback(() => {
    setInventorySeed(prev => prev + 1);
    addLog(`A new week passes... merchants restock their wares.`, 'system');
  }, [addLog]);

  // Tavern purchases
  const handleTavernBuy = useCallback((itemName, price, description) => {
    if (!char) return;
    if ((char.gold || 0) < price) {
      addLog(`${char.name} can't afford ${itemName} (${price} gp).`, 'danger');
      return;
    }
    setParty(prev => prev.map(c => {
      if (c.id !== charId) return c;
      return { ...c, gold: Math.round(((c.gold || 0) - price) * 100) / 100 };
    }));
    addLog(`${char.name} purchases ${itemName} for ${formatGold(price)}. ${description || ''}`, 'system');
  }, [char, charId, setParty, addLog]);

  const totalWeight = (char?.inventory || []).reduce((s, i) => s + (i.weight || 0) * (i.quantity || 1), 0);

  // ─── Helpers ──────────────────────────────────────────
  const formatGold = (gp) => {
    if (gp >= 1) return `${gp} gp`;
    if (gp >= 0.1) return `${Math.round(gp * 10)} sp`;
    return `${Math.round(gp * 100)} cp`;
  };

  const alignColor = (a) => {
    if (!a) return '#8b949e';
    if (a.includes('G')) return '#7fff00';
    if (a.includes('E')) return '#ff4444';
    return '#e0d6c8';
  };
  const alignLabel = (a) => {
    const map = { LG:'Lawful Good', NG:'Neutral Good', CG:'Chaotic Good', LN:'Lawful Neutral', N:'True Neutral', CN:'Chaotic Neutral', LE:'Lawful Evil', NE:'Neutral Evil', CE:'Chaotic Evil' };
    return map[a] || a;
  };
  const typeLabel = (t) => (t || '').replace(/([A-Z])/g, ' $1').trim();

  const MOD_TIPS = {
    corruption: { label: 'Corruption', color: '#a855f7', tip: 'Bluff (crimes), Stealth (crowds). Evil alignment +1' },
    crime: { label: 'Crime', color: '#ef4444', tip: 'Sense Motive (avoid bluffs), Sleight of Hand. Chaotic +1' },
    economy: { label: 'Economy', color: '#ffd700', tip: 'Craft, Perform, Profession (income). Not affected by alignment' },
    law: { label: 'Law', color: '#3b82f6', tip: 'Intimidate (compliance), Diplomacy (officials). Lawful +1' },
    lore: { label: 'Lore', color: '#8b5cf6', tip: 'Diplomacy (gather info), Knowledge (libraries). Neutral +1/axis' },
    society: { label: 'Society', color: '#22c55e', tip: 'Disguise (blend in), Diplomacy (NPC attitudes). Good +1' },
  };

  // ─── Styles ─────────────────────────────────────────
  const sty = {
    container: { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', padding: '12px' },
    topBar: { display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' },
    sel: { padding: '6px 10px', backgroundColor: '#0d1117', color: '#e0d6c8', border: '1px solid #4a3b2a', borderRadius: '4px', fontSize: '12px' },
    gold: { color: '#ffd700', fontWeight: 'bold', fontSize: '15px' },
    body: { display: 'flex', flex: 1, gap: '10px', overflow: 'hidden' },
    leftPanel: { width: '200px', minWidth: '200px', display: 'flex', flexDirection: 'column', gap: '4px', overflowY: 'auto' },
    main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    grid: { flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '6px', alignContent: 'start', padding: '2px' },
    sidebar: { width: '240px', minWidth: '240px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', padding: '10px', overflowY: 'auto', display: 'flex', flexDirection: 'column' },
    btn: (active) => ({ padding: '8px 10px', backgroundColor: active ? '#2a2a4e' : '#0d1117', border: `1px solid ${active ? '#ffd700' : '#30363d'}`, color: active ? '#ffd700' : '#8b949e', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', textAlign: 'left', fontWeight: active ? 'bold' : 'normal' }),
    card: (tier) => ({
      backgroundColor: '#1a1a2e',
      border: `1px solid ${tier === 'major' ? '#ff444466' : tier === 'medium' ? '#ffa50044' : tier === 'minor' ? '#7b68ee44' : '#4a3b2a'}`,
      borderRadius: '6px', padding: '8px', display: 'flex', flexDirection: 'column', gap: '3px',
    }),
    merchantCard: (active) => ({
      backgroundColor: active ? '#1a1a3e' : '#0d1117',
      border: `1px solid ${active ? '#ffd700' : '#30363d'}`,
      borderRadius: '6px', padding: '10px', cursor: 'pointer', marginBottom: '4px',
    }),
    tag: (color) => ({
      display: 'inline-block', padding: '1px 6px', backgroundColor: color + '22',
      border: `1px solid ${color}55`, color, borderRadius: '3px', fontSize: '9px', fontWeight: 'bold',
    }),
    searchBar: { padding: '7px 10px', backgroundColor: '#0d1117', color: '#e0d6c8', border: '1px solid #4a3b2a', borderRadius: '4px', fontSize: '12px', marginBottom: '6px' },
    statBar: { display: 'flex', gap: '12px', padding: '6px 10px', backgroundColor: '#0d111766', borderRadius: '4px', marginBottom: '8px', fontSize: '11px', flexWrap: 'wrap', alignItems: 'center' },
    buyBtn: (ok) => ({ padding: '3px 10px', backgroundColor: ok ? '#2d5016' : '#1a1a1a', border: `1px solid ${ok ? '#7fff00' : '#333'}`, color: ok ? '#7fff00' : '#555', borderRadius: '3px', cursor: ok ? 'pointer' : 'default', fontSize: '10px', fontWeight: 'bold' }),
    haggleBtn: { padding: '3px 8px', backgroundColor: '#1a1a3a', border: '1px solid #7b68ee', color: '#7b68ee', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' },
    sellBtn: { padding: '2px 6px', backgroundColor: '#2a1a1a', border: '1px solid #ff6b6b', color: '#ff6b6b', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' },
    refreshBtn: { padding: '4px 10px', backgroundColor: '#1a2a1a', border: '1px solid #4a8', color: '#4a8', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' },
    svcRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', borderBottom: '1px solid #1a1a2e' },
    tavernCard: (active) => ({
      backgroundColor: active ? '#2a1a0a' : '#0d1117',
      border: `1px solid ${active ? '#d4a574' : '#30363d'}`,
      borderRadius: '6px', padding: '10px', cursor: 'pointer', marginBottom: '4px',
    }),
    tavernBuyBtn: (ok) => ({ padding: '3px 8px', backgroundColor: ok ? '#3a2a0a' : '#1a1a1a', border: `1px solid ${ok ? '#d4a574' : '#333'}`, color: ok ? '#d4a574' : '#555', borderRadius: '3px', cursor: ok ? 'pointer' : 'default', fontSize: '10px', fontWeight: 'bold' }),
    viewTab: (active) => ({
      padding: '6px 14px', backgroundColor: active ? '#1a1a2e' : 'transparent', border: 'none',
      borderBottom: active ? '2px solid #ffd700' : '2px solid transparent',
      color: active ? '#ffd700' : '#8b949e', cursor: 'pointer', fontSize: '12px', fontWeight: active ? 600 : 400,
    }),
  };

  // ─── COMBAT BLOCK ─────────────────────────────────────
  if (combat?.active) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>&#9876;&#65039;</div>
        <div style={{ color: '#ff6b6b', fontSize: 20, fontWeight: 'bold', marginBottom: 8 }}>Shop Unavailable During Combat</div>
        <div style={{ color: '#8b949e', fontSize: 14, maxWidth: 400, margin: '0 auto' }}>
          Your party is currently engaged in combat (Round {combat.round}). Shopping, tavern services, and other town activities are unavailable until the encounter is resolved.
        </div>
        <div style={{ marginTop: 20, color: '#d4c5a9', fontSize: 12 }}>
          Return to the Combat tab to continue the fight.
        </div>
      </div>
    );
  }

  // ─── NO PARTY ─────────────────────────────────────────
  if (party.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Create a party first to visit the shop.</div>;
  }

  // ─── WILDERNESS / NO SETTLEMENT ───────────────────────
  if (campaignActive && !activeSettlementId) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>&#127956;&#65039;</div>
        <div style={{ color: '#d4a574', fontSize: 20, fontWeight: 'bold', marginBottom: 8 }}>No Settlement Nearby</div>
        <div style={{ color: '#8b949e', fontSize: 14, maxWidth: 460, margin: '0 auto' }}>
          Your party is currently at <span style={{ color: '#e0d6c8', fontWeight: 'bold' }}>{currentLocation || 'an unknown location'}</span>, which is not near a town or city. Shopping, taverns, and services are only available in settlements.
        </div>
        <div style={{ marginTop: 16, color: '#d4c5a9', fontSize: 12 }}>
          Advance the campaign to reach a settlement, or visit the Campaign tab to progress your journey.
        </div>
      </div>
    );
  }

  // ─── SETTLEMENT SELECTION (Browse Mode) ───────────────
  if (!campaignActive && !activeSettlementId) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>&#127963;&#65039;</div>
        <div style={{ color: '#ffd700', fontSize: 20, fontWeight: 'bold', marginBottom: 8 }}>Choose a Settlement</div>
        <div style={{ color: '#8b949e', fontSize: 14, maxWidth: 460, margin: '0 auto', marginBottom: 24 }}>
          Your party must travel to a settlement before you can visit shops, taverns, or purchase services. Select where the party is currently located.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'center', maxWidth: 600, margin: '0 auto' }}>
          {settlements.map(s => (
            <button key={s.id} onClick={() => setBrowseSettlementId(s.id)} style={{
              padding: '12px 20px', backgroundColor: '#1a1a2e', border: '1px solid #4a3b2a', borderRadius: '8px',
              color: '#d4c5a9', cursor: 'pointer', minWidth: '140px', textAlign: 'left',
              transition: 'all 0.15s'
            }}
              onMouseEnter={e => { e.target.style.borderColor = '#ffd700'; e.target.style.backgroundColor = '#2a2a4e'; }}
              onMouseLeave={e => { e.target.style.borderColor = '#4a3b2a'; e.target.style.backgroundColor = '#1a1a2e'; }}
            >
              <div style={{ color: '#ffd700', fontWeight: 'bold', fontSize: '14px', marginBottom: '4px' }}>{s.name}</div>
              <div style={{ color: '#8b949e', fontSize: '11px' }}>{s.type || 'Settlement'} &middot; Pop. {s.population || '?'}</div>
              {s.description && <div style={{ color: '#6b6b7b', fontSize: '10px', marginTop: '4px' }}>{s.description}</div>}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 24, color: '#8b949e', fontSize: 12 }}>
          Use the Map tab to travel between locations, or start a Campaign from the Campaign tab.
        </div>
      </div>
    );
  }

  // ─── Settlement header shared across views ────────────
  const renderSettlementHeader = () => {
    if (!settlement) return null;
    const mods = settlement.modifiers || {};
    const settlementMod = advancedService.getSettlementModifier(settlement.type || 'small_town');
    return (
      <div style={{ marginBottom: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ color: '#ffd700', fontSize: '16px', fontWeight: 'bold' }}>
              {settlement.name}
              {settlement.title && <span style={{ color: '#8b949e', fontWeight: 'normal', fontSize: '12px', marginLeft: '8px' }}>{settlement.title}</span>}
            </div>
            <div style={{ color: '#d4c5a9', fontSize: '11px', marginTop: '2px' }}>{settlement.description}</div>
            {!campaignActive && (
              <button onClick={() => { setBrowseSettlementId(null); setMerchantId(null); setView('merchants'); }} style={{
                marginTop: '4px', padding: '3px 8px', border: '1px solid #4a3b2a', borderRadius: '3px',
                backgroundColor: 'transparent', color: '#8b949e', cursor: 'pointer', fontSize: '10px'
              }}>Leave Settlement</button>
            )}
          </div>
          <div style={{ textAlign: 'right', fontSize: '11px', whiteSpace: 'nowrap' }}>
            <div style={{ color: alignColor(settlement.alignment), fontWeight: 'bold' }}>
              {alignLabel(settlement.alignment)} ({settlement.alignment})
            </div>
            <div style={{ color: '#8b949e' }}>{typeLabel(settlement.type)} &middot; Pop {settlement.population.toLocaleString()}</div>
            {settlement.danger > 0 && <div style={{ color: '#ff6b6b' }}>Danger +{settlement.danger}</div>}
          </div>
        </div>
        <div style={sty.statBar}>
          <span style={{ color: '#ffd700' }}>Base Value: {settlement.baseValue} gp</span>
          <span style={{ color: '#ffa500' }}>Purchase Limit: {settlement.purchaseLimit} gp</span>
          <span style={{ color: '#7b68ee' }}>Spellcasting: Lv {settlement.spellcasting}</span>
          <span style={{ color: '#8b949e' }}>Gov: {settlement.government}</span>
        </div>
        <div style={sty.statBar}>
          <span style={{ color: '#ffd700', fontWeight: 'bold' }}>Settlement Bargaining Limits:</span>
          <span style={{ color: '#ffa500' }}>Buy Limit: {settlementMod.buyLimit} gp</span>
          <span style={{ color: '#ffa500' }}>Sell Limit: {settlementMod.sellLimit} gp</span>
          <span style={{ color: '#7b68ee' }}>Price Modifier: {settlementMod.priceModifier >= 0 ? '+' : ''}{settlementMod.priceModifier}%</span>
          <span style={{ color: '#8b949e' }}>Availability: {settlementMod.availability}</span>
        </div>
        {Object.keys(mods).length > 0 && (
          <div style={{ display: 'flex', gap: '6px', marginBottom: '6px', flexWrap: 'wrap' }}>
            {Object.entries(MOD_TIPS).map(([key, info]) => {
              const val = mods[key];
              if (val === undefined) return null;
              return (
                <span key={key} title={info.tip} style={{
                  display: 'inline-block', padding: '2px 8px', fontSize: '10px', borderRadius: '3px', cursor: 'help',
                  backgroundColor: info.color + '15', border: `1px solid ${info.color}44`, color: info.color,
                }}>
                  {info.label} {val >= 0 ? '+' : ''}{val}
                </span>
              );
            })}
          </div>
        )}
        {(settlement.qualities || []).length > 0 && (
          <div style={{ display: 'flex', gap: '6px', marginBottom: '6px', flexWrap: 'wrap' }}>
            {settlement.qualities.map(q => (
              <span key={q} style={sty.tag('#4a8')}>{q}</span>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ─── Merchant list view ──────────────────────────────
  const renderMerchantList = () => {
    if (!settlement) return null;
    return (
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {renderSettlementHeader()}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '8px' }}>
          {(settlement.merchants || []).map(m => {
            const shopInfo = getShopTypeInfo(m.shopType);
            return (
              <div key={m.id} style={sty.merchantCard(false)} onClick={() => { setMerchantId(m.id); setView('shop'); setCategory('all'); setSearch(''); }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#ffd700', fontWeight: 'bold', fontSize: '13px' }}>
                    {shopInfo?.icon || ''} {m.name}
                  </span>
                </div>
                <div style={{ color: '#7b68ee', fontSize: '11px', marginTop: '2px' }}>{shopInfo?.name || m.shopType}</div>
                <div style={{ color: '#8b949e', fontSize: '11px', marginTop: '4px' }}>{m.description}</div>
                <div style={{ color: '#d4c5a9', fontSize: '11px', marginTop: '4px' }}>
                  Proprietor: <span style={{ color: '#e0d6c8' }}>{m.npc}</span>
                </div>
                {m.specialties && (
                  <div style={{ display: 'flex', gap: '4px', marginTop: '4px', flexWrap: 'wrap' }}>
                    {m.specialties.map(s => <span key={s} style={sty.tag('#7b68ee')}>{s}</span>)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {(settlement.merchants || []).length === 0 && (
          <div style={{ padding: '30px', textAlign: 'center', color: '#555' }}>
            No merchants available in this location.
          </div>
        )}
      </div>
    );
  };

  // ─── Shop view ───────────────────────────────────────
  const renderShopView = () => {
    if (!shopData) return null;
    const { merchant, baseValue, purchaseLimit, maxShopValue, magicItemCounts } = shopData;
    const shopInfo = getShopTypeInfo(merchant.shopType);

    return (
      <>
        <div style={{ marginBottom: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <button style={{ background: 'none', border: 'none', color: '#7b68ee', cursor: 'pointer', fontSize: '11px', padding: 0 }}
                onClick={() => { setView('merchants'); setMerchantId(null); }}>
                &larr; Back to {settlement.name}
              </button>
              <div style={{ color: '#ffd700', fontWeight: 'bold', fontSize: '15px', marginTop: '2px' }}>
                {shopInfo?.icon || ''} {merchant.name}
              </div>
              <div style={{ color: '#8b949e', fontSize: '11px' }}>
                {merchant.npc} &mdash; &quot;{merchant.personality}&quot;
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <button style={{ ...sty.refreshBtn, borderColor: bargainMode ? '#7fff00' : '#4a8', color: bargainMode ? '#7fff00' : '#4a8' }}
                onClick={() => setBargainMode(!bargainMode)}>
                {bargainMode ? 'Haggling Enabled' : 'Enable Haggling'}
              </button>
              <button style={{ ...sty.refreshBtn, marginLeft: '6px' }} onClick={handleRefreshInventory}>Restock (New Week)</button>
              {services.length > 0 && (
                <button style={{ ...sty.refreshBtn, marginLeft: '6px', borderColor: '#7b68ee', color: '#7b68ee' }}
                  onClick={() => setView('services')}>
                  Spellcasting Services
                </button>
              )}
            </div>
          </div>
          <div style={sty.statBar}>
            <span style={{ color: '#ffd700' }}>Base: {baseValue} gp</span>
            <span style={{ color: '#ffa500' }}>Max Item: {maxShopValue} gp</span>
            <span style={{ color: '#8b949e' }}>Buy Limit: {purchaseLimit} gp</span>
            <span style={{ color: '#7b68ee' }}>Magic: {magicItemCounts.minor}m {magicItemCounts.medium}M {magicItemCounts.major}L</span>
            <span style={{ color: '#8b949e' }}>{filtered.length} items shown</span>
          </div>
        </div>

        <div style={sty.body}>
          <div style={sty.leftPanel}>
            {ITEM_CATEGORIES.map(c => (
              <button key={c.key} style={sty.btn(category === c.key)} onClick={() => { setCategory(c.key); setSearch(''); }}>
                {c.label}
              </button>
            ))}
          </div>

          <div style={sty.main}>
            <input style={sty.searchBar} placeholder="Search items..." value={search} onChange={e => setSearch(e.target.value)} />
            <div style={sty.grid}>
              {filtered.map((item, idx) => {
                const price = item.shopPrice || item.price;
                const canAfford = (char?.gold || 0) >= price;
                return (
                  <div key={`${item.name}-${idx}`} style={sty.card(item.tier)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <span style={{ color: TIER_COLORS[item.tier] || '#e0d6c8', fontWeight: 'bold', fontSize: '12px', flex: 1 }}>{item.name}</span>
                      {item.tier !== 'mundane' && <span style={sty.tag(TIER_COLORS[item.tier])}>{TIER_LABELS[item.tier]}</span>}
                    </div>
                    {item.stat && <div style={{ color: '#7b68ee', fontSize: '10px' }}>{item.stat}</div>}
                    <div style={{ color: '#8b949e', fontSize: '10px', flex: 1, maxHeight: '40px', overflow: 'hidden' }}>
                      {(item.desc || '').slice(0, 120)}{item.desc?.length > 120 ? '...' : ''}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '3px' }}>
                      <div>
                        <span style={{ color: '#ffd700', fontSize: '11px', fontWeight: 'bold' }}>{price} gp</span>
                        {item.weight > 0 && <span style={{ color: '#8b949e', fontSize: '9px', marginLeft: '6px' }}>{item.weight} lbs</span>}
                      </div>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {bargainMode && price > 50 && <button style={sty.haggleBtn} onClick={() => handleBargain(item)} title="Attempt to bargain">Bargain</button>}
                        {!bargainMode && price > 50 && <button style={sty.haggleBtn} onClick={() => handleHaggle(item)} title="Attempt to haggle">Haggle</button>}
                        <button style={sty.buyBtn(canAfford)} onClick={() => handleBuy(item)} disabled={!canAfford}>Buy</button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <div style={{ gridColumn: '1 / -1', padding: '30px', textAlign: 'center', color: '#555' }}>
                  No items match your search in this shop.
                </div>
              )}
            </div>
          </div>

          <div style={sty.sidebar}>
            <div style={{ color: '#ffd700', fontWeight: 'bold', fontSize: '13px', marginBottom: '6px' }}>
              {char?.name}'s Inventory
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '11px' }}>
              <span style={{ color: '#ffd700' }}>{char?.gold || 0} gp</span>
              <span style={{ color: '#8b949e' }}>{totalWeight.toFixed(1)} lbs</span>
            </div>
            {bargainResult && (
              <div style={{ padding: '6px', marginBottom: '6px', borderRadius: '4px', fontSize: '11px',
                backgroundColor: bargainResult.success ? '#1a2a1a' : '#2a1a1a',
                border: `1px solid ${bargainResult.success ? '#4a8' : '#a44'}`,
                color: bargainResult.success ? '#7fff00' : '#ff6b6b' }}>
                <div style={{ fontWeight: 'bold' }}>{bargainResult.success ? 'Bargain Success!' : 'Bargain Failed'}</div>
                <div style={{ fontSize: '10px', marginTop: '3px' }}>
                  d20: {bargainResult.roll} + Diplomacy: {char?.skills?.diplomacy || 0} = {bargainResult.total} vs DC {bargainResult.dc}
                </div>
                <div style={{ fontSize: '10px', marginTop: '2px' }}>
                  Discount: {bargainResult.discount} • Saved: {bargainResult.savings} gp
                </div>
                {bargainResult.success && (
                  <div style={{ marginTop: '4px' }}>
                    Buy {bargainResult.item.name} for {bargainResult.newPrice} gp
                    <button style={{ ...sty.buyBtn((char?.gold || 0) >= bargainResult.newPrice), marginLeft: '6px', marginTop: '2px' }}
                      onClick={() => {
                        handleBuy({ ...bargainResult.item, shopPrice: bargainResult.newPrice });
                        setBargainResult(null);
                      }}
                      disabled={(char?.gold || 0) < bargainResult.newPrice}>
                      Buy at Discount
                    </button>
                  </div>
                )}
                <button style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '10px', marginTop: '4px', paddingLeft: 0 }}
                  onClick={() => setBargainResult(null)}>dismiss</button>
              </div>
            )}
            {haggleResult && (
              <div style={{ padding: '6px', marginBottom: '6px', borderRadius: '4px', fontSize: '11px',
                backgroundColor: haggleResult.success ? '#1a2a1a' : '#2a1a1a',
                border: `1px solid ${haggleResult.success ? '#4a8' : '#a44'}`,
                color: haggleResult.success ? '#7fff00' : '#ff6b6b' }}>
                <div style={{ fontWeight: 'bold' }}>{haggleResult.success ? 'Haggle Success!' : 'Haggle Failed'} ({haggleResult.skillName || 'Diplomacy'})</div>
                <div>
                  d20: {haggleResult.roll} + {haggleResult.skillName || 'Skill'}: {haggleResult.skillMod || 0}
                  {haggleResult.settlementBonus !== 0 && <span> + {haggleResult.settlementBonus >= 0 ? '+' : ''}{haggleResult.settlementBonus} settlement</span>}
                  {' '}= {haggleResult.total} vs DC {haggleResult.dc}
                </div>
                {haggleResult.success && (
                  <div>
                    Buy {haggleResult.item.name} for {haggleResult.finalPrice} gp
                    <button style={{ ...sty.buyBtn((char?.gold || 0) >= haggleResult.finalPrice), marginLeft: '6px' }}
                      onClick={() => {
                        handleBuy({ ...haggleResult.item, shopPrice: haggleResult.finalPrice });
                        setHaggleResult(null);
                      }}
                      disabled={(char?.gold || 0) < haggleResult.finalPrice}>
                      Buy at Discount
                    </button>
                  </div>
                )}
                <button style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '10px', marginTop: '2px' }}
                  onClick={() => setHaggleResult(null)}>dismiss</button>
              </div>
            )}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {(char?.inventory || []).length === 0 ? (
                <div style={{ color: '#555', fontSize: '11px', textAlign: 'center', padding: '16px' }}>Empty</div>
              ) : (
                (char?.inventory || []).map((item, idx) => (
                  <div key={`${item.name}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px', borderBottom: '1px solid #1a1a2e', fontSize: '11px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ color: '#d4c5a9' }}>{item.name}</span>
                      {item.quantity > 1 && <span style={{ color: '#7b68ee', marginLeft: '3px' }}>x{item.quantity}</span>}
                    </div>
                    <button style={sty.sellBtn} onClick={() => handleSell(item, idx)}
                      title={`Sell for ${Math.floor((item.price || 0) / 2)} gp`}>
                      Sell
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </>
    );
  };

  // ─── Services view ───────────────────────────────────
  const renderServicesView = () => {
    const merchant = (settlement?.merchants || []).find(m => m.id === merchantId);
    return (
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <button style={{ background: 'none', border: 'none', color: '#7b68ee', cursor: 'pointer', fontSize: '11px', padding: 0, marginBottom: '8px' }}
          onClick={() => setView('shop')}>
          &larr; Back to {merchant?.name || 'shop'}
        </button>
        <div style={{ color: '#ffd700', fontWeight: 'bold', fontSize: '15px', marginBottom: '8px' }}>
          Spellcasting Services — {merchant?.npc}
        </div>
        <div style={{ color: '#8b949e', fontSize: '11px', marginBottom: '12px' }}>
          Spells available up to level {settlement?.spellcasting || 0}. Cost = caster level x spell level x 10 gp, plus material components.
        </div>
        {services.map((svc, idx) => (
          <div key={idx} style={sty.svcRow}>
            <div>
              <span style={{ color: '#e0d6c8', fontWeight: 'bold', fontSize: '12px' }}>{svc.name}</span>
              <span style={{ color: '#7b68ee', fontSize: '10px', marginLeft: '6px' }}>Lv {svc.level}</span>
              <div style={{ color: '#8b949e', fontSize: '10px' }}>{svc.description}</div>
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span style={{ color: '#ffd700', fontSize: '12px', fontWeight: 'bold' }}>{svc.cost} gp</span>
              <button style={sty.buyBtn((char?.gold || 0) >= svc.cost)}
                onClick={() => handleBuyService(svc)}
                disabled={(char?.gold || 0) < svc.cost}>
                Purchase
              </button>
            </div>
          </div>
        ))}
        {services.length === 0 && (
          <div style={{ padding: '20px', textAlign: 'center', color: '#555' }}>No spellcasting services available here.</div>
        )}
      </div>
    );
  };

  // ─── Tavern action handlers ─────────────────────────────
  const handleEnterTavern = useCallback((tavId) => {
    const tav = taverns.find(t => t.id === tavId);
    if (!tav) return;
    const visit = generateTavernVisit(tav, activeSettlementId, settlement, inventorySeed);
    setSelectedTavern(tavId);
    setTavernVisit(visit);
    setTavernActivity(null);
    setEventResult(null);
    setGatherResult(null);
    setDrinkingState(null);
    setGambleResult(null);
    setRestResult(null);
    if (visit.hasEvent) {
      addLog(`As you enter ${tav.name}, something catches your attention...`, 'narration');
    }
    addLog(`${char?.name || 'The party'} enters ${tav.name}. ${visit.patronCount} patrons are here tonight.`, 'system');
  }, [taverns, activeSettlementId, settlement, inventorySeed, char, addLog]);

  const handleResolveEvent = useCallback(() => {
    if (!tavernVisit?.event || !char) return;
    const result = resolveEvent(tavernVisit.event, char);
    setEventResult(result);
    if (result.passive) {
      addLog(`[${tavernVisit.event.name}] ${result.message}`, 'narration');
    } else if (result.success) {
      addLog(`[${tavernVisit.event.name}] ${result.skillUsed} check: d20 ${result.roll} + ${result.modifier} = ${result.total} vs DC ${result.dc} — Success! ${result.message}`, 'success');
    } else {
      addLog(`[${tavernVisit.event.name}] ${result.skillUsed} check: d20 ${result.roll} + ${result.modifier} = ${result.total} vs DC ${result.dc} — Failed. ${result.message}`, 'danger');
      if (result.lossRange) {
        const loss = result.lossRange[0] + Math.floor(Math.random() * (result.lossRange[1] - result.lossRange[0] + 1));
        setParty(prev => prev.map(c => c.id !== charId ? c : { ...c, gold: Math.max(0, (c.gold || 0) - loss) }));
        addLog(`${char.name} loses ${loss} gp!`, 'danger');
      }
    }
  }, [tavernVisit, char, charId, setParty, addLog]);

  const handleGatherInfo = useCallback((options = {}) => {
    if (!char || !selectedTavern) return;
    const tav = taverns.find(t => t.id === selectedTavern);
    if (!tav) return;
    const chapter = campaign?.currentChapter || 1;
    const cost = options.buyDrinks ? 5 : options.barmaidTip ? 0.5 : 0;
    if ((char.gold || 0) < cost) {
      addLog(`${char.name} can't afford the cost (${formatGold(cost)}).`, 'danger');
      return;
    }
    if (cost > 0) {
      setParty(prev => prev.map(c => c.id !== charId ? c : { ...c, gold: Math.round(((c.gold || 0) - cost) * 100) / 100 }));
    }
    const result = gatherInformation(char, tav, activeSettlementId, chapter, settlement?.modifiers || {}, options);
    setGatherResult(result);
    addLog(result.message, result.rumorsFound.length > 0 ? 'system' : 'danger');
    result.rumorsFound.forEach(r => addLog(`Rumor: "${r.rumor}"`, 'narration'));
  }, [char, charId, selectedTavern, taverns, campaign, activeSettlementId, settlement, setParty, addLog, formatGold]);

  const handleDrinkRound = useCallback((drinkType) => {
    if (!char) return;
    const state = drinkingState || { round: 0, intoxication: 0, log: [] };
    const newRound = state.round + 1;
    const result = drinkingContestRound(char, newRound, drinkType);
    const newIntox = state.intoxication + result.intoxicationPoints;
    const level = getIntoxicationLevel(newIntox);
    const newLog = [...state.log, result.message];
    setDrinkingState({ round: newRound, intoxication: newIntox, log: newLog, level });
    addLog(result.message, result.success ? 'system' : 'danger');
    if (level.level === 'unconscious') {
      addLog(`${char.name} passes out!`, 'danger');
    }
  }, [char, drinkingState, addLog]);

  const handleGamble = useCallback((stake) => {
    if (!char || (char.gold || 0) < stake) {
      addLog(`${char?.name || 'You'} can't afford to wager ${stake} gp.`, 'danger');
      return;
    }
    const method = (char.skills?.profession_gambler || 0) > (char.skills?.bluff || 0) ? 'profession_gambler' : 'bluff';
    const result = gambleRound(char, stake, method);
    setGambleResult(result);
    setParty(prev => prev.map(c => c.id !== charId ? c : { ...c, gold: Math.max(0, Math.round(((c.gold || 0) + result.netGold) * 100) / 100) }));
    addLog(`[Gambling] ${result.message} (${result.method}: d20 ${result.roll} + ${result.modifier} = ${result.total} vs ${result.oppRoll}). ${result.netGold >= 0 ? `Won ${result.netGold} gp` : `Lost ${Math.abs(result.netGold)} gp`}.`, result.success ? 'loot' : 'danger');
  }, [char, charId, setParty, addLog]);

  const handleRest = useCallback((roomQuality, price, tavernName) => {
    if (!char || (char.gold || 0) < price) {
      addLog(`${char?.name || 'You'} can't afford the room (${formatGold(price)}).`, 'danger');
      return;
    }
    setParty(prev => prev.map(c => {
      if (c.id !== charId) return c;
      const result = calculateRest(c, roomQuality);
      const newHP = Math.min(c.maxHP || c.currentHP, (c.currentHP || 0) + result.healing);
      addLog(`${c.name} rests at ${tavernName} (${ROOM_LABELS[roomQuality] || roomQuality}). Heals ${result.healing} HP.${result.fatigued ? ' Poorly rested — fatigued next day.' : ''}${result.moraleBonus ? ` +${result.moraleBonus} morale bonus for ${result.moraleDuration}.` : ''}`, result.fatigued ? 'danger' : 'healing');
      setRestResult(result);
      return { ...c, gold: Math.round(((c.gold || 0) - price) * 100) / 100, currentHP: newHP };
    }));

    // ── Game Event Engine: rest cascades (spell recovery, ability damage, sanity, time) ──
    const restEffects = gameEvents.onRest({
      worldState, party, restType: roomQuality === 'common' || roomQuality === 'poor' ? 'long' : 'long',
      terrain: 'urban',
    });
    if (Object.keys(restEffects.worldUpdates).length > 0) {
      setWorldState?.(prev => gameEvents.applyWorldUpdates(prev, restEffects.worldUpdates));
    }
    restEffects.events.forEach(e => addLog?.(`[Inn] ${e.text}`, e.severity === 'danger' ? 'danger' : e.severity === 'heal' ? 'heal' : 'info'));
    // Apply spell slot / ability damage / sanity recovery from engine
    if (restEffects.partyUpdates?.length > 0) {
      setParty(prev => prev.map(c => {
        const update = restEffects.partyUpdates.find(u => u.id === c.id);
        if (!update) return c;
        const patched = { ...c };
        if (update.spellSlotsUsed !== undefined) {
          patched.spellSlotsUsed = update.spellSlotsUsed;
          addLog?.(`[Inn] ${c.name}: Spell slots recovered`, 'heal');
        }
        if (update.abilityDamage !== undefined) {
          patched.abilityDamage = update.abilityDamage;
        }
        if (update.sanity !== undefined) {
          patched.sanity = update.sanity;
        }
        return patched;
      }));
    }
  }, [char, charId, setParty, addLog, formatGold, worldState, party, setWorldState]);

  // ─── Taverns & Inns view ──────────────────────────────
  const renderTavernsView = () => {
    if (!settlement) return null;

    if (taverns.length === 0) {
      return (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {renderSettlementHeader()}
          <div style={{ padding: '30px', textAlign: 'center', color: '#555' }}>
            No detailed tavern or inn information available for {settlement.name}.
          </div>
        </div>
      );
    }

    // ─── Tavern detail view ──────────────────
    if (selectedTavern && tavernVisit) {
      const tav = tavernVisit.tavern;
      const qColor = QUALITY_COLORS[tav.quality] || '#d4a574';
      const actBtn = (label, key, icon) => (
        <button key={key} onClick={() => { setTavernActivity(tavernActivity === key ? null : key); }}
          style={{ padding: '6px 10px', backgroundColor: tavernActivity === key ? '#2a1a0a' : '#0d1117', border: `1px solid ${tavernActivity === key ? qColor : '#30363d'}`, color: tavernActivity === key ? qColor : '#8b949e', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>
          {icon} {label}
        </button>
      );

      return (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <button style={{ background: 'none', border: 'none', color: '#d4a574', cursor: 'pointer', fontSize: '11px', padding: 0, marginBottom: '8px' }}
            onClick={() => { setSelectedTavern(null); setTavernVisit(null); setTavernActivity(null); }}>
            &larr; Back to Taverns & Inns
          </button>

          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
            <div>
              <div style={{ color: qColor, fontWeight: 'bold', fontSize: '16px' }}>
                {tav.type === 'inn' ? '\uD83C\uDFE8' : '\uD83C\uDF7A'} {tav.name}
              </div>
              <div style={{ color: '#8b949e', fontSize: '11px', marginTop: '2px' }}>
                <span style={sty.tag(qColor)}>{(tav.quality || 'average').charAt(0).toUpperCase() + (tav.quality || 'average').slice(1)}</span>
                {' '}{tav.type === 'inn' ? 'Inn & Tavern' : 'Tavern'} &mdash; <span style={{ color: '#e0d6c8' }}>{tav.proprietor}</span>
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: '10px' }}>
              <div style={{ color: '#d4c5a9' }}>{tavernVisit.patronCount} patrons</div>
              {tavernVisit.hasRooms && <div style={{ color: '#4a8' }}>Rooms available</div>}
              {tav.gatherInfoDC && <div style={{ color: '#8b5cf6' }}>Gather Info DC {tav.gatherInfoDC}</div>}
            </div>
          </div>

          <div style={{ color: '#d4c5a9', fontSize: '11px', marginBottom: '4px' }}>{tav.description}</div>
          <div style={{ color: '#8b949e', fontSize: '10px', fontStyle: 'italic', marginBottom: '8px' }}>{tav.atmosphere}</div>

          {tav.specialFeature && (
            <div style={{ padding: '6px', marginBottom: '8px', borderRadius: '4px', backgroundColor: '#1a2a1a', border: '1px solid #4a8', fontSize: '10px', color: '#7fff00' }}>
              <span style={{ fontWeight: 'bold' }}>Special:</span> {tav.specialFeature}
            </div>
          )}

          {/* Tavern event alert */}
          {tavernVisit.hasEvent && !eventResult && (
            <div style={{ padding: '8px', marginBottom: '8px', borderRadius: '4px', backgroundColor: '#2a1a0a', border: '1px solid #d4a574', fontSize: '11px' }}>
              <div style={{ color: '#ffd700', fontWeight: 'bold', marginBottom: '4px' }}>{tavernVisit.event.name}</div>
              <div style={{ color: '#d4c5a9' }}>{tavernVisit.event.description}</div>
              {tavernVisit.event.mechanic !== 'passive' ? (
                <button style={{ ...sty.tavernBuyBtn(true), marginTop: '6px' }} onClick={handleResolveEvent}>
                  Respond ({tavernVisit.event.mechanic.replace(/_/g, ' ')} DC {tavernVisit.event.dc})
                </button>
              ) : (
                <button style={{ ...sty.tavernBuyBtn(true), marginTop: '6px' }} onClick={handleResolveEvent}>Observe</button>
              )}
            </div>
          )}
          {eventResult && (
            <div style={{ padding: '6px', marginBottom: '8px', borderRadius: '4px', fontSize: '10px',
              backgroundColor: eventResult.success ? '#1a2a1a' : '#2a1a1a', border: `1px solid ${eventResult.success ? '#4a8' : '#a44'}`,
              color: eventResult.success ? '#7fff00' : '#ff6b6b' }}>
              <span style={{ fontWeight: 'bold' }}>{eventResult.eventName}: </span>
              {!eventResult.passive && <span>({eventResult.skillUsed}: d20 {eventResult.roll} + {eventResult.modifier} = {eventResult.total} vs DC {eventResult.dc}) </span>}
              {eventResult.message}
            </div>
          )}

          {/* Activity buttons */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
            {actBtn('Food & Drink', 'food', '\uD83C\uDF7A')}
            {actBtn(`Patrons (${tavernVisit.patronCount})`, 'patrons', '\uD83D\uDC65')}
            {tav.rumors && actBtn('Gather Info', 'gather', '\uD83D\uDD0D')}
            {actBtn('Drinking Contest', 'drink', '\uD83C\uDF7B')}
            {actBtn('Gambling', 'gamble', '\uD83C\uDFB2')}
            {tavernVisit.hasRooms && actBtn('Rest & Lodging', 'rest', '\uD83D\uDECF\uFE0F')}
          </div>

          {/* ── Food & Drink panel ─────── */}
          {tavernActivity === 'food' && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ color: '#d4a574', fontWeight: 'bold', fontSize: '13px', marginBottom: '6px' }}>Food & Drink</div>
              {tav.meals && Object.entries(tav.meals).map(([quality, price]) => {
                const label = MEAL_LABELS[quality] || quality;
                const canAfford = (char?.gold || 0) >= price;
                return (
                  <div key={quality} style={sty.svcRow}>
                    <span style={{ color: '#e0d6c8', fontSize: '12px' }}>{label}</span>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <span style={{ color: '#ffd700', fontSize: '11px' }}>{formatGold(price)}</span>
                      <button style={sty.tavernBuyBtn(canAfford)} onClick={() => handleTavernBuy(label, price, '')} disabled={!canAfford}>Order</button>
                    </div>
                  </div>
                );
              })}
              {tav.drinks && Object.entries(tav.drinks).map(([key, val]) => {
                const isSpecialty = typeof val === 'object';
                const name = isSpecialty ? val.name : key.charAt(0).toUpperCase() + key.slice(1);
                const price = isSpecialty ? val.price : val;
                const canAfford = (char?.gold || 0) >= price;
                return (
                  <div key={key} style={sty.svcRow}>
                    <span style={{ color: '#e0d6c8', fontSize: '12px' }}>{name}</span>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <span style={{ color: '#ffd700', fontSize: '11px' }}>{formatGold(price)}</span>
                      <button style={sty.tavernBuyBtn(canAfford)} onClick={() => handleTavernBuy(name, price, '')} disabled={!canAfford}>Order</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Patrons panel ─────── */}
          {tavernActivity === 'patrons' && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ color: '#d4a574', fontWeight: 'bold', fontSize: '13px', marginBottom: '6px' }}>Patrons ({tavernVisit.patronCount})</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '4px' }}>
                {tavernVisit.patrons.map(p => (
                  <div key={p.id} style={{ padding: '6px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '4px', fontSize: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#e0d6c8', fontWeight: 'bold' }}>{p.typeDef?.icon || ''} {p.typeDef?.label || p.type}</span>
                      <span style={{ color: '#8b949e' }}>{p.race} {p.gender === 'Female' ? '\u2640' : '\u2642'}</span>
                    </div>
                    <div style={{ color: '#8b949e', marginTop: '2px' }}>Appearance: {p.appearance}</div>
                    <div style={{ color: '#8b5cf6', marginTop: '1px' }}>Mood: {p.mood}</div>
                    <div style={{ color: '#d4c5a9', marginTop: '1px' }}>Knows about: {p.knowledgeTopic}</div>
                  </div>
                ))}
              </div>
              {tavernVisit.staff && (
                <div style={{ marginTop: '8px' }}>
                  <div style={{ color: '#d4a574', fontWeight: 'bold', fontSize: '12px', marginBottom: '4px' }}>Staff</div>
                  {tavernVisit.staff.map((s, i) => (
                    <div key={i} style={{ fontSize: '10px', color: '#d4c5a9', padding: '2px 0' }}>
                      <span style={{ color: '#e0d6c8', fontWeight: 'bold' }}>{s.role}</span>
                      {s.isOwner && <span style={{ color: '#ffd700', marginLeft: '4px' }}>(Owner)</span>}
                      {' '}&mdash; {s.description}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Gather Information panel ─────── */}
          {tavernActivity === 'gather' && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ color: '#8b5cf6', fontWeight: 'bold', fontSize: '13px', marginBottom: '6px' }}>Gather Information</div>
              <div style={{ color: '#8b949e', fontSize: '10px', marginBottom: '8px' }}>
                Spend time asking around. Diplomacy check modified by settlement Lore ({settlement?.modifiers?.lore >= 0 ? '+' : ''}{settlement?.modifiers?.lore || 0}).
                {char?.skills?.diplomacy ? ` ${char.name}'s Diplomacy: +${char.skills.diplomacy}` : ''}
              </div>
              <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
                <button style={sty.tavernBuyBtn(true)} onClick={() => handleGatherInfo({})}>Ask Around (free)</button>
                <button style={sty.tavernBuyBtn((char?.gold || 0) >= 0.5)} onClick={() => handleGatherInfo({ barmaidTip: true })}>
                  Tip the Barmaid (5 sp, +2)
                </button>
                <button style={sty.tavernBuyBtn((char?.gold || 0) >= 5)} onClick={() => handleGatherInfo({ buyDrinks: true })}>
                  Buy a Round (5 gp, +2)
                </button>
              </div>
              {gatherResult && (
                <div style={{ padding: '8px', borderRadius: '4px', backgroundColor: '#1a1a2e', border: '1px solid #8b5cf6' }}>
                  <div style={{ color: '#8b5cf6', fontSize: '11px', marginBottom: '6px' }}>
                    Diplomacy: d20 {gatherResult.roll} + {gatherResult.modifier} = {gatherResult.total}
                    {gatherResult.cost > 0 && <span style={{ color: '#ffd700' }}> (spent {formatGold(gatherResult.cost)})</span>}
                  </div>
                  {gatherResult.rumorsFound.length > 0 ? (
                    gatherResult.rumorsFound.map((r, i) => (
                      <div key={i} style={{ padding: '4px 8px', marginBottom: '4px', borderRadius: '3px', backgroundColor: '#0d1117', fontSize: '11px', color: '#d4c5a9', borderLeft: `3px solid ${r.true ? '#7fff00' : '#ff6b6b'}` }}>
                        &quot;{r.rumor}&quot;
                        <div style={{ color: '#555', fontSize: '9px', marginTop: '2px' }}>DC {r.dc} {r.true ? '(reliable)' : '(unverified)'}</div>
                      </div>
                    ))
                  ) : (
                    <div style={{ color: '#555', fontSize: '11px' }}>No useful information gathered this time.</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Drinking Contest panel ─────── */}
          {tavernActivity === 'drink' && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ color: '#ffa500', fontWeight: 'bold', fontSize: '13px', marginBottom: '6px' }}>Drinking Contest</div>
              <div style={{ color: '#8b949e', fontSize: '10px', marginBottom: '6px' }}>
                Fort save each round with increasing DC. Safe drinks: {char ? getSafeDrinkCount(char) : '?'}.
                {char?.saves?.fort != null && ` Fort save: +${char.saves.fort}`}
              </div>
              {drinkingState?.level?.level === 'unconscious' ? (
                <div style={{ padding: '8px', backgroundColor: '#2a1a1a', border: '1px solid #ff4444', borderRadius: '4px', color: '#ff4444', fontSize: '11px' }}>
                  {char?.name || 'You'} has passed out! Contest over.
                  <button style={{ ...sty.tavernBuyBtn(true), marginTop: '6px' }} onClick={() => setDrinkingState(null)}>Sober Up</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '6px', marginBottom: '6px', flexWrap: 'wrap' }}>
                  <button style={sty.tavernBuyBtn(true)} onClick={() => handleDrinkRound('ale')}>Ale (DC {12 + (drinkingState?.round || 0) * 2})</button>
                  <button style={sty.tavernBuyBtn(true)} onClick={() => handleDrinkRound('spirits')}>Spirits (DC {16 + (drinkingState?.round || 0) * 2})</button>
                  <button style={sty.tavernBuyBtn(true)} onClick={() => handleDrinkRound('dwarvenStout')}>Dwarven Stout (DC {18 + (drinkingState?.round || 0) * 2})</button>
                  {drinkingState && <button style={{ ...sty.sellBtn, padding: '4px 8px' }} onClick={() => setDrinkingState(null)}>Quit</button>}
                </div>
              )}
              {drinkingState && (
                <div style={{ padding: '6px', borderRadius: '4px', backgroundColor: '#0d1117', border: '1px solid #30363d' }}>
                  <div style={{ display: 'flex', gap: '10px', marginBottom: '4px', fontSize: '11px' }}>
                    <span style={{ color: '#d4c5a9' }}>Round: {drinkingState.round}</span>
                    <span style={{ color: drinkingState.level?.color || '#7fff00' }}>
                      Status: {drinkingState.level?.level || 'Sober'} ({drinkingState.intoxication} pts)
                    </span>
                  </div>
                  {drinkingState.level?.effects && (
                    <div style={{ color: drinkingState.level.color, fontSize: '10px', marginBottom: '4px' }}>{drinkingState.level.effects}</div>
                  )}
                  <div style={{ maxHeight: '100px', overflowY: 'auto', fontSize: '10px' }}>
                    {drinkingState.log.map((msg, i) => (
                      <div key={i} style={{ color: '#8b949e', padding: '1px 0' }}>{msg}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Gambling panel ─────── */}
          {tavernActivity === 'gamble' && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ color: '#ffd700', fontWeight: 'bold', fontSize: '13px', marginBottom: '6px' }}>Gambling</div>
              <div style={{ color: '#8b949e', fontSize: '10px', marginBottom: '6px' }}>
                Bluff or Profession (Gambler) vs opponents. Higher margin = bigger payout.
                {char?.skills?.bluff ? ` Bluff: +${char.skills.bluff}` : ''}
              </div>
              <div style={{ display: 'flex', gap: '6px', marginBottom: '6px', flexWrap: 'wrap' }}>
                {[1, 5, 10, 25, 50].map(s => (
                  <button key={s} style={sty.tavernBuyBtn((char?.gold || 0) >= s)} onClick={() => handleGamble(s)} disabled={(char?.gold || 0) < s}>
                    Wager {s} gp
                  </button>
                ))}
              </div>
              {gambleResult && (
                <div style={{ padding: '6px', borderRadius: '4px', fontSize: '11px',
                  backgroundColor: gambleResult.success ? '#1a2a1a' : '#2a1a1a',
                  border: `1px solid ${gambleResult.success ? '#4a8' : '#a44'}`,
                  color: gambleResult.success ? '#7fff00' : '#ff6b6b' }}>
                  <div style={{ fontWeight: 'bold' }}>{gambleResult.message}</div>
                  <div style={{ fontSize: '10px', color: '#8b949e', marginTop: '2px' }}>
                    {gambleResult.method}: d20 {gambleResult.roll} + {gambleResult.modifier} = {gambleResult.total} vs {gambleResult.oppRoll}.
                    {' '}{gambleResult.netGold >= 0 ? `Won ${gambleResult.netGold} gp` : `Lost ${Math.abs(gambleResult.netGold)} gp`}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Rest & Lodging panel ─────── */}
          {tavernActivity === 'rest' && tavernVisit.rooms && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ color: '#4a8', fontWeight: 'bold', fontSize: '13px', marginBottom: '6px' }}>Rest & Lodging</div>
              <div style={{ color: '#8b949e', fontSize: '10px', marginBottom: '6px' }}>
                Room quality affects overnight healing. {char?.name}: {char?.currentHP}/{char?.maxHP} HP.
              </div>
              {Object.entries(tavernVisit.rooms).map(([quality, info]) => {
                const label = ROOM_LABELS[quality] || quality;
                const canAfford = (char?.gold || 0) >= info.price;
                return (
                  <div key={quality} style={sty.svcRow}>
                    <div>
                      <span style={{ color: '#e0d6c8', fontSize: '12px' }}>{label}</span>
                      <span style={{ color: info.available > 0 ? '#4a8' : '#ff6b6b', fontSize: '10px', marginLeft: '6px' }}>
                        ({info.available}/{info.total} free)
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <span style={{ color: '#ffd700', fontSize: '11px' }}>{formatGold(info.price)}/night</span>
                      <button style={sty.tavernBuyBtn(canAfford && info.available > 0)}
                        onClick={() => handleRest(quality, info.price, tav.name)}
                        disabled={!canAfford || info.available <= 0}>
                        {info.available > 0 ? 'Rest' : 'Full'}
                      </button>
                    </div>
                  </div>
                );
              })}
              {restResult && (
                <div style={{ padding: '6px', marginTop: '6px', borderRadius: '4px', fontSize: '10px', backgroundColor: '#1a2a1a', border: '1px solid #4a8', color: '#7fff00' }}>
                  Healed {restResult.healing} HP ({restResult.description}).
                  {restResult.fatigued && <span style={{ color: '#ff6b6b' }}> Poorly rested — fatigued!</span>}
                  {restResult.moraleBonus > 0 && <span> +{restResult.moraleBonus} morale bonus for {restResult.moraleDuration}.</span>}
                </div>
              )}
            </div>
          )}

          {/* Tags */}
          <div style={{ display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
            {tav.rumors && <span style={sty.tag('#8b5cf6')}>Rumors</span>}
            {tav.criminalContacts && <span style={sty.tag('#ef4444')}>Criminal Contacts</span>}
            {tav.source && <span style={{ ...sty.tag('#555'), fontSize: '8px' }}>Source: {tav.source}</span>}
          </div>
        </div>
      );
    }

    // ─── Tavern list ──────────────────
    return (
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {renderSettlementHeader()}
        <div style={{ color: '#d4a574', fontWeight: 'bold', fontSize: '14px', marginBottom: '8px' }}>Taverns & Inns</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '8px' }}>
          {taverns.map(tav => {
            const qColor = QUALITY_COLORS[tav.quality] || '#d4a574';
            return (
              <div key={tav.id} style={sty.tavernCard(false)} onClick={() => handleEnterTavern(tav.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: qColor, fontWeight: 'bold', fontSize: '13px' }}>
                    {tav.type === 'inn' ? '\uD83C\uDFE8' : '\uD83C\uDF7A'} {tav.name}
                  </span>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <span style={sty.tag(qColor)}>{(tav.quality || 'average')}</span>
                    <span style={sty.tag(tav.type === 'inn' ? '#4a8' : '#d4a574')}>{tav.type === 'inn' ? 'Inn' : 'Tavern'}</span>
                  </div>
                </div>
                <div style={{ color: '#8b949e', fontSize: '11px', marginTop: '4px' }}>{tav.description}</div>
                <div style={{ color: '#d4c5a9', fontSize: '11px', marginTop: '4px' }}>
                  Proprietor: <span style={{ color: '#e0d6c8' }}>{tav.proprietor}</span>
                </div>
                <div style={{ display: 'flex', gap: '4px', marginTop: '6px', flexWrap: 'wrap' }}>
                  {tav.rooms && <span style={sty.tag('#4a8')}>Rooms</span>}
                  {tav.rumors && <span style={sty.tag('#8b5cf6')}>Rumors</span>}
                  {tav.specialFeature && <span style={sty.tag('#ffd700')}>Special</span>}
                  {tav.criminalContacts && <span style={sty.tag('#ef4444')}>Underworld</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ─── Main render ──────────────────────────────────────
  return (
    <div style={sty.container}>
      {/* Top bar */}
      <div style={sty.topBar}>
        {campaignActive ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: '#d4c5a9', fontSize: '12px' }}>Location:</span>
            <span style={{ color: '#ffd700', fontWeight: 'bold', fontSize: '13px' }}>{settlement?.name || currentLocation || 'Unknown'}</span>
            {currentLocation && currentLocation !== settlement?.name && (
              <span style={{ color: '#8b949e', fontSize: '10px' }}>({currentLocation})</span>
            )}
          </div>
        ) : (
          <>
            <label style={{ color: '#d4c5a9', fontSize: '12px' }}>Location:</label>
            <select style={sty.sel} value={browseSettlementId} onChange={e => { setBrowseSettlementId(e.target.value); setMerchantId(null); setView('merchants'); setSelectedTavern(null); setTavernVisit(null); }}>
              {settlements.map(s => (
                <option key={s.id} value={s.id}>{s.name} ({s.type.replace(/([A-Z])/g, ' $1').trim()}, Ch.{s.chapter})</option>
              ))}
            </select>
          </>
        )}
        <label style={{ color: '#d4c5a9', fontSize: '12px' }}>Shopping as:</label>
        <select style={sty.sel} value={charId || ''} onChange={e => setCharId(e.target.value)}>
          {party.map(c => <option key={c.id} value={c.id}>{c.name} ({c.race} {c.class})</option>)}
        </select>
        <span style={sty.gold}>{char?.gold || 0} gp</span>
        <span style={{ color: '#8b949e', fontSize: '11px' }}>{totalWeight.toFixed(1)} lbs</span>
      </div>

      {/* View tabs */}
      {(view === 'merchants' || view === 'taverns') && settlement && (
        <div style={{ display: 'flex', borderBottom: '1px solid #30363d', marginBottom: '8px' }}>
          <button style={sty.viewTab(view === 'merchants')} onClick={() => { setView('merchants'); setSelectedTavern(null); setTavernVisit(null); }}>
            Merchants & Shops
          </button>
          <button style={sty.viewTab(view === 'taverns')} onClick={() => { setView('taverns'); setSelectedTavern(null); setTavernVisit(null); }}>
            Taverns & Inns {taverns.length > 0 ? `(${taverns.length})` : ''}
          </button>
        </div>
      )}

      {/* Main content */}
      {view === 'merchants' && renderMerchantList()}
      {view === 'shop' && renderShopView()}
      {view === 'services' && renderServicesView()}
      {view === 'taverns' && renderTavernsView()}
    </div>
  );
}
