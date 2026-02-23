import React, { useState, useEffect, useCallback } from 'react';
import { X, CheckCircle, AlertCircle, Info, Settings } from 'lucide-react';
import API_URL from '@/config/api'
import { useSessionStore } from '@/lib/store/sessionStore'
import { getModelCreditCost, MODEL_PROVIDERS_UI } from '@/lib/model-registry'
import { useModelSettings, ModelSettings } from '@/lib/hooks/useModelSettings';

interface SettingsPopupProps {
  isOpen: boolean;
  onClose: () => void;
  initialSettings?: ModelSettings;
  onSettingsUpdated?: (settings: ModelSettings) => void;
}

// Define model providers and their models - use the central registry
const MODEL_PROVIDERS = MODEL_PROVIDERS_UI;

const BASE_URL = API_URL;

const SettingsPopup: React.FC<SettingsPopupProps> = ({ isOpen, onClose, initialSettings, onSettingsUpdated }) => {
  const { updateModelSettings } = useModelSettings();
  const { sessionId, setSessionId } = useSessionStore();
  
  // Function to ensure we have a session ID
  const ensureSessionId = useCallback(() => {
    // Don't generate temporary session IDs in SettingsPopup
    // The session ID should be managed by the main chat components
    if (!sessionId) {
      console.warn('No session ID available in SettingsPopup');
    }
  }, [sessionId]);
  
  // Check session ID on load
  useEffect(() => {
    if (!sessionId) {
      console.warn('SettingsPopup opened without session ID');
    }
  }, [sessionId]);
  
  const [selectedProvider, setSelectedProvider] = useState(initialSettings?.provider || 'anthropic');
  const [selectedModel, setSelectedModel] = useState(initialSettings?.model || 'claude-sonnet-4-5-20250929');
  const [useCustomAPI, setUseCustomAPI] = useState(initialSettings?.hasCustomKey || false);
  const [apiKey, setApiKey] = useState(initialSettings?.apiKey || '');
  const [notification, setNotification] = useState<{type: 'success' | 'error', message: string} | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  // Convert string to number for temperature if needed
  const [temperature, setTemperature] = useState<number>(() => {
    const defaultTemp = initialSettings?.temperature || 1;
    return typeof defaultTemp === 'string' ? parseFloat(defaultTemp as string) : (defaultTemp as number);
  });
  
  // Convert string to number for maxTokens if needed
  const [maxTokens, setMaxTokens] = useState<number>(() => {
    const defaultTokens = initialSettings?.maxTokens || 1000;
    return typeof defaultTokens === 'string' ? parseInt(defaultTokens as string) : (defaultTokens as number);
  });

  // Update selected model when provider changes
  useEffect(() => {
    const provider = MODEL_PROVIDERS.find(p => p.name === selectedProvider);
    if (provider) {
      // Find if the current model exists in the new provider
      const modelExists = provider.models.some(m => m.id === selectedModel);
      // If not, set the first model of the new provider
      if (!modelExists) {
        setSelectedModel(provider.models[0].id);
      }
    }
  }, [selectedProvider, selectedModel]);

  // Update selected model when initialSettings change
  useEffect(() => {
    if (initialSettings) {
      setSelectedModel(initialSettings.model);
      setSelectedProvider(initialSettings.provider);
      setUseCustomAPI(initialSettings.hasCustomKey);
      setApiKey(initialSettings.apiKey);
      
      // Handle temperature with proper type conversion
      const temp = initialSettings.temperature;
      setTemperature(typeof temp === 'string' ? parseFloat(temp) : (temp as number));
      
      // Handle maxTokens with proper type conversion
      const tokens = initialSettings.maxTokens;
      setMaxTokens(typeof tokens === 'string' ? parseInt(tokens) : (tokens as number));
    }
  }, [initialSettings]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Ensure we have a session ID
      ensureSessionId();
      
      // Check for session ID first
      if (!sessionId) {
        setNotification({ 
          type: 'error', 
          message: 'Session ID is missing. Please refresh the page and try again.'
        });
        return;
      }
      
      // Validate API key if custom API is enabled
      if (useCustomAPI && !apiKey.trim()) {
        setNotification({ 
          type: 'error', 
          message: 'Please provide an API key or disable custom API option'
        });
        return;
      }

      // Create settings object that we'll pass to hook and parent component
      const updatedSettings: ModelSettings = {
        provider: selectedProvider,
        model: selectedModel,
        hasCustomKey: useCustomAPI,
        apiKey: useCustomAPI ? apiKey.trim() : '',
        temperature: temperature,
        maxTokens: maxTokens,
      };

      // Use the hook to update settings
      const success = await updateModelSettings(updatedSettings);
      
      if (success) {
        setNotification({ type: 'success', message: 'Settings updated successfully!' });
        
        // Call the callback if provided
        if (onSettingsUpdated) {
          onSettingsUpdated(updatedSettings);
        }
        
        setTimeout(() => {
          setNotification(null);
          onClose();
        }, 2000);
      } else {
        throw new Error('Failed to update settings');
      }
    } catch (error) {
      setNotification({ 
        type: 'error', 
        message: error instanceof Error ? error.message : 'Failed to update settings'
      });
      console.error('Failed to update settings:', error);
    }
  };

  if (!isOpen) return null;

  // Get credit cost for the currently selected model
  const selectedModelCreditCost = getModelCreditCost(selectedModel);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-96 relative shadow-lg">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-[#FF7F7F] transition-colors"
          aria-label="Close"
        >
          <X className="h-6 w-6" />
        </button>
        
        <h2 className="text-xl font-semibold mb-6 text-gray-800">Settings</h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Model Provider
            </label>
            <select
              value={selectedProvider}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedProvider(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#FF7F7F] focus:border-transparent bg-white"
            >
              {MODEL_PROVIDERS.map((provider) => (
                <option key={provider.name} value={provider.name}>
                  {provider.displayName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Model
            </label>
            <div className="mb-1 text-xs text-gray-500 flex items-center">
              <Info className="h-3 w-3 mr-1" />
              Current selection: <span className="font-semibold ml-1">{selectedModelCreditCost} credits per query</span>
            </div>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#FF7F7F] focus:border-transparent bg-white"
            >
              {MODEL_PROVIDERS.find(p => p.name === selectedProvider)?.models.map((model) => {
                const creditCost = getModelCreditCost(model.id);
                return (
                  <option key={model.id} value={model.id}>
                    {model.name} ({creditCost} credits)
                  </option>
                );
              })}
            </select>
          </div>
          
          {/* <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="useCustomAPI"
              checked={useCustomAPI}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUseCustomAPI(e.target.checked)}
              className="rounded bg-white border-white text-[#FF7F7F] focus:ring-[#FF7F7F]"
            />
            <label htmlFor="useCustomAPI" className="text-sm font-medium text-gray-700">
              Use custom API key
            </label>
          </div> */}

          {useCustomAPI && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className="block text-sm font-medium text-gray-700">
                  API Key
                </label>
                <div className="relative group">
                  <Info className="h-4 w-4 text-gray-400 cursor-help" />
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:block w-64 p-2 bg-[#FF7F7F] text-white text-xs rounded-md shadow-lg z-10">
                    Your API key is never stored on our servers. It's only used once for the current request.
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-1">
                      <div className="border-solid border-4 border-transparent border-t-[#FF7F7F]"></div>
                    </div>
                  </div>
                </div>
              </div>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your API key"
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#FF7F7F] focus:border-transparent bg-white"
              />
            </div>
          )}
          
          <div className="border-t pt-4">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-2"
            >
              <Settings className="w-4 h-4" />
              Advanced Settings
            </button>
          </div>

          {showAdvanced && (
            <div className="space-y-4 p-3 bg-gray-50 rounded-md">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Temperature ({temperature})
                </label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={temperature}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTemperature(parseFloat(e.target.value))}
                  className="w-full accent-[#FF7F7F]"
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>More precise</span>
                  <span>More creative</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max Tokens
                </label>
                <input
                  type="number"
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(parseInt(e.target.value))}
                  min="1"
                  max="32000"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#FF7F7F] focus:border-transparent bg-white"
                />
              </div>
            </div>
          )}
          
          {notification && (
            <div className={`flex items-center gap-2 p-3 rounded-md ${
              notification.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}>
              {notification.type === 'success' ? (
                <CheckCircle className="h-5 w-5" />
              ) : (
                <AlertCircle className="h-5 w-5" />
              )}
              <span className="text-sm">{notification.message}</span>
            </div>
          )}
          
          <button
            type="submit"
            className="w-full bg-[#FF7F7F] text-white py-2 px-4 rounded-md hover:bg-[#FF6B6B] transition-colors"
          >
            Save Settings
          </button>
        </form>
      </div>
    </div>
  );
};

export default SettingsPopup; 