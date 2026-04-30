// CalendarPanel.jsx — Task #78 (2026-04-19) follow-up to the Time/Weather/
// Calendar epic (#70). Replaces the tiny CalendarDisplay tooltip with a full
// SlidePanel view: browseable month grid with prev/next arrows, holiday
// highlights on their day cells, upcoming-holidays list, and a GM-only
// "set date" form that commits to worldState.
//
// Design notes:
// - Panel is pure *view* unless the GM commits via Apply; prev/next only
//   bumps local viewYear/viewMonth state so the operator can browse
//   centuries without touching the world clock.
// - GM "set date" is gated on the `gmMode` prop. When committed, we write
//   currentYear/Month/Day/Hour/Minute directly (setWorldState(prev => ...))
//   and log a visible "GM advanced time" line. Weather regen is NOT
//   triggered here because a GM jump is not a natural tick — it represents
//   the GM retconning the clock, not the party experiencing that passage.
//   (If you want a "natural" advance that regenerates weather, use the
//   quick-advance buttons which route through tickClock.)
// - The panel accepts `onClose` from the SlidePanel wrapper and renders
//   everything inside a scrollable container so a small browser window
//   still shows the GM form below the grid.
//
// Honors feedback_no_fast_travel.md: the quick-advance buttons here do
// NOT pass through the overland engine and therefore skip encounter
// rolls. They're a GM tool for resolving downtime / cutscenes, not a
// player-facing shortcut. The primary "walk to a distant place" path
// still has to go through switchToNodePath.

import React, { useState, useMemo } from 'react';
import {
  getDateInfo,
  getDayOfWeek,
  getMonths,
  getHolidaysInMonth,
  DAYS_OF_WEEK,
} from '../services/calendar.js';
import { tickClock } from '../services/clockTick.js';

const MONTHS = getMonths();

// ────────────────────────────────────────────────────── tiny style helpers
const palette = {
  bg: '#1a1408',
  panel: '#2a1f12',
  text: '#f3e6c4',
  textDim: 'rgba(243, 230, 196, 0.65)',
  textFaint: 'rgba(243, 230, 196, 0.35)',
  border: 'rgba(200, 160, 80, 0.35)',
  borderStrong: 'rgba(200, 160, 80, 0.6)',
  today: '#ffd700',
  todayBg: 'rgba(255, 215, 0, 0.18)',
  holiday: '#e8a060',
  holidayBg: 'rgba(232, 160, 96, 0.14)',
  gmAccent: '#d946ef',
};

function cellStyle({ isToday, isHoliday, isBlank }) {
  return {
    boxSizing: 'border-box',
    minHeight: 52,
    padding: '4px 6px',
    border: `1px solid ${isBlank ? 'transparent' : palette.border}`,
    borderRadius: 4,
    background: isToday
      ? palette.todayBg
      : isHoliday
        ? palette.holidayBg
        : isBlank
          ? 'transparent'
          : 'rgba(0,0,0,0.18)',
    color: isToday ? palette.today : palette.text,
    fontWeight: isToday ? 700 : 400,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    overflow: 'hidden',
  };
}

function btnStyle({ accent = false, disabled = false } = {}) {
  return {
    padding: '4px 10px',
    background: accent ? palette.gmAccent : 'rgba(200, 160, 80, 0.15)',
    color: accent ? '#1a1408' : palette.text,
    border: `1px solid ${accent ? palette.gmAccent : palette.borderStrong}`,
    borderRadius: 4,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    fontSize: 12,
    fontFamily: 'inherit',
  };
}

function inputStyle() {
  return {
    background: palette.bg,
    color: palette.text,
    border: `1px solid ${palette.border}`,
    borderRadius: 4,
    padding: '4px 6px',
    fontSize: 12,
    fontFamily: 'inherit',
    width: '100%',
    boxSizing: 'border-box',
  };
}

