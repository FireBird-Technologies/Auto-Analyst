/**
 * Utility for handling logging in a production-safe manner
 * 
 * This logger wraps console methods and can be globally configured
 * to disable logs in production environments.
 */

// Set this to true to disable all non-error logs
const DISABLE_LOGS = true;

const logger = {
  log: (...args: any[]) => {
    if (!DISABLE_LOGS) {
      console.log(...args);
    }
  },
  
  info: (...args: any[]) => {
    if (!DISABLE_LOGS) {
      console.info(...args);
    }
  },
  
  warn: (...args: any[]) => {
    if (!DISABLE_LOGS) {
      console.warn(...args);
    }
  },
  
  error: (...args: any[]) => {
    // Always show errors, even when other logs are disabled
    console.error(...args);
  },
  
  debug: (...args: any[]) => {
    if (!DISABLE_LOGS) {
      console.debug(...args);
    }
  }
};

export default logger; 