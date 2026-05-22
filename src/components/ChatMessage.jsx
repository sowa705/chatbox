import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

function AttachmentContextMenu({ x, y, att, onClose }) {
  const menuRef = useRef(null)
  const [copyState, setCopyState] = useState('idle') // 'idle' | 'copying' | 'done' | 'error'

  useEffect(() => {
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose()
    }
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const dataUrl = att.content || att.data || att.preview || ''
  const isMedia = att.type === 'video' || att.type === 'audio'

  const handleSave = async () => {
    onClose()
    try {
      await window.electronAPI.saveAttachmentToFile(dataUrl, att.name || 'attachment')
    } catch (err) {
      console.error('Failed to save attachment:', err)
    }
  }

  const handleCopy = async () => {
    setCopyState('copying')
    try {
      const result = await window.electronAPI.copyAttachmentToClipboard(dataUrl, att.type)
      if (result?.success) {
        setCopyState('done')
        setTimeout(() => onClose(), 900)
      } else {
        setCopyState('error')
        setTimeout(() => setCopyState('idle'), 2000)
      }
    } catch (err) {
      console.error('Failed to copy attachment:', err)
      setCopyState('error')
      setTimeout(() => setCopyState('idle'), 2000)
    }
  }

  const copyLabel =
    copyState === 'done'  ? 'Copied!' :
    copyState === 'error' ? 'Failed' :
    isMedia               ? 'Copy path to clipboard' :
                            'Copy to clipboard'

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[170px]"
      style={{ left: x, top: y }}
    >
      <button
        onClick={handleSave}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Save as…
      </button>
      <button
        onClick={handleCopy}
        disabled={copyState === 'copying' || copyState === 'done'}
        className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors disabled:cursor-default
          ${copyState === 'done'  ? 'text-green-600 dark:text-green-400' :
            copyState === 'error' ? 'text-red-500 dark:text-red-400' :
            'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
      >
        {copyState === 'done' ? (
          <svg className="w-4 h-4 flex-shrink-0 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        )}
        {copyLabel}
      </button>
    </div>
  )
}

function formatJson(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function toolOutputText(result) {
  if (!result) return ''
  const parts = []
  for (const item of result.content || []) {
    if (item.type === 'text') parts.push(item.text)
    else if (item.type === 'image') parts.push(`[image: ${item.mimeType || 'image'}]`)
    else if (item.type === 'audio') parts.push(`[audio: ${item.mimeType || 'audio'}]`)
    else if (item.type === 'resource_link') parts.push(`[resource: ${item.uri}]`)
    else if (item.type === 'resource') parts.push(`[resource: ${item.resource?.uri || 'embedded resource'}]`)
    else parts.push(formatJson(item))
  }
  if (result.structuredContent) {
    if (Array.isArray(result.structuredContent.previews)) {
      parts.push(`Displayed inline previews:\n${result.structuredContent.previews.map(preview => `- ${preview.path} (${preview.mimeType}, ${preview.sizeBytes} bytes)`).join('\n')}`)
    } else {
      parts.push(formatJson(result.structuredContent))
    }
  }
  return parts.join('\n\n')
}

function FilePreview({ preview, threadId }) {
  if (!preview) return null

  const handleCopyPath = async () => {
    try {
      await window.electronAPI.copyWorkspaceFilePath(threadId, preview.path)
    } catch (err) {
      console.error('Failed to copy file path:', err)
    }
  }

  const handleOpenFolder = async () => {
    try {
      await window.electronAPI.openWorkspaceContainingFolder(threadId, preview.path)
    } catch (err) {
      console.error('Failed to open containing folder:', err)
    }
  }

  const handleSaveAs = async () => {
    try {
      await window.electronAPI.saveWorkspaceFileAs(threadId, preview.path)
    } catch (err) {
      console.error('Failed to save file:', err)
    }
  }

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-3 py-2 text-xs dark:border-gray-700">
        <div className="min-w-0">
          <div className="truncate font-medium text-gray-700 dark:text-gray-300">{preview.title || preview.name}</div>
          <div className="truncate text-gray-400 dark:text-gray-600">{preview.path}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-gray-400 dark:text-gray-600">{preview.mimeType}</span>
          {threadId && (
            <>
              <button
                type="button"
                onClick={handleSaveAs}
                className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              >
                Save as
              </button>
              <button
                type="button"
                onClick={handleCopyPath}
                className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              >
                Copy path
              </button>
              <button
                type="button"
                onClick={handleOpenFolder}
                className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              >
                Open folder
              </button>
            </>
          )}
        </div>
      </div>
      {preview.kind === 'image' ? (
        <div className="bg-gray-50 p-3 dark:bg-gray-950">
          <img
            src={preview.dataUrl}
            alt={preview.title || preview.name}
            className="max-h-[420px] max-w-full rounded object-contain"
          />
        </div>
      ) : preview.kind === 'video' ? (
        <div className="bg-black">
          <video src={preview.dataUrl} controls className="max-h-[520px] w-full" />
        </div>
      ) : preview.kind === 'audio' ? (
        <div className="bg-gray-50 p-3 dark:bg-gray-950">
          <audio src={preview.dataUrl} controls className="w-full" />
        </div>
      ) : preview.kind === 'embed' ? (
        <iframe
          title={preview.title || preview.name}
          src={preview.dataUrl}
          className="h-[520px] w-full bg-white dark:bg-gray-950"
        />
      ) : preview.text != null ? (
        <pre className="max-h-[420px] overflow-auto bg-gray-50 p-3 text-xs text-gray-700 dark:bg-gray-950 dark:text-gray-300">
          <code>{preview.text}</code>
        </pre>
      ) : (
        <div className="p-3 text-sm text-gray-500 dark:text-gray-400">Preview is available as an attachment-sized file.</div>
      )}
    </div>
  )
}

function FilePreviews({ result, threadId }) {
  const previews = result?.structuredContent?.previews || []
  if (previews.length === 0) return null
  return (
    <div className="space-y-2">
      {previews.map((preview, index) => (
        <FilePreview key={`${preview.path || preview.name}-${index}`} preview={preview} threadId={threadId} />
      ))}
    </div>
  )
}

function InlineFilePreview({ threadId, filePath, title }) {
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setPreview(null)
    setError(null)
    window.electronAPI.previewWorkspaceFile(threadId, filePath, title)
      .then(result => {
        if (!cancelled) setPreview(result)
      })
      .catch(err => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [threadId, filePath, title])

  if (error) {
    return (
      <div className="my-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        Failed to preview {filePath}: {error}
      </div>
    )
  }

  if (!preview) {
    return (
      <div className="my-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
        Loading preview for {filePath}...
      </div>
    )
  }

  return <FilePreview preview={preview} threadId={threadId} />
}

function AssistantContent({ content, threadId }) {
  const parts = []
  const regex = /\[\[preview:([^\]|]+)(?:\|([^\]]+))?\]\]/g
  let lastIndex = 0
  let match

  while ((match = regex.exec(content || '')) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', text: content.slice(lastIndex, match.index) })
    }
    parts.push({
      type: 'preview',
      path: match[1].trim(),
      title: match[2]?.trim() || null
    })
    lastIndex = regex.lastIndex
  }

  if (lastIndex < (content || '').length) {
    parts.push({ type: 'text', text: content.slice(lastIndex) })
  }

  if (parts.length === 0) return null

  return (
    <div>
      {parts.map((part, index) => (
        part.type === 'preview' ? (
          <InlineFilePreview key={`${part.path}-${index}`} threadId={threadId} filePath={part.path} title={part.title} />
        ) : (
          <AssistantMarkdown key={`text-${index}`}>{part.text}</AssistantMarkdown>
        )
      ))}
    </div>
  )
}

function ToolCallRow({ event, threadId }) {
  const name = event.tool_name || event.toolName || 'tool'
  const status = event.status || 'running'
  const shouldDefaultOpen = !!(event._live && status !== 'running' && event.result)
  const [open, setOpen] = useState(() => shouldDefaultOpen)
  const args = event.arguments || {}
  const output = toolOutputText(event.result)

  useEffect(() => {
    if (shouldDefaultOpen) {
      setOpen(true)
    }
  }, [shouldDefaultOpen])

  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-2 text-gray-500 hover:text-gray-800 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
      >
        <svg
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="font-mono">{name}</span>
        <span className={`text-xs ${status === 'error' ? 'text-red-500' : 'text-gray-400 dark:text-gray-600'}`}>
          {status === 'running' ? 'running' : status}
          {event.duration_ms ? ` · ${event.duration_ms}ms` : ''}
        </span>
      </button>
      {open && (
        <div className="mt-2 ml-5 space-y-2 text-xs text-gray-500 dark:text-gray-400">
          <div>
            <div className="mb-1 uppercase tracking-wide text-[10px] text-gray-400 dark:text-gray-600">Arguments</div>
            <pre className="whitespace-pre-wrap break-words rounded-md bg-gray-100 dark:bg-gray-800/70 px-3 py-2 font-mono">
              {formatJson(args) || '{}'}
            </pre>
          </div>
          <div>
            <div className="mb-1 uppercase tracking-wide text-[10px] text-gray-400 dark:text-gray-600">Output</div>
            <pre className="whitespace-pre-wrap break-words rounded-md bg-gray-100 dark:bg-gray-800/70 px-3 py-2 font-mono">
              {output || (status === 'running' ? 'Running...' : '(no output)')}
            </pre>
          </div>
        </div>
      )}
      <div className="ml-5">
        <FilePreviews result={event.result} threadId={threadId} />
      </div>
    </div>
  )
}

