import { useState } from 'react'
import ProvidersSettings from './ProvidersSettings'
import GeneralSettings from './GeneralSettings'

function SettingsModal({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('general')

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
      <div className="relative bg-white rounded-lg shadow-2xl w-[900px] h-[600px] flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-48 bg-gray-50 border-r border-gray-200 p-4">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Settings</h2>
          <nav className="space-y-1">
            <button
              onClick={() => setActiveTab('general')}
              className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                activeTab === 'general'
                  ? 'bg-blue-100 text-blue-700 font-medium'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              General
            </button>
            <button
              onClick={() => setActiveTab('providers')}
              className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                activeTab === 'providers'
                  ? 'bg-blue-100 text-blue-700 font-medium'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              Providers
            </button>
            <button
              onClick={() => setActiveTab('about')}
              className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                activeTab === 'about'
                  ? 'bg-blue-100 text-blue-700 font-medium'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              About
            </button>
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
            <h3 className="text-xl font-semibold text-gray-900">
              {activeTab === 'general' ? 'General' : activeTab === 'providers' ? 'Provider Configuration' : 'About'}
            </h3>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 transition-colors"
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
                <h4 className="text-lg font-medium text-gray-900">ChatBox</h4>
                <p className="text-gray-600">Version 1.0.0</p>
                <p className="text-gray-600">
                  A modern interface for interacting with Large Language Models.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal
