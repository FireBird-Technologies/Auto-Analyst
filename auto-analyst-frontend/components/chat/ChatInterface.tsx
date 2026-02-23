"use client"

import type React from "react"
import { useState, useEffect, useRef, useCallback } from "react"
import { motion } from "framer-motion"
import Image from "next/image"
import ChatWindow from "./ChatWindow"
import ChatInput from "./ChatInput"
import Sidebar from "./Sidebar"
import apiClient from '@/lib/api/axiosConfig'
import { useSession } from "next-auth/react"
import { useFreeTrialStore } from "@/lib/store/freeTrialStore"
import FreeTrialOverlay from "./FreeTrialOverlay"
import { useChatHistoryStore } from "@/lib/store/chatHistoryStore"
import { useCookieConsentStore } from "@/lib/store/cookieConsentStore"
import { useRouter } from "next/navigation"
import { AwardIcon, User, Menu, MessageSquare } from "lucide-react"
import { useSessionStore } from '@/lib/store/sessionStore'
import API_URL from '@/config/api'
import { useCredits } from '@/lib/contexts/credit-context'
import { getModelCreditCost } from '@/lib/model-tiers'
import InsufficientCreditsModal from '@/components/chat/InsufficientCreditsModal'
import CreditBalance from '@/components/chat/CreditBalance'
import { Avatar } from '@/components/ui/avatar'
import UserProfilePopup from './UserProfilePopup'
import SettingsPopup from './SettingsPopup'

import { useModelSettings } from '@/lib/hooks/useModelSettings'
import logger from '@/lib/utils/logger'
import { OnboardingTooltip } from '../onboarding/OnboardingTooltips'
import { getDisplayName } from '@/lib/model-registry'
import { useUserSubscriptionStore } from '@/lib/store/userSubscriptionStore'
import { hasFeatureAccess } from '@/lib/features/feature-access'
import { toast } from "@/components/ui/use-toast"
import FeedbackPopup from './FeedbackPopup'
import { SessionRecovery } from '@/lib/utils/sessionRecovery';
import axios from 'axios'

interface PlotlyMessage {
  type: "plotly"
  data: any
  layout: any
}

interface Message {
  text: string | PlotlyMessage
  sender: "user" | "ai"
}

interface AgentInfo {
  name: string
  description: string
}

interface ChatMessage {
  text: string | PlotlyMessage;
  sender: "user" | "ai";
  agent?: string;
  message_id?: number;
  chat_id?: number | null;
  timestamp?: string;
}
  
interface ChatHistory {
  chat_id: number;
  title: string;
  created_at: string;
  user_id?: number;
}

