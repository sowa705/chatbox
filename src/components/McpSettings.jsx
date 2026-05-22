import { useEffect, useState } from 'react'
import { useDatabase } from '../hooks/useDatabase'

const emptyForm = {
  name: '',
  transport: 'stdio',
  command: '',
  argsText: '[]',
  envText: '{}',
  url: '',
  headersText: '{}',
  enabled: true
}

function parseJsonField(value, fallback, label) {
  try {
    return value?.trim() ? JSON.parse(value) : fallback
  } catch {
    throw new Error(`${label} must be valid JSON`)
  }
}

function serverToForm(server) {
  return {
    name: server.name || '',
    transport: server.transport || 'stdio',
    command: server.command || '',
    argsText: JSON.stringify(server.args || [], null, 2),
    envText: JSON.stringify(server.env || {}, null, 2),
    url: server.url || '',
    headersText: JSON.stringify(server.headers || {}, null, 2),
    enabled: !!server.enabled
  }
}

function formToServer(form) {
  return {
    name: form.name.trim(),
    transport: form.transport,
    command: form.transport === 'stdio' ? form.command.trim() : null,
    args: form.transport === 'stdio' ? parseJsonField(form.argsText, [], 'Arguments') : [],
    env: form.transport === 'stdio' ? parseJsonField(form.envText, {}, 'Environment') : {},
    url: form.transport === 'http' ? form.url.trim() : null,
    headers: form.transport === 'http' ? parseJsonField(form.headersText, {}, 'Headers') : {},
    enabled: form.enabled
  }
}

function McpSettings() {
  const db = useDatabase()
  const [servers, setServers] = useState([])
  const [isAdding, setIsAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [testResult, setTestResult] = useState(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (db.isReady) loadServers()
  }, [db.isReady])

  const loadServers = async () => {
    const data = await db.getAllMcpServers()
    setServers(data || [])
  }

  const reset = () => {
    setIsAdding(false)
    setEditingId(null)
    setForm(emptyForm)
    setTestResult(null)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    try {
      const server = formToServer(form)
      if (!server.name) throw new Error('Name is required')
      if (server.transport === 'stdio' && !server.command) throw new Error('Command is required')
      if (server.transport === 'http' && !server.url) throw new Error('URL is required')
      if (editingId) await db.updateMcpServer(editingId, server)
      else await db.createMcpServer(server)
      await loadServers()
      reset()
    } catch (err) {
      alert(err.message)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await db.testMcpServer(formToServer(form))
      setTestResult({ success: true, text: `Tools: ${(result.tools || []).join(', ') || '(none)'}` })
    } catch (err) {
      setTestResult({ success: false, text: err.message })
    } finally {
      setTesting(false)
    }
  }

  const handleEdit = (server) => {
    setEditingId(server.id)
    setForm(serverToForm(server))
    setIsAdding(true)
    setTestResult(null)
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this MCP server?')) return
    await db.deleteMcpServer(id)
    await loadServers()
  }

  if (!db.isReady) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
  }

  return (
    <div className="space-y-6">
      {!isAdding && (
        <button
          onClick={() => setIsAdding(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          + Add MCP Server
        </button>
      )}

      {isAdding && (
        <form onSubmit={handleSubmit} className="space-y-4 bg-gray-50 dark:bg-gray-900 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <h4 className="text-lg font-medium text-gray-900 dark:text-gray-100">
              {editingId ? 'Edit MCP Server' : 'Add MCP Server'}
            </h4>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={e => setForm({ ...form, enabled: e.target.checked })}
              />
              Enabled
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
            <input
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Transport</label>
            <select
              value={form.transport}
              onChange={e => setForm({ ...form, transport: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            >
              <option value="stdio">stdio</option>
              <option value="http">Streamable HTTP</option>
            </select>
          </div>

          {form.transport === 'stdio' ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Command</label>
                <input
                  value={form.command}
                  onChange={e => setForm({ ...form, command: e.target.value })}
                  placeholder="npx"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Arguments JSON</label>
                <textarea
                  rows={3}
                  value={form.argsText}
                  onChange={e => setForm({ ...form, argsText: e.target.value })}
                  className="w-full px-3 py-2 font-mono text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Environment JSON</label>
                <textarea
                  rows={3}
                  value={form.envText}
                  onChange={e => setForm({ ...form, envText: e.target.value })}
                  className="w-full px-3 py-2 font-mono text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">MCP URL</label>
                <input
                  value={form.url}
                  onChange={e => setForm({ ...form, url: e.target.value })}
                  placeholder="http://localhost:3000/mcp"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Headers JSON</label>
                <textarea
                  rows={3}
                  value={form.headersText}
                  onChange={e => setForm({ ...form, headersText: e.target.value })}
                  className="w-full px-3 py-2 font-mono text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              </div>
            </>
          )}

          {testResult && (
            <div className={`text-sm rounded-lg px-3 py-2 ${testResult.success ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}>
              {testResult.text}
            </div>
          )}

          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
              {editingId ? 'Update' : 'Add'}
            </button>
            <button type="button" onClick={handleTest} disabled={testing} className="px-4 py-2 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded-lg hover:bg-green-200 dark:hover:bg-green-900/60 disabled:opacity-50 transition-colors">
              {testing ? 'Testing...' : 'Test'}
            </button>
            <button type="button" onClick={reset} className="px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        <h4 className="text-lg font-medium text-gray-900 dark:text-gray-100">Configured MCP Servers</h4>
        {servers.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400">No MCP servers configured yet.</p>
        ) : (
          servers.map(server => (
            <div key={server.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h5 className="font-medium text-gray-900 dark:text-gray-100">
                    {server.name}
                    {!server.enabled && <span className="ml-2 text-xs text-gray-400">disabled</span>}
                  </h5>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 truncate">
                    {server.transport === 'stdio'
                      ? `${server.command} ${(server.args || []).join(' ')}`
                      : server.url}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => handleEdit(server)} className="px-3 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-900/60 text-sm">
                    Edit
                  </button>
                  <button onClick={() => handleDelete(server.id)} className="px-3 py-1 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-900/60 text-sm">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default McpSettings
