import { app, BrowserWindow, ipcMain, dialog, clipboard, nativeImage } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import os from 'os'
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

  ipcMain.handle('db:updateThreadSamplingParams', async (event, threadId, params) => {
    return dbOperations.updateThreadSamplingParams(threadId, params)
  })

  ipcMain.handle('db:getThreadCost', async (event, threadId) => {
    return dbOperations.getThreadCost(threadId)
  })

  ipcMain.handle('db:addToThreadCost', async (event, threadId, cost) => {
    return dbOperations.addToThreadCost(threadId, cost)
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
  ipcMain.handle('db:sendChatStream', async (event, providerId, modelId, messages, samplingParams) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return await sendChatStream(providerId, modelId, messages, win, samplingParams || {})
  })

  // Thread label generation
  ipcMain.handle('db:generateThreadLabel', async (event, userMessageText) => {
    return await generateThreadLabel(userMessageText)
  })

  // Attachment file operations
  ipcMain.handle('attachment:saveToFile', async (event, dataUrl, defaultName) => {
    const ext = defaultName ? path.extname(defaultName) : ''
    const { filePath, canceled } = await dialog.showSaveDialog({
      defaultPath: defaultName || 'attachment',
      filters: ext ? [{ name: 'File', extensions: [ext.slice(1)] }] : [{ name: 'All Files', extensions: ['*'] }]
    })
    if (canceled || !filePath) return { success: false }
    // dataUrl can be a data URI or plain text
    if (dataUrl.startsWith('data:')) {
      const base64 = dataUrl.split(',')[1]
      fs.writeFileSync(filePath, Buffer.from(base64, 'base64'))
    } else {
      fs.writeFileSync(filePath, dataUrl, 'utf8')
    }
    return { success: true, filePath }
  })

  ipcMain.handle('attachment:copyToClipboard', async (event, dataUrl, type) => {
    try {
      if (type === 'image') {
        // Extract MIME type and raw buffer from the data URL
        // nativeImage.createFromDataURL only reliably handles PNG; for all other
        // formats (JPEG, WebP, GIF, …) we decode the base64 ourselves and pass
        // the raw Buffer to clipboard.write so Electron picks the right format.
        const mimeMatch = dataUrl.match(/^data:([^;]+);base64,/)
        if (!mimeMatch) return { success: false, error: 'Invalid data URL' }
        const mime = mimeMatch[1]                     // e.g. "image/png"
        const base64 = dataUrl.split(',')[1]
        const buf = Buffer.from(base64, 'base64')

        if (mime === 'image/png') {
          clipboard.write({ image: nativeImage.createFromBuffer(buf) })
        } else if (mime === 'image/jpeg' || mime === 'image/jpg') {
          // nativeImage.createFromBuffer with JPEGs works on Electron ≥ 28
          clipboard.write({ image: nativeImage.createFromBuffer(buf) })
        } else {
          // For WebP, GIF, BMP, etc. – convert via nativeImage (it decodes most
          // formats internally) then re-export as PNG for the clipboard
          const img = nativeImage.createFromBuffer(buf)
          if (img.isEmpty()) {
            // Last-resort fallback: write the raw data URL as text
            clipboard.writeText(dataUrl)
            return { success: true, warning: 'Image format not supported natively; copied as data URL' }
          }
          clipboard.write({ image: img })
        }
        return { success: true }
      } else if (type === 'video' || type === 'audio') {
        // Electron has no clipboard type for binary media understood by other apps.
        // Write the raw bytes to a temp file and put the file path as text so the
        // user can at least paste the path into Finder / Explorer / a media player.
        const mimeMatch = dataUrl.match(/^data:([^;]+);base64,/)
        if (!mimeMatch) return { success: false, error: 'Invalid data URL' }
        const mime = mimeMatch[1]
        const ext = mime.split('/')[1] || type
        const base64 = dataUrl.split(',')[1]
        const buf = Buffer.from(base64, 'base64')
        const tmpPath = path.join(os.tmpdir(), `clipboard_${Date.now()}.${ext}`)
        fs.writeFileSync(tmpPath, buf)
        clipboard.writeText(tmpPath)
        return { success: true, tmpPath }
      } else {
        // Plain text / documents
        if (dataUrl.startsWith('data:')) {
          const base64 = dataUrl.split(',')[1]
          clipboard.writeText(Buffer.from(base64, 'base64').toString('utf8'))
        } else {
          clipboard.writeText(dataUrl)
        }
        return { success: true }
      }
    } catch (err) {
      console.error('clipboard copy error:', err)
      return { success: false, error: err.message }
    }
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