const ChatInterface: React.FC = () => {
  const router = useRouter()
  const { data: session, status } = useSession()
  const { hasConsented } = useCookieConsentStore()
  const { queriesUsed, incrementQueries, hasFreeTrial } = useFreeTrialStore()
  const { messages: storedMessages, addMessage, updateMessage, clearMessages } = useChatHistoryStore()
  const [mounted, setMounted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isSidebarOpen, setSidebarOpen] = useState(false)
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [showWelcome, setShowWelcome] = useState(true)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const { sessionId, setSessionId, clearSessionId } = useSessionStore()
  const chatInputRef = useRef<{ 
    handlePreviewDefaultDataset: () => void;
    handleSilentDefaultDataset: () => void;
  }>(null);
  const [activeChatId, setActiveChatId] = useState<number | null>(null);
  const [chatHistories, setChatHistories] = useState<ChatHistory[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const { remainingCredits, isLoading: creditsLoading, checkCredits, hasEnoughCredits } = useCredits()
  const [insufficientCreditsModalOpen, setInsufficientCreditsModalOpen] = useState(false)
  const [requiredCredits, setRequiredCredits] = useState(0)
  const [isUserProfileOpen, setIsUserProfileOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { modelSettings, syncSettingsToBackend } = useModelSettings();
  const [hasUploadedDataset, setHasUploadedDataset] = useState(false);
  const [recentlyUploadedDataset, setRecentlyUploadedDataset] = useState(false);
  const datasetPopupShownRef = useRef(false);
  const popupShownForChatIdsRef = useRef<Set<number>>(new Set());
  const [isNewLoginSession, setIsNewLoginSession] = useState(false);
  const [chatNameGenerated, setChatNameGenerated] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showFeedbackPopup, setShowFeedbackPopup] = useState(false);
  const { subscription, fetchSubscription, setSubscription } = useUserSubscriptionStore();
  const [datasetDescription, setDatasetDescription] = useState<string | null>(null);
  const [selectedDataset, setSelectedDataset] = useState<{ id: string; name: string; isDefault: boolean; source: 'default'|'upload'|'existing' } | null>(null);
  const [lastGeneratedForFile, setLastGeneratedForFile] = useState<string | null>(null);
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);

  useEffect(() => {
    setMounted(true)
  }, [])

  // Fetch user subscription when session changes
  useEffect(() => {
    if (session) {
      fetchSubscription();
    } else {
      // Set a free tier subscription for non-logged in users
      setSubscription({
        plan: 'free',
        status: 'active',
        amount: 0,
        interval: 'month',
        planType: 'free',
      });
    }
  }, [session, fetchSubscription, setSubscription]);

  // Check if it's the user's first time and show onboarding tooltip
  useEffect(() => {
    if (mounted) {
      const showOnboardingFlag = localStorage.getItem('showOnboarding');
      // Show for both signed-in users and free trial users
      if (showOnboardingFlag === 'true') {
        // Delay showing the tooltip slightly to ensure the UI is fully loaded
        const timer = setTimeout(() => {
          setShowOnboarding(true);
          // Remove the flag so it doesn't show again on page refresh
          localStorage.removeItem('showOnboarding');
        }, 1500);
        return () => clearTimeout(timer);
      }
      
      // Set the onboarding flag for first-time free trial users
      if (!session && hasFreeTrial() && !localStorage.getItem('hasSeenOnboarding')) {
        localStorage.setItem('showOnboarding', 'true');
        
        const timer = setTimeout(() => {
          setShowOnboarding(true);
          localStorage.removeItem('showOnboarding');
          localStorage.setItem('hasSeenOnboarding', 'true');
        }, 1500);
        return () => clearTimeout(timer);
      }
    }
  }, [mounted, session, hasFreeTrial]);

  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
        const response = await apiClient.get(`${API_URL}/agents`)
        if (response.data && response.data.available_agents) {
          const agentList: AgentInfo[] = response.data.available_agents.map((name: string) => ({
            name,
            description: `Specialized ${name.replace(/_/g, " ")} agent`,
          }))
          setAgents(agentList)
        }
      } catch (error) {
        console.error("Error fetching agents:", error)
      }
    }

    fetchAgents()
  }, [])

  useEffect(() => {
    // Show welcome section if there are no messages
    setShowWelcome(storedMessages.length === 0)
  }, [storedMessages])

  useEffect(() => {
    if (status === "unauthenticated") {
      clearMessages()
      setShowWelcome(true)
    }
  }, [status, clearMessages])

  useEffect(() => {
    if (session?.user && mounted) {
      const createOrGetUser = async () => {
        try {
          const response = await apiClient.post(`${API_URL}/chats/users`, {
            username: session.user.name || 'Anonymous User',
            email: session.user.email || `anonymous-${Date.now()}@example.com`
          });
          
          setUserId(response.data.user_id);
          
          // Now fetch chat history for this user
          fetchChatHistories(response.data.user_id);
        } catch (error) {
          console.error("Error creating/getting user:", error);
        }
      };
      
      createOrGetUser();
    } else if (!session && mounted) {
      // Handle admin/testing case with adminUserId from localStorage
      const adminId = localStorage.getItem('adminUserId');
      if (adminId) {
        const adminUserId = parseInt(adminId);
        setUserId(adminUserId);
        setIsAdmin(true);
        fetchChatHistories(adminUserId);
      }
    }
  }, [session, mounted]);

  // Add new effect to reset dataset on login
  useEffect(() => {
    // Only run when a user successfully logs in and component is mounted
    if (session?.user && mounted && sessionId) {
      const resetToDefaultDatasetOnLogin = async () => {
        try {
          // logger.log("New login detected, checking dataset state");
          
          // Check if user has stored login status in localStorage
          const lastLoginUser = localStorage.getItem('lastLoginUser');
          const currentUser = session.user.email || session.user.name || '';
          const lastSessionTime = localStorage.getItem('lastSessionTime');
          const currentTime = Date.now();
          const SESSION_TIMEOUT = 1000 * 60 * 30; // 30 minutes in milliseconds
          
          // Detect if this is a new session:
          // 1. Different user OR
          // 2. Same user but browser was closed (lastSessionTime is too old)
          const isNewSession = lastLoginUser !== currentUser ||
                            !lastSessionTime ||
                            (currentTime - parseInt(lastSessionTime)) > SESSION_TIMEOUT;
          
          if (isNewSession) {
            // logger.log("New session detected, silently resetting to default dataset");
            
            // Mark this as a new login session so popup appears in silent mode
            setIsNewLoginSession(true);
            
            // Reset the session to use the default dataset but preserve model settings
            await apiClient.post(`${API_URL}/reset-session`, 
              { preserveModelSettings: true }, // Add flag to preserve model settings
              {
                headers: { 'X-Session-ID': sessionId }
              }
            );
            
            // Reset local dataset state
            setHasUploadedDataset(false);
            localStorage.removeItem('lastUploadedFile');
            
            // Reset popup tracking
            datasetPopupShownRef.current = false;
            popupShownForChatIdsRef.current = new Set();
            
            // Store current user and timestamp to identify new sessions in future
            localStorage.setItem('lastLoginUser', currentUser);
            localStorage.setItem('lastSessionTime', currentTime.toString());
            
            // Force the use of default dataset with an explicit API call, but don't show preview
            try {
              await apiClient.get(`${API_URL}/api/default-dataset`, {
                headers: { 'X-Session-ID': sessionId }
              });
              // logger.log("Default dataset loaded silently on login");
              
              // Instead of showing the preview directly, use the silent method
              if (chatInputRef.current && chatInputRef.current.handleSilentDefaultDataset) {
                chatInputRef.current.handleSilentDefaultDataset();
              } else {
                // If the method doesn't exist yet, we'll do a silent reset here
                localStorage.removeItem('lastUploadedFile');
              }
              
              // After a brief delay, reset the new login session flag
              setTimeout(() => {
                setIsNewLoginSession(false);
              }, 1000);
            } catch (error) {
              console.error("Error loading default dataset:", error);
              setIsNewLoginSession(false);
            }
          } else {
            // logger.log("Returning user in same session, maintaining dataset state");
            // Update the session timestamp
            localStorage.setItem('lastSessionTime', currentTime.toString());
          }
        } catch (error) {
          console.error("Error resetting dataset on login:", error);
          setIsNewLoginSession(false);
        }
      };
      
      resetToDefaultDatasetOnLogin();
    } else if (!session && mounted) {
      // Clear last login when user logs out
      localStorage.removeItem('lastLoginUser');
    }
  }, [session, mounted, sessionId]);

  // Add another effect to periodically update the session time while active
  useEffect(() => {
    if (session?.user && mounted) {
      // Start a timer to update the last session time periodically
      const intervalId = setInterval(() => {
        localStorage.setItem('lastSessionTime', Date.now().toString());
      }, 60000); // Update every minute
      
      return () => clearInterval(intervalId);
    }
  }, [session, mounted]);

  // Define createNewChat function that was removed
  const createNewChat = useCallback(async () => {
    // Sync model settings to ensure backend uses the right model
    try {
      await syncSettingsToBackend();
      // logger.log('Model settings synced during new chat creation');
    } catch (error) {
      console.error('Failed to sync model settings:', error);
    }
    
    // Clear local messages state
    clearMessages();
    setShowWelcome(true);
    
    // Just set a temporary ID - we'll create the actual chat when the user sends a message
    const tempId = Date.now(); // Use timestamp as temporary ID
    setActiveChatId(tempId);
    return tempId;
  }, [clearMessages, syncSettingsToBackend]);

  // Define loadChat before it's used in the fetchChatHistories dependency array
  const loadChat = useCallback(async (chatId: number) => {
    try {
      // Sync model settings
      try {
        await syncSettingsToBackend();
      } catch (error) {
        console.error('Failed to sync model settings:', error);
      }
      
      // Check for dataset mismatch before loading chat
      try {
        // Skip dataset check if we just uploaded a dataset
        if (recentlyUploadedDataset) {
          setHasUploadedDataset(true);
          setRecentlyUploadedDataset(false);
          
          // Load chat directly
          setActiveChatId(chatId);
          const response = await apiClient.get(`${API_URL}/chats/${chatId}`, {
            params: { user_id: userId },
            headers: { 'X-Session-ID': sessionId }
          });
          
          if (response.data && response.data.messages) {
            clearMessages();
            response.data.messages.forEach((msg: any) => {
              addMessage({
                text: msg.content,
                sender: msg.sender,
                message_id: msg.message_id,
                chat_id: msg.chat_id,
                timestamp: msg.timestamp
              });
            });
            setShowWelcome(false);
          }
          return;
        }
        
        // Check for dataset reset popup when switching chats
        const isPopupShownForChat = popupShownForChatIdsRef.current.has(chatId);
        
        if (!isPopupShownForChat && !recentlyUploadedDataset && activeChatId !== chatId) {
          // Clear suppression when switching chats
          localStorage.removeItem('suppressDatasetPopup');
          logger.log("[ChatInterface] Session ID:", sessionId);
          // Check if we need to show dataset selection popup
          const sessionResponse = await apiClient.get(`${API_URL}/api/session-info`, {
            headers: { 'X-Session-ID': sessionId }
          });
          
          if (sessionResponse.data && sessionResponse.data.is_custom_dataset) {
            // Show popup for chat with custom dataset
            datasetPopupShownRef.current = true;
            popupShownForChatIdsRef.current.add(chatId);
            
            // setTempChatIdForReset(chatId); // This line is removed
            return; // Wait for user decision
          }
        }
      } catch (error) {
        console.error("Error checking dataset:", error);
      }
      
      // Load chat messages
      setActiveChatId(chatId);
      const response = await apiClient.get(`${API_URL}/chats/${chatId}`, {
        params: { user_id: userId },
        headers: { 'X-Session-ID': sessionId }
      });
      
      if (response.data && response.data.messages) {
        clearMessages();
        
        if (response.data.messages.length === 0) {
          console.warn("No messages found in chat history");
        }
        
        response.data.messages.forEach((msg: any) => {
          addMessage({
            text: msg.content,
            sender: msg.sender,
            message_id: msg.message_id,
            chat_id: msg.chat_id,
            timestamp: msg.timestamp
          });
        });
        
        setShowWelcome(false);
      } else {
        console.error("No messages found in the chat data");
      }
    } catch (error) {
      console.error(`Failed to load chat ${chatId}:`, error);
    }
  }, [addMessage, clearMessages, userId, sessionId, recentlyUploadedDataset, syncSettingsToBackend]);

  // Now fetchChatHistories can use loadChat in its dependency array
  const fetchChatHistories = useCallback(async (userIdParam?: number) => {
    // Fetch chat histories for signed-in users or admin
    if (!session && !isAdmin) return;
    
    const currentUserId = userIdParam || userId;
    
    // For admin users, we might not have a userId but still want to fetch chats
    if (!currentUserId && !isAdmin) return;
    
    setIsLoadingHistory(true);
    try {
      // Fetch chat histories for the user or admin
      const response = await apiClient.get(`${API_URL}/chats/`, {
        params: { user_id: currentUserId, is_admin: isAdmin },
        headers: { 'X-Session-ID': sessionId }
      });
      
      // logger.log("Fetched chat histories:", response.data);
      setChatHistories(response.data);
      
      // If we have chat histories but no active chat, set the most recent one
      if (response.data.length > 0 && !activeChatId) {
        // Sort by created_at descending and take the first one
        const mostRecentChat = [...response.data].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )[0];
        
        setActiveChatId(mostRecentChat.chat_id);
        loadChat(mostRecentChat.chat_id);
      }
    } catch (error) {
      console.error("Failed to fetch chat histories:", error);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [session, userId, activeChatId, sessionId, loadChat, isAdmin, syncSettingsToBackend]);

  const handleNewChat = useCallback(async () => {
    // Cleanup empty chats
    if (session || isAdmin) {
      try {
        await apiClient.post(`${API_URL}/chats/cleanup-empty`, {
          user_id: userId,
          is_admin: isAdmin
        }, {
          headers: { 'X-Session-ID': sessionId }
        });
      } catch (error) {
        console.error('Failed to clean up empty chats:', error);
      }
    }
    
    // Sync model settings
    try {
      await syncSettingsToBackend();
    } catch (error) {
      console.error('Failed to sync model settings:', error);
    }
    
    // Create temporary chat ID
    const tempId = Date.now();
    
    // Skip dataset check if recently uploaded
    if (recentlyUploadedDataset) {
      // Mark popup as shown to prevent unnecessary popups
      datasetPopupShownRef.current = true;
      popupShownForChatIdsRef.current.add(tempId);
      
      // Create new chat without showing popup
      clearMessages();
      setShowWelcome(true);
      setActiveChatId(tempId);
      fetchChatHistories();
      return;
    }
    
    // Check for custom dataset
    try {
      const response = await apiClient.get(`${API_URL}/api/session-info`, {
        headers: { 'X-Session-ID': sessionId }
      });
      
      // Show popup for custom dataset if needed
      if (response.data && response.data.is_custom_dataset && 
          !popupShownForChatIdsRef.current.has(tempId)) {
        datasetPopupShownRef.current = true;
        popupShownForChatIdsRef.current.add(tempId);
        
        // setTempChatIdForReset(tempId); // This line is removed
        return;
      }
    } catch (error) {
      console.error("Error checking for custom dataset:", error);
    }
    
    // Create new chat normally
    clearMessages();
    setShowWelcome(true);
    setActiveChatId(tempId);
    fetchChatHistories();
    
  }, [clearMessages, fetchChatHistories, userId, sessionId, session, isAdmin, recentlyUploadedDataset, syncSettingsToBackend]);

  const handleStopGeneration = () => {
    if (abortController) {
      abortController.abort()
      setIsLoading(false)
      setAbortController(null)
    }
  }

  // Define the processRegularMessage function to ensure it correctly captures the message_id
  const processRegularMessage = async (
    message: string, 
    controller: AbortController, 
    currentId: number | null
  ): Promise<{ hadError: boolean }> => {
    let hadError = false
    let accumulatedResponse = ""
    const baseUrl = API_URL
    const endpoint = `${baseUrl}/chat`
    let lastAgentName = "AI" // Track the last agent name
    let aiMessageId: number | undefined = undefined // Track the message ID from the response

    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...(sessionId && { 'X-Session-ID': sessionId }),
    }

    // Important: Use currentId instead of activeChatId
    // currentId is the actual database chat ID passed from handleSendMessage
    const queryParams = new URLSearchParams();
    if (userId) {
      queryParams.append('user_id', userId.toString());
    }
    if (currentId) { // Use currentId which is the real database ID
      queryParams.append('chat_id', currentId.toString());
    }
    if (isAdmin) {
      queryParams.append('is_admin', 'true');
    }
    
    const fullEndpoint = `${endpoint}${queryParams.toString() ? '?' + queryParams.toString() : ''}`;

    // Streaming response handling
    const response = await fetch(fullEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: message }),
      signal: controller.signal,
    })

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('No response body')
    }

    // Add initial AI message that we'll update | this shows an empty blob in the UI
    const messageId = addMessage({
      text: "",
      sender: "ai"
    })

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = new TextDecoder().decode(value)
      const lines = chunk.split('\n').filter(line => line.trim())

      for (const line of lines) {
        try {
          const { agent, content, error, message_id } = JSON.parse(line)
          
          // Capture the message_id if provided
          if (message_id) {
            aiMessageId = message_id;
          }
          
          if (error) {
            hadError = true
            accumulatedResponse += `\n\n**Sorry, the request could not be completed.**\n\n${error}\n\nPlease try again.`
          } else {
            // Add agent info to content with code blocks
            const codeBlockRegex = /```([a-zA-Z0-9_]+)?\n([\s\S]*?)```/g;
            if (content.match(codeBlockRegex)) {
              // Content contains code blocks, add agent information as a comment before each block
              let modifiedContent = content.replace(codeBlockRegex, (match: string, language: string, code: string) => {
                // Add agent information as a markdown comment above each code block
                return `\n<!-- AGENT: ${agent || 'AI'} -->\n${match}`;
              });
              accumulatedResponse += `\n${modifiedContent}`
            } else {
              // Regular content without code block
              accumulatedResponse += `\n${content}`
            }
          }
          
          // Store the most recent agent name
          if (agent) {
            lastAgentName = agent
          }
          
          // Update the existing message with accumulated content and agent name
          updateMessage(messageId, {
            text: accumulatedResponse.trim(),
            sender: "ai",
            agent: agent, // Include the agent name from the response
            message_id: aiMessageId // Include the message_id if available
          })
        } catch (e) {
          console.error('Error parsing chunk:', e)
        }
      }
    }

    // Save the final AI response to the database for signed-in or admin users
    if (currentId && (session || isAdmin)) {
      try {
        // logger.log("Saving AI response for chat ID:", currentId);
        
        // More robust save process with retry for the critical first message
        const saveAIResponse = async (retryCount = 0) => {
          try {
            const response = await apiClient.post(`${API_URL}/chats/${currentId}/messages`, {
              content: accumulatedResponse.trim(),
              sender: 'ai',
              agent: lastAgentName // Use the tracked agent name
            }, {
              params: { user_id: userId, is_admin: isAdmin },
              headers: { 'X-Session-ID': sessionId }
            });
            
            // logger.log("AI response saved successfully:", response.data);
            
            // If we get a message_id in the response, update our local message with it
            if (response.data && response.data.message_id && !aiMessageId) {
              aiMessageId = response.data.message_id;
              updateMessage(messageId, {
                text: accumulatedResponse.trim(),
                sender: "ai",
                agent: lastAgentName,
                message_id: aiMessageId
              });
            }
            
            return response;
          } catch (error) {
            console.error(`Failed to save AI response (attempt ${retryCount + 1}):`, error);
            
            // Retry up to 3 times for the first AI response
            if (retryCount < 3) {
              // logger.log(`Retrying in ${(retryCount + 1) * 500}ms...`);
              await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 500));
              return saveAIResponse(retryCount + 1);
            }
            throw error;
          }
        };
        
        await saveAIResponse();
      } catch (error) {
        console.error('Failed to save AI response after retries:', error);
      }
    }
    
    return { hadError }
  }

  const processAgentMessage = async (
    agentName: string, 
    message: string, 
    controller: AbortController, 
    currentId: number | null
  ): Promise<{ hadError: boolean }> => {
    let hadError = false
    let accumulatedResponse = ""
    const baseUrl = API_URL
    const endpoint = `${baseUrl}/chat/${agentName}`

    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...(sessionId && { 'X-Session-ID': sessionId }),
    }

    // Important: Use currentId instead of activeChatId
    const queryParams = new URLSearchParams();
    if (userId) {
      queryParams.append('user_id', userId.toString());
    }
    if (currentId) { // Use currentId which is the real database ID
      queryParams.append('chat_id', currentId.toString());
    }
    if (isAdmin) {
      queryParams.append('is_admin', 'true');
    }
    
    const fullEndpoint = `${endpoint}${queryParams.toString() ? '?' + queryParams.toString() : ''}`;

    try {
      // Add initial AI message that we'll update
      const messageId = addMessage({
        text: "",
        sender: "ai",
        agent: agentName
      })

      // Streaming response handling
      const response = await fetch(fullEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: message }),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()
      let responseContent = data.response || data.content || JSON.stringify(data)
      
      // Process code blocks to add agent information
      const codeBlockRegex = /```([a-zA-Z0-9_]+)?\n([\s\S]*?)```/g;
      if (responseContent.match(codeBlockRegex)) {
        // Content contains code blocks, add agent information as a comment before each block
        responseContent = responseContent.replace(codeBlockRegex, (match: string, language: string, code: string) => {
          // Add agent information as a markdown comment above each code block
          return `\n<!-- AGENT: ${agentName} -->\n${match}`;
        });
      }
      
      accumulatedResponse = responseContent;
      
      // Update the message with the processed content
      updateMessage(messageId, {
        text: accumulatedResponse,
        sender: "ai",
        agent: agentName
      })

      // Save the final agent response to the database for signed-in or admin users
      let aiMessageId: number | undefined = undefined;
      if (currentId && (session || isAdmin)) {
        try {
          // logger.log("Saving agent response for chat ID:", currentId);
          const saveResponse = await apiClient.post(`${API_URL}/chats/${currentId}/messages`, {
            content: accumulatedResponse.trim(),
            sender: 'ai',
            agent: agentName
          }, {
            params: { user_id: userId, is_admin: isAdmin },
            headers: { 'X-Session-ID': sessionId }
          });

          // Capture the message_id from the response
          if (saveResponse.data && saveResponse.data.message_id) {
            aiMessageId = saveResponse.data.message_id;
            
            // Update the message in the UI with the message_id
            updateMessage(messageId, {
              text: accumulatedResponse.trim(),
              sender: "ai",
              agent: agentName,
              message_id: aiMessageId
            });
            
            // Update the backend's current message ID
            try {
              await apiClient.post(`${API_URL}/set-message-info`, {
                message_id: aiMessageId,
                chat_id: currentId
              }, {
                headers: {
                  ...(sessionId && { 'X-Session-ID': sessionId }),
                },
              });
              console.log(`[Session ID: ${sessionId}] Updated backend with message_id: ${aiMessageId} for chat_id: ${currentId}`);
            } catch (error) {
              console.error("Error setting message ID in backend:", error);
            }
          }
        } catch (error) {
          console.error('Failed to save agent response:', error);
        }
      }
    } catch (error) {
      hadError = true
      console.error(`Error processing agent message (${agentName}):`, error);
      // Add error message
      addMessage({
        text: `**Sorry, the ${agentName} request could not be completed.**\n\n${error instanceof Error ? error.message : String(error)}\n\nPlease try again.`,
        sender: "ai",
        agent: agentName
      });
    }
    
    return { hadError }
  }

  // Then keep the handleSendMessage function as is
  const handleSendMessage = useCallback(async (message: string) => {
    if (isLoading || !message.trim()) return

    // If a dataset was recently uploaded, mark it so consent popup doesn't appear
    // during this message processing flow
    if (recentlyUploadedDataset) {
      // logger.log("Dataset was just uploaded, suppressing consent popup for this message");
      // Ensure the popup won't show during this entire message flow
      datasetPopupShownRef.current = true;
      if (activeChatId) {
        popupShownForChatIdsRef.current.add(activeChatId);
      }
      
      // IMPORTANT: When a dataset was just uploaded, we need to explicitly
      // check the backend or forcibly set the session state to reflect the custom dataset
      try {
        // logger.log("Explicitly forcing recognition of custom dataset");
        await apiClient.get(`${API_URL}/api/session-info`, {
          headers: {
            'X-Session-ID': sessionId,
          }
        });
      } catch (error) {
        console.error("Error refreshing session state after dataset upload:", error);
      }
      
      // We'll keep the flag true until the message is fully processed
    }

    // Sync model settings to ensure backend uses the correct model
    try {
      await syncSettingsToBackend();
    } catch (error) {
      console.error('Failed to sync model settings before sending message:', error);
    }
    
    const controller = new AbortController();
    setAbortController(controller);
    
    let currentChatId = activeChatId;
    let isFirstMessage = false;
    
    // For signed-in or admin users, ensure we have a real database chat ID
    if (session || isAdmin) {
      const existingChat = chatHistories.find(chat => chat.chat_id === currentChatId);
      
      // If the currentChatId is a temporary one (not in chat histories), create a real chat
      if (!existingChat) {
        isFirstMessage = true;
        try {
          // logger.log("Creating new chat on first message with user_id:", userId, "isAdmin:", isAdmin);
          const response = await apiClient.post(`${API_URL}/chats/`, { 
            user_id: userId,
            is_admin: isAdmin 
          }, { 
            headers: { 'X-Session-ID': sessionId } 
          });
          
          // logger.log("New chat created:", response.data);
          currentChatId = response.data.chat_id;
          // Update the activeChatId state - React handles the async update
          setActiveChatId(currentChatId);
        } catch (error) {
          console.error("Failed to create new chat:", error);
          // Stop processing if chat creation failed
          setIsLoading(false);
          setAbortController(null);
          // Add error message to UI
          addMessage({ text: "Error creating new chat. Please try again.", sender: "ai" });
          return;
        }
      }

      // Ensure we have a valid chat ID before saving the user message
      if (currentChatId !== null) {
        // Save user message to the database
        try {
          await apiClient.post(`${API_URL}/chats/${currentChatId}/messages`, {
            content: message,
            sender: 'user'
          }, {
            params: { user_id: userId, is_admin: isAdmin },
            headers: { 'X-Session-ID': sessionId }
          });
        } catch (error) {
          console.error('Failed to save user message:', error);
        }
      } else {
         // This case should ideally not happen for logged-in/admin users after the check above
         console.error("Cannot save user message: Chat ID is null.");
         // Stop processing if we somehow don't have a chat ID
         setIsLoading(false);
         setAbortController(null);
         addMessage({ text: "Error saving message. Cannot determine chat.", sender: "ai" });
         return;
      }
    }

    // Add user message to local state for all users
    addMessage({
      text: message,
      sender: "user",
    });
    setShowWelcome(false);

    // Counting user queries for free trial
    if (!session) {
      incrementQueries();
      
      // Check if this is the first free trial message and user hasn't seen onboarding
      if (queriesUsed === 0 && !localStorage.getItem('hasSeenOnboarding')) {
        // Set flag to show onboarding after this message completes
        localStorage.setItem('showFirstQueryOnboarding', 'true');
      }
    }

    setIsLoading(true);
    
    // Store original message for later use with chat title generation
    const originalQuery = message;

    // Check if the user has sufficient credits BEFORE processing the query
    if (session && !isAdmin) {
      try {
        // Get the model that will be used for this query
        let modelName = modelSettings.model || "gpt-4o-mini";
        
        // Calculate required credits based on model tier
        const creditCost = getModelCreditCost(modelName);
        // logger.log(`[Credits] Required credits for ${modelName}: ${creditCost}`);
        
        // Check if user has enough credits - this call also sets isChatBlocked=true if insufficient
        const hasEnough = await hasEnoughCredits(creditCost);
        
        if (!hasEnough) {
          // logger.log(`[Credits] Insufficient credits for operation. Required: ${creditCost}, Available: ${remainingCredits}`);
          
          // Store the required credits amount for the modal
          setRequiredCredits(creditCost);
          
          // Show the insufficient credits modal
          setInsufficientCreditsModalOpen(true);
          
          // Ensure chat remains blocked
          await checkCredits();
          
          // Stop processing here if not enough credits
          return;
        }
      } catch (error) {
        console.error("Error checking credits:", error);
        // Continue anyway to avoid blocking experience
      }
    }

    try {
      // Match all @agent mentions in the query
      const agentRegex = /@(\w+)/g
      const matches = [...message.matchAll(agentRegex)]
      
      // Process the message and track errors
      let messageResult = { hadError: false }
      
      // If no agent calls are found, process as a regular message
      if (matches.length === 0) {
        messageResult = await processRegularMessage(message, controller, currentChatId)
      } else {
        // Extract all unique agent names
        const agentNames = [...new Set(matches.map(match => match[1]))]
        
        if (agentNames.length === 1) {
          // Single agent case - use the original logic
          const agentName = agentNames[0]
          
          // Remove the empty agent indicator message
          // Extract the query text by removing the @mentions
          const cleanQuery = message.replace(agentRegex, '').trim()
          messageResult = await processAgentMessage(agentName, cleanQuery, controller, currentChatId)
        } else {
          // Multiple agents case - send a single request with comma-separated agent names
          const combinedAgentName = agentNames.join(",")
          
          // Remove the empty agent indicator message
          // Extract the query text by removing the @mentions
          const cleanQuery = message.replace(agentRegex, '').trim()
          messageResult = await processAgentMessage(combinedAgentName, cleanQuery, controller, currentChatId)
        }
      }

      // ONLY deduct credits if there was NO error
      if (!messageResult.hadError && session?.user) {
        console.log('[Credits] Processing credit deduction for successful request');
        try {
          // Get the model directly from the API instead of relying on React state
          let modelName;
          try {
            const settingsResponse = await apiClient.get(`${API_URL}/api/model-settings`, {
              headers: { 'X-Session-ID': sessionId }
            });
            modelName = settingsResponse.data.model;
            // logger.log(`[Credits] Using freshly fetched model: ${modelName}`);
          } catch (settingsError) {
            console.error('[Credits] Failed to fetch fresh model settings:', settingsError);
            // Fall back to the model in state
            modelName = modelSettings.model || "gpt-3.5-turbo";
          }
          
          // Use more robust user ID extraction with logging
          let userIdForCredits = '';
          
          if ((session.user as any).sub) {
            userIdForCredits = (session.user as any).sub;
          } else if (session.user.id) {
            userIdForCredits = session.user.id;
          } else if (session.user.email) {
            userIdForCredits = session.user.email;
          } else {
            // Fallback to logged in user ID from component state
            userIdForCredits = userId?.toString() || '';
          }
          
          // Skip credit deduction if we still can't identify the user
          if (!userIdForCredits) {
            console.warn('[Credits] Cannot identify user for credit deduction');
            return;
          }
          
          // Calculate credit cost based on the fresh model name
          const creditCost = getModelCreditCost(modelName);
          
          // logger.log(`[Credits] Deducting ${creditCost} credits for user ${userIdForCredits} for model ${modelName}`);
          
          // Deduct credits directly through an API call
          const response = await axios.post('/api/user/deduct-credits', {
            userId: userIdForCredits,
            credits: creditCost,
            description: `Used ${modelName} for chat`
          });
          
          // logger.log('[Credits] Deduction result:', response.data);
          
          // Refresh the credits display in the UI after deduction
          if (checkCredits) {
            await checkCredits();
          }
        } catch (creditError) {
          console.error('[Credits] Failed to deduct credits:', creditError);
          // Don't block the user experience if credit deduction fails
        }
      } else if (messageResult.hadError) {
        console.log('[Credits] Skipping credit deduction due to error');
        toast({
          title: "No credits used",
          description: "Credits were not deducted due to the error.",
          duration: 3000,
        })
      }

      // After the AI response is generated and saved, update the chat title for new chats
      // *but do not* trigger a full history refresh/load immediately
      if (isFirstMessage && currentChatId !== null) {
        try {
          // logger.log("Generating title for new chat using query:", message);
          const titleResponse = await apiClient.post(`${API_URL}/chat_history_name`, {
            query: message
          });
          
          // logger.log("Title response:", titleResponse.data);
          
          if (titleResponse.data && titleResponse.data.name) {
            await apiClient.put(`${API_URL}/chats/${currentChatId}`, {
              title: titleResponse.data.name
            });
            
            // Optionally update the title in the local chatHistories state if needed for the sidebar
            setChatHistories(prev => 
              prev.map(chat => 
                chat.chat_id === currentChatId 
                  ? { ...chat, title: titleResponse.data.name } 
                  : chat
              )
            );
            
            // Set chatNameGenerated to true to trigger auto-run in CodeCanvas
            setChatNameGenerated(true);
            
            // Reset the flag after a delay 
            setTimeout(() => {
              setChatNameGenerated(false);
            }, 5000);
          }
        } catch (error) {
          console.error('Failed to update chat title:', error);
        }
      }
    } catch (error) {
      console.error("Error sending message:", error);
      
      // Add error message
      addMessage({
        text: "Sorry, there was an error processing your request. Please try again.",
        sender: "ai"
      });
    } finally {
      setIsLoading(false);
      setAbortController(null);
      
      // Reset the recently uploaded dataset flag now that message processing is complete
      if (recentlyUploadedDataset) {
        // logger.log("Message processing complete, resetting recentlyUploadedDataset flag");
        setRecentlyUploadedDataset(false);
      }
      
      // Check if this was a free trial user's first query
      const showFirstQueryOnboarding = localStorage.getItem('showFirstQueryOnboarding');
      if (showFirstQueryOnboarding === 'true') {
        localStorage.removeItem('showFirstQueryOnboarding');
        setShowOnboarding(true);
        localStorage.setItem('hasSeenOnboarding', 'true');
      }
    }
  }, [addMessage, clearMessages, incrementQueries, session, isAdmin, activeChatId, userId, sessionId, modelSettings, hasEnoughCredits, processRegularMessage, processAgentMessage, fetchChatHistories, checkCredits, recentlyUploadedDataset, chatHistories, syncSettingsToBackend, queriesUsed]);

  const handleFileUpload = async (file: File) => {
    // File validation
    const isCSVByExtension = file.name.toLowerCase().endsWith('.csv');
    const isCSVByType = file.type === 'text/csv' || file.type === 'application/csv';
    const isExcelByExtension = file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls');
    const isExcelByType = file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
                          file.type === 'application/vnd.ms-excel';
    
    // Only check enterprise restriction for Excel files, not CSV files
    if (isExcelByExtension || isExcelByType) {
      if (subscription && !hasFeatureAccess('CUSTOM_INTEGRATIONS', subscription).hasAccess) {
        toast({
          title: "Enterprise feature",
          description: "Excel file uploads require an enterprise subscription. CSV uploads are available for all users.",
          variant: "destructive",
          duration: 5000,
        });
        return;
      }
    }

    if (!isCSVByExtension || !isCSVByType) {
      addMessage({
        text: "Error: Please upload a valid CSV file. Other file formats are not supported.",
        sender: "ai"
      });
      return;
    }

    if (file.size > 30 * 1024 * 1024) {
      addMessage({
        text: "Error: File size exceeds 30MB limit. Please upload a smaller file.",
        sender: "ai"
      });
      return;
    }

    const formData = new FormData()
    formData.append("file", file)
    formData.append("styling_instructions", "Please analyze the data and provide a detailed report.")

    try {
      // Force close any open dataset popup and set short-term suppression
      localStorage.setItem('suppressDatasetPopup', 'true');
      setTimeout(() => localStorage.removeItem('suppressDatasetPopup'), 5000);
      
      const baseUrl = API_URL
     
      // const uploadResponse = await axios.post(`${baseUrl}/upload_dataframe`, formData, {
      //   headers: {
      //     "Content-Type": "multipart/form-data",
      //     ...(sessionId && { 'X-Session-ID': sessionId }),
      //   },
      //   timeout: 30000,
      //   maxContentLength: 30 * 1024 * 1024,
      // });
      
      // Update dataset state
      setRecentlyUploadedDataset(true);
      setHasUploadedDataset(true);
      
      // Mark current chat to prevent popup
      if (activeChatId) {
        popupShownForChatIdsRef.current.add(activeChatId);
      }
      
      // Add a temporary ID for any new chat created immediately after upload
      popupShownForChatIdsRef.current.add(Date.now());
      datasetPopupShownRef.current = true;
      
      // Refresh session info to avoid race conditions
      try {
        await apiClient.get(`${baseUrl}/api/session-info`, {
          headers: { 'X-Session-ID': sessionId }
        });
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error("Error refreshing session info:", error);
      }

    } catch (error) {
      let errorMessage = "An error occurred while uploading the file.";
      
      if (apiClient.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED') {
          errorMessage = "Upload timeout: The request took too long to complete. Please try again with a smaller file.";
        } else if (error.response) {
          errorMessage = `Upload failed: ${error.response.data?.message || error.message}`;
        }
      }
      
      addMessage({
        text: errorMessage,
        sender: "ai"
      });
      
      throw error;
    }
  }

  const isInputDisabled = () => {
    if (session) return false // Allow input if user is signed in
    return !hasFreeTrial() // Only check free trial if not signed in
  }

  // Add useEffect to fetch chat histories on mount for signed-in or admin users
  useEffect(() => {
    if (mounted && (session || isAdmin)) {
      fetchChatHistories();
    }
  }, [mounted, fetchChatHistories, session, isAdmin]);

  // Add back the initial page load effect
  useEffect(() => {
    if (mounted) {
      // Just set up an empty chat initially, the dataset check will handle the rest
      clearMessages();
      setShowWelcome(true);
      
      // Only set activeChatId if we don't already have one
      if (!activeChatId) {
        setActiveChatId(Date.now());
      }
    }
  }, [mounted, clearMessages, activeChatId]);

  // Add useEffect to check admin status
  useEffect(() => {
    if (mounted) {
      setIsAdmin(localStorage.getItem('isAdmin') === 'true');
    }
  }, [mounted]);

  // Update useEffect with isSettingsOpen dependency
  useEffect(() => {
    if (isSettingsOpen) {
      // No need for explicit fetch as the hook handles it
    }
  }, [isSettingsOpen]);

  // Session info check for dataset state
  useEffect(() => {
    if (sessionId) {
      const checkSessionDataset = async () => {
        try {
          // Check for uploaded dataset in localStorage
          const lastUploadedFile = localStorage.getItem('lastUploadedFile');
          if (lastUploadedFile) {
            setHasUploadedDataset(true);
            datasetPopupShownRef.current = true;
            
            if (activeChatId) {
              popupShownForChatIdsRef.current.add(activeChatId);
            }
            
            localStorage.setItem('suppressDatasetPopup', 'true');
            return;
          }
          
          // Skip check if we just uploaded a dataset
          if (recentlyUploadedDataset) {
            datasetPopupShownRef.current = true;
            setHasUploadedDataset(true);
            
            if (activeChatId) {
              popupShownForChatIdsRef.current.add(activeChatId);
            }
            
            localStorage.setItem('suppressDatasetPopup', 'true');
            return;
          }
          
          // Check session info for custom dataset
          const response = await apiClient.get(`${API_URL}/api/session-info`, {
            headers: { 'X-Session-ID': sessionId }
          });
          
          // Handle custom dataset detection
          if (response.data && response.data.is_custom_dataset) {
            setHasUploadedDataset(true);
            
            // Show dataset popup if needed
            const currentChatId = activeChatId || Date.now();
            const shouldShowPopup = !datasetPopupShownRef.current && 
                !popupShownForChatIdsRef.current.has(currentChatId) && 
                !recentlyUploadedDataset &&
                !localStorage.getItem('suppressDatasetPopup') &&
                !localStorage.getItem('lastUploadedFile');
            
            if (shouldShowPopup) {
              datasetPopupShownRef.current = true;
              popupShownForChatIdsRef.current.add(currentChatId);
              
              localStorage.setItem('suppressDatasetPopup', 'true');
              setTimeout(() => localStorage.removeItem('suppressDatasetPopup'), 5000);
              
              // setTempChatIdForReset(currentChatId); // This line is removed
            }
          } else {
            // Using default dataset
            if (!recentlyUploadedDataset && !localStorage.getItem('lastUploadedFile')) {
              setHasUploadedDataset(false);
            }
          }
        } catch (error) {
          console.error("Error checking session dataset:", error);
        }
      };
      
      // Slight delay to ensure it runs after initial render
      setTimeout(() => {
        checkSessionDataset();
      }, 100);
    }
  }, [sessionId, activeChatId, recentlyUploadedDataset, syncSettingsToBackend]);
  
  // Fix the dataset reset confirmation handler
  const handleDatasetResetConfirm = async (shouldReset: boolean) => {
    try {
      if (shouldReset) {
        // Reset to default dataset
        await apiClient.post(`${API_URL}/reset-session`, 
          { preserveModelSettings: true },
          { headers: { 'X-Session-ID': sessionId } }
        );
        
        setHasUploadedDataset(false);
        
        // Show default dataset preview
        if (chatInputRef.current) {
          chatInputRef.current.handlePreviewDefaultDataset();
          localStorage.removeItem('lastUploadedFile');
          
          setTimeout(() => {
            setHasUploadedDataset(false);
          }, 100);
        }
      } else {
        // Keep custom dataset
        try {
          const sessionResponse = await apiClient.get(`${API_URL}/api/session-info`, {
            headers: { 'X-Session-ID': sessionId }
          });
          
          if (sessionResponse.data && sessionResponse.data.is_custom_dataset) {
            setHasUploadedDataset(true);
            
            if (chatInputRef.current && sessionResponse.data.dataset_name) {
              const datasetName = sessionResponse.data.dataset_name;
              
              const fileInfo = {
                name: datasetName.endsWith('.csv') ? datasetName : `${datasetName}.csv`,
                type: 'text/csv',
                lastModified: new Date().getTime()
              };
              
              localStorage.setItem('lastUploadedFile', JSON.stringify(fileInfo));
              
              setTimeout(() => {
                setHasUploadedDataset(prev => !prev);
                setTimeout(() => setHasUploadedDataset(true), 10);
              }, 10);
            }
          }
        } catch (error) {
          console.error("Error getting session info:", error);
        }
      }
      
      // Hide the popup and proceed with loading chat
      // setTempChatIdForReset(null); // This line is removed
    } catch (error) {
      console.error("Error handling dataset reset:", error);
      // setTempChatIdForReset(null); // This line is removed
    }
  };

  const handleChatDelete = useCallback((chatId: number) => {
    apiClient.delete(`${API_URL}/chats/${chatId}`, {
      params: { user_id: userId },
      headers: { 'X-Session-ID': sessionId }
    }).then(() => {
      // Remove the chat from the chat histories
      setChatHistories(prev => prev.filter(chat => chat.chat_id !== chatId));
      
      // If the deleted chat was the active chat, reset the active chat and clear messages
      if (chatId === activeChatId) {
        setActiveChatId(null);
        clearMessages();
        setShowWelcome(true);
        
        // If there are other chats, select the most recent one
        const remainingChats = chatHistories.filter(chat => chat.chat_id !== chatId);
        if (remainingChats.length > 0) {
          const mostRecentChat = [...remainingChats].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )[0];
          
          setActiveChatId(mostRecentChat.chat_id);
          loadChat(mostRecentChat.chat_id);
        } else {
          // If no chats remain, create a new one
          createNewChat();
        }
      }
    }).catch(error => {
      console.error(`Failed to delete chat ${chatId}:`, error);
    });
  }, [activeChatId, chatHistories, clearMessages, createNewChat, loadChat, userId, sessionId]);

  const handleNavigateToAccount = useCallback(() => {
    // Emit event that user is going to accounts page (may update credits there)
    window.dispatchEvent(new CustomEvent('navigatingToAccounts'));
    router.push('/account');
    setIsUserProfileOpen(false);
  }, [router, setIsUserProfileOpen]);

  // Add session recovery on component mount
  useEffect(() => {
    const recoverSession = () => {
      const storedSessionId = SessionRecovery.getStoredSessionId();
      if (storedSessionId && storedSessionId !== sessionId) {
        console.log(`Recovering session on mount: ${storedSessionId}`);
        setSessionId(storedSessionId);
      }
    };
    
    recoverSession();
  }, []); // Run once on mount
  
  // Add session persistence when sessionId changes
  useEffect(() => {
    if (sessionId) {
      SessionRecovery.storeSessionId(sessionId);
    }
  }, [sessionId]);

  // Don't render anything until mounted to prevent hydration mismatch
  if (!mounted) {
    return null
  }

  return (
    <div className="flex h-screen bg-gradient-to-br from-gray-50 to-white text-gray-900">
      {/* Include sidebar for signed-in users or admin */}
      {(session || isAdmin) && (
        <Sidebar 
          isOpen={isSidebarOpen} 
          onClose={() => setSidebarOpen(false)} 
          onNewChat={handleNewChat}
          chatHistories={chatHistories}
          activeChatId={activeChatId}
          onChatSelect={loadChat}
          isLoading={isLoadingHistory}
          onDeleteChat={handleChatDelete}
          userId={userId || undefined}
        />
      )}

      <motion.div
        animate={{ 
          marginLeft: (session || isAdmin) && isSidebarOpen ? "16rem" : "0rem" 
        } as any}
        transition={{ type: "tween", duration: 0.3 }}
        className="flex-1 flex flex-col min-w-0 relative"
      >
        {mounted && !session && !hasFreeTrial() && <FreeTrialOverlay />}
        
        <header className="bg-white/70 backdrop-blur-sm p-4 flex justify-between items-center border-b border-gray-200 relative z-10">
          <div className="flex items-center gap-4">
            {(session || isAdmin) && !isSidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 rounded-full text-gray-500 hover:text-[#FF7F7F] hover:bg-[#FF7F7F]/5 focus:outline-none transition-colors"
                aria-label="Toggle sidebar"
              >
                <Menu className="h-5 w-5" />
              </button>
            )}
            
            <div className="flex items-center cursor-pointer" onClick={() => router.push("/")}>
              <div className="w-8 h-8 relative">
                <Image
                  src="https://4q2e4qu710mvgubg.public.blob.vercel-storage.com/Auto-analysts%20icon%20small-S682Oi8nbFhOADUHXJSD9d0KtSWKCe.png"
                  alt="Auto-Analyst Logo"
                  fill
                  className="object-contain"
                  priority
                />
              </div>
              <h1 className="text-xl font-semibold text-gray-900 ml-3">
                Auto-Analyst
              </h1>
            </div>
          </div>

          {/* Show credit balance and user profile */}
          <div className="flex items-center gap-3">
          {/* Feedback button */}
            <div className="relative">
              <button
                onClick={() => setShowFeedbackPopup(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-gray-600 hover:text-[#FF7F7F] hover:bg-[#FF7F7F]/5 rounded-lg transition-all duration-200"
                title="Send Feedback"
              >
                <MessageSquare className="w-4 h-4" />
                <span className="hidden sm:inline">Feedback</span>
              </button>
              {/* Small pink strip with 20% off */}
              <div className="absolute -top-3 -right-1 bg-[#FF7F7F] text-white text-xs px-1.5 py-0.5 rounded-full font-medium">
                get 20% off
              </div>
            </div>
            
            {/* Display current model */}
            {(session || isAdmin) && (
              <div 
                className="px-2.5 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-xs font-medium text-gray-700 cursor-pointer flex items-center"
                onClick={() => setIsSettingsOpen(true)}
              >
                {getDisplayName(modelSettings.model)}
              </div>
            )}
            
            {(session || isAdmin) && <CreditBalance />}
            
            
            {(session || isAdmin) && (
              <div className="relative">
                <div 
                  onClick={() => setIsUserProfileOpen(prev => !prev)}
                  className="cursor-pointer"
                >
                  {session?.user?.image ? (
                    <Avatar className="h-8 w-8">
                      <img src={session.user.image} alt={session.user.name || "User"} />
                    </Avatar>
                  ) : (
                    <Avatar className="h-8 w-8 bg-gray-100">
                      <User className="h-5 w-5 text-gray-600" />
                    </Avatar>
                  )}
                </div>
                
                <div className="relative z-50">
                  <UserProfilePopup 
                    isOpen={isUserProfileOpen}
                    onClose={() => setIsUserProfileOpen(false)}
                    onSettingsOpen={() => {
                      setIsUserProfileOpen(false);
                      setIsSettingsOpen(true);
                    }}
                    onAccountOpen={handleNavigateToAccount}
                    isAdmin={isAdmin}
                  />
                </div>
              </div>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-hidden">
          <ChatWindow 
            messages={storedMessages} 
            isLoading={isLoading} 
            onSendMessage={handleSendMessage}
            showWelcome={showWelcome}
            chatNameGenerated={chatNameGenerated}
            sessionId={sessionId || undefined}  // Convert null to undefined
            setSidebarOpen={setSidebarOpen}
          />
        </div>
        <ChatInput 
          ref={chatInputRef}
          onSendMessage={handleSendMessage} 
          onFileUpload={handleFileUpload}
          disabled={isInputDisabled()} 
          isLoading={isLoading}
          onStopGeneration={handleStopGeneration}
          chatId={activeChatId}
          userId={userId}
        />

        <SettingsPopup 
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          initialSettings={modelSettings}
          onSettingsUpdated={() => {
            // logger.log("Settings updated");
          }}
        />
        
        <InsufficientCreditsModal
          isOpen={insufficientCreditsModalOpen}
          onClose={() => {
            // When the modal is closed, keep the blocked state but hide the modal
            setInsufficientCreditsModalOpen(false);
            
            // Force a credits check to ensure the blocked state is maintained
            checkCredits().then(() => {
              // logger.log("[ChatInterface] Credits checked after modal closed");
            });
          }}
          requiredCredits={requiredCredits}
        />

        {/* Dataset Reset Popup */}
        {/* This block is removed as per the edit hint */}
      </motion.div>
      
      {/* Onboarding Tooltip */}
      <OnboardingTooltip 
        isOpen={showOnboarding} 
        onClose={() => setShowOnboarding(false)} 
      />
      
      {/* Feedback Popup */}
      <FeedbackPopup 
        isOpen={showFeedbackPopup}
        onClose={() => setShowFeedbackPopup(false)}
      />
    </div>
  )
}

export default ChatInterface