import { useState, useEffect, useRef } from 'react'
import { useDatabase } from '../hooks/useDatabase'

// Small modality badge icons shown next to model names
function ModalityIcons({ modalities }) {
  if (!modalities || modalities.length === 0) return null
  const hasImage = modalities.includes('image') || modalities.includes('file')
  const hasAudio = modalities.includes('audio')
  const hasVideo = modalities.includes('video')
  return (
    <span className="flex items-center gap-0.5 shrink-0">
      {hasImage && (
        <span title="Supports image input" className="text-blue-400">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18a.75.75 0 00.75-.75V6.75A.75.75 0 0021 6H3a.75.75 0 00-.75.75v13.5c0 .414.336.75.75.75zM9.75 9.75a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
          </svg>
        </span>
      )}
      {hasAudio && (
        <span title="Supports audio input" className="text-purple-400">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
          </svg>
        </span>
      )}
      {hasVideo && (
        <span title="Supports video input" className="text-green-400">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
        </span>
      )}
    </span>
  )
}

function ModelSelector({ selectedModel, onModelChange }) {
  const db = useDatabase()
  const [models, setModels] = useState([])
  const [search, setSearch] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef(null)
  const searchRef = useRef(null)

  // Load models from all providers
  const loadModels = async () => {
    if (!db.isReady) return
    setLoading(true)
    try {
      const providers = await db.getAllProviders()
      const allModels = []
      for (const provider of providers) {
        try {
          const providerModels = await db.listProviderModels(provider.id)
          allModels.push(...providerModels)
        } catch (err) {
          console.warn(`Failed to load models from ${provider.name}:`, err)
        }
      }
      setModels(allModels)
    } catch (err) {
      console.error('Failed to load models:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadModels()
  }, [db.isReady])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Focus search when dropdown opens
  useEffect(() => {
    if (isOpen && searchRef.current) {
      searchRef.current.focus()
    }
  }, [isOpen])

  const filteredModels = models.filter(m => {
    const q = search.toLowerCase()
    return m.id.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q)
  })

  // Group by provider
  const grouped = filteredModels.reduce((acc, m) => {
    if (!acc[m.provider]) acc[m.provider] = []
    acc[m.provider].push(m)
    return acc
  }, {})

  const selectedDisplay = selectedModel
    ? (() => {
        const m = models.find(m => m.id === selectedModel.modelId && m.providerId === selectedModel.providerId)
        return m ? `${m.provider} / ${m.id}` : `${selectedModel.modelId}`
      })()
    : 'Select a model...'

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-left bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm truncate text-gray-900 dark:text-gray-100"
        title={selectedDisplay}
      >
        <span className="flex items-center justify-between gap-1 pr-5">
          <span className="truncate">{selectedDisplay}</span>
          {selectedModel && (() => {
            const m = models.find(m => m.id === selectedModel.modelId && m.providerId === selectedModel.providerId)
            return m ? <ModalityIcons modalities={m.modalities} /> : null
          })()}
        </span>
        <span className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
          <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-80 flex flex-col">
          {/* Search */}
          <div className="p-2 border-b border-gray-100 dark:border-gray-700">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search models..."
              className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
            />
          </div>

          {/* Refresh button */}
          <div className="px-2 py-1 border-b border-gray-100 dark:border-gray-700">
            <button
              onClick={(e) => {
                e.stopPropagation()
                loadModels()
              }}
              disabled={loading}
              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              <svg className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {loading ? 'Loading...' : 'Refresh models'}
            </button>
          </div>

          {/* Model list */}
          <div className="overflow-y-auto flex-1">
            {Object.keys(grouped).length === 0 && (
              <div className="p-3 text-sm text-gray-500 dark:text-gray-400 text-center">
                {loading ? 'Loading models...' : 'No models found. Add a provider in Settings.'}
              </div>
            )}
            {Object.entries(grouped).map(([provider, providerModels]) => (
              <div key={provider}>
                <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase bg-gray-50 dark:bg-gray-900 sticky top-0">
                  {provider}
                </div>
                {providerModels.map((m) => (
                  <button
                    key={`${m.providerId}-${m.id}`}
                    onClick={() => {
                      onModelChange({ providerId: m.providerId, modelId: m.id, provider: m.provider, contextWindow: m.contextWindow || null, modalities: m.modalities || null, supportedParameters: m.supportedParameters || null, pricing: m.pricing || null })
                      setIsOpen(false)
                      setSearch('')
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors flex items-center justify-between gap-2 ${
                      selectedModel?.modelId === m.id && selectedModel?.providerId === m.providerId
                        ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300'
                        : 'text-gray-700 dark:text-gray-200'
                    }`}
                  >
                    <span className="truncate flex-1">{m.id}</span>
                    <ModalityIcons modalities={m.modalities} />
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default ModelSelector
