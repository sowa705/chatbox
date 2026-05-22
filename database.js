import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import OpenAI from 'openai'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Database will be stored in user data directory
const dbPath = path.join(app.getPath('userData'), 'database.db')

let db = null

export function initDatabase() {
  db = new Database(dbPath, { verbose: process.env.NODE_ENV === 'development' ? console.log : undefined })
  
  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL')
  
  // Create your tables here
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    create table if not exists providers (
      id integer primary key autoincrement,
      name text not null,
      api_base text not null,
      api_key text not null
    );

    CREATE TABLE IF NOT EXISTS threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      selected_model TEXT,
      total_tokens INTEGER DEFAULT 0,
      total_cost REAL DEFAULT 0,
      sampling_params TEXT,
      workspace_path TEXT,
      container_id TEXT,
      container_status TEXT
    );

    create table if not exists messages (
      timestamp integer primary key,
      deleted boolean default false,
      thread_id integer not null,
      role text not null,
      model text,
      content text not null,
      token_count integer default 0,
      reasoning_content text,
      duration_ms integer default null,
      foreign key (thread_id) references threads(id)
    );

    create table if not exists attachments (
        id integer primary key autoincrement,
        message_id integer not null,
        type text not null,
        content blob not null,
        name TEXT,
        mime_type TEXT,
        workspace_path TEXT,
        size_bytes INTEGER,
        foreign key (message_id) references messages(timestamp)
    );

    create table if not exists mcp_servers (
      id integer primary key autoincrement,
      name text not null,
      transport text not null,
      command text,
      args_json text,
      env_json text,
      url text,
      headers_json text,
      enabled integer default 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    create table if not exists tool_events (
      id integer primary key autoincrement,
      thread_id integer not null,
      message_id integer,
      event_type text default 'tool',
      sequence_index integer default 0,
      tool_call_id text,
      tool_name text not null,
      arguments_json text,
      result_json text,
      text text,
      status text not null,
      duration_ms integer,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      foreign key (thread_id) references threads(id)
    );
  `)

  console.log('Database initialized at:', dbPath)

  // Migrations: add columns to existing databases that predate them
  try { db.exec(`ALTER TABLE threads ADD COLUMN total_cost REAL DEFAULT 0`) } catch {}
  try { db.exec(`ALTER TABLE attachments ADD COLUMN name TEXT`) } catch {}
  try { db.exec(`ALTER TABLE messages ADD COLUMN duration_ms INTEGER DEFAULT NULL`) } catch {}
  try { db.exec(`ALTER TABLE threads ADD COLUMN workspace_path TEXT`) } catch {}
  try { db.exec(`ALTER TABLE threads ADD COLUMN container_id TEXT`) } catch {}
  try { db.exec(`ALTER TABLE threads ADD COLUMN container_status TEXT`) } catch {}
  try { db.exec(`ALTER TABLE attachments ADD COLUMN mime_type TEXT`) } catch {}
  try { db.exec(`ALTER TABLE attachments ADD COLUMN workspace_path TEXT`) } catch {}
  try { db.exec(`ALTER TABLE attachments ADD COLUMN size_bytes INTEGER`) } catch {}
  try { db.exec(`ALTER TABLE tool_events ADD COLUMN event_type TEXT DEFAULT 'tool'`) } catch {}
  try { db.exec(`ALTER TABLE tool_events ADD COLUMN sequence_index INTEGER DEFAULT 0`) } catch {}
  try { db.exec(`ALTER TABLE tool_events ADD COLUMN text TEXT`) } catch {}

  return db
}

export function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

export function closeDatabase() {
  if (db) {
    db.close()
    db = null
  }
}

// Example CRUD operations
export const dbOperations = {
  // Settings
  getSetting: (key) => {
    const stmt = db.prepare('SELECT value FROM settings WHERE key = ?')
    const row = stmt.get(key)
    return row ? JSON.parse(row.value) : null
  },
  
  setSetting: (key, value) => {
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    stmt.run(key, JSON.stringify(value))
  },

  // Thread operations
  getAllThreads: () => {
    const stmt = db.prepare('SELECT * FROM threads ORDER BY updated_at DESC')
    return stmt.all()
  },

  getThreadById: (id) => {
    const stmt = db.prepare('SELECT * FROM threads WHERE id = ?')
    return stmt.get(id)
  },

  createThread: (model) => {
    const stmt = db.prepare('INSERT INTO threads (selected_model) VALUES (?)')
    const result = stmt.run(model)
    return result.lastInsertRowid
  },

  updateThreadModel: (threadId, model) => {
    const stmt = db.prepare('UPDATE threads SET selected_model = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    stmt.run(model, threadId)
  },

  updateThreadWorkspace: (threadId, workspacePath, containerId = null, containerStatus = null) => {
    const stmt = db.prepare('UPDATE threads SET workspace_path = ?, container_id = ?, container_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    stmt.run(workspacePath, containerId, containerStatus, threadId)
  },

  updateThreadContainer: (threadId, containerId, containerStatus) => {
    const stmt = db.prepare('UPDATE threads SET container_id = ?, container_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    stmt.run(containerId, containerStatus, threadId)
  },

  setThreadLabel: (threadId, label) => {
    const stmt = db.prepare('UPDATE threads SET label = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    stmt.run(label, threadId)
  },

  deleteThread: (threadId) => {
    const deleteThread = db.transaction((id) => {
      db.prepare('DELETE FROM attachments WHERE message_id IN (SELECT timestamp FROM messages WHERE thread_id = ?)').run(id)
      db.prepare('DELETE FROM messages WHERE thread_id = ?').run(id)
      db.prepare('DELETE FROM threads WHERE id = ?').run(id)
    })
    deleteThread(threadId)
  },

  // Message operations
  getMessagesByThread: (threadId) => {
    const stmt = db.prepare('SELECT * FROM messages WHERE thread_id = ? AND deleted = 0 ORDER BY timestamp ASC')
    return stmt.all(threadId)
  },

  getMessageByTimestamp: (timestamp) => {
    const stmt = db.prepare('SELECT * FROM messages WHERE timestamp = ?')
    return stmt.get(timestamp)
  },

  addMessage: (threadId, role, model, content, tokenCount = 0, reasoningContent = null, durationMs = null) => {
    let ts = Date.now()
    // Ensure unique timestamp for each message
    while (db.prepare('SELECT 1 FROM messages WHERE timestamp = ?').get(ts)) {
      ts++
    }

    const stmt = db.prepare('INSERT INTO messages (timestamp, thread_id, role, model, content, token_count, reasoning_content, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    stmt.run(ts, threadId, role, model, content, tokenCount, reasoningContent, durationMs)
    // Touch thread updated_at
    db.prepare('UPDATE threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(threadId)
    return ts
  },

  updateMessageContent: (timestamp, content) => {
    const stmt = db.prepare('UPDATE messages SET content = ? WHERE timestamp = ?')
    stmt.run(content, timestamp)
  },

  updateMessageTokenCount: (timestamp, tokenCount) => {
    const stmt = db.prepare('UPDATE messages SET token_count = ? WHERE timestamp = ?')
    stmt.run(tokenCount, timestamp)
  },

  deleteMessagesFrom: (threadId, fromTimestamp) => {
    // Soft-delete all messages in a thread at or after the given timestamp
    db.prepare('UPDATE messages SET deleted = 1 WHERE thread_id = ? AND timestamp >= ?').run(threadId, fromTimestamp)
  },

  getThreadTokenCount: (threadId) => {
    // Return the total_tokens stored on the thread itself
    const stmt = db.prepare('SELECT total_tokens FROM threads WHERE id = ?')
    const row = stmt.get(threadId)
    return row ? row.total_tokens : 0
  },

  updateThreadTotalTokens: (threadId, totalTokens) => {
    const stmt = db.prepare('UPDATE threads SET total_tokens = ? WHERE id = ?')
    stmt.run(totalTokens, threadId)
  },

  getThreadCost: (threadId) => {
    const stmt = db.prepare('SELECT total_cost FROM threads WHERE id = ?')
    const row = stmt.get(threadId)
    return row ? (row.total_cost || 0) : 0
  },

  addToThreadCost: (threadId, cost) => {
    const stmt = db.prepare('UPDATE threads SET total_cost = COALESCE(total_cost, 0) + ? WHERE id = ?')
    stmt.run(cost, threadId)
  },

  updateThreadSamplingParams: (threadId, params) => {
    const stmt = db.prepare('UPDATE threads SET sampling_params = ? WHERE id = ?')
    stmt.run(JSON.stringify(params), threadId)
  },

  // Attachment operations
  addAttachment: (messageId, type, content, name = null, mimeType = null, workspacePath = null, sizeBytes = null) => {
    const stmt = db.prepare('INSERT INTO attachments (message_id, type, content, name, mime_type, workspace_path, size_bytes) VALUES (?, ?, ?, ?, ?, ?, ?)')
    stmt.run(messageId, type, content, name, mimeType, workspacePath, sizeBytes)
  },

  getAttachmentsByMessage: (messageId) => {
    const stmt = db.prepare('SELECT * FROM attachments WHERE message_id = ?')
    return stmt.all(messageId)
  },

  // MCP server operations
  getAllMcpServers: () => {
    const stmt = db.prepare('SELECT * FROM mcp_servers ORDER BY id')
    return stmt.all().map(row => ({
      ...row,
      args: row.args_json ? JSON.parse(row.args_json) : [],
      env: row.env_json ? JSON.parse(row.env_json) : {},
      headers: row.headers_json ? JSON.parse(row.headers_json) : {},
      enabled: !!row.enabled
    }))
  },

  getEnabledMcpServers: () => {
    const stmt = db.prepare('SELECT * FROM mcp_servers WHERE enabled = 1 ORDER BY id')
    return stmt.all().map(row => ({
      ...row,
      args: row.args_json ? JSON.parse(row.args_json) : [],
      env: row.env_json ? JSON.parse(row.env_json) : {},
      headers: row.headers_json ? JSON.parse(row.headers_json) : {},
      enabled: !!row.enabled
    }))
  },

  createMcpServer: (server) => {
    const stmt = db.prepare(`
      INSERT INTO mcp_servers (name, transport, command, args_json, env_json, url, headers_json, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const result = stmt.run(
      server.name,
      server.transport,
      server.command || null,
      JSON.stringify(server.args || []),
      JSON.stringify(server.env || {}),
      server.url || null,
      JSON.stringify(server.headers || {}),
      server.enabled ? 1 : 0
    )
    return result.lastInsertRowid
  },

  updateMcpServer: (id, server) => {
    const stmt = db.prepare(`
      UPDATE mcp_servers
      SET name = ?, transport = ?, command = ?, args_json = ?, env_json = ?, url = ?, headers_json = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    stmt.run(
      server.name,
      server.transport,
      server.command || null,
      JSON.stringify(server.args || []),
      JSON.stringify(server.env || {}),
      server.url || null,
      JSON.stringify(server.headers || {}),
      server.enabled ? 1 : 0,
      id
    )
  },

  deleteMcpServer: (id) => {
    db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id)
  },

  addToolEvent: (event) => {
    const stmt = db.prepare(`
      INSERT INTO tool_events (thread_id, message_id, event_type, sequence_index, tool_call_id, tool_name, arguments_json, result_json, text, status, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const result = stmt.run(
      event.threadId,
      event.messageId || null,
      event.eventType || 'tool',
      event.sequenceIndex || 0,
      event.toolCallId || null,
      event.toolName || '__reasoning__',
      JSON.stringify(event.arguments || {}),
      JSON.stringify(event.result || null),
      event.text || null,
      event.status,
      event.durationMs || null
    )
    return result.lastInsertRowid
  },

  getToolEventsByThread: (threadId) => {
    const stmt = db.prepare('SELECT * FROM tool_events WHERE thread_id = ? ORDER BY COALESCE(message_id, 0), sequence_index ASC, id ASC')
    return stmt.all(threadId).map(row => ({
      ...row,
      arguments: row.arguments_json ? JSON.parse(row.arguments_json) : {},
      result: row.result_json ? JSON.parse(row.result_json) : null
    }))
  },

  assignPendingToolEventsToMessage: (threadId, messageId) => {
    const stmt = db.prepare('UPDATE tool_events SET message_id = ? WHERE thread_id = ? AND message_id IS NULL')
    stmt.run(messageId, threadId)
  },

  // Provider operations
  getAllProviders: () => {
    const stmt = db.prepare('SELECT * FROM providers ORDER BY id')
    return stmt.all()
  },

  getProviderById: (id) => {
    const stmt = db.prepare('SELECT * FROM providers WHERE id = ?')
    return stmt.get(id)
  },

  createProvider: (name, apiBase, apiKey) => {
    const stmt = db.prepare('INSERT INTO providers (name, api_base, api_key) VALUES (?, ?, ?)')
    const result = stmt.run(name, apiBase, apiKey)
    return result.lastInsertRowid
  },

  updateProvider: (id, name, apiBase, apiKey) => {
    const stmt = db.prepare('UPDATE providers SET name = ?, api_base = ?, api_key = ? WHERE id = ?')
    stmt.run(name, apiBase, apiKey, id)
  },

  deleteProvider: (id) => {
    const stmt = db.prepare('DELETE FROM providers WHERE id = ?')
    stmt.run(id)
  },

  getDatabaseStats: () => {
    const threadCount = db.prepare('SELECT COUNT(*) as count FROM threads').get().count
    const messageCount = db.prepare('SELECT COUNT(*) as count FROM messages WHERE deleted = 0').get().count
    const attachmentCount = db.prepare('SELECT COUNT(*) as count FROM attachments').get().count
    const sizeBytes = fs.statSync(dbPath).size
    return { threadCount, messageCount, attachmentCount, sizeBytes }
  }
}

export async function listProviderModels(providerId) {
  const provider = dbOperations.getProviderById(providerId)
  if (!provider) {
    throw new Error('Provider not found')
  }

  const openai = new OpenAI({
    apiKey: provider.api_key,
    baseURL: provider.api_base
  })

  const modelList = await openai.models.list()

  const models = modelList.data.map(m => {
    // OpenRouter uses context_length, OpenAI uses context_window
    const contextWindow = m.context_length || m.context_window || null
    // OpenRouter provides architecture.input_modalities: ["text", "image", "file"]
    const modalities = m.architecture?.input_modalities || null
    // OpenRouter provides supported_parameters: ["reasoning", "reasoning_effort", ...]
    const supportedParameters = m.supported_parameters || null
    // OpenRouter provides pricing: { prompt, completion } as cost-per-token strings
    const pricing = m.pricing ? {
      prompt: parseFloat(m.pricing.prompt) || 0,
      completion: parseFloat(m.pricing.completion) || 0,
    } : null
    return { id: m.id, provider: provider.name, providerId: provider.id, contextWindow, modalities, supportedParameters, pricing }
  })

  // If any models are missing context window info and the base URL ends with /v1,
  // try fetching from Ollama's native /api/show endpoint
  const hasMissingCtx = models.some(m => !m.contextWindow)
  const looksLikeOllama = provider.api_base.replace(/\/$/, '').endsWith('/v1')

  if (hasMissingCtx && looksLikeOllama) {
    const ollamaBase = provider.api_base.replace(/\/v1\/?$/, '')
    for (const model of models) {
      if (model.contextWindow && model.modalities) continue
      try {
        const resp = await fetch(`${ollamaBase}/api/show`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: model.id })
        })
        if (resp.ok) {
          const info = await resp.json()
          // Ollama stores context length in model_info under keys like "llama.context_length"
          if (info.model_info && !model.contextWindow) {
            const ctxKey = Object.keys(info.model_info).find(k => k.endsWith('.context_length'))
            if (ctxKey) {
              model.contextWindow = info.model_info[ctxKey]
            }
          }
          // Infer modalities from model_info keys (vision models have clip or projector keys)
          if (!model.modalities) {
            const hasVision = info.model_info
              ? Object.keys(info.model_info).some(k => k.startsWith('clip.') || k.includes('vision'))
              : false
            model.modalities = hasVision ? ['text', 'image'] : ['text']
          }
        }
      } catch (e) {
        // Not an Ollama instance or model info unavailable, skip silently
      }
    }
  }

  // For any Ollama models that didn't get modalities from /api/show, infer from name
  if (looksLikeOllama) {
    const visionNamePatterns = /llava|bakllava|moondream|minicpm-v|cogvlm|qwen.*vl|internvl|phi.*vision|gemma.*vision|vision/i
    for (const model of models) {
      if (!model.modalities) {
        model.modalities = visionNamePatterns.test(model.id) ? ['text', 'image'] : ['text']
      }
    }
  }

  return models
}

export async function sendChatStream(providerIdNum, modelId, messages, win, samplingParams = {}) {
  const provider = dbOperations.getProviderById(providerIdNum)
  if (!provider) {
    throw new Error('Provider not found')
  }

  const openai = new OpenAI({
    apiKey: provider.api_key,
    baseURL: provider.api_base
  })

  // Build optional sampling parameters, omitting undefined/null values
  const extraParams = {}
  if (samplingParams.temperature != null) extraParams.temperature = samplingParams.temperature
  if (samplingParams.max_tokens != null) extraParams.max_tokens = samplingParams.max_tokens
  if (samplingParams.top_p != null) extraParams.top_p = samplingParams.top_p
  if (samplingParams.top_k != null) extraParams.top_k = samplingParams.top_k

  // Build reasoning config for OpenRouter (passed via extra_body)
  // reasoning.mode: 'off' | 'effort' | 'tokens'
  const reasoningMode = samplingParams.reasoning_mode
  let extraBody = undefined
  if (reasoningMode === 'effort' && samplingParams.reasoning_effort) {
    const reasoningObj = { effort: samplingParams.reasoning_effort }
    if (samplingParams.reasoning_exclude) reasoningObj.exclude = true
    extraBody = { reasoning: reasoningObj }
  } else if (reasoningMode === 'tokens' && samplingParams.reasoning_max_tokens != null) {
    const reasoningObj = { max_tokens: samplingParams.reasoning_max_tokens }
    if (samplingParams.reasoning_exclude) reasoningObj.exclude = true
    extraBody = { reasoning: reasoningObj }
  } else if (reasoningMode === 'off') {
    extraBody = { reasoning: { effort: 'none' } }
  }

  let stream
  try {
    stream = await openai.chat.completions.create({
      model: modelId,
      messages: messages,
      stream: true,
      stream_options: { include_usage: true },
      ...extraParams,
      ...(extraBody ? extraBody : {})
    })
  } catch (e) {
    // Fallback: some providers may not support stream_options
    stream = await openai.chat.completions.create({
      model: modelId,
      messages: messages,
      stream: true,
      ...extraParams,
      ...(extraBody ? extraBody : {})
    })
  }

  // Store stream reference so it can be cancelled
  activeStream = stream

  let fullContent = ''
  let fullReasoning = ''
  let usage = null
  const streamStartTime = Date.now()
  try {
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta
      const contentDelta = delta?.content || ''
      fullContent += contentDelta

      // Capture reasoning tokens from various provider formats
      let reasoningDelta = ''
      if (delta?.reasoning_content) {
        reasoningDelta = delta.reasoning_content
      } else if (delta?.reasoning) {
        reasoningDelta = delta.reasoning
      } else if (delta?.reasoning_details && Array.isArray(delta.reasoning_details)) {
        // Structured reasoning_details array (OpenRouter unified format)
        for (const detail of delta.reasoning_details) {
          if (detail.type === 'reasoning.text' && detail.text) {
            reasoningDelta += detail.text
          } else if (detail.type === 'reasoning.summary' && detail.summary) {
            reasoningDelta += detail.summary
          }
        }
      }

      if (reasoningDelta) {
        fullReasoning += reasoningDelta
        win.webContents.send('chat:stream-reasoning-chunk', reasoningDelta)
      }

      if (chunk.usage) {
        usage = chunk.usage
      }
      if (contentDelta) {
        win.webContents.send('chat:stream-chunk', contentDelta)
      }
    }
  } catch (err) {
    // Stream was aborted or errored — treat as cancellation if we have partial content
    if (streamCancelled) {
      streamCancelled = false
      activeStream = null
      const durationMs = Date.now() - streamStartTime
      win.webContents.send('chat:stream-cancelled', fullContent, fullReasoning || null, durationMs)
      return { content: fullContent, usage, reasoning: fullReasoning || null, durationMs, cancelled: true }
    }
    throw err
  }

  activeStream = null
  const durationMs = Date.now() - streamStartTime
  win.webContents.send('chat:stream-done', fullContent, usage, fullReasoning || null, durationMs)
  return { content: fullContent, usage, reasoning: fullReasoning || null, durationMs }
}

