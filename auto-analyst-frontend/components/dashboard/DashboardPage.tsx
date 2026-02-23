"use client"

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { 
  BarChart3, 
  RefreshCw,
  LogIn,
  PinOff,
  Maximize2,
  X,
  Menu,
  MessageSquare,
  User
} from 'lucide-react'
import { useVisualizationsStore, Viz } from '@/lib/store/visualizationsStore'
import PlotlyChart from '@/components/chat/PlotlyChart'
import MatplotlibChart from '@/components/chat/MatplotlibChart'
import Sidebar from '@/components/chat/Sidebar'
import CreditBalance from '@/components/chat/CreditBalance'
import UserProfilePopup from '@/components/chat/UserProfilePopup'
import SettingsPopup from '@/components/chat/SettingsPopup'
import FeedbackPopup from '@/components/chat/FeedbackPopup'
import { useModelSettings } from '@/lib/hooks/useModelSettings'
import { getDisplayName } from '@/lib/model-registry'
import { motion } from 'framer-motion'

export default function DashboardPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const { visualizations: storeVisualizations, unpinVisualization } = useVisualizationsStore()
  const [fullscreenViz, setFullscreenViz] = useState<Viz | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isUserProfileOpen, setIsUserProfileOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [showFeedbackPopup, setShowFeedbackPopup] = useState(false)
  const [userId, setUserId] = useState<number | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const { modelSettings } = useModelSettings()

  // Set up user ID and admin status
  useEffect(() => {
    if (session?.user?.id) {
      setUserId(parseInt(session.user.id))
    }
    
    if (typeof window !== 'undefined') {
      setIsAdmin(localStorage.getItem('isAdmin') === 'true')
    }
  }, [session])

  // Redirect to login if not authenticated
  useEffect(() => {
    if (status === 'loading') return // Still loading
    
    if (!session && !isAdmin) {
      router.push('/login?callbackUrl=/dashboard')
    }
  }, [session, status, router, isAdmin])

  // Show loading state while checking authentication
  if (status === 'loading') {
    return (
      <div className="h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-[#FF7F7F] mx-auto mb-4" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  // Show login prompt if not authenticated
  if (!session && !isAdmin) {
    return (
      <div className="h-screen bg-white flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-8">
          <LogIn className="h-16 w-16 text-gray-400 mx-auto mb-6" />
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Login Required</h2>
          <p className="text-gray-600 mb-6">
            Please log in to access the Auto-Analyst Dashboard and view your visualizations.
          </p>
          <Button 
            onClick={() => router.push('/login?callbackUrl=/dashboard')}
            className="bg-[#FF7F7F] hover:bg-[#FF6666] text-white"
          >
            <LogIn className="h-4 w-4 mr-2" />
            Go to Login
          </Button>
        </div>
      </div>
    )
  }

  const handleUnpin = (viz: Viz, e: React.MouseEvent) => {
    e.stopPropagation()
    unpinVisualization(viz.codeHash)
  }

  const handleFullscreen = (viz: Viz, e: React.MouseEvent) => {
    e.stopPropagation()
    setFullscreenViz(viz)
  }

  const handleNavigateToAccount = () => {
    router.push('/account')
    setIsUserProfileOpen(false)
  }

  const renderVisualization = (viz: Viz) => {
    if (viz.type === 'plotly') {
      return (
        <div className="bg-white p-6 rounded-lg border shadow-sm relative group">
          {/* Action buttons - only unpin and fullscreen */}
          <div className="absolute top-4 right-4 z-10 flex space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button 
              variant="outline" 
              size="sm"
              onClick={(e: React.MouseEvent<HTMLButtonElement>) => handleFullscreen(viz, e)}
              className="h-8 w-8 p-0 bg-white/90 backdrop-blur-sm"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={(e: React.MouseEvent<HTMLButtonElement>) => handleUnpin(viz, e)}
              className="h-8 w-8 p-0 bg-white/90 backdrop-blur-sm hover:bg-red-50 hover:border-red-300"
            >
              <PinOff className="h-4 w-4 text-red-500" />
            </Button>
          </div>
          
          {viz.title && (
            <h3 className="text-xl font-semibold mb-4">{viz.title}</h3>
          )}
          <div className="h-80 w-full">
            <PlotlyChart data={viz.data} layout={viz.layout} />
          </div>
        </div>
      )
    } else if (viz.type === 'matplotlib') {
      return (
        <div className="bg-white p-6 rounded-lg border shadow-sm relative group">
          {/* Action buttons - only unpin and fullscreen */}
          <div className="absolute top-4 right-4 z-10 flex space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button 
              variant="outline" 
              size="sm"
              onClick={(e: React.MouseEvent<HTMLButtonElement>) => handleFullscreen(viz, e)}
              className="h-8 w-8 p-0 bg-white/90 backdrop-blur-sm"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={(e: React.MouseEvent<HTMLButtonElement>) => handleUnpin(viz, e)}
              className="h-8 w-8 p-0 bg-white/90 backdrop-blur-sm hover:bg-red-50 hover:border-red-300"
            >
              <PinOff className="h-4 w-4 text-red-500" />
            </Button>
          </div>
          
          {viz.title && (
            <h3 className="text-xl font-semibold mb-4">{viz.title}</h3>
          )}
          <div className="h-80 w-full flex items-center justify-center">
            <MatplotlibChart imageData={viz.imageData} />
          </div>
        </div>
      )
    }
    
    return null
  }

  return (
    <div className="flex h-screen bg-gradient-to-br from-gray-50 to-white text-gray-900">
      {/* Include sidebar */}
      {(session || isAdmin) && (
        <Sidebar 
          isOpen={sidebarOpen} 
          onClose={() => setSidebarOpen(false)} 
          onNewChat={() => router.push('/chat')}
          chatHistories={[]}
          activeChatId={null}
          onChatSelect={() => {}}
          isLoading={false}
          onDeleteChat={() => {}}
          userId={userId || undefined}
        />
      )}

      <motion.div
        animate={{ 
          marginLeft: (session || isAdmin) && sidebarOpen ? "16rem" : "0rem" 
        } as any}
        transition={{ type: "tween", duration: 0.3 }}
        className="flex-1 flex flex-col min-w-0 relative"
      >
        {/* Same navbar as ChatInterface */}
        <header className="bg-white/70 backdrop-blur-sm p-4 flex justify-between items-center border-b border-gray-200 relative z-10">
          <div className="flex items-center gap-4">
            {(session || isAdmin) && !sidebarOpen && (
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
                Dashboard
              </h1>
            </div>
          </div>

          {/* Same right side as ChatInterface */}
          <div className="flex items-center gap-3">
            {/* Feedback button */}
            <button
              onClick={() => setShowFeedbackPopup(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-gray-600 hover:text-[#FF7F7F] hover:bg-[#FF7F7F]/5 rounded-lg transition-all duration-200"
              title="Send Feedback"
            >
              <MessageSquare className="w-4 h-4" />
              <span className="hidden sm:inline">Feedback</span>
            </button>
            
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

        {/* Main Visualization Area */}
        <div className="flex-1 p-6 overflow-auto">
          {storeVisualizations.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <BarChart3 className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-gray-900 mb-2">No Visualizations Yet</h3>
                <p className="text-gray-600 mb-6">
                  Start chatting to generate your first visualization
                </p>
                <Button 
                  onClick={() => router.push('/chat')}
                  className="bg-[#FF7F7F] hover:bg-[#FF6666] text-white"
                >
                  Go to Chat
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
              {storeVisualizations.map(viz => (
                <div key={viz.id} className="relative">
                  {renderVisualization(viz)}
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>

      {/* Fullscreen Modal */}
      {fullscreenViz && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full h-full max-w-[95vw] max-h-[95vh] flex flex-col">
            <div className="flex justify-between items-center p-4 border-b bg-white rounded-t-lg">
              <h2 className="text-xl font-semibold">
                {fullscreenViz.title || 'Visualization'}
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFullscreenViz(null)}
                className="h-8 w-8 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            
            <div className="flex-1 p-4 overflow-auto">
              {fullscreenViz.type === 'plotly' ? (
                <div className="w-full h-full min-h-[500px] overflow-auto">
                  <PlotlyChart 
                    data={fullscreenViz.data} 
                    layout={fullscreenViz.layout} 
                    isFullscreen={true}
                  />
                </div>
              ) : (
                <div className="w-full h-full flex items-center justify-center overflow-auto">
                  <MatplotlibChart imageData={fullscreenViz.imageData} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Settings Popup */}
      <SettingsPopup 
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      {/* Feedback Popup */}
      <FeedbackPopup 
        isOpen={showFeedbackPopup}
        onClose={() => setShowFeedbackPopup(false)}
      />
    </div>
  )
}
