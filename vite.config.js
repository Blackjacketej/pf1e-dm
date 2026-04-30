import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

function parseClaudeNotesMarkdown(raw) {
  const entries = []
  const headerRe = /^## \[([^\]]+)\]\s+([A-Za-z]+)([^\n#]*?)#(\d+)\s*$/gm
  const headers = []
  let hm
  while ((hm = headerRe.exec(raw)) !== null) {
    headers.push({
      index: hm.index,
      end: hm.index + hm[0].length,
      ts: hm[1],
      kind: hm[2],
      midRaw: hm[3],
      idStr: hm[4],
    })
  }
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i]
    if (h.kind === 'resolution') continue
    const id = Number(h.idStr)
    if (!Number.isFinite(id)) continue
    if (h.kind === 'note' && /re-/i.test(h.midRaw)) continue

    const parts = h.midRaw.split(/[|\u00B7]/).map(s => s.trim()).filter(Boolean)
    let severity = null
    let status = 'open'
    if (parts.length >= 2) {
      severity = parts[0]
      status = parts[1]
    } else if (parts.length === 1) {
      if (/^(open|resolved|closed)$/i.test(parts[0])) status = parts[0]
      else severity = parts[0]
    }
    if (!/^(open|resolved|closed)$/i.test(status)) status = 'open'
    status = status.toLowerCase()

    const nextStart = i + 1 < headers.length ? headers[i + 1].index : raw.length
    let body = raw.slice(h.end, nextStart)
    body = body.replace(/\n-{3,}\s*$/m, '')

    const sceneRe = /_Scene:\s*([^|\u00B7_]+)[|\u00B7]\s*Character:\s*([^_]+)_/
    const sm = sceneRe.exec(body)
    const scene = sm ? sm[1].trim() : null
    const character = sm ? sm[2].trim() : null
    const bodyStart = sm ? body.indexOf(sm[0]) + sm[0].length : 0
    const text = body.slice(bodyStart).replace(/^\s+|\s+$/g, '')
    if (!text) continue

    entries.push({
      id, kind: h.kind, severity, status, scene, character, text,
      createdAt: parseNotesTimestamp(h.ts),
    })
  }
  const byId = new Map()
  for (const e of entries) byId.set(e.id, e)
  return Array.from(byId.values()).sort((a, b) => a.id - b.id)
}

function parseNotesTimestamp(ts) {
  const m = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(ts || '').trim())
  if (!m) return new Date().toISOString()
  const [, Y, M, D, h, mm, s] = m
  return new Date(`${Y}-${M}-${D}T${h}:${mm}:${s || '00'}Z`).toISOString()
}

