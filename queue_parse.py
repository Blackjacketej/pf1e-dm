import json, re, sys
from datetime import datetime
from pathlib import Path

base = Path('.')
with open(base / 'claude-priority.json') as f:
    prio_order = json.load(f)['order']

resolved = set()
try:
    with open(base / 'claude-resolutions.json') as f:
        data = json.load(f)
    for r in data.get('resolutions', []):
        if r.get('resolvedAt'):
            resolved.add(r['id'])
except:
    pass

notes = []
with open(base / 'claude-notes.md', encoding='utf-8') as f:
    content = f.read()

for entry in content.split('---\n'):
    if not entry.strip():
        continue
    lines = entry.strip().split('\n')
    pat = r'##\s*\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\]\s+(\w+)(?:\s*\|\s*([^|]+?))?\s*\|\s*(\w+)\s*\|\s*#(\d+)$'
    m = re.match(pat, lines[0])
    if not m:
        continue
    ts, kind, sev, status, iid = m.groups()
    iid = int(iid)
    if status \!= 'open' or iid in resolved:
        continue
    blines = lines[1:]
    scl = ''
    bsi = 0
    for i, l in enumerate(blines):
        if l.startswith('_Scene:') or l.startswith('_Character:'):
            scl = l
            bsi = i + 1
            break
    body = '\n'.join(blines[bsi:]).strip()
    notes.append({'id': iid, 'kind': kind, 'severity': sev.strip() if sev else None, 'created_at': ts, 'scene_char': scl, 'body': body})

def sort_fn(e):
    r = float('inf') if e['id'] not in prio_order else prio_order.index(e['id'])
    t = -datetime.fromisoformat(e['created_at']).timestamp()
    return (r, t)

notes.sort(key=sort_fn)

for i, e in enumerate(notes[:12], 1):
    rp = prio_order.index(e['id'])+1 if e['id'] in prio_order else None
    rank_str = "#" + str(rp) if rp else "unranked"
    sev_str = e['severity'] if e['severity'] else 'N/A'
    print(i, "#" + str(e['id']), "|", e['kind'].upper(), "| severity=" + sev_str, "| rank=" + rank_str)
    print("   Created:", e['created_at'])
    if e['scene_char']:
        print("  ", e['scene_char'])
    print()
    print("   Body:")
    print(e['body'])
    print()
