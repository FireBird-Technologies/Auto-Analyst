// New utility file for session recovery
export class SessionRecovery {
  private static readonly SESSION_KEY = 'auto-analyst-session-id';
  private static readonly BACKUP_KEY = 'auto-analyst-session-backup';
  
  static getStoredSessionId(): string | null {
    // Try multiple storage sources in order of preference
    const sources = [
      () => localStorage.getItem(this.SESSION_KEY),
      () => sessionStorage.getItem(this.SESSION_KEY),
      () => localStorage.getItem(this.BACKUP_KEY),
      () => sessionStorage.getItem(this.BACKUP_KEY),
    ];
    
    for (const source of sources) {
      try {
        const sessionId = source();
        if (sessionId && this.isValidSessionId(sessionId)) {
          console.log(`Recovered session ID from ${source.name}: ${sessionId}`);
          return sessionId;
        }
      } catch (error) {
        console.warn('Error accessing storage source:', error);
      }
    }
    
    return null;
  }
  
  static storeSessionId(sessionId: string): void {
    try {
      // Store in primary location
      localStorage.setItem(this.SESSION_KEY, sessionId);
      sessionStorage.setItem(this.SESSION_KEY, sessionId);
      
      // Create backup
      localStorage.setItem(this.BACKUP_KEY, sessionId);
      
      console.log(`Stored session ID: ${sessionId}`);
    } catch (error) {
      console.error('Failed to store session ID:', error);
    }
  }
  
  static clearStoredSessionId(): void {
    try {
      localStorage.removeItem(this.SESSION_KEY);
      sessionStorage.removeItem(this.SESSION_KEY);
      localStorage.removeItem(this.BACKUP_KEY);
      sessionStorage.removeItem(this.BACKUP_KEY);
      
      console.log('Cleared all stored session IDs');
    } catch (error) {
      console.error('Failed to clear session IDs:', error);
    }
  }
  
  static isValidSessionId(sessionId: string): boolean {
    if (!sessionId || typeof sessionId !== 'string') {
      return false;
    }
    
    // Check for valid session ID patterns
    const patterns = [
      /^session_\d+_[a-z0-9]+$/,  // session_1234567890_abc123 (frontend fallback)
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,  // UUID (backend)
      /^user_\d+$/,  // user_123
    ];
    
    return patterns.some(pattern => pattern.test(sessionId));
  }
  
  static generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
