import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

function ChatMessage({ message, onRetry, onEdit, isStreaming }) {
  const [hovering, setHovering] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [reasoningOpen, setReasoningOpen] = useState(isStreaming)

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

  return (
    <div
      className={`group flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {/* Model label for assistant messages */}
      {isAssistant && message.model && (
        <span className="text-xs text-gray-400 mb-1 ml-1 font-medium">
          {message.model}
        </span>
      )}

      {/* Attachments - shown above the message bubble */}
      {message.attachments && message.attachments.length > 0 && (
        <div className={`flex flex-wrap gap-2 mb-1.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
          {message.attachments.map((att, i) => (
            <div key={i}>
              {att.type === 'image' ? (
                <img
                  src={att.content || att.data || att.preview}
                  alt={att.name || 'Attached image'}
                  className="max-h-48 max-w-xs rounded-lg border border-gray-200 shadow-sm object-contain bg-white"
                />
              ) : att.type === 'audio' ? (
                <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2 border border-gray-200">
                  <svg className="w-5 h-5 text-purple-500 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                  </svg>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-gray-600 truncate max-w-[300px]">{att.name || 'Audio'}</span>
                    <audio controls className="h-8 w-[300px]" src={att.content || att.data} />
                  </div>
                </div>
              ) : att.type === 'video' ? (
                <video
                  src={att.content || att.data || att.preview}
                  controls
                  className="max-h-64 max-w-sm rounded-lg border border-gray-200 shadow-sm bg-black"
                />
              ) : (
                <div className="flex items-center gap-2 text-xs bg-gray-100 text-gray-600 rounded-lg px-3 py-2 border border-gray-200">
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
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors px-2 py-1 rounded-md hover:bg-gray-100"
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
            <div className="mt-1 ml-1 border border-amber-200 bg-amber-50 rounded-lg px-3 py-2 text-xs text-gray-700 leading-relaxed max-h-64 overflow-y-auto">
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
            : 'bg-white text-gray-900 border border-gray-200'
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
                      <code className="bg-gray-100 text-pink-600 rounded px-1 py-0.5 text-[0.85em] font-mono">{children}</code>
                    ) : (
                      <code className={className}>{children}</code>
                    ),
                  pre: ({ children }) => (
                    <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-2 overflow-x-auto text-[0.85em]">{children}</pre>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-4 border-gray-300 pl-3 italic text-gray-600 mb-2">{children}</blockquote>
                  ),
                  a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 underline hover:text-blue-800">{children}</a>
                  ),
                  table: ({ children }) => (
                    <div className="overflow-x-auto mb-2">
                      <table className="min-w-full border border-gray-200 rounded text-sm">{children}</table>
                    </div>
                  ),
                  th: ({ children }) => <th className="border border-gray-200 bg-gray-50 px-3 py-1.5 font-semibold text-left">{children}</th>,
                  td: ({ children }) => <td className="border border-gray-200 px-3 py-1.5">{children}</td>,
                  hr: () => <hr className="my-3 border-gray-200" />,
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
            className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
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
              className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
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
