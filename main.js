import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { initDatabase, closeDatabase, dbOperations, testProvider, listProviderModels, sendChatStream, generateThreadLabel } from './database.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1700,
    height: 1000,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  // In development, load from Vite dev server
  // In production, load from built files
  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'))
  }
}

// Set up IPC handlers for database operations
function setupIpcHandlers() {
  // Settings
  ipcMain.handle('db:getSetting', async (event, key) => {
    return dbOperations.getSetting(key)
  })
  
  ipcMain.handle('db:setSetting', async (event, key, value) => {
    return dbOperations.setSetting(key, value)
  })

  // Thread operations
  ipcMain.handle('db:getAllThreads', async () => {
    return dbOperations.getAllThreads()
  })

  ipcMain.handle('db:getThreadById', async (event, id) => {
    return dbOperations.getThreadById(id)
  })

  ipcMain.handle('db:createThread', async (event, model) => {
    return dbOperations.createThread(model)
  })

  ipcMain.handle('db:setThreadLabel', async (event, threadId, label) => {
    return dbOperations.setThreadLabel(threadId, label)
  })

  ipcMain.handle('db:updateThreadModel', async (event, threadId, model) => {
    return dbOperations.updateThreadModel(threadId, model)
  })

  ipcMain.handle('db:deleteThread', async (event, threadId) => {
    return dbOperations.deleteThread(threadId)
  })

  // Message operations
  ipcMain.handle('db:getMessagesByThread', async (event, threadId) => {
    return dbOperations.getMessagesByThread(threadId)
  })

  ipcMain.handle('db:addMessage', async (event, threadId, role, model, content, tokenCount, reasoningContent) => {
    return dbOperations.addMessage(threadId, role, model, content, tokenCount, reasoningContent)
  })

  ipcMain.handle('db:updateMessageContent', async (event, timestamp, content) => {
    return dbOperations.updateMessageContent(timestamp, content)
  })

  ipcMain.handle('db:updateMessageTokenCount', async (event, timestamp, tokenCount) => {
    return dbOperations.updateMessageTokenCount(timestamp, tokenCount)
  })

  ipcMain.handle('db:deleteMessagesFrom', async (event, threadId, fromTimestamp) => {
    return dbOperations.deleteMessagesFrom(threadId, fromTimestamp)
  })

  ipcMain.handle('db:getThreadTokenCount', async (event, threadId) => {
    return dbOperations.getThreadTokenCount(threadId)
  })

  ipcMain.handle('db:updateThreadTotalTokens', async (event, threadId, totalTokens) => {
    return dbOperations.updateThreadTotalTokens(threadId, totalTokens)
  })

  // Attachment operations
  ipcMain.handle('db:addAttachment', async (event, messageId, type, content) => {
    return dbOperations.addAttachment(messageId, type, content)
  })

  ipcMain.handle('db:getAttachmentsByMessage', async (event, messageId) => {
    return dbOperations.getAttachmentsByMessage(messageId)
  })

  // Provider operations
  ipcMain.handle('db:getAllProviders', async () => {
    return dbOperations.getAllProviders()
  })

  ipcMain.handle('db:getProviderById', async (event, id) => {
    return dbOperations.getProviderById(id)
  })

  ipcMain.handle('db:createProvider', async (event, name, apiBase, apiKey) => {
    return dbOperations.createProvider(name, apiBase, apiKey)
  })

  ipcMain.handle('db:updateProvider', async (event, id, name, apiBase, apiKey) => {
    return dbOperations.updateProvider(id, name, apiBase, apiKey)
  })

  ipcMain.handle('db:deleteProvider', async (event, id) => {
    return dbOperations.deleteProvider(id)
  })

  ipcMain.handle('db:testProvider', async (event, id) => {
    return await testProvider(id)
  })

  // Model listing
  ipcMain.handle('db:listProviderModels', async (event, providerId) => {
    return await listProviderModels(providerId)
  })

  // Streaming chat
  ipcMain.handle('db:sendChatStream', async (event, providerId, modelId, messages) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return await sendChatStream(providerId, modelId, messages, win)
  })

  // Thread label generation
  ipcMain.handle('db:generateThreadLabel', async (event, userMessageText) => {
    return await generateThreadLabel(userMessageText)
  })
}

app.whenReady().then(() => {
  // Initialize database
  initDatabase()
  
  // Setup IPC handlers
  setupIpcHandlers()
  
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // Close database connection
  closeDatabase()
  
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
