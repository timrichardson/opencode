import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs"
import path from "node:path"
import { Database } from "bun:sqlite"

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

const source = process.argv[2]
const sessionID = process.argv[3]
const output = process.argv[4]

if (!source || !sessionID || !output) {
  throw new Error("usage: bun export_anonymized_opencode_session.ts <source.db> <session_id> <output.db>")
}

const outputDir = path.dirname(output)
if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })
rmSync(output, { force: true })
rmSync(`${output}-wal`, { force: true })
rmSync(`${output}-shm`, { force: true })
copyFileSync(source, output)

const db = new Database(output)
db.run("PRAGMA foreign_keys = OFF")

const keepSession = db.query("select * from session where id = ?").get(sessionID) as { project_id: string } | undefined
if (!keepSession) throw new Error(`session not found: ${sessionID}`)

const keepProjectID = keepSession.project_id

function rows<T extends object>(sql: string, ...params: unknown[]): T[] {
  return db.query(sql).all(...params) as T[]
}

function cell<T extends object>(sql: string, ...params: unknown[]): T | undefined {
  return db.query(sql).get(...params) as T | undefined
}

const projectTables = ["project", "permission"]
const sessionTables = ["session", "message", "part", "todo", "session_message"]
const syncTables = ["event", "event_sequence"]

for (const table of sessionTables) {
  if (table === "session") db.run(`delete from ${table} where id <> ?`, [sessionID])
  else db.run(`delete from ${table} where session_id <> ?`, [sessionID])
}
for (const table of projectTables) {
  db.run(`delete from ${table} where ${table === "permission" ? "project_id" : "id"} <> ?`, [keepProjectID])
}

db.run("delete from event where aggregate_id <> ? and aggregate_id <> ?", [sessionID, keepProjectID])
db.run("delete from event_sequence where aggregate_id <> ? and aggregate_id <> ?", [sessionID, keepProjectID])

// Drop account/control-plane/share state. The reproducer only needs local project/session/message rows.
for (const row of rows<{ name: string }>("select name from sqlite_master where type='table'")) {
  if ([...projectTables, ...sessionTables, ...syncTables, "__drizzle_migrations", "sqlite_sequence"].includes(row.name)) continue
  db.run(`delete from ${row.name}`)
}

const tokenMap = new Map<string, string>()
function token(prefix: string, value: unknown): string {
  const key = `${prefix}:${String(value)}`
  let existing = tokenMap.get(key)
  if (!existing) {
    existing = `${prefix}-${String(tokenMap.size + 1).padStart(5, "0")}`
    tokenMap.set(key, existing)
  }
  return existing
}

function placeholder(label: string, original: unknown, min = 16): string {
  const length = Math.max(min, String(original ?? "").length)
  return `${label} ${"x".repeat(Math.max(0, length - label.length - 1))}`
}

function sanitizePath(original: unknown): string {
  return `/tmp/opencode-repro/${token("path", original)}`
}

const structuralStringKeys = new Set(["type", "role", "status", "finish", "mode", "reason", "agent", "providerID", "modelID"])
const structuralObjectKeys = new Set([
  "agent",
  "attachments",
  "cache",
  "callID",
  "content",
  "cost",
  "cwd",
  "diffs",
  "files",
  "finish",
  "hash",
  "input",
  "inputTokens",
  "itemId",
  "metadata",
  "mime",
  "filename",
  "mode",
  "model",
  "modelID",
  "openai",
  "output",
  "outputTokens",
  "parentID",
  "path",
  "providerID",
  "reason",
  "reasoning",
  "reasoningEncryptedContent",
  "role",
  "root",
  "snapshot",
  "source",
  "state",
  "status",
  "summary",
  "text",
  "time",
  "title",
  "tokens",
  "tool",
  "total",
  "totalTokens",
  "truncated",
  "type",
  "url",
  "variant",
  "read",
  "write",
  "start",
  "end",
  "created",
  "completed",
  "compacted",
])

function scrubKey(key: string): string {
  return structuralObjectKeys.has(key) ? key : token("key", key)
}