function AssistantMarkdown({ children, muted = false }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        h1: ({ children }) => <h1 className="text-xl font-bold mb-2 mt-3 first:mt-0">{children}</h1>,
        h2: ({ children }) => <h2 className="text-lg font-bold mb-2 mt-3 first:mt-0">{children}</h2>,
        h3: ({ children }) => <h3 className="text-base font-bold mb-1 mt-2 first:mt-0">{children}</h3>,
        ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-0.5">{children}</ol>,
        li: ({ children }) => <li className="ml-2">{children}</li>,
        code: ({ inline, className, children }) =>
          inline ? (
            <code className={`${muted ? 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400' : 'bg-gray-100 dark:bg-gray-800 text-pink-600 dark:text-pink-400'} rounded px-1 py-0.5 text-[0.85em] font-mono`}>{children}</code>
          ) : (
            <code className={className}>{children}</code>
          ),
        pre: ({ children }) => (
          <pre className="bg-gray-100 dark:bg-gray-800/70 rounded-md p-3 mb-2 overflow-x-auto text-[0.85em]">{children}</pre>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-gray-300 dark:border-gray-700 pl-3 italic mb-2">{children}</blockquote>
        ),
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline hover:text-blue-800 dark:hover:text-blue-300">{children}</a>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto mb-2">
            <table className="min-w-full border border-gray-200 dark:border-gray-700 rounded text-sm">{children}</table>
          </div>
        ),
        th: ({ children }) => <th className="border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-1.5 font-semibold text-left">{children}</th>,
        td: ({ children }) => <td className="border border-gray-200 dark:border-gray-700 px-3 py-1.5">{children}</td>,
        hr: () => <hr className="my-3 border-gray-200 dark:border-gray-700" />,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
      }}
    >
      {children}
    </ReactMarkdown>
  )
}