// Module-level state for the active stream
let activeStream = null
let streamCancelled = false

export function cancelChatStream() {
  if (activeStream) {
    streamCancelled = true
    activeStream.controller?.abort()
    activeStream = null
  }
}

export async function testProvider(providerId) {
  const provider = dbOperations.getProviderById(providerId)
  if (!provider) {
    throw new Error('Provider not found')
  }

  try {
    const openai = new OpenAI({
      apiKey: provider.api_key,
      baseURL: provider.api_base
    })

    const modelList = await openai.models.list()

    return {
        success: true,
        models: modelList.data.map(m => m.id)
    }
  } catch (error) {
    throw new Error(`Provider test failed: ${error.message}`)
  }
}

/**
 * Generate a short thread label from the first user message using the configured label model.
 * Returns a trimmed one-line string, or null if the model is not configured / request fails.
 */
export async function generateThreadLabel(userMessageText) {
  const labelModelSetting = dbOperations.getSetting('labelModel')
  if (!labelModelSetting) return null

  const { providerId, modelId } = labelModelSetting
  const provider = dbOperations.getProviderById(providerId)
  if (!provider) return null

  try {
    const openai = new OpenAI({
      apiKey: provider.api_key,
      baseURL: provider.api_base
    })

    const resp = await openai.chat.completions.create({
      model: modelId,
      messages: [
        {
          role: 'system',
          content: 'You generate very short conversation titles. Respond with only a concise title (2–6 words, no punctuation, no quotes). Do not explain, just output the title.'
        },
        {
          role: 'user',
          content: `Generate a short title for a conversation that starts with:\n"${userMessageText.substring(0, 500)}"`
        }
      ],
      max_tokens: 20,
      stream: false
    })

    const label = resp.choices?.[0]?.message?.content?.trim()
    return label || null
  } catch (err) {
    console.error('Failed to generate thread label:', err)
    return null
  }
}