function scrubStrings(value: Json, key = "value"): Json {
  if (typeof value === "string") {
    if (structuralStringKeys.has(key)) return value
    return placeholder(key, value, 64)
  }
  if (!value || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map((entry) => scrubStrings(entry, key))
  return Object.fromEntries(Object.entries(value).map(([entryKey, entry]) => [scrubKey(entryKey), scrubStrings(entry, entryKey)]))
}

function sanitizeModel(model: unknown): unknown {
  if (!model || typeof model !== "object" || Array.isArray(model)) return model
  return { ...model, providerID: "openai", modelID: "gpt-5.1-codex-max" }
}

function sanitizeMessageData(data: Record<string, Json>): Record<string, Json> {
  if (data.role === "user") {
    return scrubStrings({
      ...data,
      agent: "build",
      model: sanitizeModel(data.model) as Json,
      summary: data.summary && typeof data.summary === "object" ? { diffs: [] } : data.summary,
      variant: undefined as unknown as Json,
    }) as Record<string, Json>
  }
  if (data.role === "assistant") {
    const pathValue = data.path && typeof data.path === "object" && !Array.isArray(data.path) ? data.path : {}
    return scrubStrings({
      ...data,
      agent: "build",
      mode: "build",
      modelID: "gpt-5.1-codex-max",
      providerID: "openai",
      path: {
        cwd: sanitizePath((pathValue as Record<string, Json>).cwd),
        root: sanitizePath((pathValue as Record<string, Json>).root),
      },
      variant: undefined as unknown as Json,
    }) as Record<string, Json>
  }
  return scrubStrings(data) as Record<string, Json>
}

function sanitizePartData(data: Record<string, Json>, rowID: string): Record<string, Json> {
  let sanitized: Record<string, Json>
  switch (data.type) {
    case "text":
      sanitized = { ...data, text: placeholder(`text ${rowID}`, data.text, 256) }
      break
    case "reasoning": {
      const metadata = data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata) ? data.metadata : {}
      const openai = (metadata as Record<string, Json>).openai
      const openaiObject = openai && typeof openai === "object" && !Array.isArray(openai) ? openai : {}
      sanitized = {
        ...data,
        text: placeholder(`reasoning ${rowID}`, data.text, 128),
        metadata: {
          openai: {
            ...(openaiObject as Record<string, Json>),
            itemId: token("openai-item", (openaiObject as Record<string, Json>).itemId),
            reasoningEncryptedContent: placeholder(
              `encrypted reasoning ${rowID}`,
              (openaiObject as Record<string, Json>).reasoningEncryptedContent,
              1024,
            ),
          },
        },
      }
      break
    }
    case "tool": {
      const state = data.state && typeof data.state === "object" && !Array.isArray(data.state) ? data.state : {}
      const metadata = data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata) ? data.metadata : {}
      const openai = (metadata as Record<string, Json>).openai
      const openaiObject = openai && typeof openai === "object" && !Array.isArray(openai) ? openai : {}
      sanitized = {
        ...data,
        callID: token("call", data.callID),
        metadata: { openai: { itemId: token("openai-item", (openaiObject as Record<string, Json>).itemId) } },
        tool: token("tool", data.tool),
        state: {
          ...(state as Record<string, Json>),
          input: {},
          output: placeholder(`tool output ${rowID}`, (state as Record<string, Json>).output, 2048),
          title: token("title", (state as Record<string, Json>).title),
          attachments: [],
        },
      }
      break
    }
    case "file":
      sanitized = {
        ...data,
        mime: typeof data.mime === "string" ? data.mime : "text/plain",
        filename: token("file", data.filename),
        url: `file://${sanitizePath(data.url)}`,
        source: {
          type: "file",
          path: token("file-path", JSON.stringify(data.source)),
          text: { value: placeholder(`file source ${rowID}`, JSON.stringify(data.source), 128), start: 0, end: 16 },
        },
      }
      break
    case "patch":
      sanitized = { ...data, files: [], hash: token("hash", data.hash) }
      break
    case "step-start":
    case "step-finish":
      sanitized = { ...data, snapshot: token("snapshot", data.snapshot) }
      break
    default:
      sanitized = data
      break
  }
  return scrubStrings(sanitized) as Record<string, Json>
}

const sessionRow = cell<Record<string, Json>>("select * from session where id = ?", sessionID)!
db.run(
  `update session set slug = ?, directory = ?, path = ?, title = ?, share_url = null, summary_diffs = null, permission = null, agent = ?, model = ? where id = ?`,
  [
    "compact-large-session-repro",
    "/tmp/opencode-repro",
    "/tmp/opencode-repro",
    "Anonymized compact large session reproducer",
    "build",
    JSON.stringify({ providerID: "openai", id: "gpt-5.1-codex-max" }),
    sessionID,
  ],
)

db.run("update project set worktree = ?, vcs = null, name = ?, icon_url = null, icon_url_override = null, commands = null where id = ?", [
  "/tmp/opencode-repro",
  "opencode-repro",
  keepProjectID,
])

const updateMessage = db.prepare("update message set data = ? where id = ?")
for (const row of rows<{ id: string; data: string }>("select id, data from message where session_id = ?", sessionID)) {
  updateMessage.run(JSON.stringify(sanitizeMessageData(JSON.parse(row.data))), row.id)
}

const updatePart = db.prepare("update part set data = ? where id = ?")
for (const row of rows<{ id: string; data: string }>("select id, data from part where session_id = ?", sessionID)) {
  updatePart.run(JSON.stringify(sanitizePartData(JSON.parse(row.data), row.id)), row.id)
}

const updateEvent = db.prepare("update event set data = ? where id = ?")
for (const row of rows<{ id: string; data: string }>("select id, data from event")) {
  const value = JSON.parse(row.data)
  updateEvent.run(JSON.stringify(value, (_key, entry) => (typeof entry === "string" ? token("event", entry) : entry)), row.id)
}

db.run("delete from todo")
db.run("delete from session_message")
db.run("vacuum")

const counts = {
  sessionID,
  sourceTitle: sessionRow.title,
  output,
  messages: cell<{ count: number }>("select count(*) count from message where session_id = ?", sessionID)?.count,
  parts: cell<{ count: number }>("select count(*) count from part where session_id = ?", sessionID)?.count,
  partBytes: cell<{ bytes: number }>("select sum(length(data)) bytes from part where session_id = ?", sessionID)?.bytes,
}
console.log(JSON.stringify(counts, null, 2))
db.close()