function claudeNotesPlugin() {
  return {
    name: 'claude-notes-endpoint',
    configureServer(server) {
      server.middlewares.use('/__claude-notes', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Allow', 'POST')
          res.end('Method Not Allowed')
          return
        }
        // Bump the raw body cap since #36 attachments inline as base64 data URLs.
        // 5 files × 5 MB base64 + overhead ≈ 35 MB upper bound.
        let body = ''
        let bodyBytes = 0
        const MAX_BODY = 40 * 1024 * 1024
        let aborted = false
        req.on('data', (chunk) => {
          bodyBytes += chunk.length
          if (bodyBytes > MAX_BODY) {
            aborted = true
            res.statusCode = 413
            res.end('Payload too large')
            req.destroy()
            return
          }
          body += chunk
        })
        req.on('end', () => {
          if (aborted) return
          try {
            const payload = JSON.parse(body || '{}')
            const text = String(payload.text || '').trim()
            if (!text) {
              res.statusCode = 400
              res.end('Missing text')
              return
            }
            const kind = String(payload.kind || 'bug')
            const severity = String(payload.severity || 'minor')
            const id = payload.id ?? '-'
            const scene = payload.scene || '-'
            const character = payload.character || '-'
            const ts = new Date(payload.createdAt || Date.now())
              .toISOString().replace('T', ' ').slice(0, 16)
            const header = kind === 'bug'
              ? `## [${ts}] ${kind} | ${severity} | open | #${id}`
              : `## [${ts}] ${kind} | open | #${id}`

            // #36 — attachments: decode each dataUrl to bytes and write to
            // claude-attachments/<id>-<i>-<sanitized-name>. We then append
            // a markdown list of relative paths under the note body so both
            // Cowork/Claude and the in-app viewer can find them.
            const attachments = Array.isArray(payload.attachments) ? payload.attachments : []
            const savedAttachments = []
            if (attachments.length > 0) {
              const attDir = path.resolve(process.cwd(), 'claude-attachments')
              try { fs.mkdirSync(attDir, { recursive: true }) } catch { /* noop */ }
              for (let i = 0; i < attachments.length; i++) {
                const a = attachments[i]
                if (!a || typeof a.dataUrl !== 'string') continue
                const m = /^data:([^;,]+)(?:;charset=[^;,]+)?(;base64)?,(.*)$/s.exec(a.dataUrl)
                if (!m) continue
                const mime = m[1] || 'application/octet-stream'
                const isBase64 = !!m[2]
                const raw = m[3]
                let bytes
                try {
                  bytes = isBase64
                    ? Buffer.from(raw, 'base64')
                    : Buffer.from(decodeURIComponent(raw), 'utf8')
                } catch {
                  continue
                }
                // Sanitize name; preserve extension when possible, pick one from
                // MIME if the original name was just a paste like "image.png".
                const rawName = String(a.name || `attachment-${i}`)
                const safeBase = rawName
                  .replace(/[\\\/:\*\?"<>\|\x00-\x1f]/g, '_')
                  .replace(/\s+/g, '_')
                  .slice(0, 80)
                let finalName = safeBase
                if (!/\.[A-Za-z0-9]{1,6}$/.test(finalName)) {
                  const extFromMime = mime === 'image/png' ? '.png'
                    : mime === 'image/jpeg' ? '.jpg'
                    : mime === 'image/gif' ? '.gif'
                    : mime === 'image/webp' ? '.webp'
                    : mime === 'application/pdf' ? '.pdf'
                    : mime.startsWith('text/') ? '.txt'
                    : ''
                  finalName = `${finalName || 'attachment'}${extFromMime}`
                }
                const filename = `${id}-${i}-${finalName}`
                const outPath = path.resolve(attDir, filename)
                try {
                  fs.writeFileSync(outPath, bytes)
                  savedAttachments.push({
                    path: `claude-attachments/${filename}`,
                    name: rawName,
                    type: mime,
                    size: bytes.length,
                  })
                } catch (e) {
                  console.warn('[claude-notes-endpoint] attachment write failed:', e)
                }
              }
            }

            const lines = ['', header, `_Scene: ${scene} | Character: ${character}_`, '', text, '']
            if (savedAttachments.length > 0) {
              lines.push('')
              lines.push('**Attachments:**')
              for (const a of savedAttachments) {
                const sizeKb = Math.round(a.size / 1024)
                // Use markdown image syntax for images so the file renders inline
                // in editors that support it; plain link for everything else.
                if (a.type.startsWith('image/')) {
                  lines.push(`- ![${a.name}](${a.path}) _(${a.type}, ${sizeKb} KB)_`)
                } else {
                  lines.push(`- [${a.name}](${a.path}) _(${a.type}, ${sizeKb} KB)_`)
                }
              }
              lines.push('')
            }
            lines.push('---')
            lines.push('')
            const filePath = path.resolve(process.cwd(), 'claude-notes.md')
            fs.appendFileSync(filePath, lines.join('\n'), 'utf8')
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, attachments: savedAttachments }))
          } catch (err) {
            console.warn('[claude-notes-endpoint] failed:', err)
            res.statusCode = 500
            res.end(String(err?.message || err))
          }
        })
      })

      server.middlewares.use('/__claude-resolutions', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.setHeader('Allow', 'GET')
          res.end('Method Not Allowed')
          return
        }
        try {
          const filePath = path.resolve(process.cwd(), 'claude-resolutions.json')
          if (!fs.existsSync(filePath)) {
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ resolutions: [] }))
            return
          }
          const raw = fs.readFileSync(filePath, 'utf8')
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(raw)
        } catch (err) {
          console.warn('[claude-resolutions-endpoint] failed:', err)
          res.statusCode = 500
          res.end(String(err?.message || err))
        }
      })

      server.middlewares.use('/__claude-resolve', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Allow', 'POST')
          res.end('Method Not Allowed')
          return
        }
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          try {
            const payload = JSON.parse(body || '{}')
            const ids = Array.isArray(payload.ids)
              ? payload.ids.map((n) => Number(n)).filter((n) => Number.isFinite(n))
              : []
            const note = String(payload.note || '').trim()
            if (!ids.length) {
              res.statusCode = 400
              res.end('Missing ids')
              return
            }
            const filePath = path.resolve(process.cwd(), 'claude-resolutions.json')
            let current = { resolutions: [] }
            if (fs.existsSync(filePath)) {
              try { current = JSON.parse(fs.readFileSync(filePath, 'utf8')) || { resolutions: [] } }
              catch { current = { resolutions: [] } }
            }
            if (!Array.isArray(current.resolutions)) current.resolutions = []
            const now = new Date().toISOString()
            for (const id of ids) {
              const existingIdx = current.resolutions.findIndex((r) => r && r.id === id)
              const entry = { id, note: note || null, resolvedAt: now }
              if (existingIdx >= 0) current.resolutions[existingIdx] = entry
              else current.resolutions.push(entry)
            }
            fs.writeFileSync(filePath, JSON.stringify(current, null, 2), 'utf8')
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, count: ids.length }))
          } catch (err) {
            console.warn('[claude-resolve-endpoint] failed:', err)
            res.statusCode = 500
            res.end(String(err?.message || err))
          }
        })
      })

      // /__claude-accept — operator sign-off on a resolved bug. Records
      // `acceptedAt` onto the matching claude-resolutions.json entry so the
      // acceptance status survives an IndexedDB wipe or project folder move.
      server.middlewares.use('/__claude-accept', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Allow', 'POST')
          res.end('Method Not Allowed')
          return
        }
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          try {
            const payload = JSON.parse(body || '{}')
            const ids = Array.isArray(payload.ids)
              ? payload.ids.map((n) => Number(n)).filter((n) => Number.isFinite(n))
              : []
            if (!ids.length) {
              res.statusCode = 400
              res.end('Missing ids')
              return
            }
            const acceptedAt = typeof payload.acceptedAt === 'string' && payload.acceptedAt
              ? payload.acceptedAt
              : new Date().toISOString()
            const filePath = path.resolve(process.cwd(), 'claude-resolutions.json')
            let current = { resolutions: [] }
            if (fs.existsSync(filePath)) {
              try { current = JSON.parse(fs.readFileSync(filePath, 'utf8')) || { resolutions: [] } }
              catch { current = { resolutions: [] } }
            }
            if (!Array.isArray(current.resolutions)) current.resolutions = []
            for (const id of ids) {
              const idx = current.resolutions.findIndex((r) => r && r.id === id)
              if (idx >= 0) {
                current.resolutions[idx] = {
                  ...current.resolutions[idx],
                  id,
                  acceptedAt,
                }
              } else {
                // Operator accepted an entry that was never formally resolved
                // via /__claude-resolve (e.g. Claude fixed it in code but
                // never wrote the resolution JSON). Record the acceptance
                // anyway so the status survives a rehydrate.
                current.resolutions.push({ id, note: null, resolvedAt: null, acceptedAt })
              }
            }
            fs.writeFileSync(filePath, JSON.stringify(current, null, 2), 'utf8')
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, count: ids.length }))
          } catch (err) {
            console.warn('[claude-accept-endpoint] failed:', err)
            res.statusCode = 500
            res.end(String(err?.message || err))
          }
        })
      })

      // /__claude-priority — write-through for the drag-rank order. Writes
      // `claude-priority.json` at the project root every time the operator
      // reorders the open queue. The scheduled task `review-pf-dm-bug-queue`
      // reads this file to walk items in operator-ranked order rather than
      // chronological order (which is all claude-notes.md can express).
      server.middlewares.use('/__claude-priority', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Allow', 'POST')
          res.end('Method Not Allowed')
          return
        }
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          try {
            const payload = JSON.parse(body || '{}')
            const order = Array.isArray(payload.order)
              ? payload.order.map((n) => Number(n)).filter((n) => Number.isFinite(n))
              : []
            const filePath = path.resolve(process.cwd(), 'claude-priority.json')
            const out = {
              updatedAt: new Date().toISOString(),
              order,
            }
            fs.writeFileSync(filePath, JSON.stringify(out, null, 2), 'utf8')
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, count: order.length }))
          } catch (err) {
            console.warn('[claude-priority-endpoint] failed:', err)
            res.statusCode = 500
            res.end(String(err?.message || err))
          }
        })
      })

      // /__claude-note-edit — operator edited the text/severity/kind of a
      // queue entry. Rewrites the matching entry in claude-notes.md so the
      // edit survives a rehydrate (without this, "Restore from disk" would
      // revert the edit to whatever was captured at original submit time).
      //
      // Entry shape in claude-notes.md:
      //   ## [ts] kind | severity | status | #id       (bug)
      //   ## [ts] kind | status | #id                  (note/design/idea)
      //   _Scene: X | Character: Y_
      //   (blank)
      //   body text (possibly multi-line)
      //   (blank)
      //   ---
      //   (blank)
      //
      // We locate the header by #id, preserve the timestamp + status, swap
      // kind/severity into the header if changed, and replace the body text
      // between the _Scene:..._ line and the trailing `---` marker.
      server.middlewares.use('/__claude-note-edit', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Allow', 'POST')
          res.end('Method Not Allowed')
          return
        }
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          try {
            const payload = JSON.parse(body || '{}')
            const id = Number(payload.id)
            if (!Number.isFinite(id)) {
              res.statusCode = 400
              res.end('Missing id')
              return
            }
            const newText = typeof payload.text === 'string' ? payload.text : null
            const newSeverity = typeof payload.severity === 'string' ? payload.severity : null
            const newKind = typeof payload.kind === 'string' ? payload.kind : null
            if (newText == null && newSeverity == null && newKind == null) {
              res.statusCode = 400
              res.end('Nothing to update')
              return
            }

            const filePath = path.resolve(process.cwd(), 'claude-notes.md')
            if (!fs.existsSync(filePath)) {
              res.statusCode = 404
              res.end('claude-notes.md not found')
              return
            }
            const raw = fs.readFileSync(filePath, 'utf8')

            // Locate every header, pick the one whose trailing #N matches.
            const headerRe = /^## \[([^\]]+)\]\s+([A-Za-z]+)([^\n#]*?)#(\d+)\s*$/gm
            const headers = []
            let hm
            while ((hm = headerRe.exec(raw)) !== null) {
              headers.push({
                index: hm.index,
                end: hm.index + hm[0].length,
                match: hm[0],
                ts: hm[1],
                kind: hm[2],
                mid: hm[3],
                id: Number(hm[4]),
              })
            }
            const target = headers.find((h) => h.id === id)
            if (!target) {
              res.statusCode = 404
              res.end(`No entry with #${id} in claude-notes.md`)
              return
            }

            // Parse existing mid-segment to recover severity/status.
            const parts = target.mid.split(/[|\u00B7]/).map((s) => s.trim()).filter(Boolean)
            let existingSeverity = null
            let existingStatus = 'open'
            if (parts.length >= 2) {
              existingSeverity = parts[0]
              existingStatus = parts[1]
            } else if (parts.length === 1) {
              if (/^(open|resolved|closed)$/i.test(parts[0])) existingStatus = parts[0]
              else existingSeverity = parts[0]
            }

            const finalKind = newKind || target.kind
            const finalSeverity = newSeverity || existingSeverity || 'minor'
            const finalStatus = existingStatus || 'open'
            const newHeader = finalKind === 'bug'
              ? `## [${target.ts}] ${finalKind} | ${finalSeverity} | ${finalStatus} | #${id}`
              : `## [${target.ts}] ${finalKind} | ${finalStatus} | #${id}`

            // Body spans from the end of the header line to the next
            // `---` marker on its own line, or (fallback) the next `## `
            // header — whichever comes first.
            const bodyStart = target.end
            const tail = raw.slice(bodyStart)
            const nextHeaderRe = /\n## \[/
            const nextHrRe = /\n---\s*(\n|$)/
            const nhMatch = nextHeaderRe.exec(tail)
            const hrMatch = nextHrRe.exec(tail)
            let bodyEndOffset = tail.length
            if (hrMatch && (!nhMatch || hrMatch.index < nhMatch.index)) {
              bodyEndOffset = hrMatch.index
            } else if (nhMatch) {
              bodyEndOffset = nhMatch.index
            }
            const bodyEnd = bodyStart + bodyEndOffset
            const oldBody = raw.slice(bodyStart, bodyEnd)

            // Preserve the _Scene: ... | Character: ..._ line if present —
            // that's captured context, not something the text edit should
            // touch.
            const sceneRe = /\n_Scene:[^\n]*_\s*\n/
            const sceneMatch = sceneRe.exec(oldBody)
            const scenePrefix = sceneMatch
              ? oldBody.slice(0, sceneMatch.index + sceneMatch[0].length)
              : '\n'

            let newBody
            if (newText != null) {
              const trimmed = String(newText).trim()
              if (!trimmed) {
                res.statusCode = 400
                res.end('text cannot be empty')
                return
              }
              newBody = `${scenePrefix}\n${trimmed}\n\n`
            } else {
              // No text change — keep the body as-is, only the header moved.
              newBody = oldBody
            }

            const rebuilt = raw.slice(0, target.index)
              + newHeader
              + newBody
              + raw.slice(bodyEnd)

            fs.writeFileSync(filePath, rebuilt, 'utf8')
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({
              ok: true,
              id,
              updated: {
                text: newText != null,
                severity: newSeverity != null,
                kind: newKind != null,
              },
            }))
          } catch (err) {
            console.warn('[claude-note-edit-endpoint] failed:', err)
            res.statusCode = 500
            res.end(String(err?.message || err))
          }
        })
      })

      // /__claude-reopen — operator re-opened a resolved/accepted bug.
      // Removes the matching entry from claude-resolutions.json so the
      // syncClaudeResolutions pass on the next mount doesn't immediately
      // re-apply the stale resolved/accepted status and clobber the reopen.
      // Without this, reopens appear to "not stick" — the DB flip succeeds
      // but the disk file is authoritative for the sync, so the bug snaps
      // right back to resolved on the next refresh.
      server.middlewares.use('/__claude-reopen', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Allow', 'POST')
          res.end('Method Not Allowed')
          return
        }
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          try {
            const payload = JSON.parse(body || '{}')
            const ids = Array.isArray(payload.ids)
              ? payload.ids.map((n) => Number(n)).filter((n) => Number.isFinite(n))
              : []
            if (!ids.length) {
              res.statusCode = 400
              res.end('Missing ids')
              return
            }
            const filePath = path.resolve(process.cwd(), 'claude-resolutions.json')
            let current = { resolutions: [] }
            if (fs.existsSync(filePath)) {
              try { current = JSON.parse(fs.readFileSync(filePath, 'utf8')) || { resolutions: [] } }
              catch { current = { resolutions: [] } }
            }
            if (!Array.isArray(current.resolutions)) current.resolutions = []
            const removeSet = new Set(ids)
            const before = current.resolutions.length
            current.resolutions = current.resolutions.filter(
              (r) => !(r && removeSet.has(r.id))
            )
            const removed = before - current.resolutions.length
            fs.writeFileSync(filePath, JSON.stringify(current, null, 2), 'utf8')
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, removed, remaining: current.resolutions.length }))
          } catch (err) {
            console.warn('[claude-reopen-endpoint] failed:', err)
            res.statusCode = 500
            res.end(String(err?.message || err))
          }
        })
      })

      server.middlewares.use('/__claude-notes-raw', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.setHeader('Allow', 'GET')
          res.end('Method Not Allowed')
          return
        }
        try {
          const filePath = path.resolve(process.cwd(), 'claude-notes.md')
          if (!fs.existsSync(filePath)) {
            res.statusCode = 404
            res.end('claude-notes.md not found')
            return
          }
          const raw = fs.readFileSync(filePath, 'utf8')
          res.statusCode = 200
          res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(raw)
        } catch (err) {
          console.warn('[claude-notes-raw-endpoint] failed:', err)
          res.statusCode = 500
          res.end(String(err?.message || err))
        }
      })

      server.middlewares.use('/__claude-notes-scan', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.setHeader('Allow', 'GET')
          res.end('Method Not Allowed')
          return
        }
        try {
          const filePath = path.resolve(process.cwd(), 'claude-notes.md')
          if (!fs.existsSync(filePath)) {
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ entries: [] }))
            return
          }
          const raw = fs.readFileSync(filePath, 'utf8')
          const entries = parseClaudeNotesMarkdown(raw)
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ entries }))
        } catch (err) {
          console.warn('[claude-notes-scan-endpoint] failed:', err)
          res.statusCode = 500
          res.end(String(err?.message || err))
        }
      })

      server.middlewares.use('/__claude-export', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Allow', 'POST')
          res.end('Method Not Allowed')
          return
        }
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          try {
            const payload = JSON.parse(body || '{}')
            const filename = String(payload.filename || '').trim()
            const content = String(payload.content || '')
            if (!filename || !/^[\w.\-]+\.md$/.test(filename)) {
              res.statusCode = 400
              res.end('Invalid filename')
              return
            }
            if (!content) {
              res.statusCode = 400
              res.end('Missing content')
              return
            }
            const dir = path.resolve(process.cwd(), 'claude-exports')
            fs.mkdirSync(dir, { recursive: true })
            const filePath = path.join(dir, filename)
            fs.writeFileSync(filePath, content, 'utf8')
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ path: `claude-exports/${filename}` }))
          } catch (err) {
            console.warn('[claude-export-endpoint] failed:', err)
            res.statusCode = 500
            res.end(String(err?.message || err))
          }
        })
      })
    },
  }
}

export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/pf1e-dm/' : '/',
  plugins: [react(), claudeNotesPlugin()],
  cacheDir: process.env.TEMP
    ? process.env.TEMP + '/vite-pf-dm'
    : 'node_modules/.vite',
  server: {
    open: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'data-monsters': ['./src/data/monsters.json'],
          'data-spells': ['./src/data/spells.json'],
          'data-equipment': ['./src/data/equipment.json'],
          'data-feats': ['./src/data/feats.json'],
          'data-shop': [
            './src/data/gear.json',
            './src/data/magicItems.json',
            './src/data/weapons.json',
            './src/data/settlements.json',
          ],
          'data-campaign': [
            './src/data/campaign-rotrl.json',
            './src/data/rotrl-encounters.json',
            './src/data/rotrl-context.json',
            './src/data/sandpoint.json',
          ],
          'data-world': [
            './src/data/worldMechanics.json',
            './src/data/ultimateCampaign.json',
            './src/data/sandpointMap.json',
            './src/data/advancedSystems.json',
            './src/data/dmToolsData.json',
          ],
        },
      },
    },
  },
})
