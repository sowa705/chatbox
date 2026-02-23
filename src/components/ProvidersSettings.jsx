import { useState, useEffect } from 'react'
import { useDatabase } from '../hooks/useDatabase'

function ProvidersSettings() {
  const db = useDatabase()
  const [providers, setProviders] = useState([])
  const [isAdding, setIsAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [formData, setFormData] = useState({ name: '', apiBase: '', apiKey: '' })
  const [testingId, setTestingId] = useState(null)
  const [testResult, setTestResult] = useState(null)

  useEffect(() => {
    console.log('ProvidersSettings: db.isReady =', db.isReady)
    if (db.isReady) {
      loadProviders()
    }
  }, [db.isReady])

  const loadProviders = async () => {
    try {
      const data = await db.getAllProviders()
      setProviders(data || [])
    } catch (error) {
      console.error('Failed to load providers:', error)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      if (editingId) {
        await db.updateProvider(editingId, formData.name, formData.apiBase, formData.apiKey)
      } else {
        await db.createProvider(formData.name, formData.apiBase, formData.apiKey)
      }
      await loadProviders()
      resetForm()
    } catch (error) {
      console.error('Failed to save provider:', error)
      alert('Failed to save provider: ' + error.message)
    }
  }

  const handleEdit = (provider) => {
    setEditingId(provider.id)
    setFormData({
      name: provider.name,
      apiBase: provider.api_base,
      apiKey: provider.api_key
    })
    setIsAdding(true)
  }

  const handleDelete = async (id) => {
    if (confirm('Are you sure you want to delete this provider?')) {
      try {
        await db.deleteProvider(id)
        await loadProviders()
      } catch (error) {
        console.error('Failed to delete provider:', error)
        alert('Failed to delete provider: ' + error.message)
      }
    }
  }

  const handleTest = async (provider) => {
    setTestingId(provider.id)
    setTestResult(null)
    try {
      const result = await db.testProvider(provider.id)
      setTestResult({ success: true, data: result })
    } catch (error) {
      console.error('Failed to test provider:', error)
      setTestResult({ success: false, error: error.message })
    } finally {
      setTestingId(null)
    }
  }

  const resetForm = () => {
    setIsAdding(false)
    setEditingId(null)
    setFormData({ name: '', apiBase: '', apiKey: '' })
    setTestResult(null)
  }

  // Show loading state if database is not ready
  if (!db.isReady) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-gray-500 dark:text-gray-400">Loading...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Add Provider Button */}
      {!isAdding && (
        <button
          onClick={() => setIsAdding(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          + Add Provider
        </button>
      )}

      {/* Add/Edit Form */}
      {isAdding && (
        <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
          <h4 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
            {editingId ? 'Edit Provider' : 'Add New Provider'}
          </h4>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Provider Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., OpenAI, Anthropic, Local LLM"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                API Base URL
              </label>
              <input
                type="text"
                value={formData.apiBase}
                onChange={(e) => setFormData({ ...formData, apiBase: e.target.value })}
                placeholder="https://api.openai.com/v1"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                API Key
              </label>
              <input
                type="password"
                value={formData.apiKey}
                onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                placeholder="sk-..."
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                {editingId ? 'Update' : 'Add'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Test Result */}
      {testResult && (
        <div className={`p-4 rounded-lg ${testResult.success ? 'bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700' : 'bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700'}`}>
          <div className="flex items-start">
            <div className="flex-shrink-0">
              {testResult.success ? (
                <svg className="h-5 w-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="h-5 w-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              )}
            </div>
            <div className="ml-3">
              <h3 className={`text-sm font-medium ${testResult.success ? 'text-green-800' : 'text-red-800'}`}>
                {testResult.success ? 'Connection Successful' : 'Connection Failed'}
              </h3>
              <div className={`mt-2 text-sm ${testResult.success ? 'text-green-700' : 'text-red-700'}`}>
                {testResult.success ? (
                  <div>
                    <p>Available Models: {testResult.data.models.join(', ')}</p>
                  </div>
                ) : (
                  <p>{testResult.error}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Providers List */}
      <div className="space-y-3">
        <h4 className="text-lg font-medium text-gray-900 dark:text-gray-100">Configured Providers</h4>
        {providers.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400">No providers configured yet.</p>
        ) : (
          providers.map((provider) => (
            <div
              key={provider.id}
              className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h5 className="font-medium text-gray-900 dark:text-gray-100">{provider.name}</h5>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{provider.api_base}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
                    API Key: {provider.api_key.substring(0, 10)}...
                  </p>
                </div>
                <div className="flex gap-2 ml-4">
                  <button
                    onClick={() => handleTest(provider)}
                    disabled={testingId === provider.id}
                    className="px-3 py-1 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded hover:bg-green-200 dark:hover:bg-green-900/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    {testingId === provider.id ? 'Testing...' : 'Test'}
                  </button>
                  <button
                    onClick={() => handleEdit(provider)}
                    className="px-3 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-900/60 transition-colors text-sm"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(provider.id)}
                    className="px-3 py-1 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors text-sm"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default ProvidersSettings
