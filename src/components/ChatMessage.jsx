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

function ChatMessage({ message, onRetry, onEdit, isStreaming }) {
  const [hovering, setHovering] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [reasoningOpen, setReasoningOpen] = useState(isStreaming)
  const [attMenu, setAttMenu] = useState(null) // { x, y, att }

  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const hasReasoning = !!(message.reasoning_content)

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

      {/* Reasoning collapsible box - shown above assistant message bubble */}
      {isAssistant && hasReasoning && (
        <div className="max-w-2xl w-full mb-1.5">
          <button
            onClick={() => setReasoningOpen(!reasoningOpen)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <svg
              className={`w-3.5 h-3.5 transition-transform duration-200 ${reasoningOpen ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <svg className="w-3.5 h-3.5 text-amber-500" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5.002 5.002 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <span className="font-medium">Reasoning</span>
            {isStreaming && !message.content && (
              <span className="inline-block w-1.5 h-3 bg-amber-500 ml-0.5 animate-pulse rounded-sm" />
            )}
          </button>
          {reasoningOpen && (
            <div className="mt-1 ml-1 border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 rounded-lg px-3 py-2 text-xs text-gray-700 dark:text-gray-300 leading-relaxed max-h-64 overflow-y-auto">
                <ReactMarkdown>
                    {message.reasoning_content}
                </ReactMarkdown>
            </div>
          )}
        </div>
      )}

      {/* Message bubble */}
      <div
        className={`rounded-xl px-4 py-3 max-w-2xl shadow-sm ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700'
        }`}
      >
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
                      <code className="bg-gray-100 dark:bg-gray-700 text-pink-600 dark:text-pink-400 rounded px-1 py-0.5 text-[0.85em] font-mono">{children}</code>
                    ) : (
                      <code className={className}>{children}</code>
                    ),
                  pre: ({ children }) => (
                    <pre className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-3 mb-2 overflow-x-auto text-[0.85em]">{children}</pre>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-3 italic text-gray-600 dark:text-gray-400 mb-2">{children}</blockquote>
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
                {message.content}
              </ReactMarkdown>
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
        </div>
      )}
    </div>
  )
}

export default ChatMessage
