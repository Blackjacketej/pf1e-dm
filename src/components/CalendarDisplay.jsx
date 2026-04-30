import React from 'react';
import { getDateInfo, formatShort, getActiveHolidays } from '../services/calendar.js';

/**
 * CalendarDisplay - small badge showing the current Golarion date/time/season.
 *
 * Reads worldState.currentYear/Month/Day/Hour/Minute. Falls back to
 * DEFAULT_START via the calendar service if any field is missing, so old
 * saves render fine.
 *
 * Mounted in the AdventureTab header. Click to expand a tooltip with the
 * full date + active holidays.
 */
const SEASON_ICON = {
  Winter: 'W',
  Spring: 'Sp',
  Summer: 'Su',
  Autumn: 'A',
};

// Task #70f — format a duration in (real-time) ms as a compact "Xh Ym" /
// "Xm" / "just now" string for the "last advance" tooltip line.
function formatElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const sec = Math.floor(ms / 1000);
  if (sec < 30) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  const remMin = min - hr * 60;
  return remMin ? `${hr}h ${remMin}m ago` : `${hr}h ago`;
}

export default function CalendarDisplay({ worldState = {}, compact = false }) {
  const [open, setOpen] = React.useState(false);
  const info = getDateInfo(worldState);
  const holidays = getActiveHolidays(worldState, 2);

  // Task #70f — track the real-world wall-clock time of the last in-world
  // tick so the expanded tooltip can show "Last advance: 1h 32m ago". We
  // key on year/month/day/hour/minute so any forward-march (narration,
  // combat round, rest, in-town travel) bumps the timestamp. The tick-tock
  // timer below forces a re-render once per minute so the tooltip stays
  // fresh even when the operator leaves the panel open.
  const lastAdvanceAtRef = React.useRef(Date.now());
  const prevStampRef = React.useRef(null);
  // Task #79 — include seconds in the stamp so combat rounds (6 sec each)
  // correctly re-base the "last advance" clock. Prior stamp only watched
  // minute-precision, so a fight resolved in 54 seconds would look stale
  // (lastAdvanceAt never bumped) even though the clock actually ticked.
  const stamp = `${info.year}-${info.month}-${info.day}-${info.hour}-${info.minute}-${info.second ?? 0}`;
  if (prevStampRef.current !== null && prevStampRef.current !== stamp) {
    lastAdvanceAtRef.current = Date.now();
  }
  prevStampRef.current = stamp;

  // Re-render once a minute so the "ago" string stays accurate even while
  // worldState is idle. Only runs while the tooltip is open to avoid
  // waking the renderer on every CalendarDisplay mount across the app.
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!open) return undefined;
    const id = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(id);
  }, [open]);
  const elapsedLabel = formatElapsed(Date.now() - lastAdvanceAtRef.current);

  const baseStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: compact ? '2px 8px' : '4px 10px',
    background: 'rgba(60, 50, 30, 0.85)',
    color: '#f3e6c4',
    borderRadius: 6,
    fontSize: compact ? 12 : 13,
    fontFamily: 'inherit',
    cursor: 'pointer',
    border: '1px solid rgba(200, 160, 80, 0.4)',
    userSelect: 'none',
    position: 'relative',
  };

  const seasonTag = SEASON_ICON[info.season] || 'D';

  return (
    <span
      style={baseStyle}
      title={info.dayOfWeek + ', ' + info.monthName + ' ' + info.day + ', ' + info.year + ' AR (' + info.season + ')'}
      onClick={() => setOpen(o => !o)}
      data-testid="calendar-display"
    >
      <span aria-hidden style={{ opacity: 0.8 }}>{seasonTag}</span>
      {/* Bug: seconds missing from badge — includeSeconds lines up the badge
          with the tooltip body ("Hour HH:MM:SS") so combat rounds visibly
          tick. */}
      <span>{formatShort(worldState, { includeSeconds: true })}</span>
      {open && (
        <span style={{
          position: 'absolute',
          top: '100%',
          // Bug: tooltip clipped when CalendarDisplay sits at the right edge
          // of the AdventureTab header. Anchor the tooltip's right edge to
          // the badge's right edge so it extends leftward (into the viewport)
          // instead of rightward (off-screen).
          right: 0,
          left: 'auto',
          marginTop: 4,
          background: '#1a1408',
          color: '#f3e6c4',
          padding: '8px 12px',
          borderRadius: 6,
          fontSize: 12,
          border: '1px solid rgba(200, 160, 80, 0.4)',
          zIndex: 1000,
          minWidth: 220,
          maxWidth: 280,
          lineHeight: 1.4,
          whiteSpace: 'normal',
        }}>
          <div style={{ fontWeight: 'bold' }}>
            {info.dayOfWeek}, {info.monthName} {info.day}, {info.year} AR
          </div>
          <div style={{ opacity: 0.8 }}>
            {/* Task #79 — HH:MM:SS so combat rounds (6 sec) are visible
                drift in the tooltip instead of invisible sub-minute ticks. */}
            {info.season} - Hour {String(info.hour).padStart(2, '0')}:{String(info.minute).padStart(2, '0')}:{String(info.second ?? 0).padStart(2, '0')}
          </div>
          <div style={{ opacity: 0.6, fontSize: 11, marginTop: 2 }}>
            Last advance: {elapsedLabel}
          </div>
          {info.description && (
            <div style={{ marginTop: 4, fontStyle: 'italic', opacity: 0.7 }}>{info.description}</div>
          )}
          {holidays.length > 0 && (
            <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(200,160,80,0.25)' }}>
              <div style={{ fontWeight: 'bold', fontSize: 11 }}>Nearby holidays:</div>
              {holidays.map(h => (
                <div key={h.name} style={{ fontSize: 11 }}>
                  - {h.name} ({h.date})
                </div>
              ))}
            </div>
          )}
        </span>
      )}
    </span>
  );
}
