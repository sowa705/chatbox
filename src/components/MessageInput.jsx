import { useState, useRef, useEffect } from 'react'
import { processPdf } from '../utils/pdfProcessor'

function MessageInput({ onSend, disabled }) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [processingFiles, setProcessingFiles] = useState(0) // track async file processing
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const recordingTimerRef = useRef(null)

  const readFileAsBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const readFileAsText = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsText(file)
    })
  }

  const readFileAsArrayBuffer = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsArrayBuffer(file)
    })
  }

  const processFile = async (file) => {
    const isImage = file.type.startsWith('image/')
    const isAudio = file.type.startsWith('audio/')
    const isVideo = file.type.startsWith('video/')
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    const isText = file.type.startsWith('text/') || 
      ['.md', '.json', '.csv', '.xml', '.yaml', '.yml', '.log', '.js', '.ts', '.py', '.html', '.css']
        .some(ext => file.name.toLowerCase().endsWith(ext))

    if (isImage) {
      const base64 = await readFileAsBase64(file)
      return {
        type: 'image',
        name: file.name,
        data: base64,
        preview: base64
      }
    } else if (isAudio) {
      const base64 = await readFileAsBase64(file)
      return {
        type: 'audio',
        name: file.name,
        data: base64,
        preview: base64
      }
    } else if (isVideo) {
      const base64 = await readFileAsBase64(file)
      return {
        type: 'video',
        name: file.name,
        data: base64,
        preview: base64
      }
    } else if (isPdf) {
      const arrayBuffer = await readFileAsArrayBuffer(file)
      const result = await processPdf(arrayBuffer, file.name)

      if (result.type === 'text') {
        // Text-based PDF: attach as a document with extracted text
        return {
          type: 'document',
          name: file.name,
          data: result.text,
          preview: null,
          pdfPageCount: result.pageCount
        }
      } else {
        // Scanned/image PDF: return an array of image attachments
        return result.images.map((img) => ({
          type: 'image',
          name: `${file.name} (page ${img.page}/${result.pageCount})`,
          data: img.data,
          preview: img.data
        }))
      }
    } else if (isText || file.size < 100000) {
      // Try reading as text for text-like files
      try {
        const content = await readFileAsText(file)
        return {
          type: 'document',
          name: file.name,
          data: content,
          preview: null
        }
      } catch {
        // fallback to base64
        const base64 = await readFileAsBase64(file)
        return {
          type: 'document',
          name: file.name,
          data: base64,
          preview: null
        }
      }
    } else {
      const base64 = await readFileAsBase64(file)
      return {
        type: 'document',
        name: file.name,
        data: base64,
        preview: null
      }
    }
  }

  // Cleanup recording timer on unmount
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
    }
  }, [])

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioChunksRef.current = []
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm'
      })
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data)
        }
      }

      mediaRecorder.onstop = async () => {
        // Stop all tracks to release the microphone
        stream.getTracks().forEach(t => t.stop())
        clearInterval(recordingTimerRef.current)
        setRecordingDuration(0)

        const blob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType })
        if (blob.size === 0) return

        // Convert to base64 data URL
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result)
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })

        const format = mediaRecorder.mimeType.includes('webm') ? 'webm' : 'wav'
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

        setAttachments(prev => [...prev, {
          type: 'audio',
          name: `Recording ${timestamp}`,
          data: base64,
          audioFormat: format,
          preview: base64
        }])
      }

      mediaRecorderRef.current = mediaRecorder
      mediaRecorder.start(250) // Collect data every 250ms
      setIsRecording(true)
      setRecordingDuration(0)

      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1)
      }, 1000)
    } catch (err) {
      console.error('Failed to start recording:', err)
      alert('Could not access microphone. Please check permissions.')
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)
  }

  const formatDuration = (seconds) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const handleFiles = async (files) => {
    setProcessingFiles(prev => prev + files.length)
    const processed = []
    for (const file of files) {
      try {
        const result = await processFile(file)
        // processFile may return an array (e.g. scanned PDF pages) or a single object
        if (Array.isArray(result)) {
          processed.push(...result)
        } else {
          processed.push(result)
        }
      } catch (err) {
        console.error('Failed to process file:', file.name, err)
      }
    }
    setProcessingFiles(prev => prev - files.length)
    setAttachments(prev => [...prev, ...processed])
  }

  const handleDrop = async (e) => {
    e.preventDefault()
    setIsDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      await handleFiles(files)
    }
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const handlePaste = async (e) => {
    const items = Array.from(e.clipboardData.items)
    const files = items
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter(Boolean)

    if (files.length > 0) {
      e.preventDefault()
      await handleFiles(files)
    }
  }

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files)
    if (files.length > 0) {
      await handleFiles(files)
    }
    // Reset file input
    e.target.value = ''
  }

  const removeAttachment = (index) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }

  const handleSend = () => {
    if ((!text.trim() && attachments.length === 0) || disabled || processingFiles > 0) return
    onSend(text.trim(), attachments)
    setText('')
    setAttachments([])
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div
      className={`bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4 ${
        isDragOver ? 'ring-2 ring-blue-400 ring-inset bg-blue-50 dark:bg-blue-900/30' : ''
      }`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Attachment previews */}
      {(attachments.length > 0 || processingFiles > 0) && (
        <div className="flex flex-wrap gap-2 mb-3">
          {attachments.map((att, i) => (
            <div
              key={i}
              className="relative group flex items-center gap-2 bg-gray-100 dark:bg-gray-700 rounded-lg px-3 py-2 text-sm"
            >
              {att.type === 'image' && att.preview ? (
                <img src={att.preview} alt={att.name} className="h-10 w-10 object-cover rounded" />
              ) : att.type === 'audio' ? (
                <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                </svg>
              ) : att.type === 'video' ? (
                <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              )}
              <span className="text-gray-700 dark:text-gray-300 max-w-[120px] truncate">{att.name}</span>
              <button
                onClick={() => removeAttachment(i)}
                className="ml-1 text-gray-400 hover:text-red-500 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
          {processingFiles > 0 && (
            <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg px-3 py-2 text-sm text-blue-600 dark:text-blue-400">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-xs">Processing PDF...</span>
            </div>
          )}
        </div>
      )}

      {/* Input area */}
      <div className="flex gap-2 items-end">
        {/* Attach button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors flex-shrink-0"
          title="Attach file"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        </button>

        {/* Record audio button */}
        <button
          onClick={isRecording ? stopRecording : startRecording}
          disabled={disabled}
          className={`p-2 transition-colors flex-shrink-0 ${
            isRecording
              ? 'text-red-500 hover:text-red-700 animate-pulse'
              : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
          }`}
          title={isRecording ? `Stop recording (${formatDuration(recordingDuration)})` : 'Record audio'}
        >
          {isRecording ? (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
          )}
        </button>

        {isRecording && (
          <span className="text-xs text-red-500 font-mono self-center flex-shrink-0">
            {formatDuration(recordingDuration)}
          </span>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
          accept="image/*,audio/*,video/*,.txt,.md,.json,.csv,.xml,.yaml,.yml,.log,.js,.ts,.py,.html,.css,.pdf"
        />

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={isDragOver ? 'Drop files here...' : 'Type your message... (Shift+Enter for new line)'}
          disabled={disabled}
          rows={1}
          className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none text-sm min-h-[40px] max-h-[200px] overflow-y-auto disabled:bg-gray-100 disabled:text-gray-400 dark:disabled:bg-gray-700 dark:disabled:text-gray-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
          style={{ height: 'auto' }}
          onInput={(e) => {
            e.target.style.height = 'auto'
            e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'
          }}
        />

        <button
          onClick={handleSend}
          disabled={disabled || processingFiles > 0 || (!text.trim() && attachments.length === 0)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </div>

      {isDragOver && (
        <div className="absolute inset-0 flex items-center justify-center bg-blue-50 dark:bg-blue-900/80 bg-opacity-90 rounded pointer-events-none">
          <p className="text-blue-600 dark:text-blue-300 font-medium">Drop files to attach</p>
        </div>
      )}
    </div>
  )
}

export default MessageInput