function ChatMessage({ message, onRetry, onEdit, isStreaming }) {
  const [hovering, setHovering] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [attMenu, setAttMenu] = useState(null) // { x, y, att }

  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const hasReasoning = !!(message.reasoning_content)
  const traceEvents = [...(message.toolEvents || [])].sort((a, b) =>
    (a.sequence_index || 0) - (b.sequence_index || 0) || (a.id || 0) - (b.id || 0)
  )
  const hasTraceReasoning = traceEvents.some(event => event.event_type === 'reasoning')
  const hasTraceContent = traceEvents.some(event => event.event_type === 'content')

  const handleStartEdit = () => {
    setEditText(message.content)
    setEditing(true)
  }

  const handleSaveEdit = () => {
    if (editText.trim()) {
      onEdit(message, editText.trim())
    }
    setEditing(false)
  }

  const handleCancelEdit = () => {
    setEditing(false)
    setEditText('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSaveEdit()
    }
    if (e.key === 'Escape') {
      handleCancelEdit()
    }
  }

  const handleAttContextMenu = (e, att) => {
    e.preventDefault()
    setAttMenu({ x: e.clientX, y: e.clientY, att })
  }

  return (
    <div
      className={`group flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {attMenu && (
        <AttachmentContextMenu
          x={attMenu.x}
          y={attMenu.y}
          att={attMenu.att}
          onClose={() => setAttMenu(null)}
        />
      )}
      {/* Model label for assistant messages */}
      {isAssistant && message.model && (
        <span className="text-xs text-gray-400 dark:text-gray-500 mb-1 ml-1 font-medium">
          {message.model}
        </span>
      )}

      {/* Attachments - shown above the message bubble */}
      {message.attachments && message.attachments.length > 0 && (
        <div className={`flex flex-wrap gap-2 mb-1.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
          {message.attachments.map((att, i) => (
            <div key={i} onContextMenu={(e) => handleAttContextMenu(e, att)}>
              {att.type === 'image' ? (
                <img
                  src={att.content || att.data || att.preview}
                  alt={att.name || 'Attached image'}
                  className="max-h-48 max-w-xs rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm object-contain bg-white dark:bg-gray-800"
                />
              ) : att.type === 'audio' ? (
                <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2 border border-gray-200 dark:border-gray-700">
                  <svg className="w-5 h-5 text-purple-500 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                  </svg>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-gray-600 dark:text-gray-400 truncate max-w-[300px]">{att.name || 'Audio'}</span>
                    <audio controls className="h-8 w-[300px]" src={att.content || att.data} />
                  </div>
                </div>
              ) : att.type === 'video' ? (
                <video
                  src={att.content || att.data || att.preview}
                  controls
                  className="max-h-64 max-w-sm rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm bg-black"
                />
              ) : (
                <div className="flex items-center gap-2 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-lg px-3 py-2 border border-gray-200 dark:border-gray-700">
                  <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="max-w-[150px] truncate">{att.name || 'Document'}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className={`${isUser ? 'rounded-xl px-4 py-3 max-w-2xl shadow-sm bg-blue-600 text-white' : 'max-w-3xl w-full px-1 py-1 text-gray-900 dark:text-gray-100'}`}>
        {editing ? (
          <div className="min-w-[300px]">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full bg-transparent resize-none border-0 focus:outline-none text-sm min-h-[60px]"
              autoFocus
              rows={3}
            />
            <div className="flex gap-2 mt-2 justify-end">
              <button
                onClick={handleCancelEdit}
                className={`text-xs px-2 py-1 rounded ${
                  isUser
                    ? 'text-blue-200 hover:text-white'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                className={`text-xs px-3 py-1 rounded font-medium ${
                  isUser
                    ? 'bg-blue-500 text-white hover:bg-blue-400'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                Save & Send
              </button>
            </div>
          </div>
        ) : (
          <div className="text-sm leading-relaxed">
            {isUser ? (
              <span className="whitespace-pre-wrap">{message.content}</span>
            ) : (
              <div className="space-y-3">
                {hasReasoning && !hasTraceReasoning && (
                  <div className="text-gray-500 dark:text-gray-500">
                    <AssistantMarkdown muted>{message.reasoning_content}</AssistantMarkdown>
                  </div>
                )}
                {traceEvents.length > 0 && (
                  <div className="space-y-1">
                    {traceEvents.map((event, index) => (
                      event.event_type === 'reasoning' ? (
                        <div key={event.id || `reasoning-${index}`} className="text-gray-500 dark:text-gray-500">
                          <AssistantMarkdown muted>{event.text || ''}</AssistantMarkdown>
                        </div>
                      ) : event.event_type === 'content' ? (
                        <div key={event.id || `content-${index}`}>
                          <AssistantContent content={event.text || ''} threadId={message.thread_id} />
                        </div>
                      ) : (
                        <ToolCallRow key={event.id || `${event.tool_name}-${index}`} event={event} threadId={message.thread_id} />
                      )
                    ))}
                  </div>
                )}
                {message.content && !hasTraceContent && (
                  <div>
                    <AssistantContent content={message.content} threadId={message.thread_id} />
                  </div>
                )}
              </div>
            )}
            {isStreaming && (
              <span className="inline-block w-1.5 h-4 bg-current ml-0.5 animate-pulse" />
            )}
          </div>
        )}
      </div>

      {/* Action buttons (visible on hover) */}
      {!editing && !isStreaming && (
        <div
          className={`flex gap-1 mt-1 transition-opacity duration-150 ${
            hovering ? 'opacity-100' : 'opacity-0'
          } ${isUser ? 'flex-row-reverse' : ''}`}
        >
          {/* Edit button - both sides */}
          <button
            onClick={handleStartEdit}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            title="Edit message"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>

          {/* Retry button - assistant only */}
          {isAssistant && (
            <button
              onClick={() => onRetry(message)}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              title="Retry from here"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}

          {/* Tokens used */}
          { message.token_count !== undefined && (
            <span className="text-xs text-gray-500 ml-1">{message.token_count} tokens</span>
          )}
          {/* Response time and tok/s (assistant messages only) */}
          { message.duration_ms != null && message.role === 'assistant' && (() => {
            const secs = message.duration_ms / 1000
            const tps = message.token_count > 0 ? Math.round(message.token_count / secs) : null
            return (
              <span className="text-xs text-gray-500 ml-1">
                {secs.toFixed(1)}s{tps != null ? ` · ${tps} tok/s` : ''}
              </span>
            )
          })()}
        </div>
      )}
    </div>
  )
}

export default ChatMessage
