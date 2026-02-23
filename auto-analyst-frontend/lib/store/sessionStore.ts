import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getUserStorageKey } from '../utils/userStorage'

interface SessionStore {
  sessionId: string | null
  setSessionId: (id: string) => void
  clearSessionId: () => void
  isUserBased: () => boolean
  validateSessionId: (newId: string) => boolean
}

export const useSessionStore = create<SessionStore>()(
  persist(
    (set, get) => ({
      sessionId: null,
      
      setSessionId: (id: string) => {
        const currentState = get();
        
        // Validate the new session ID
        if (currentState.validateSessionId(id)) {
          console.log(`Updating session ID from ${currentState.sessionId} to ${id}`);
          set({ sessionId: id });
          
          // Also update localStorage for redundancy
          localStorage.setItem('auto-analyst-session-id', id);
        } else {
          console.warn(`Rejected session ID update: ${id}`);
        }
      },
      
      clearSessionId: () => {
        console.log('Clearing session ID from store');
        set({ sessionId: null });
        localStorage.removeItem('auto-analyst-session-id');
      },
      
      isUserBased: () => {
        const state = get();
        return state.sessionId ? state.sessionId.startsWith('user_') : false;
      },
      
      validateSessionId: (newId: string) => {
        const currentState = get();
        const currentId = currentState.sessionId;
        
        // If no current session ID, accept any new one
        if (!currentId) {
          console.log(`Accepting new session ID (no current): ${newId}`);
          return true;
        }
        
        // If it's the same ID, reject (no change needed)
        if (currentId === newId) {
          console.log(`Rejecting same session ID: ${newId}`);
          return false;
        }
        
        const isNewUserBased = newId.startsWith('user_');
        const isCurrentUserBased = currentId.startsWith('user_');
        
        // Prevent downgrade from user-based to anonymous
        if (isCurrentUserBased && !isNewUserBased) {
          console.warn('Preventing downgrade from user-based to anonymous session');
          return false;
        }
        
        // Allow upgrade from anonymous to user-based
        if (!isCurrentUserBased && isNewUserBased) {
          console.log('Upgrading from anonymous to user-based session');
          return true;
        }
        
        // For same type, only allow if significantly different (avoid minor changes)
        const isSignificantlyDifferent = Math.abs(newId.length - currentId.length) > 5;
        if (isSignificantlyDifferent) {
          console.log(`Accepting significantly different session ID: ${newId}`);
          return true;
        }
        
        console.log(`Rejecting similar session ID: ${newId}`);
        return false;
      }
    }),
    {
      name: 'session-storage',
      // Add partialize to only persist sessionId
      partialize: (state: SessionStore) => ({ sessionId: state.sessionId }),
      // Add storage configuration for better persistence
      storage: {
        getItem: (name: string) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          return JSON.parse(str);
        },
        setItem: (name: string, value: any) => {
          localStorage.setItem(name, JSON.stringify(value));
        },
        removeItem: (name: string) => {
          localStorage.removeItem(name);
        },
      },
    }
  )
); 