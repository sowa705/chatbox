import { useState, useEffect, useRef } from 'react'
import { useDatabase } from '../hooks/useDatabase'

function GeneralSettings() {
  const db = useDatabase()
  const [models, setModels] = useState([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [labelModel, setLabelModel] = useState(null) // { providerId, modelId, provider }
  const [search, setSearch] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [darkMode, setDarkMode] = useState(false)
  const dropdownRef = useRef(null)

  // Load all models and current setting
  useEffect(() => {
    if (!db.isReady) return
    loadData()
  }, [db.isReady])

  const loadData = async () => {
    setLoadingModels(true)
    try {
      const providers = await db.getAllProviders()
      const allModels = []
      for (const provider of providers) {
        try {
          const pm = await db.listProviderModels(provider.id)
          allModels.push(...pm)
        } catch (err) {
          console.warn(`Failed to load models from ${provider.name}:`, err)
        }
      }
      setModels(allModels)

      const saved = await db.getSetting('labelModel')
      if (saved) {
        const match = allModels.find(m => m.id === saved.modelId && m.providerId === saved.providerId)
        if (match) {
          setLabelModel({ modelId: match.id, providerId: match.providerId, provider: match.provider })
        } else {
          setLabelModel(saved)
        }
      }

      const dm = await db.getSetting('darkMode')
      setDarkMode(!!dm)
    } catch (err) {
      console.error('Failed to load settings data:', err)
    } finally {
      setLoadingModels(false)
    }
  }

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

  const handleSaveLabelModel = async (model) => {
    setLabelModel(model)
    setIsOpen(false)
    setSearch('')
    try {
      await db.setSetting('labelModel', { providerId: model.providerId, modelId: model.id || model.modelId, provider: model.provider })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('Failed to save label model:', err)
    }
  }

  const handleClearLabelModel = async () => {
    setLabelModel(null)
    try {
      await db.setSetting('labelModel', null)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('Failed to clear label model:', err)
    }
  }

  const handleDarkModeToggle = async () => {
    const next = !darkMode
    setDarkMode(next)
    if (next) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    try {
      await db.setSetting('darkMode', next)
    } catch (err) {
      console.error('Failed to save dark mode setting:', err)
    }
  }

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

  return (
    <div className="space-y-8">
      {/* Dark Mode */}
      <section className="space-y-3">
        <div>
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Appearance</h4>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Choose between light and dark interface theme.
          </p>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-700 dark:text-gray-300">Dark mode</span>
          <button
            type="button"
            role="switch"
            aria-checked={darkMode}
            onClick={handleDarkModeToggle}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
              darkMode ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                darkMode ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </section>

      {/* Thread Label Model */}
      <section className="space-y-3">
        <div>
          <h4 className="text-sm font-semibold text-gray-900">Thread Label Model</h4>
          <p className="text-xs text-gray-500 mt-1">
            When set, this model will automatically generate a short title for new threads after the first message.
            If not set, the first 50 characters of the message are used instead.
          </p>
        </div>

        <div className="relative" ref={dropdownRef}>
          {/* Selector button */}
          <button
            onClick={() => setIsOpen(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
            {labelModel ? (
              <span className="text-gray-900 truncate">
                <span className="text-gray-400 text-xs mr-1">{labelModel.provider} /</span>
                {labelModel.modelId}
              </span>
            ) : (
              <span className="text-gray-400">Select a model…</span>
            )}
            <svg className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Dropdown */}
          {isOpen && (
            <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
              {/* Search */}
              <div className="p-2 border-b border-gray-100">
                <input
                  autoFocus
                  type="text"
                  placeholder="Search models…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="max-h-64 overflow-y-auto">
                {loadingModels ? (
                  <div className="px-4 py-3 text-sm text-gray-400 text-center">Loading models…</div>
                ) : Object.keys(grouped).length === 0 ? (
                  <div className="px-4 py-3 text-sm text-gray-400 text-center">No models found</div>
                ) : (
                  Object.entries(grouped).map(([providerName, providerModels]) => (
                    <div key={providerName}>
                      <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 bg-gray-50 border-b border-gray-100">
                        {providerName}
                      </div>
                      {providerModels.map(m => (
                        <button
                          key={`${m.providerId}-${m.id}`}
                          onClick={() => handleSaveLabelModel(m)}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition-colors flex items-center justify-between ${
                            labelModel?.modelId === m.id && labelModel?.providerId === m.providerId
                              ? 'bg-blue-50 text-blue-700'
                              : 'text-gray-800'
                          }`}
                        >
                          <span className="truncate">{m.id}</span>
                        </button>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Current selection + clear */}
        {labelModel && (
          <div className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs">
            <span className="text-blue-700">
              <span className="font-medium">Active:</span> {labelModel.provider} / {labelModel.modelId}
            </span>
            <button
              onClick={handleClearLabelModel}
              className="text-blue-400 hover:text-red-500 transition-colors ml-2 shrink-0"
              title="Clear label model"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {saved && (
          <p className="text-xs text-green-600 flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Saved
          </p>
        )}
      </section>
    </div>
  )
}

export default GeneralSettings
