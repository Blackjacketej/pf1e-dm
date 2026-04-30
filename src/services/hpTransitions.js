// ─────────────────────────────────────────────────────────────
// HP State Transition signals — NWN-style "so-and-so is bloodied!"
// / "falls unconscious!" / "is dying!" / "rises!" cues for the
// narrative log. Purely derivative of current and previous HP —
// the canonical state lives on the PC record (c.currentHP).
//
// Buckets (PF1e semantics):
//   healthy   — HP > 50% of effective max
//   bloodied  — 0 < HP ≤ 50% of effective max (informal DM term;
//               not a PF1e condition, but a useful UX marker)
//   disabled  — HP == 0 (CRB: standard OR move action, then 1 dmg)
//   dying     — HP < 0 && HP > -CON (unconscious, losing 1/rd)
//   dead      — HP ≤ -CON
//
// We emit a line whenever a PC crosses a bucket boundary. We do
// NOT emit when HP ticks down within the same bucket — that's
// just the damage log lines' job.
// ─────────────────────────────────────────────────────────────

/**
 * Classify a PC's HP into one of five buckets.
 * @param {number} hp       current HP (can be negative)
 * @param {number} effMax   effective max HP (base + familiar boost, etc.)
 * @param {number} con      CON score (defaults to 10 if unset)
 */
export function hpBucket(hp, effMax, con = 10) {
  const deathThreshold = -Math.abs(con || 10);
  if (hp <= deathThreshold) return 'dead';
  if (hp < 0) return 'dying';
  if (hp === 0) return 'disabled';
  const halfMax = Math.max(1, Math.floor((effMax || 1) / 2));
  if (hp <= halfMax) return 'bloodied';
  return 'healthy';
}

// Ordered from best → worst so we can tell "going down" vs. "going up".
const BUCKET_ORDER = ['healthy', 'bloodied', 'disabled', 'dying', 'dead'];
function severity(bucket) {
  const i = BUCKET_ORDER.indexOf(bucket);
  return i < 0 ? 0 : i;
}

/**
 * Build a log entry describing a single HP bucket crossing.
 * @returns {{ text: string, type: string } | null}  null if the
 *   crossing shouldn't produce a line (e.g. healthy ↔ healthy).
 */
export function formatHpTransition(name, prevBucket, newBucket) {
  if (!name || !prevBucket || !newBucket || prevBucket === newBucket) return null;
  const worsening = severity(newBucket) > severity(prevBucket);

  // ── Worsening crossings ──
  if (worsening) {
    if (newBucket === 'bloodied') {
      return { text: `🩸 ${name} is bloodied!`, type: 'warning' };
    }
    if (newBucket === 'disabled') {
      return { text: `💤 ${name} falls unconscious!`, type: 'danger' };
    }
    if (newBucket === 'dying') {
      return { text: `💀 ${name} is dying! (losing 1 HP/round until stabilized)`, type: 'danger' };
    }
    if (newBucket === 'dead') {
      return { text: `☠️ ${name} has perished.`, type: 'danger' };
    }
  }

  // ── Recovering crossings ──
  if (newBucket === 'healthy') {
    // coming back up to above-half — the party just pulled this PC out of trouble
    if (prevBucket === 'bloodied') {
      return { text: `✨ ${name} is back on their feet.`, type: 'success' };
    }
    return { text: `✨ ${name} is stabilized and conscious!`, type: 'success' };
  }
  if (newBucket === 'bloodied' && (prevBucket === 'disabled' || prevBucket === 'dying' || prevBucket === 'dead')) {
    return { text: `🩹 ${name} is stabilized and back in the fight (bloodied).`, type: 'success' };
  }
  if (newBucket === 'disabled' && (prevBucket === 'dying' || prevBucket === 'dead')) {
    return { text: `🩺 ${name} is stabilized at 0 HP.`, type: 'success' };
  }

  // Fallback for unusual transitions (e.g., dead → dying — only via DM fiat
  // or a resurrection). Keep it quiet rather than invent a line.
  return null;
}
