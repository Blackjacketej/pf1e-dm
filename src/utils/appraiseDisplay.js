// ─────────────────────────────────────────────────────
// Appraise display formatting
// ─────────────────────────────────────────────────────
//
// Converts a `resolveAppraise` result + the item being appraised into the
// player-facing strings the UI (AreaItemsPanel hover card, GM narration)
// will display. This is intentionally separate from the resolver so the
// resolver stays a pure CRB rules function.
//
// Three display bands, keyed off the resolver result:
//
//   1. success (diff >= 0):
//        - exact value shown as "N gp"
//        - if detectsMagic (success by 5+), append a magic sparkle hint
//        - hoard mode: phrase as "the most valuable piece is X"
//
//   2. failsByLessThan5 (diff in (-5, 0)):
//        - show a range band: [0.8 × actual, 1.2 × actual] rounded to gp
//        - CRB says "within 20% of actual value" — we display the full ±20%
//          band so the player knows the uncertainty envelope without
//          leaking the exact number
//
//   3. failsBy5OrMore (diff <= -5):
//        - "wildly inaccurate (GM discretion)" placeholder
//        - leave a hook for the GM narration layer to invent a wrong number
//
// The function never throws. Unknown items / missing actualValue degrade to
// "you're not sure what it's worth".

// Round to a "nice" display number: exact for small values, rounded to the
// nearest 5 gp under 100, nearest 10 gp under 1000, nearest 50 gp under
// 10000, nearest 100 gp above that. Avoids giving away exact digits inside
// the 20% band.
function roundDisplayGP(n) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n < 10) return Math.round(n * 10) / 10; // one decimal for coppers/silvers
  if (n < 100) return Math.round(n / 5) * 5;
  if (n < 1000) return Math.round(n / 10) * 10;
  if (n < 10000) return Math.round(n / 50) * 50;
  return Math.round(n / 100) * 100;
}

// Format a gp number with thousand separators, no trailing .0.
function formatGP(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 gp';
  const rounded = Math.round(n * 100) / 100;
  const asInt = Math.round(rounded);
  if (Math.abs(rounded - asInt) < 0.005) {
    return `${asInt.toLocaleString('en-US')} gp`;
  }
  return `${rounded.toLocaleString('en-US')} gp`;
}

export function formatAppraiseForPlayer(result, item) {
  const safeItem = item && typeof item === 'object' ? item : {};
  const itemName = typeof safeItem.name === 'string' && safeItem.name.trim().length > 0
    ? safeItem.name
    : 'the item';
  const actualValue = typeof safeItem.actualValue === 'number' && Number.isFinite(safeItem.actualValue)
    ? safeItem.actualValue
    : 0;

  // Malformed resolver output → safe "no idea" band.
  if (!result || typeof result !== 'object') {
    return {
      band: 'unknown',
      headline: `You can't tell what ${itemName} is worth.`,
      valueText: '—',
      magicHint: null,
      rulesNote: null,
    };
  }

  const {
    success,
    detectsMagic,
    failsByLessThan5,
    failsBy5OrMore,
    hoard,
    breakdown,
  } = result;

  // Hoard mode: on success the check identifies the most valuable visible
  // piece. The caller is responsible for passing the "top piece" as item.
  if (hoard) {
    if (success) {
      return {
        band: 'hoard-success',
        headline: `You pick out the most valuable piece in the hoard: ${itemName}.`,
        valueText: formatGP(actualValue),
        magicHint: detectsMagic ? 'It radiates a magical aura.' : null,
        rulesNote: breakdown || null,
      };
    }
    if (failsByLessThan5) {
      return {
        band: 'hoard-near-miss',
        headline: `You can't single out the most valuable piece, but the hoard looks roughly worth a fair sum.`,
        valueText: '—',
        magicHint: null,
        rulesNote: breakdown || null,
      };
    }
    return {
      band: 'hoard-big-miss',
      headline: `You can't make heads or tails of the hoard's value.`,
      valueText: '—',
      magicHint: null,
      rulesNote: breakdown || null,
    };
  }

  // Success: exact value. Success-by-5 also detects magic presence.
  if (success) {
    return {
      band: 'exact',
      headline: `You confidently appraise ${itemName}.`,
      valueText: formatGP(actualValue),
      magicHint: detectsMagic
        ? 'You also sense a faint magical aura — something in this item is enchanted. (Use Spellcraft to identify the specific properties.)'
        : null,
      rulesNote: breakdown || null,
    };
  }

  // Near-miss: ±20% band around actual value, rounded.
  if (failsByLessThan5) {
    if (actualValue <= 0) {
      return {
        band: 'near-miss',
        headline: `You think ${itemName} is worth something, but you can't settle on a figure.`,
        valueText: '—',
        magicHint: null,
        rulesNote: breakdown || null,
      };
    }
    const low = roundDisplayGP(actualValue * 0.8);
    const high = roundDisplayGP(actualValue * 1.2);
    return {
      band: 'near-miss',
      headline: `You estimate ${itemName}.`,
      valueText: `roughly ${formatGP(low)}–${formatGP(high)}`,
      magicHint: null,
      rulesNote: breakdown || null,
    };
  }

  // Big miss: wildly inaccurate, GM discretion. The UI should treat
  // gmDiscretion: true as "ask the GM narration layer for a wrong number".
  if (failsBy5OrMore) {
    return {
      band: 'big-miss',
      headline: `You're confident about ${itemName}'s value — but you're almost certainly wrong.`,
      valueText: 'GM discretion',
      magicHint: null,
      gmDiscretion: true,
      rulesNote: breakdown || null,
    };
  }

  // Fallback for any resolver state we didn't anticipate.
  return {
    band: 'unknown',
    headline: `You're not sure what ${itemName} is worth.`,
    valueText: '—',
    magicHint: null,
    rulesNote: breakdown || null,
  };
}

export { roundDisplayGP, formatGP };
