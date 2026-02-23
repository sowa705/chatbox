import { useState, useEffect } from 'react'
import ProvidersSettings from './ProvidersSettings'
import GeneralSettings from './GeneralSettings'

function SettingsModal({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('general')
  const [dbStats, setDbStats] = useState(null)

  useEffect(() => {
    if (isOpen && activeTab === 'about') {
      window.electronAPI.getDatabaseStats().then(setDbStats).catch(() => setDbStats(null))
    }
  }, [isOpen, activeTab])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop with blur */}
      <div 
        className="absolute inset-0 backdrop-blur-sm"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)' }}
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-[900px] h-[600px] flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-48 bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 p-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Settings</h2>
          <nav className="space-y-1">
            <button
              onClick={() => setActiveTab('general')}
              className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                activeTab === 'general'
                  ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              General
            </button>
            <button
              onClick={() => setActiveTab('providers')}
              className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                activeTab === 'providers'
                  ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              Providers
            </button>
            <button
              onClick={() => setActiveTab('about')}
              className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                activeTab === 'about'
                  ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              About
            </button>
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
            <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {activeTab === 'general' ? 'General' : activeTab === 'providers' ? 'Provider Configuration' : 'About'}
            </h3>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Settings Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'general' && <GeneralSettings />}
            {activeTab === 'providers' && <ProvidersSettings />}
            {activeTab === 'about' && (
              <div className="space-y-4">
                <h4 className="text-lg font-medium text-gray-900 dark:text-gray-100">ChatBox</h4>
                <p className="text-gray-600 dark:text-gray-400">Version 1.0.0</p>
                <p className="text-gray-600 dark:text-gray-400">
                  A modern interface for interacting with Large Language Models.
                </p>

                <div className="mt-6">
                  <h5 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-3">Database Statistics</h5>
                  {dbStats ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Database Size</p>
                        <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                          {(dbStats.sizeBytes / (1024 * 1024)).toFixed(2)} MB
                        </p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Threads</p>
                        <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{dbStats.threadCount}</p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Messages</p>
                        <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{dbStats.messageCount}</p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Attachments</p>
                        <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{dbStats.attachmentCount}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 dark:text-gray-400">Loading statistics…</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal
