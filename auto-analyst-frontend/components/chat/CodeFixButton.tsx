"use client"

import React, { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { WrenchIcon, CreditCard, Lock, X } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useToast } from "@/components/ui/use-toast"
import axios from "axios"
import API_URL from '@/config/api'
import { useSession } from "next-auth/react"
import { useCredits } from '@/lib/contexts/credit-context'
import { motion } from "framer-motion"
import { useUserTier } from '@/lib/store/userSubscriptionStore'

interface CodeFixButtonProps {
  codeId: string                    // For tracking which code block
  code: string                      // ✅ For the request  
  errorOutput: string               // ✅ For the request
  isFixing: boolean                 // UI state (is this button currently fixing)
  codeFixes: Record<string, number> // Track fix attempts per code block
  sessionId: string                 // ✅ Add this back - required for backend
  onFixStart: (codeId: string) => void           // Callback when fix starts
  onFixComplete: (codeId: string, fixedCode: string) => void  // Callback when fix completes
  onCreditCheck: (codeId: string, hasEnough: boolean) => void // Credit check callback
  onRefreshCode?: (codeId: string) => Promise<void>  // Callback to refresh code from parent
  onCanvasOpen?: () => void         // Callback to open the code canvas
  className?: string
  variant?: 'default' | 'inline' | 'icon-only'  // ✅ Add 'icon-only'
  checkCredits?: () => Promise<void>
}

