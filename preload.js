const { contextBridge, ipcRenderer } = require('electron')

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Database operations
  getSetting: (key) => ipcRenderer.invoke('db:getSetting', key),
  setSetting: (key, value) => ipcRenderer.invoke('db:setSetting', key, value),

  // Thread operations
  getAllThreads: () => ipcRenderer.invoke('db:getAllThreads'),
  getThreadById: (id) => ipcRenderer.invoke('db:getThreadById', id),
  createThread: (model) => ipcRenderer.invoke('db:createThread', model),
  setThreadLabel: (threadId, label) => ipcRenderer.invoke('db:setThreadLabel', threadId, label),
  updateThreadModel: (threadId, model) => ipcRenderer.invoke('db:updateThreadModel', threadId, model),
  deleteThread: (threadId) => ipcRenderer.invoke('db:deleteThread', threadId),

  // Message operations
  getMessagesByThread: (threadId) => ipcRenderer.invoke('db:getMessagesByThread', threadId),
  addMessage: (threadId, role, model, content, tokenCount, reasoningContent) => ipcRenderer.invoke('db:addMessage', threadId, role, model, content, tokenCount, reasoningContent),
  updateMessageContent: (timestamp, content) => ipcRenderer.invoke('db:updateMessageContent', timestamp, content),
  updateMessageTokenCount: (timestamp, tokenCount) => ipcRenderer.invoke('db:updateMessageTokenCount', timestamp, tokenCount),
  deleteMessagesFrom: (threadId, fromTimestamp) => ipcRenderer.invoke('db:deleteMessagesFrom', threadId, fromTimestamp),
  getThreadTokenCount: (threadId) => ipcRenderer.invoke('db:getThreadTokenCount', threadId),
  updateThreadTotalTokens: (threadId, totalTokens) => ipcRenderer.invoke('db:updateThreadTotalTokens', threadId, totalTokens),
  updateThreadSamplingParams: (threadId, params) => ipcRenderer.invoke('db:updateThreadSamplingParams', threadId, params),
  getThreadCost: (threadId) => ipcRenderer.invoke('db:getThreadCost', threadId),
  addToThreadCost: (threadId, cost) => ipcRenderer.invoke('db:addToThreadCost', threadId, cost),

  // Attachment operations
  addAttachment: (messageId, type, content) => ipcRenderer.invoke('db:addAttachment', messageId, type, content),
  getAttachmentsByMessage: (messageId) => ipcRenderer.invoke('db:getAttachmentsByMessage', messageId),
  saveAttachmentToFile: (dataUrl, defaultName) => ipcRenderer.invoke('attachment:saveToFile', dataUrl, defaultName),
  copyAttachmentToClipboard: (dataUrl, type) => ipcRenderer.invoke('attachment:copyToClipboard', dataUrl, type),
  
  // Provider operations
  getAllProviders: () => ipcRenderer.invoke('db:getAllProviders'),
  getProviderById: (id) => ipcRenderer.invoke('db:getProviderById', id),
  createProvider: (name, apiBase, apiKey) => ipcRenderer.invoke('db:createProvider', name, apiBase, apiKey),
  updateProvider: (id, name, apiBase, apiKey) => ipcRenderer.invoke('db:updateProvider', id, name, apiBase, apiKey),
  deleteProvider: (id) => ipcRenderer.invoke('db:deleteProvider', id),
  testProvider: (id) => ipcRenderer.invoke('db:testProvider', id),

  // Model listing
  listProviderModels: (providerId) => ipcRenderer.invoke('db:listProviderModels', providerId),

  // Streaming chat
  sendChatStream: (providerId, modelId, messages, samplingParams) => ipcRenderer.invoke('db:sendChatStream', providerId, modelId, messages, samplingParams),
  generateThreadLabel: (userMessageText) => ipcRenderer.invoke('db:generateThreadLabel', userMessageText),
  onStreamChunk: (callback) => {
    const listener = (event, chunk) => callback(chunk)
    ipcRenderer.on('chat:stream-chunk', listener)
    return () => ipcRenderer.removeListener('chat:stream-chunk', listener)
  },
  onStreamReasoningChunk: (callback) => {
    const listener = (event, chunk) => callback(chunk)
    ipcRenderer.on('chat:stream-reasoning-chunk', listener)
    return () => ipcRenderer.removeListener('chat:stream-reasoning-chunk', listener)
  },
  onStreamDone: (callback) => {
    const listener = (event, fullContent, usage, reasoning) => callback(fullContent, usage, reasoning)
    ipcRenderer.on('chat:stream-done', listener)
    return () => ipcRenderer.removeListener('chat:stream-done', listener)
  },
})
