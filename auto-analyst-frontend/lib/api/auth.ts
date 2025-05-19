import { v4 as uuidv4 } from 'uuid';
import logger from '@/lib/utils/logger'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function loginUser(username: string, email: string, sessionId?: string) {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username,
      email,
      session_id: sessionId || localStorage.getItem('sessionId') || undefined
    }),
  });

  if (!response.ok) {
    throw new Error(`Login failed: ${response.statusText}`);
  }

  const data = await response.json();
  
  // Store the session ID in localStorage
  localStorage.setItem('sessionId', data.session_id);
  localStorage.setItem('userId', String(data.user_id));
  
  return data;
}

export function getSessionId() {
  // Check if code is running in browser environment
  if (typeof window === 'undefined') {
    return '';
  }

  // Get or create a session ID
  let sessionId = localStorage.getItem('sessionId');
  if (!sessionId) {
    // Make sure uuidv4 is imported at the top of the file
    sessionId = uuidv4();
    localStorage.setItem('sessionId', sessionId);
  }
  
  return sessionId;
}

export function getUserId() {
  return localStorage.getItem('userId');
} 