const CodeFixButton: React.FC<CodeFixButtonProps> = ({
  codeId,
  code,           // ✅ Used in request
  errorOutput,
  isFixing,
  codeFixes,
  sessionId,      // ✅ Used in request
  onFixStart,
  onFixComplete,
  onCreditCheck,
  onRefreshCode,
  onCanvasOpen,   // ✅ Canvas open callback
  className = "",
  variant = 'default',
  checkCredits
}) => {
  const { toast } = useToast()
  const { data: session } = useSession()
  const { remainingCredits } = useCredits()
  const userTier = useUserTier()
  
  // Local state for retry management
  const [retryCount, setRetryCount] = useState(0)
  const [isCancellable, setIsCancellable] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const longTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Cleanup function to clear all timeouts and abort requests
  const cleanup = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    if (longTimeoutRef.current) {
      clearTimeout(longTimeoutRef.current)
      longTimeoutRef.current = null
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setIsCancellable(false)
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [])

  // Enhanced fix function with better timeout handling and error management
  const handleFixCode = async (isRetry = false, currentRetryCount = 0) => {
    // Validate inputs before starting
    if (!code || !errorOutput || !sessionId) {
      toast({
        title: "Invalid request",
        description: "Missing required data for code fixing.",
        variant: "destructive",
        duration: 5000,
      })
      return
    }

    // Validate session ID format
    if (sessionId.length < 10) {
      toast({
        title: "Session Error",
        description: "Invalid session. Please refresh the page.",
        variant: "destructive",
        duration: 5000,
      })
      return
    }

    // Open canvas to show fixing process
    onCanvasOpen?.()
    
    // Start fixing
    onFixStart?.(codeId)

    // Check if user has enough credits for non-free fixes
    const needsCredits = userTier === 'free' && (codeFixes[codeId] || 0) >= 2
    if (needsCredits && remainingCredits < 1) {
      onCreditCheck?.(codeId, false)
      toast({
        title: "Insufficient credits",
        description: "You need at least 1 credit to fix code errors.",
        variant: "destructive",
        duration: 5000,
      })
      return
    }

    // Credit check for non-free fixes
    if (needsCredits && !session?.user) {
      toast({
        title: "Login required",
        description: "Please log in to use AI code fixing.",
        variant: "destructive",
        duration: 5000,
      })
      return
    }
    
    try {
      // Show appropriate toast message
      if (isRetry) {
        toast({
          title: `Retrying fix (${currentRetryCount + 1}/3)`,
          description: "Attempting to fix the code again...",
          duration: 3000,
        })
      } else {
        toast({
          title: "Fixing code",
          description: "AI is attempting to fix the errors...",
          duration: 3000,
        })
      }

      console.log('🔧 Sending fix request:', {
        codeLength: code.length,
        errorLength: errorOutput.length,
        sessionId: sessionId,
        retryCount: currentRetryCount
      })
      
      // Create new abort controller for this request
      abortControllerRef.current = new AbortController()
      
      // Set up timeouts
      // Short timeout for immediate feedback (15 seconds)
      timeoutRef.current = setTimeout(() => {
        setIsCancellable(true)
        toast({
          title: "Taking longer than expected",
          description: "The fix is still processing. You can cancel if needed.",
          duration: 5000,
        })
      }, 15000)

      // Long timeout to abort request (75 seconds - longer than backend timeout)
      longTimeoutRef.current = setTimeout(() => {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort()
        }
      }, 75000)

      // ✅ Simple request with just code + error
      const response = await axios.post(`${API_URL}/code/fix`, {
        code: code.trim(),
        error: errorOutput.trim(),
      }, {
        headers: {
          'X-Session-ID': sessionId,
        },
        signal: abortControllerRef.current.signal,
        timeout: 80000 // 80 second axios timeout
      })

      // Clear timeouts on successful response
      cleanup()

      if (response.data && response.data.fixed_code) {
        const fixedCode = response.data.fixed_code
        
        // Deduct credits if this was not a free fix and user is logged in
        if (needsCredits && session?.user) {
          try {
            // Determine user ID for credit deduction
            let userIdForCredits = '';
            
            if ((session.user as any).sub) {
              userIdForCredits = (session.user as any).sub;
            } else if ((session.user as any).id) {
              userIdForCredits = (session.user as any).id;
            } else if (session.user.email) {
              userIdForCredits = session.user.email;
            }
            
            if (userIdForCredits) {
              // Deduct 1 credit for AI code fix
              await axios.post('/api/user/deduct-credits', {
                userId: userIdForCredits,
                credits: 1,
                description: 'Used AI to fix code error'
              });
              
              // Refresh credits display
              if (checkCredits) {
                await checkCredits();
              }
              
              toast({
                title: "Credit used",
                description: "1 credit deducted for AI code fix",
                duration: 3000,
              })
            }
          } catch (creditError) {
            console.warn("Failed to deduct credits:", creditError)
            // Don't block the fix if credit deduction fails
          }
        }

        // Complete fixing
        onFixComplete?.(codeId, fixedCode)
        
        // Reset retry count on success
        setRetryCount(0)
        
        toast({
          title: "Code fixed successfully!",
          description: "The AI has provided a potential fix for your code.",
          duration: 5000,
        })
        
      } else if (response.data && response.data.error) {
        // Server returned an error
        toast({
          title: "Error fixing code",
          description: response.data.error,
          variant: "destructive", 
          duration: 5000,
        })
      } else {
        // No fixed code or error in response
        toast({
          title: "Error fixing code", 
          description: "No fixed code received from the server.",
          variant: "destructive",
          duration: 5000,
        })
      }
    } catch (error) {
      console.error("Error fixing code with AI:", error)
      
      // Always cleanup on error
      cleanup()
      
      // Handle different types of errors
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED' || error.name === 'AbortError') {
          // Timeout error - silent retry
          if (currentRetryCount < 2) {
            setTimeout(() => {
              handleFixCode(true, currentRetryCount + 1)
            }, 2000)
            return
          } else {
            toast({
              title: "Request timeout",
              description: "Request timed out after retries. Please try again later.",
              variant: "destructive",
              duration: 5000,
            })
          }
        } else if (error.response && error.response.status === 400 && error.response?.data?.detail === "Session ID required") {
          // Session ID error - silent retry once
          if (currentRetryCount < 1) {
            setTimeout(() => {
              handleFixCode(true, currentRetryCount + 1)
            }, 1000)
            return
          } else {
            toast({
              title: "Session Error",
              description: "Session expired. Please refresh the page and try again.",
              variant: "destructive",
              duration: 5000,
            })
          }
        } else if (error.response && error.response.status === 500) {
          // Server error - retry once
          if (currentRetryCount < 1) {
            setTimeout(() => {
              handleFixCode(true, currentRetryCount + 1)
            }, 3000)
            return
          } else {
            toast({
              title: "Server Error",
              description: "Server error occurred. Please try again later.",
              variant: "destructive",
              duration: 5000,
            })
          }
        } else if (error.response && error.response.status === 429) {
          // Rate limit error
          toast({
            title: "Rate limit exceeded",
            description: "Too many requests. Please wait a moment and try again.",
            variant: "destructive",
            duration: 5000,
          })
        } else {
          // Other axios errors
          toast({
            title: "Network Error",
            description: error.message || "Failed to connect to server. Please check your connection.",
            variant: "destructive",
            duration: 5000,
          })
        }
      } else {
        // Non-axios errors
        toast({
          title: "Unexpected Error",
          description: "An unexpected error occurred. Please try again.",
          variant: "destructive",
          duration: 5000,
        })
      }
    }
  }

  // Cancel function
  const handleCancel = () => {
    cleanup()
    toast({
      title: "Fix cancelled",
      description: "Code fixing has been cancelled.",
      duration: 3000,
    })
  }

  // Determine if fix button should be shown
  const shouldShowFixButton = errorOutput && errorOutput.trim().length > 0
  const hasAttemptedFixes = (codeFixes[codeId] || 0) > 0
  const maxAttemptsReached = (codeFixes[codeId] || 0) >= 3

  if (!shouldShowFixButton) {
    return null
  }

  // Determine button content based on state
  const getButtonContent = () => {
    if (isFixing) {
      if (isCancellable) {
        return (
          <div className="flex items-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            <span>Fixing...</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCancel}
              className="h-6 w-6 p-0 hover:bg-red-500 hover:text-white"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )
      }
      return (
        <div className="flex items-center gap-2">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
          <span>Fixing...</span>
        </div>
      )
    }

    if (maxAttemptsReached) {
      return (
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4" />
          <span>Max attempts reached</span>
        </div>
      )
    }

    if (hasAttemptedFixes && userTier === 'free') {
      return (
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4" />
          <span>Fix ({codeFixes[codeId]}/3)</span>
        </div>
      )
    }

    return (
      <div className="flex items-center gap-2">
        <WrenchIcon className="h-4 w-4" />
        <span>Fix Code</span>
      </div>
    )
  }

  // Determine button variant and disabled state
  const isDisabled = isFixing || maxAttemptsReached || !sessionId

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={() => handleFixCode()}
            disabled={isDisabled}
            size="sm"
            className={`
              ${className} 
              ${isFixing ? 'cursor-not-allowed' : ''} 
              ${maxAttemptsReached 
                ? 'bg-red-500 hover:bg-red-600 text-white' 
                : 'bg-[#FF7F7F] hover:bg-[#FF6666] text-white border-none'
              }
            `}
          >
            {getButtonContent()}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {isFixing ? (
            isCancellable ? (
              <p>Click X to cancel the fix</p>
            ) : (
              <p>AI is fixing your code...</p>
            )
          ) : maxAttemptsReached ? (
            <p>Maximum fix attempts reached. Upgrade to fix more.</p>
          ) : hasAttemptedFixes && userTier === 'free' ? (
            <p>Free fixes: {codeFixes[codeId]}/3 used</p>
          ) : (
            <p>Click to fix code errors with AI</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export default CodeFixButton