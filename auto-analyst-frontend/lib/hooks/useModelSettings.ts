import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import API_URL from '@/config/api'
import { useSessionStore } from '@/lib/store/sessionStore'
import logger from '@/lib/utils/logger'
import { getUserStorageKey } from '@/lib/utils/userStorage'


export interface ModelSettings {
  provider: string
  model: string
  hasCustomKey: boolean
  apiKey: string
  temperature: number | string
  maxTokens: number | string
}

// Helper functions for localStorage with mobile support
const saveSettingsToLocalStorage = (settings: ModelSettings) => {
  try {
    // Don't save API key to localStorage for security
    const safeSettings = {
      ...settings,
      apiKey: '', // Clear API key
      hasCustomKey: settings.hasCustomKey, // Keep flag but not the actual key
    }
    
    const userKey = getUserStorageKey('userModelSettings');
    localStorage.setItem(userKey, JSON.stringify(safeSettings));
  } catch (error) {
    console.error('Failed to save settings:', error)
  }
}

const getSettingsFromLocalStorage = (): Partial<ModelSettings> | null => {
  try {
    const userKey = getUserStorageKey('userModelSettings');
    const settings = localStorage.getItem(userKey);
    return settings ? JSON.parse(settings) : null;
  } catch (error) {
    console.error('Failed to get settings:', error)
    return null
  }
}

export function useModelSettings() {
  const { sessionId } = useSessionStore()
  
  // Initialize with localStorage or defaults
  const [modelSettings, setModelSettings] = useState<ModelSettings>(() => {
    // Use a function to initialize state to avoid multiple localStorage reads
    const localSettings = getSettingsFromLocalStorage()
    return {
      provider: localSettings?.provider || process.env.DEFAULT_MODEL_PROVIDER || 'anthropic',
      model: localSettings?.model || process.env.DEFAULT_PUBLIC_MODEL || 'claude-sonnet-4-5-20250929',
      hasCustomKey: localSettings?.hasCustomKey || false,
      apiKey: process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY || '', // Never load API key from localStorage
      temperature: localSettings?.temperature || process.env.DEFAULT_TEMPERATURE || 1,
      maxTokens: localSettings?.maxTokens || process.env.PUBLIC_DEFAULT_MAX_TOKENS || 3000
    }
  })
  
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchModelSettings = useCallback(async () => {
    if (!sessionId) return
    
    setIsLoading(true)
    setError(null)
    
    try {
      const response = await axios.get(`${API_URL}/api/model-settings`, {
        headers: { 'X-Session-ID': sessionId }
      })
      
      if (response.data) {
        const updatedSettings = {
          provider: response.data.provider,
          model: response.data.model,
          hasCustomKey: !!response.data.api_key,
          apiKey: response.data.api_key || '',
          temperature: response.data.temperature,
          maxTokens: response.data.maxTokens
        }
        
        setModelSettings(updatedSettings)
        saveSettingsToLocalStorage(updatedSettings)
        
        logger.log(`[Settings] Fetched model settings: ${response.data.model}`)
      }
    } catch (error) {
      console.error('Failed to fetch model settings:', error)
      setError('Failed to fetch model settings')
    } finally {
      setIsLoading(false)
    }
  }, [sessionId])

  const syncSettingsToBackend = useCallback(async () => {
    if (!sessionId) return false
    
    try {
      // Only sync if we have settings in localStorage
      const localSettings = getSettingsFromLocalStorage()
      if (!localSettings) return false
      
      // Ensure we have complete settings with defaults for any missing values
      const completeSettings = {
        provider: localSettings.provider || 'anthropic',
        model: localSettings.model || 'claude-sonnet-4-5-20250929',
        api_key: '', // Never send API key from localStorage
        temperature: localSettings.temperature || 1,
        max_tokens: 5000 // Always use 3000 for consistency
      }
      const response = await axios.post(`${API_URL}/settings/model`, completeSettings, {
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId
        }
      })
      
      logger.log(`[Settings] Synced model settings to backend: ${completeSettings.model}`)
      
      // If the sync was successful, update local state to match what we sent
      if (response.status === 200) {
        setModelSettings(prev => ({
          ...prev,
          provider: completeSettings.provider,
          model: completeSettings.model,
          temperature: completeSettings.temperature,
          maxTokens: completeSettings.max_tokens
        }))
      }
      
      return true
    } catch (error) {
      console.error('Failed to sync settings to backend:', error)
      return false
    }
  }, [sessionId, setModelSettings])

  const updateModelSettings = useCallback(async (updatedSettings: Partial<ModelSettings>) => {
    if (!sessionId) {
      return false;
    }
    
    setIsLoading(true)
    setError(null)
    
    try {
      // Use the correct endpoint for updating settings
      const response = await axios.post(`${API_URL}/settings/model`, {
        provider: updatedSettings.provider,
        model: updatedSettings.model,
        api_key: updatedSettings.apiKey,
        temperature: updatedSettings.temperature || 1,
        max_tokens: updatedSettings.maxTokens || 5000  // Default to 5000 if not specified
      }, {
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId
        }
      })
      
      // Then update local state
      const newSettings = {
        ...modelSettings,
        ...updatedSettings,
        hasCustomKey: !!updatedSettings.apiKey
      }
      
      setModelSettings(newSettings)
      saveSettingsToLocalStorage(newSettings)
      
      logger.log(`[Settings] Updated model settings to ${updatedSettings.model}`)
      
      // Fetch the latest settings to ensure consistency
      await fetchModelSettings()
      
      return true
    } catch (error) {
      console.error('Failed to update model settings:', error)
      setError('Failed to update model settings')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [sessionId, fetchModelSettings, modelSettings])

  // Initial fetch when session ID is available
  useEffect(() => {
    if (sessionId) {
      // First check if we have local settings that need to be synced
      const localSettings = getSettingsFromLocalStorage();
      
      if (localSettings && localSettings.model) {
        // If we have local settings, immediately sync them to the backend
        // This ensures backend uses the same model as shown in frontend after refresh
        logger.log(`[Settings] Syncing local settings to backend: ${localSettings.model}`);
        syncSettingsToBackend()
          .then(success => {
            if (success) {
              logger.log('[Settings] Successfully synced local settings to backend');
            } else {
              console.warn('[Settings] Failed to sync local settings, fetching from backend instead');
              fetchModelSettings();
            }
          })
          .catch(error => {
            console.error('[Settings] Error syncing settings:', error);
            fetchModelSettings();
          });
      } else {
        // If no local settings, fetch from backend
        fetchModelSettings();
      }
    }
  }, [sessionId, fetchModelSettings, syncSettingsToBackend]);

  return {
    modelSettings,
    isLoading,
    error,
    fetchModelSettings,
    updateModelSettings,
    syncSettingsToBackend
  }
} 