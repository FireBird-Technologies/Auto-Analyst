"use client"

import { type FC, useState, useEffect } from "react"
import Image from "next/image"
import { motion } from "framer-motion"
import { X, MessageSquarePlus, History, Settings, LogOut, Trash2, BarChart2, MessageSquare } from "lucide-react"
import { signOut, useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useChatHistoryStore } from "@/lib/store/chatHistoryStore"
import SettingsPopup from './SettingsPopup'
import axios from "axios"
import { useSessionStore } from '@/lib/store/sessionStore'
import API_URL from '@/config/api'
import { format } from 'date-fns'
import { useModelSettings } from '@/lib/hooks/useModelSettings'
import logger from '@/lib/utils/logger'
import { TemplatesButton, TemplatesModal, useTemplates } from '@/components/custom-templates'
import { useUserSubscriptionStore } from '@/lib/store/userSubscriptionStore'

const PREVIEW_API_URL = API_URL;

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
  onNewChat: () => void
  chatHistories: Array<{
    chat_id: number;
    title: string;
    created_at: string;
    user_id?: number;
  }>
  activeChatId: number | null
  onChatSelect: (chatId: number) => void
  isLoading: boolean
  onDeleteChat: (chatId: number) => void
  userId?: number | null
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose, onNewChat, chatHistories = [], activeChatId, onChatSelect, isLoading, onDeleteChat, userId: userIdProp }) => {
  const { clearMessages } = useChatHistoryStore()
  const { data: session } = useSession()
  const router = useRouter()
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const { modelSettings } = useModelSettings()
  const { sessionId } = useSessionStore()
  const [isAdmin, setIsAdmin] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [chatToDelete, setChatToDelete] = useState<number | null>(null);
  const [isTemplatesModalOpen, setIsTemplatesModalOpen] = useState(false);
  const { subscription } = useUserSubscriptionStore()
  
  // Get current user profile for templates
  const userProfile = subscription || null
  
  // Handle userId properly for both regular users and admin testing
  const [userId, setUserId] = useState<number>(1) // Default fallback
  
  const getUserId = () => {
    // First check if userId prop is provided (correct user-specific ID)
    if (userIdProp) {
      return userIdProp
    }
    
    // Only access localStorage on client side
    if (typeof window !== 'undefined') {
      // Then check for admin testing user ID
      const adminUserId = localStorage.getItem('adminUserId')
      if (adminUserId) {
        return parseInt(adminUserId)
      }
    }
    
    // Then check session user ID
    if (session?.user?.id) {
      return parseInt(session.user.id)
    }
    
    // Default fallback
    return 1 // Use 1 instead of 0 since user IDs start from 1
  }
  
  // Update userId when dependencies change
  useEffect(() => {
    const newUserId = getUserId()
    setUserId(newUserId)
  }, [userIdProp, session?.user?.id])
  
  // Also check admin status on client side only
  useEffect(() => {
    if (typeof window !== 'undefined') {
    setIsAdmin(localStorage.getItem('isAdmin') === 'true')
    }
  }, [])
  
  // Use templates hook for data management
  const { templateCount, enabledCount } = useTemplates({ 
    userId, 
    enabled: isOpen && !!userId 
  })

  const handleNewChat = async () => {
    if (sessionId) {
      try {
        // Before resetting, check if there's a custom dataset loaded
        const sessionInfoResponse = await axios.get(`${PREVIEW_API_URL}/api/session-info`, {
          headers: {
            'X-Session-ID': sessionId,
          }
        });
        
        // If there's a custom dataset, we'll let the ChatInterface handle it
        // logger.log("Dataset check before new chat:", sessionInfoResponse.data);
        const hasCustomDataset = sessionInfoResponse.data && sessionInfoResponse.data.is_custom_dataset;
        
        // Important: Do NOT reset model settings when starting a new chat
        if (!hasCustomDataset) {
          // If no custom dataset, we can reset session data but KEEP model settings
          // logger.log("No custom dataset, resetting session data only");
          await axios.post(`${PREVIEW_API_URL}/reset-session`, 
            { preserveModelSettings: true }, // Add flag to preserve model settings
            {
              headers: {
                'X-Session-ID': sessionId,
              },
            }
          );
        } else {
          // logger.log("Custom dataset detected, ChatInterface will handle dataset choice");
          // We'll let ChatInterface handle the custom dataset flow
        }
        
        clearMessages();
        onClose();
        onNewChat();  // This will trigger handleNewChat in ChatInterface
      } catch (error) {
        console.error('Failed to check or reset session:', error);
        
        // Fallback to normal flow
        clearMessages();
        onClose();
        onNewChat();
      }
    } else {
      clearMessages();
      onClose();
      onNewChat();
    }
  }

  const handleSignOut = async () => {
    if (typeof window !== 'undefined' && localStorage.getItem('isAdmin') === 'true') {
      // Clear admin status
      localStorage.removeItem('isAdmin')
      // Redirect to home page
      window.location.href = '/'
    } else {
      // Sign out from next-auth (Google)
      await signOut({ callbackUrl: '/' })
    }
  }

  // Add a function to delete a chat
  const handleDeleteChat = (chatId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setChatToDelete(chatId);
    setIsDeleteModalOpen(true);
  };

  // Add a function to confirm deletion
  const confirmDeleteChat = async () => {
    if (!chatToDelete) return;
    
    // Call onDeleteChat to update the sidebar - this will handle the API call in ChatInterface
    onDeleteChat(chatToDelete);
    
    // Close the modal
    setIsDeleteModalOpen(false);
  };
  
  // Format the date for display
  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return format(date, 'MMM d, yyyy');
    } catch (error) {
      return dateString;
    }
  };

  // Update the onClick handler to call onChatSelect
  const handleChatSelect = (chatId: number) => {
    onChatSelect(chatId);
  };

  // Keep the renderUserProfile function for the sidebar itself
  const renderUserProfile = () => {
    if (session?.user) {
      return (
        <div className="p-3 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="relative w-10 h-10 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center">
              {session.user.image ? (
                <Image 
                  src={session.user.image} 
                  alt="User avatar" 
                  fill 
                  className="object-cover"
                />
              ) : (
                <div className="text-gray-500 font-semibold text-lg">
                  {session.user.name?.charAt(0) || session.user.email?.charAt(0) || '?'}
                </div>
              )}
              {isAdmin && (
                <div className="absolute bottom-0 right-0 w-4 h-4 bg-[#FF7F7F] rounded-full border-2 border-white flex items-center justify-center">
                  <span className="text-white text-[8px]">A</span>
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              {session.user.name && (
                <p className="text-sm font-medium text-gray-800 truncate">
                  {session.user.name}
                </p>
              )}
              <p className="text-xs text-gray-500 truncate">
                {session.user.email || 'User'}
              </p>
            </div>
          </div>
        </div>
      );
    } else if (isAdmin) {
      return (
        <div className="p-3 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#FF7F7F]/10 flex items-center justify-center">
              <BarChart2 className="h-5 w-5 text-[#FF7F7F]" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-800">Administrator</p>
              <p className="text-xs text-gray-500">Admin Mode</p>
            </div>
          </div>
        </div>
      );
    }
    
    return null;
  };

  return (
    <>
      {/* Backdrop for mobile */}
      {isOpen && (
        <div 
          className="md:hidden fixed inset-0 bg-black/30 z-40"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <motion.div
        initial={{ x: "-100%" }}
        animate={{ x: isOpen ? 0 : "-100%" }}
        transition={{ type: "tween", duration: 0.3 }}
        className="fixed top-0 left-0 h-full w-64 bg-white shadow-lg z-50 flex flex-col"
      >
        <div className="flex-1 flex flex-col h-full">
          {/* Header with logo and close button */}
          <div className="flex justify-between items-center p-4 border-b border-gray-100 bg-white/80 backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 relative">
                <Image
                  src="https://4q2e4qu710mvgubg.public.blob.vercel-storage.com/Auto-analysts%20icon%20small-S682Oi8nbFhOADUHXJSD9d0KtSWKCe.png"
                  alt="Auto-Analyst Logo"
                  fill
                  className="object-contain"
                />
              </div>
              <h2 className="text-lg font-semibold text-gray-800">Chat History</h2>
            </div>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-[#FF7F7F] focus:outline-none focus:ring-2 focus:ring-[#FF7F7F]/20 rounded-full p-1.5 transition-colors"
              aria-label="Close sidebar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation */}
          <div className="mx-3 mt-3 mb-2 grid grid-cols-1 gap-2">
            <button
              onClick={() => router.push('/chat')}
              className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-sm hover:shadow-md hover:text-[#FF7F7F] border border-gray-100 hover:border-[#FF7F7F]/20 transition-all duration-200"
            >
              <MessageSquare className="w-4 h-4" />
              <span>Chat</span>
            </button>
            <button
              onClick={() => router.push('/dashboard')}
              className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-sm hover:shadow-md hover:text-[#FF7F7F] border border-gray-100 hover:border-[#FF7F7F]/20 transition-all duration-200"
            >
              <BarChart2 className="w-4 h-4" />
              <span>Dashboard</span>
            </button>
          </div>

          {/* New Chat Button */}
          <div className="mx-3 mb-3">
            <button
              onClick={onNewChat}
              className="w-full flex items-center gap-3 rounded-xl bg-[#FF7F7F] px-4 py-3 text-sm font-medium text-white shadow-sm hover:bg-[#FF6666] transition-all duration-200"
            >
              <MessageSquarePlus className="w-4 h-4" />
              <span>New Chat</span>
            </button>
          </div>

          {/* Templates Section */}
          <div className="mx-3 mb-3">
            <TemplatesButton
              onClick={() => setIsTemplatesModalOpen(true)}
              userProfile={userProfile}
              templateCount={templateCount}
              enabledCount={enabledCount}
            />
          </div>

          {/* Chat History - more minimal with less padding */}
          <div className="flex-1 overflow-y-auto px-4 py-3 bg-gradient-to-b from-white to-gray-50/30">
            <div className="mb-2 px-1 flex items-center">
              <History className="w-4 h-4 text-gray-400 mr-2" />
              <h3 className="text-xs font-medium uppercase text-gray-500 tracking-wider">Recent Conversations</h3>
            </div>
            
            {isLoading ? (
              <div className="flex justify-center py-6">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[#FF7F7F]"></div>
              </div>
            ) : chatHistories && chatHistories.length > 0 ? (
              <div className="space-y-1">
                {chatHistories.map((chat) => (
                  <motion.div 
                    key={chat.chat_id}
                    onClick={() => handleChatSelect(chat.chat_id)}
                    className={`flex items-center justify-between p-2.5 rounded-lg cursor-pointer group transition-all ${
                      activeChatId === chat.chat_id 
                        ? 'bg-[#FF7F7F]/10 text-[#FF7F7F]' 
                        : 'hover:bg-gray-100 text-gray-700'
                    }`}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    transition={{ duration: 0.15 }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{chat.title}</p>
                      <p className="text-xs text-gray-500">{formatDate(chat.created_at)}</p>
                    </div>
                    <button
                      onClick={(e) => handleDeleteChat(chat.chat_id, e)}
                      className={`opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-full focus:outline-none focus:ring-2 focus:ring-red-200 transition-all ${
                        activeChatId === chat.chat_id ? 'opacity-70' : ''
                      }`}
                      aria-label="Delete chat"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 px-2">
                <div className="bg-gray-50 rounded-lg p-4 shadow-sm">
                  <History className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                  <p className="text-sm text-gray-600 mb-1">No conversations yet</p>
                  <p className="text-xs text-gray-500">Your chats will appear here</p>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Navigation - more minimal and consistent with profile popup */}
          <div className="border-t border-gray-100 bg-white/90 backdrop-blur-sm">
            {/* User Profile */}
            {renderUserProfile()}
            
            {/* Actions - simplified buttons */}
            <div className="p-3 grid grid-cols-2 gap-2">
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="flex items-center justify-center gap-1.5 rounded-md py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Settings</span>
              </button>
              
              <button
                onClick={handleSignOut}
                className="flex items-center justify-center gap-1.5 rounded-md py-2 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        </div>
      </motion.div>
      
      <SettingsPopup 
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        initialSettings={modelSettings}
      />

      {isDeleteModalOpen && (
        <div 
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] flex items-center justify-center"
          onClick={() => setIsDeleteModalOpen(false)}
        >
          <motion.div 
            className="bg-white rounded-xl shadow-xl p-5 max-w-sm w-[90%] mx-4 z-[70]"
            onClick={e => e.stopPropagation()}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
          >
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Delete Chat</h3>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to delete this chat? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setIsDeleteModalOpen(false)}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteChat}
                className="px-3 py-1.5 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                Delete
              </button>
            </div>
          </motion.div>
        </div>
      )}
      
      {/* Templates Modal */}
      <TemplatesModal
        isOpen={isTemplatesModalOpen}
        onClose={() => setIsTemplatesModalOpen(false)}
        userId={userId}
      />
    </>
  )
}

export default Sidebar

