
import axios, { AxiosInstance } from 'axios'
import { useSessionStore } from '@/lib/store/sessionStore'
import API_URL from '@/config/api'

// Extend the AxiosInstance type to include isAxiosError
interface ExtendedAxiosInstance extends AxiosInstance {
  isAxiosError: typeof axios.isAxiosError
}

// Create axios instance
const apiClient = axios.create({
  baseURL: API_URL
}) as ExtendedAxiosInstance

// Helper function to get current user data from localStorage
const getCurrentUserData = () => {
  try {
    // Try to get from stored session data
    const storedUserData = localStorage.getItem('current-user-data')
    if (storedUserData) {
      const userData = JSON.parse(storedUserData)
      return {
        user_id: userData.user_id || 0,
        user_email: userData.user_email || '',
        user_name: userData.user_name || 'Anonymous'
      }
    }
    
    // Fallback to anonymous if no user data found
    return {
      user_id: 0,
      user_email: '',
      user_name: 'Anonymous'
    }
  } catch (error) {
    console.warn('Failed to get current user data:', error)
    return {
      user_id: 0,
      user_email: '',
      user_name: 'Anonymous'
    }
  }
}

// Response interceptor to handle "Session ID required" errors
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config
    
    // Check if error is "Session ID required" and we haven't already retried
    if (
      error.response?.status === 400 && 
      error.response?.data?.detail === "Session ID required" &&
      !originalRequest._retry
    ) {
      originalRequest._retry = true
      
      console.log('🔄 Session ID required - auto-generating and retrying...')
      
      try {
        // Generate new sessionId
        const newSessionId = `auto_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        
        // Store in sessionStore
        const { setSessionId } = useSessionStore.getState()
        setSessionId(newSessionId)
        
        // Store in localStorage
        localStorage.setItem('auto-analyst-session-id', newSessionId)
        sessionStorage.setItem('auto-analyst-session-id', newSessionId)
        
        // Get current user data from localStorage
        const userData = getCurrentUserData()
        
        // Initialize session on backend with actual user data
        await apiClient.post('/initialize-session', {
          session_id: newSessionId,
          ...userData
        }, {
          headers: { 'X-Session-ID': newSessionId }
        })
        
        console.log('✅ Auto-generated session for user:', userData.user_email || 'Anonymous', newSessionId)
        
        // Retry original request with new sessionId
        originalRequest.headers['X-Session-ID'] = newSessionId
        return apiClient(originalRequest)
        
      } catch (retryError) {
        console.error('❌ Failed to auto-generate session:', retryError)
        return Promise.reject(error)
      }
    }
    
    return Promise.reject(error)
  }
)

// Request interceptor to always add sessionId header
apiClient.interceptors.request.use(
  (config) => {
    const { sessionId } = useSessionStore.getState()
    const storedSessionId = sessionId || 
      localStorage.getItem('auto-analyst-session-id') || 
      sessionStorage.getItem('auto-analyst-session-id')
    
    if (storedSessionId) {
      config.headers['X-Session-ID'] = storedSessionId
    }
    
    return config
  },
  (error) => Promise.reject(error)
)

// Add isAxiosError utility to apiClient
apiClient.isAxiosError = axios.isAxiosError

export default apiClient
