import { useState, useEffect } from 'react'

// Custom hook for database operations
export function useDatabase() {
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    // Check if electronAPI is available
    const checkAPI = () => {
      console.log('Checking for electronAPI:', !!window.electronAPI)
      if (window.electronAPI) {
        console.log('electronAPI found!')
        setIsReady(true)
        return true
      }
      return false
    }

    // Try immediately
    if (!checkAPI()) {
      // If not available, poll until it becomes available
      console.log('electronAPI not immediately available, polling...')
      const interval = setInterval(() => {
        if (checkAPI()) {
          clearInterval(interval)
        }
      }, 50)
      
      // Cleanup on unmount
      return () => clearInterval(interval)
    }
  }, [])

  return {
    isReady,
    
    // Settings operations
    getSetting: async (key) => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.getSetting(key)
    },
    
    setSetting: async (key, value) => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.setSetting(key, value)
    },

    // Thread operations
    getAllThreads: async () => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.getAllThreads()
    },

    getThreadById: async (id) => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.getThreadById(id)
    },

    createThread: async (model) => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.createThread(model)
    },
    
    setThreadLabel: async (threadId, label) => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.setThreadLabel(threadId, label)
    },

    updateThreadModel: async (threadId, model) => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.updateThreadModel(threadId, model)
    },

    deleteThread: async (threadId) => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.deleteThread(threadId)
    },

    // Message operations
    getMessagesByThread: async (threadId) => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.getMessagesByThread(threadId)
    },

    addMessage: async (threadId, role, model, content, tokenCount, reasoningContent) => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.addMessage(threadId, role, model, content, tokenCount, reasoningContent)
    },

    updateMessageContent: async (timestamp, content) => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.updateMessageContent(timestamp, content)
    },

    updateMessageTokenCount: async (timestamp, tokenCount) => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.updateMessageTokenCount(timestamp, tokenCount)
    },

    deleteMessagesFrom: async (threadId, fromTimestamp) => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.deleteMessagesFrom(threadId, fromTimestamp)
    },

    getThreadTokenCount: async (threadId) => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.getThreadTokenCount(threadId)
    },

    updateThreadTotalTokens: async (threadId, totalTokens) => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.updateThreadTotalTokens(threadId, totalTokens)
    },

    updateThreadSamplingParams: async (threadId, params) => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.updateThreadSamplingParams(threadId, params)
    },

    getThreadCost: async (threadId) => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.getThreadCost(threadId)
    },

    addToThreadCost: async (threadId, cost) => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.addToThreadCost(threadId, cost)
    },

    // Attachment operations
    addAttachment: async (messageId, type, content, name) => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.addAttachment(messageId, type, content, name)
    },

    getAttachmentsByMessage: async (messageId) => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.getAttachmentsByMessage(messageId)
    },

    // Provider operations
    getAllProviders: async () => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.getAllProviders()
    },

    getProviderById: async (id) => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.getProviderById(id)
    },

    createProvider: async (name, apiBase, apiKey) => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.createProvider(name, apiBase, apiKey)
    },

    updateProvider: async (id, name, apiBase, apiKey) => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.updateProvider(id, name, apiBase, apiKey)
    },

    deleteProvider: async (id) => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.deleteProvider(id)
    },

    testProvider: async (id) => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.testProvider(id)
    },

    // Model listing
    listProviderModels: async (providerId) => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.listProviderModels(providerId)
    },

    // Streaming chat
    sendChatStream: async (providerId, modelId, messages, samplingParams) => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.sendChatStream(providerId, modelId, messages, samplingParams)
    },

    generateThreadLabel: async (userMessageText) => {
      if (!window.electronAPI) throw new Error('Electron API not available')
      return await window.electronAPI.generateThreadLabel(userMessageText)
    },

    onStreamChunk: (callback) => {
      if (!window.electronAPI) return () => {}
      return window.electronAPI.onStreamChunk(callback)
    },

    onStreamReasoningChunk: (callback) => {
      if (!window.electronAPI) return () => {}
      return window.electronAPI.onStreamReasoningChunk(callback)
    },

    onStreamDone: (callback) => {
      if (!window.electronAPI) return () => {}
      return window.electronAPI.onStreamDone(callback)
    },
  }
}