export default function CalendarPanel({
  worldState = {},
  setWorldState,
  gmMode = false,
  addLog,
  onClose,
}) {
  const info = getDateInfo(worldState);

  // viewYear/viewMonth drive grid browsing; independent of the world clock.
  const [viewYear, setViewYear] = useState(info.year);
  const [viewMonth, setViewMonth] = useState(info.month);

  const viewMonthInfo = MONTHS[viewMonth] || { name: '?', daysInMonth: 30, season: '' };
  const daysInView = viewMonthInfo.daysInMonth || 30;

  // Day-of-week index for the 1st of the viewed month. getDayOfWeek returns
  // a string; map back to the 0-6 index for grid-column offset.
  const firstWeekday = useMemo(() => {
    const label = getDayOfWeek(viewYear, viewMonth, 1);
    const idx = DAYS_OF_WEEK.indexOf(label);
    return idx >= 0 ? idx : 0;
  }, [viewYear, viewMonth]);

  const holidaysThisMonth = useMemo(() => getHolidaysInMonth(viewMonth), [viewMonth]);

  // Quick lookup: day number → [holiday, ...] for the visible month.
  const holidayByDay = useMemo(() => {
    const m = new Map();
    for (const h of holidaysThisMonth) {
      for (let d = h.dayStart; d <= h.dayEnd; d++) {
        if (!m.has(d)) m.set(d, []);
        m.get(d).push(h);
      }
    }
    return m;
  }, [holidaysThisMonth]);

  function navMonth(delta) {
    let m = viewMonth + delta;
    let y = viewYear;
    while (m < 0) { m += 12; y -= 1; }
    while (m > 11) { m -= 12; y += 1; }
    setViewMonth(m);
    setViewYear(y);
  }

  function jumpToToday() {
    setViewYear(info.year);
    setViewMonth(info.month);
  }

  // ─────────────────────────────────────────── GM controls (set date form)
  const [gmYear, setGmYear] = useState(info.year);
  const [gmMonth, setGmMonth] = useState(info.month);
  const [gmDay, setGmDay] = useState(info.day);
  const [gmHour, setGmHour] = useState(info.hour);
  const [gmMinute, setGmMinute] = useState(info.minute);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Clamp the GM day field to the selected month's day count.
  const gmDaysInMonth = MONTHS[gmMonth]?.daysInMonth || 30;
  const gmDayClamped = Math.min(Math.max(1, gmDay || 1), gmDaysInMonth);

  function applyGmDate() {
    if (!setWorldState) return;
    const patch = {
      currentYear: Number(gmYear) || info.year,
      currentMonth: Number(gmMonth),
      currentDay: gmDayClamped,
      currentHour: Math.max(0, Math.min(23, Number(gmHour) || 0)),
      currentMinute: Math.max(0, Math.min(59, Number(gmMinute) || 0)),
    };
    setWorldState(prev => ({ ...(prev || {}), ...patch }));
    addLog?.(
      `GM set the date to ${MONTHS[patch.currentMonth]?.name} ${patch.currentDay}, ${patch.currentYear} AR — ${String(patch.currentHour).padStart(2, '0')}:${String(patch.currentMinute).padStart(2, '0')}.`,
      'system',
    );
    setConfirmOpen(false);
    onClose?.();
  }

  function quickAdvance(opts, label) {
    if (!setWorldState) return;
    const { patch, events } = tickClock(worldState, { ...opts, cause: 'gm-quick-advance' });
    if (Object.keys(patch).length === 0) return;
    setWorldState(prev => ({ ...(prev || {}), ...patch }));
    addLog?.(`GM advanced time: ${label}.`, 'system');
    events.forEach(e => addLog?.(e.text, e.type));
  }

  // ─────────────────────────────────────────── grid cell renderer
  const totalCells = Math.ceil((firstWeekday + daysInView) / 7) * 7;
  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - firstWeekday + 1;
    if (dayNum < 1 || dayNum > daysInView) {
      cells.push(<div key={i} style={cellStyle({ isBlank: true })} />);
      continue;
    }
    const isToday =
      viewYear === info.year && viewMonth === info.month && dayNum === info.day;
    const holidaysOnDay = holidayByDay.get(dayNum) || [];
    const isHoliday = holidaysOnDay.length > 0;
    cells.push(
      <div
        key={i}
        style={cellStyle({ isToday, isHoliday })}
        title={
          holidaysOnDay.length
            ? holidaysOnDay.map(h => `${h.name}${h.approximate ? ' (approx.)' : ''}: ${h.description}`).join('\n')
            : `${getDayOfWeek(viewYear, viewMonth, dayNum)}, ${viewMonthInfo.name} ${dayNum}, ${viewYear} AR`
        }
      >
        <div style={{ fontSize: 13, lineHeight: 1 }}>{dayNum}</div>
        {isHoliday && (
          <div
            style={{
              fontSize: 10,
              color: palette.holiday,
              lineHeight: 1.1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {holidaysOnDay[0].name}
          </div>
        )}
      </div>,
    );
  }

  // ─────────────────────────────────────────── render
  return (
    <div style={{ padding: '12px 14px', color: palette.text, fontFamily: 'inherit', fontSize: 13, lineHeight: 1.4, overflowY: 'auto', height: '100%' }}>
      {/* ─── current-time header */}
      <div style={{ padding: '8px 10px', background: palette.panel, borderRadius: 6, marginBottom: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>
          {info.dayOfWeek}, {info.monthName} {info.day}, {info.year} AR
        </div>
        <div style={{ fontSize: 12, color: palette.textDim }}>
          {/* Task #79 — full HH:MM:SS in the panel header so combat
              rounds (6 sec) are visible drift. Panel already renders
              large, so the extra width cost is negligible. */}
          {info.season} — {String(info.hour).padStart(2, '0')}:{String(info.minute).padStart(2, '0')}:{String(info.second ?? 0).padStart(2, '0')}
          {info.description && <span style={{ fontStyle: 'italic' }}> · {info.description}</span>}
        </div>
      </div>

      {/* ─── month navigator */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <button type="button" style={btnStyle()} onClick={() => navMonth(-12)} title="Previous year">«</button>
          <button type="button" style={btnStyle()} onClick={() => navMonth(-1)} title="Previous month">‹</button>
        </div>
        <div style={{ textAlign: 'center', fontWeight: 600, fontSize: 14 }}>
          {viewMonthInfo.name} {viewYear} AR
          <div style={{ fontSize: 11, color: palette.textDim, fontWeight: 400 }}>
            {viewMonthInfo.season} · {daysInView} days
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button type="button" style={btnStyle()} onClick={() => navMonth(1)} title="Next month">›</button>
          <button type="button" style={btnStyle()} onClick={() => navMonth(12)} title="Next year">»</button>
        </div>
      </div>
      <div style={{ textAlign: 'center', marginBottom: 6 }}>
        <button type="button" style={{ ...btnStyle(), fontSize: 11 }} onClick={jumpToToday}>
          Return to today ({info.monthName} {info.day}, {info.year} AR)
        </button>
      </div>

      {/* ─── day-of-week header row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, marginBottom: 3 }}>
        {DAYS_OF_WEEK.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: palette.textDim, padding: '3px 0' }}>
            {d.slice(0, 3)}
          </div>
        ))}
      </div>

      {/* ─── month grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
        {cells}
      </div>

      {/* ─── holidays in view */}
      {holidaysThisMonth.length > 0 && (
        <div style={{ marginTop: 12, padding: '8px 10px', background: palette.panel, borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: palette.holiday }}>
            Holidays in {viewMonthInfo.name}
          </div>
          {holidaysThisMonth.map(h => (
            <div key={h.name} style={{ fontSize: 11, marginBottom: 3 }}>
              <span style={{ color: palette.holiday }}>
                {h.dayStart === h.dayEnd ? h.dayStart : `${h.dayStart}–${h.dayEnd}`}
                {h.approximate ? '*' : ''}
              </span>
              {' '}
              <span style={{ fontWeight: 600 }}>{h.name}</span>
              <span style={{ color: palette.textDim }}> — {h.description}</span>
            </div>
          ))}
          {holidaysThisMonth.some(h => h.approximate) && (
            <div style={{ fontSize: 10, color: palette.textFaint, marginTop: 4 }}>
              * approximate date (astronomical event)
            </div>
          )}
        </div>
      )}

      {/* ─── GM-only controls */}
      {gmMode && (
        <div
          style={{
            marginTop: 14,
            padding: '10px 12px',
            background: 'rgba(217, 70, 239, 0.08)',
            border: `1px solid ${palette.gmAccent}`,
            borderRadius: 6,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: palette.gmAccent, marginBottom: 6 }}>
            GM Controls
          </div>

          {/* Quick advance — routes through tickClock so day-change weather fires */}
          <div style={{ fontSize: 11, color: palette.textDim, marginBottom: 4 }}>
            Quick advance (ticks like a natural pass of time — regenerates weather on day-change):
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
            <button type="button" style={btnStyle()} onClick={() => quickAdvance({ minutes: 10 }, '+10 minutes')}>+10m</button>
            <button type="button" style={btnStyle()} onClick={() => quickAdvance({ hours: 1 }, '+1 hour')}>+1h</button>
            <button type="button" style={btnStyle()} onClick={() => quickAdvance({ hours: 4 }, '+4 hours')}>+4h</button>
            <button type="button" style={btnStyle()} onClick={() => quickAdvance({ hours: 8 }, '+8 hours')}>+8h</button>
            <button type="button" style={btnStyle()} onClick={() => quickAdvance({ days: 1 }, '+1 day')}>+1 day</button>
            <button type="button" style={btnStyle()} onClick={() => quickAdvance({ days: 7 }, '+1 week')}>+1 week</button>
          </div>

          {/* Set date form — bypasses tickClock (no weather regen, no encounter rolls) */}
          <div style={{ fontSize: 11, color: palette.textDim, marginBottom: 4 }}>
            Set date directly (retcon — no weather regen, no encounter rolls):
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 6 }}>
            <label style={{ fontSize: 10 }}>
              Year
              <input style={inputStyle()} type="number" value={gmYear} onChange={e => setGmYear(e.target.value)} />
            </label>
            <label style={{ fontSize: 10 }}>
              Month
              <select style={inputStyle()} value={gmMonth} onChange={e => setGmMonth(Number(e.target.value))}>
                {MONTHS.map((m, i) => (
                  <option key={m.name} value={i}>{m.name}</option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 10 }}>
              Day (1–{gmDaysInMonth})
              <input style={inputStyle()} type="number" min={1} max={gmDaysInMonth} value={gmDay} onChange={e => setGmDay(Number(e.target.value) || 1)} />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
            <label style={{ fontSize: 10 }}>
              Hour (0–23)
              <input style={inputStyle()} type="number" min={0} max={23} value={gmHour} onChange={e => setGmHour(Number(e.target.value) || 0)} />
            </label>
            <label style={{ fontSize: 10 }}>
              Minute (0–59)
              <input style={inputStyle()} type="number" min={0} max={59} value={gmMinute} onChange={e => setGmMinute(Number(e.target.value) || 0)} />
            </label>
          </div>

          {!confirmOpen && (
            <button type="button" style={btnStyle({ accent: true })} onClick={() => setConfirmOpen(true)}>
              Apply new date…
            </button>
          )}
          {confirmOpen && (
            <div style={{ padding: 8, background: 'rgba(0,0,0,0.35)', border: `1px solid ${palette.gmAccent}`, borderRadius: 4 }}>
              <div style={{ fontSize: 11, marginBottom: 6 }}>
                Set the world clock to{' '}
                <b>
                  {MONTHS[gmMonth]?.name} {gmDayClamped}, {gmYear} AR — {String(gmHour).padStart(2, '0')}:{String(gmMinute).padStart(2, '0')}
                </b>
                ?
                <div style={{ fontSize: 10, color: palette.textDim, marginTop: 3 }}>
                  This retcons the clock. Any time skipped does NOT fire encounter rolls, weather ticks, rumor decay, or downtime cascades.
                  For a natural pass of time use the Quick advance buttons above.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" style={btnStyle({ accent: true })} onClick={applyGmDate}>Yes, set date</button>
                <button type="button" style={btnStyle()} onClick={() => setConfirmOpen(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {!gmMode && (
        <div style={{ marginTop: 14, fontSize: 10, color: palette.textFaint, textAlign: 'center' }}>
          Enable GM Mode (top toolbar) to set the date or advance time manually.
        </div>
      )}
    </div>
  );
}
