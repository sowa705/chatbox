import { useState, useEffect, useRef, useCallback } from 'react'
import { useDatabase } from './hooks/useDatabase'
import SettingsModal from './components/SettingsModal'
import ModelSelector from './components/ModelSelector'
import ChatMessage from './components/ChatMessage'
import MessageInput from './components/MessageInput'
import ContextGauge from './components/ContextGauge'

function App() {
  const db = useDatabase()
  const [threads, setThreads] = useState([])
  const [selectedThreadId, setSelectedThreadId] = useState(null)
  const [messages, setMessages] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedModel, setSelectedModel] = useState(null) // { providerId, modelId, provider }
  const [allModels, setAllModels] = useState([]) // flat list of all provider models
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [streamingReasoning, setStreamingReasoning] = useState('')
  const [threadTokenCount, setThreadTokenCount] = useState(0)
  const [threadCost, setThreadCost] = useState(0)
  const [threadSamplingParams, setThreadSamplingParams] = useState({})
  const messagesEndRef = useRef(null)
  // Refs to carry streaming context into the onStreamDone callback
  const pendingStreamRef = useRef(null) // { threadId, modelId }

  // Load threads and all models on mount, then restore last used model
  useEffect(() => {
    if (!db.isReady) return
    loadThreads()
    loadAllModels()
    // Restore dark mode preference
    db.getSetting('darkMode').then(value => {
      if (value) {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
    }).catch(() => {})
  }, [db.isReady])

  const loadAllModels = async () => {
    try {
      const providers = await db.getAllProviders()
      const models = []
      for (const provider of providers) {
        try {
          const pm = await db.listProviderModels(provider.id)
          models.push(...pm)
        } catch (err) {
          console.warn(`Failed to load models from ${provider.name}:`, err)
        }
      }
      setAllModels(models)
      // Restore last used model from settings
      try {
        const saved = await db.getSetting('lastModel')
        if (saved) {
          // Find matching model from freshly loaded list
          const match = models.find(m => m.id === saved.modelId && m.providerId === saved.providerId)
          if (match) {
            setSelectedModel({ modelId: match.id, providerId: match.providerId, provider: match.provider, contextWindow: match.contextWindow, modalities: match.modalities, supportedParameters: match.supportedParameters, pricing: match.pricing || null })
          } else {
            // Use saved data as-is even if not in current list
            setSelectedModel(saved)
          }
        }
      } catch (err) {
        console.warn('Failed to restore last model:', err)
      }
    } catch (err) {
      console.error('Failed to load models:', err)
    }
  }

  // Load messages and switch model when thread changes
  useEffect(() => {
    if (db.isReady && selectedThreadId) {
      loadMessages(selectedThreadId)
      loadThreadTokenCount(selectedThreadId)
      loadThreadCost(selectedThreadId)
      // Switch to the model that was used in this thread
      db.getThreadById(selectedThreadId).then(thread => {
        if (thread?.selected_model) {
          const match = allModels.find(m => m.id === thread.selected_model)
          if (match) {
            setSelectedModel({ modelId: match.id, providerId: match.providerId, provider: match.provider, contextWindow: match.contextWindow, modalities: match.modalities, supportedParameters: match.supportedParameters, pricing: match.pricing || null })
          }
        }
        // Restore sampling params saved with this thread
        if (thread?.sampling_params) {
          try {
            setThreadSamplingParams(JSON.parse(thread.sampling_params))
          } catch {
            setThreadSamplingParams({})
          }
        } else {
          setThreadSamplingParams({})
        }
      }).catch(err => console.warn('Failed to load thread model:', err))
    } else {
      setMessages([])
      setThreadTokenCount(0)
      setThreadCost(0)
      setThreadSamplingParams({})
    }
  }, [db.isReady, selectedThreadId])

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // Subscribe to streaming events
  useEffect(() => {
    if (!db.isReady) return

    const unsubChunk = db.onStreamChunk((chunk) => {
      setStreamingContent(prev => prev + chunk)
    })

    const unsubReasoningChunk = db.onStreamReasoningChunk((chunk) => {
      setStreamingReasoning(prev => prev + chunk)
    })

    const saveAssistantMessage = async (threadId, modelId, msgs, prevTotalTokens, fullContent, usage, reasoning, durationMs) => {
      const promptTokens = usage?.prompt_tokens || 0
      const completionTokens = usage?.completion_tokens || 0
      const totalTokens = promptTokens + completionTokens
      const callCost = usage?.cost || 0

      try {
        // Back-fill per-message token count on the last user message:
        // prompt_tokens covers the entire context sent, so subtracting the previous
        // thread total gives the tokens contributed by the new user turn.
        if (promptTokens > 0) {
          const userMsgTokens = promptTokens - prevTotalTokens
          const lastUserMsg = msgs ? [...msgs].reverse().find(m => m.role === 'user') : null
          if (lastUserMsg?.timestamp && userMsgTokens > 0) {
            await db.updateMessageTokenCount(lastUserMsg.timestamp, userMsgTokens)
          }
        }

        await db.addMessage(threadId, 'assistant', modelId, fullContent, completionTokens, reasoning || null, durationMs || null)

        if (totalTokens > 0) {
          await db.updateThreadTotalTokens(threadId, totalTokens)
        }

        if (callCost > 0) {
          await db.addToThreadCost(threadId, callCost)
        }
      } catch (err) {
        console.error('Failed to save assistant message:', err)
      }

      loadMessages(threadId)
      loadThreadTokenCount(threadId)
      loadThreadCost(threadId)
      loadThreads()
    }

    const unsubDone = db.onStreamDone(async (fullContent, usage, reasoning, durationMs) => {
      setIsStreaming(false)
      setStreamingContent('')
      setStreamingReasoning('')

      const pending = pendingStreamRef.current
      if (pending) {
        const { threadId, modelId, msgs, prevTotalTokens } = pending
        pendingStreamRef.current = null
        await saveAssistantMessage(threadId, modelId, msgs, prevTotalTokens, fullContent, usage, reasoning, durationMs)
      }
    })

    const unsubCancelled = db.onStreamCancelled(async (partialContent, partialReasoning, durationMs) => {
      setIsStreaming(false)
      setStreamingContent('')
      setStreamingReasoning('')

      const pending = pendingStreamRef.current
      if (pending) {
        const { threadId, modelId, msgs, prevTotalTokens } = pending
        pendingStreamRef.current = null
        // Save whatever partial content was received before cancellation
        if (partialContent) {
          await saveAssistantMessage(threadId, modelId, msgs, prevTotalTokens, partialContent, null, partialReasoning, durationMs)
        }
      }
    })

    return () => {
      unsubChunk()
      unsubReasoningChunk()
      unsubDone()
      unsubCancelled()
    }
  }, [db.isReady, selectedThreadId])

  const loadThreads = async () => {
    try {
      const data = await db.getAllThreads()
      setThreads(data || [])
    } catch (err) {
      console.error('Failed to load threads:', err)
    }
  }

  const loadMessages = async (threadId) => {
    try {
      const data = await db.getMessagesByThread(threadId)
      // Load attachments for each message
      const withAttachments = await Promise.all(
        (data || []).map(async (msg) => {
          try {
            const atts = await db.getAttachmentsByMessage(msg.timestamp)
            return { ...msg, attachments: atts || [] }
          } catch {
            return { ...msg, attachments: [] }
          }
        })
      )
      setMessages(withAttachments)
    } catch (err) {
      console.error('Failed to load messages:', err)
    }
  }

  const loadThreadTokenCount = async (threadId) => {
    try {
      const count = await db.getThreadTokenCount(threadId)
      setThreadTokenCount(count)
    } catch (err) {
      console.error('Failed to load token count:', err)
    }
  }

  const loadThreadCost = async (threadId) => {
    try {
      const cost = await db.getThreadCost(threadId)
      setThreadCost(cost || 0)
    } catch (err) {
      console.error('Failed to load thread cost:', err)
    }
  }

  const handleNewThread = async () => {
    if (!selectedModel) {
      alert('Please select a model first.')
      return
    }
    try {
      const threadId = await db.createThread(selectedModel.modelId)
      await db.setThreadLabel(threadId, 'New Thread')
      await loadThreads()
      setSelectedThreadId(Number(threadId))
    } catch (err) {
      console.error('Failed to create thread:', err)
    }
  }

  const handleDeleteThread = async (threadId) => {
    if (!confirm('Delete this thread and all its messages?')) return
    try {
      await db.deleteThread(threadId)
      if (selectedThreadId === threadId) {
        setSelectedThreadId(null)
        setMessages([])
      }
      await loadThreads()
    } catch (err) {
      console.error('Failed to delete thread:', err)
    }
  }

  const handleModelChange = async (model) => {
    setSelectedModel(model)
    // Persist as last used model for next startup
    try {
      await db.setSetting('lastModel', model)
    } catch (err) {
      console.warn('Failed to save last model:', err)
    }
    if (selectedThreadId) {
      try {
        await db.updateThreadModel(selectedThreadId, model.modelId)
      } catch (err) {
        console.error('Failed to update thread model:', err)
      }
    }
    // If the new model doesn't support the currently set reasoning mode, clear it
    const sp = model.supportedParameters || []
    const supportsReasoning = sp.includes('reasoning')
    const supportsEffort = sp.includes('reasoning_effort')
    const currentMode = threadSamplingParams.reasoning_mode
    if (currentMode) {
      const modeStillValid =
        (currentMode === 'effort' && supportsEffort) ||
        (currentMode === 'tokens' && supportsReasoning && !supportsEffort) ||
        (currentMode === 'off' && supportsReasoning)
      if (!modeStillValid) {
        const updated = { ...threadSamplingParams }
        delete updated.reasoning_mode
        delete updated.reasoning_effort
        delete updated.reasoning_max_tokens
        delete updated.reasoning_exclude
        setThreadSamplingParams(updated)
        if (selectedThreadId) {
          try { await db.updateThreadSamplingParams(selectedThreadId, updated) } catch {}
        }
      }
    }
  }

  const handleSamplingParamChange = async (key, value) => {
    const updated = { ...threadSamplingParams, [key]: value }
    // Remove keys explicitly set to null/undefined (reset to default)
    if (value === null || value === undefined || value === '') {
      delete updated[key]
    }
    setThreadSamplingParams(updated)
    if (selectedThreadId) {
      try {
        await db.updateThreadSamplingParams(selectedThreadId, updated)
      } catch (err) {
        console.error('Failed to save sampling params:', err)
      }
    }
  }

  const buildApiMessages = (msgs) => {
    // Build OpenAI-compatible messages array, including any attachments per message
    return msgs.map(m => {
      const atts = m.attachments || []
      if (atts.length === 0) {
        return { role: m.role, content: m.content }
      }

      // Build multipart content for messages with attachments
      const parts = []
      if (m.content) {
        parts.push({ type: 'text', text: m.content })
      }
      for (const att of atts) {
        if (att.type === 'image') {
          parts.push({
            type: 'image_url',
            image_url: { url: att.content || att.data }
          })
        } else if (att.type === 'audio') {
          // OpenAI-compatible input_audio content part
          // Data is stored as a data URL (e.g. "data:audio/webm;base64,...")
          const raw = att.content || att.data
          // Extract the raw base64 data (strip the data URL prefix)
          const base64Data = raw.includes(',') ? raw.split(',')[1] : raw
          // Determine audio format from the data URL or audioFormat field
          let format = att.audioFormat || 'wav'
          if (!att.audioFormat && raw.includes('data:audio/')) {
            const mime = raw.split(';')[0].split('/')[1]
            // Map common MIME subtypes to API-accepted formats
            if (mime === 'webm' || mime === 'ogg') format = 'wav' // webm/ogg not always supported; some providers accept it
            else if (mime === 'mpeg' || mime === 'mp3') format = 'mp3'
            else if (mime === 'wav' || mime === 'x-wav') format = 'wav'
            else format = mime
          }
          parts.push({
            type: 'input_audio',
            input_audio: { data: base64Data, format }
          })
        } else if (att.type === 'video') {
          // OpenRouter video_url content part
          // Accepts both URLs and base64 data URLs (e.g. "data:video/mp4;base64,...")
          const raw = att.content || att.data
          parts.push({
            type: 'video_url',
            video_url: { url: raw }
          })
        } else {
          parts.push({
            type: 'text',
            text: `[Attached file: ${att.name || 'document'}]\n${att.content || att.data}`
          })
        }
      }
      return { role: m.role, content: parts }
    })
  }

  const sendToLLM = async (threadId, msgs) => {
    if (!selectedModel) {
      alert('Please select a model first.')
      return
    }

    setIsStreaming(true)
    setStreamingContent('')
    setStreamingReasoning('')

    // Snapshot token count before sending so onStreamDone can compute the user message delta
    const prevTotalTokens = await db.getThreadTokenCount(threadId).catch(() => 0)
    pendingStreamRef.current = { threadId, modelId: selectedModel.modelId, msgs, prevTotalTokens }

    try {
      const apiMessages = buildApiMessages(msgs)

      // Kick off the stream — chunks arrive via IPC events.
      // onStreamDone will save the assistant message and update tokens.
      await db.sendChatStream(
        selectedModel.providerId,
        selectedModel.modelId,
        apiMessages,
        threadSamplingParams
      )
    } catch (err) {
      console.error('Chat error:', err)
      pendingStreamRef.current = null
      setIsStreaming(false)
      setStreamingContent('')
      setStreamingReasoning('')
      // Show error as a system-like message
      await db.addMessage(threadId, 'assistant', selectedModel.modelId, `⚠️ Error: ${err.message}`, 0)
      await loadMessages(threadId)
      await loadThreads()
    }
  }

  // Helper: fetch messages with attachments for API calls
  const getMessagesWithAttachments = async (threadId) => {
    const data = await db.getMessagesByThread(threadId)
    return Promise.all(
      (data || []).map(async (msg) => {
        try {
          const atts = await db.getAttachmentsByMessage(msg.timestamp)
          return { ...msg, attachments: atts || [] }
        } catch {
          return { ...msg, attachments: [] }
        }
      })
    )
  }

  const handleSend = async (text, attachments = []) => {
    if (!selectedThreadId || !selectedModel) return

    try {
      // Save user message
      const msgTs = await db.addMessage(selectedThreadId, 'user', null, text)

      // Save attachments
      for (const att of attachments) {
        await db.addAttachment(msgTs, att.type, att.data, att.name || null)
      }

      // Reload to include the new user message
      await loadMessages(selectedThreadId)

      // Auto-label thread if it's the first message — generate a title asynchronously
      const currentThread = threads.find(t => t.id === selectedThreadId)
      if (currentThread && (!currentThread.label || currentThread.label === 'New Thread')) {
        // Fire-and-forget: generate label with configured label model
        db.generateThreadLabel(text).then(async (label) => {
          const finalLabel = label || (text.substring(0, 50) + (text.length > 50 ? '...' : ''))
          await db.setThreadLabel(selectedThreadId, finalLabel)
          await loadThreads()
        }).catch(async () => {
          // Fallback: use truncated message text
          const fallback = text.substring(0, 50) + (text.length > 50 ? '...' : '')
          await db.setThreadLabel(selectedThreadId, fallback)
          await loadThreads()
        })
      }

      // Get fresh messages with attachments for the API call
      const freshMessages = await getMessagesWithAttachments(selectedThreadId)
      await sendToLLM(selectedThreadId, freshMessages)
    } catch (err) {
      console.error('Failed to send message:', err)
    }
  }

  const handleRetry = async (message) => {
    if (!selectedThreadId || !selectedModel) return

    try {
      // Delete from the assistant message onwards
      await db.deleteMessagesFrom(selectedThreadId, message.timestamp)
      await loadMessages(selectedThreadId)

      // Re-send with the remaining messages (including their attachments)
      const freshMessages = await getMessagesWithAttachments(selectedThreadId)
      await sendToLLM(selectedThreadId, freshMessages)
    } catch (err) {
      console.error('Failed to retry:', err)
    }
  }

  const handleEdit = async (message, newContent) => {
    if (!selectedThreadId || !selectedModel) return

    try {
      // Preserve the original message's attachments before deleting
      const originalAttachments = message.attachments || []

      // Delete from this message onwards
      await db.deleteMessagesFrom(selectedThreadId, message.timestamp)

      // Add the edited message
      const newTs = await db.addMessage(selectedThreadId, message.role, message.model, newContent)

      // Re-attach the original attachments to the new message timestamp
      for (const att of originalAttachments) {
        await db.addAttachment(newTs, att.type, att.content || att.data, att.name || null)
      }

      await loadMessages(selectedThreadId)

      // If the edited message was from the user, re-send to get a new response
      if (message.role === 'user') {
        const freshMessages = await getMessagesWithAttachments(selectedThreadId)
        await sendToLLM(selectedThreadId, freshMessages)
      }
    } catch (err) {
      console.error('Failed to edit:', err)
    }
  }

  const filteredThreads = threads.filter(thread =>
    (thread.label || '').toLowerCase().includes(searchQuery.toLowerCase())
  )

  const selectedThread = threads.find(t => t.id === selectedThreadId)

  // Warn if the thread has image attachments but the selected model doesn't support images
  const threadHasImages = messages.some(m => m.attachments?.some(a => a.type === 'image'))
  const modelSupportsImages = !selectedModel?.modalities || selectedModel.modalities.includes('image') || selectedModel.modalities.includes('file')

  // Warn if the thread has audio attachments but the selected model doesn't support audio
  const threadHasAudio = messages.some(m => m.attachments?.some(a => a.type === 'audio'))
  const modelSupportsAudio = !selectedModel?.modalities || selectedModel.modalities.includes('audio')

  // Warn if the thread has video attachments but the selected model doesn't support video
  const threadHasVideo = messages.some(m => m.attachments?.some(a => a.type === 'video'))
  const modelSupportsVideo = !selectedModel?.modalities || selectedModel.modalities.includes('video')

  // Build display messages with streaming placeholder
  const displayMessages = [...messages]
  if (isStreaming && (streamingContent || streamingReasoning)) {
    displayMessages.push({
      timestamp: Date.now(),
      role: 'assistant',
      model: selectedModel?.modelId || '',
      content: streamingContent,
      reasoning_content: streamingReasoning || null,
      _streaming: true
    })
  }

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      {/* Settings Modal */}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      
      {/* Left Sidebar - Thread List */}
      <div className={`w-80 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col ${isSettingsOpen ? 'blur-sm' : ''}`}>
        {/* Search Bar */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <input
            type="text"
            placeholder="Search threads..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
          />
        </div>

        {/* New Thread Button */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={handleNewThread}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
          >
            + New Thread
          </button>
        </div>

        {/* Thread List */}
        <div className="flex-1 overflow-y-auto">
          {filteredThreads.map(thread => (
            <div
              key={thread.id}
              onClick={() => setSelectedThreadId(thread.id)}
              className={`group p-4 border-b border-gray-100 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                selectedThreadId === thread.id ? 'bg-blue-50 dark:bg-blue-900/30 border-l-4 border-l-blue-500' : ''
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-gray-900 dark:text-gray-100 text-sm truncate">
                    {thread.label || 'Untitled'}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {thread.selected_model || 'No model'}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteThread(thread.id)
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all"
                  title="Delete thread"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
          {filteredThreads.length === 0 && (
            <div className="p-4 text-sm text-gray-400 text-center">
              No threads yet
            </div>
          )}
        </div>
        
        {/* Settings Button */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700">
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="w-full px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm"
          >
            Settings
          </button>
        </div>
      </div>

      {/* Middle - Messages Area */}
      <div className={`flex-1 flex flex-col ${isSettingsOpen ? 'blur-sm' : ''}`}>
        {/* Header */}
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {selectedThread ? selectedThread.label || 'Untitled Thread' : 'Select a thread'}
          </h2>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4">
          {selectedThreadId ? (
            <div className="space-y-4 max-w-4xl mx-auto">
              {displayMessages.map((msg) => (
                <ChatMessage
                  key={msg.timestamp}
                  message={msg}
                  onRetry={handleRetry}
                  onEdit={handleEdit}
                  isStreaming={msg._streaming}
                />
              ))}
              {isStreaming && !streamingContent && !streamingReasoning && (
                <div className="flex items-start">
                  <div className="bg-white dark:bg-gray-800 rounded-xl px-4 py-3 shadow-sm border border-gray-200 dark:border-gray-700">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400">
              <div className="text-center">
                <svg className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <p className="text-lg">Select a thread or create a new one</p>
              </div>
            </div>
          )}
        </div>

        {/* Input Area */}
        {selectedThreadId && (
          <MessageInput
            onSend={handleSend}
            onCancel={() => db.cancelChatStream()}
            isStreaming={isStreaming}
            disabled={false}
          />
        )}
      </div>

      {/* Right Sidebar - Model Settings */}
      <div className={`w-80 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex flex-col ${isSettingsOpen ? 'blur-sm' : ''}`}>
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Model Settings</h3>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Model
            </label>
            <ModelSelector
              selectedModel={selectedModel}
              onModelChange={handleModelChange}
            />
          </div>

          {selectedModel && (
            <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1 bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
              <p><span className="font-medium">Provider:</span> {selectedModel.provider}</p>
              <p><span className="font-medium">Model:</span> {selectedModel.modelId}</p>
              <p><span className="font-medium">Context size:</span> {selectedModel.contextWindow ? selectedModel.contextWindow.toLocaleString() + ' tokens' : 'Unknown'}</p>
              <p className="flex items-center gap-1">
                <span className="font-medium">Modalities:</span>
                {selectedModel.modalities
                  ? selectedModel.modalities.join(', ')
                  : 'text'}
              </p>
              {selectedModel.pricing && (selectedModel.pricing.prompt > 0 || selectedModel.pricing.completion > 0) && (
                <div className="pt-1 mt-1 border-t border-gray-200 dark:border-gray-600 space-y-0.5">
                  <p className="flex justify-between">
                    <span className="font-medium">Input price:</span>
                    <span className="text-blue-600 dark:text-blue-400 font-mono">
                      ${(selectedModel.pricing.prompt * 1_000_000).toPrecision(3)}/M
                    </span>
                  </p>
                  <p className="flex justify-between">
                    <span className="font-medium">Output price:</span>
                    <span className="text-purple-600 dark:text-purple-400 font-mono">
                      ${(selectedModel.pricing.completion * 1_000_000).toPrecision(3)}/M
                    </span>
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Sampling parameters */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Settings</h4>

            {/* Temperature */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Temperature</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0" max="2" step="0.01"
                    value={threadSamplingParams.temperature ?? ''}
                    onChange={e => handleSamplingParamChange('temperature', e.target.value === '' ? null : parseFloat(e.target.value))}
                    placeholder="default"
                    className="w-16 px-1.5 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-right bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                </div>
              </div>
              <input
                type="range"
                min="0" max="2" step="0.01"
                value={threadSamplingParams.temperature ?? 1}
                onChange={e => handleSamplingParamChange('temperature', parseFloat(e.target.value))}
                className="w-full h-1.5 accent-blue-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                <span>0 — focused</span>
                <span>2 — creative</span>
              </div>
            </div>

            {/* Max Output Tokens */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Max Output Tokens</label>
                <input
                  type="number"
                  min="1"
                  value={threadSamplingParams.max_tokens ?? ''}
                  onChange={e => handleSamplingParamChange('max_tokens', e.target.value === '' ? null : parseInt(e.target.value, 10))}
                  placeholder="default"
                  className="w-20 px-1.5 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-right bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              </div>
            </div>

            {/* Top-P */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Top-P</label>
                <input
                  type="number"
                  min="0" max="1" step="0.01"
                  value={threadSamplingParams.top_p ?? ''}
                  onChange={e => handleSamplingParamChange('top_p', e.target.value === '' ? null : parseFloat(e.target.value))}
                  placeholder="default"
                  className="w-16 px-1.5 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-right bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              </div>
              <input
                type="range"
                min="0" max="1" step="0.01"
                value={threadSamplingParams.top_p ?? 1}
                onChange={e => handleSamplingParamChange('top_p', parseFloat(e.target.value))}
                className="w-full h-1.5 accent-blue-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                <span>0</span>
                <span>1</span>
              </div>
            </div>

            {/* Top-K */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Top-K</label>
                <input
                  type="number"
                  min="1"
                  value={threadSamplingParams.top_k ?? ''}
                  onChange={e => handleSamplingParamChange('top_k', e.target.value === '' ? null : parseInt(e.target.value, 10))}
                  placeholder="default"
                  className="w-16 px-1.5 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-right bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              </div>
            </div>

            {/* Reasoning */}
            <div className="space-y-2 pt-1 border-t border-gray-100 dark:border-gray-700">
              {(() => {
                const sp = selectedModel?.supportedParameters || []
                const supportsReasoning = sp.includes('reasoning')
                const supportsEffort = sp.includes('reasoning_effort')
                // Models with unknown supported_parameters (non-OpenRouter) show all options
                const unknownCaps = !selectedModel?.supportedParameters
                const showReasoning = unknownCaps || supportsReasoning || supportsEffort
                if (!showReasoning) return null

                // Determine which modes to offer
                // - effort mode: available if model supports reasoning_effort OR capabilities unknown
                // - tokens mode: available if model supports reasoning but NOT reasoning_effort (Anthropic/Gemini/Qwen), OR unknown
                const showEffortMode = unknownCaps || supportsEffort
                const showTokensMode = unknownCaps || (supportsReasoning && !supportsEffort)

                return (
                  <>
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Reasoning</label>
                      <select
                        value={threadSamplingParams.reasoning_mode ?? 'default'}
                        onChange={e => handleSamplingParamChange('reasoning_mode', e.target.value === 'default' ? null : e.target.value)}
                        className="px-1.5 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                      >
                        <option value="default">Model default</option>
                        {showEffortMode && <option value="effort">Effort level</option>}
                        {showTokensMode && <option value="tokens">Token budget</option>}
                        <option value="off">Disabled</option>
                      </select>
                    </div>

                    {threadSamplingParams.reasoning_mode === 'effort' && (
                      <div className="flex items-center justify-between">
                        <label className="text-xs text-gray-500 dark:text-gray-400">Effort</label>
                        <select
                          value={threadSamplingParams.reasoning_effort ?? 'medium'}
                          onChange={e => handleSamplingParamChange('reasoning_effort', e.target.value)}
                          className="px-1.5 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                        >
                          <option value="xhigh">X-High (~95%)</option>
                          <option value="high">High (~80%)</option>
                          <option value="medium">Medium (~50%)</option>
                          <option value="low">Low (~20%)</option>
                          <option value="minimal">Minimal (~10%)</option>
                          <option value="none">None (off)</option>
                        </select>
                      </div>
                    )}

                    {threadSamplingParams.reasoning_mode === 'tokens' && (
                      <div className="flex items-center justify-between">
                        <label className="text-xs text-gray-500 dark:text-gray-400">Budget tokens</label>
                        <input
                          type="number"
                          min="1024"
                          step="256"
                          value={threadSamplingParams.reasoning_max_tokens ?? ''}
                          onChange={e => handleSamplingParamChange('reasoning_max_tokens', e.target.value === '' ? null : parseInt(e.target.value, 10))}
                          placeholder="e.g. 4096"
                          className="w-20 px-1.5 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-right bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                        />
                      </div>
                    )}

                    {(threadSamplingParams.reasoning_mode === 'effort' || threadSamplingParams.reasoning_mode === 'tokens') && (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!threadSamplingParams.reasoning_exclude}
                          onChange={e => handleSamplingParamChange('reasoning_exclude', e.target.checked ? true : null)}
                          className="w-3 h-3 accent-blue-500"
                        />
                        <span className="text-xs text-gray-500 dark:text-gray-400">Exclude from response</span>
                      </label>
                    )}
                  </>
                )
              })()}
            </div>

            {/* Reset button */}
            {Object.keys(threadSamplingParams).length > 0 && (
              <button
                onClick={async () => {
                  setThreadSamplingParams({})
                  if (selectedThreadId) {
                    try { await db.updateThreadSamplingParams(selectedThreadId, {}) } catch {}
                  }
                }}
                className="w-full text-xs text-gray-500 hover:text-red-500 py-1 border border-gray-200 dark:border-gray-600 rounded hover:border-red-300 transition-colors"
              >
                Reset to defaults
              </button>
            )}
          </div>

          {/* Warning: thread has images but model doesn't support vision */}
          {threadHasImages && !modelSupportsImages && (
            <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-300">
              <svg className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <span>This thread contains images but the selected model may not support vision input. Responses may be incorrect or fail.</span>
            </div>
          )}

          {/* Warning: thread has audio but model doesn't support audio */}
          {threadHasAudio && !modelSupportsAudio && (
            <div className="flex items-start gap-2 bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-700 rounded-lg p-3 text-xs text-purple-800 dark:text-purple-300">
              <svg className="w-4 h-4 shrink-0 mt-0.5 text-purple-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <span>This thread contains audio but the selected model may not support audio input. Responses may be incorrect or fail.</span>
            </div>
          )}

          {/* Warning: thread has video but model doesn't support video */}
          {threadHasVideo && !modelSupportsVideo && (
            <div className="flex items-start gap-2 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-lg p-3 text-xs text-green-800 dark:text-green-300">
              <svg className="w-4 h-4 shrink-0 mt-0.5 text-green-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <span>This thread contains video but the selected model may not support video input. Responses may be incorrect or fail.</span>
            </div>
          )}
        </div>

        {/* Context Usage Gauge - pushed to bottom */}
        <div className="mt-auto border-t border-gray-200 dark:border-gray-700 p-4">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 text-center">Context Usage</h4>
          <ContextGauge
            usedTokens={threadTokenCount}
            totalTokens={selectedModel?.contextWindow || 0}
            totalCost={threadCost}
          />
        </div>
      </div>
    </div>
  )
}

export default App
