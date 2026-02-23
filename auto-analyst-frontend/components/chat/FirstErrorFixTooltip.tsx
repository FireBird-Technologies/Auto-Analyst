"use client"

import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { WrenchIcon, X } from 'lucide-react'

interface FirstErrorFixTooltipProps {
  hasError: boolean
  messageId: string
  onFixClick: () => void
  isFirstMessage: boolean
}

export default function FirstErrorFixTooltip({ 
  hasError, 
  messageId, 
  onFixClick, 
  isFirstMessage 
}: FirstErrorFixTooltipProps) {
  const [showTooltip, setShowTooltip] = useState(false)
  const [hasShownTooltip, setHasShownTooltip] = useState(false)

  // Check if we should show the tooltip
  useEffect(() => {
    if (hasError && isFirstMessage && !hasShownTooltip) {
      // Show tooltip after a short delay
      const timer = setTimeout(() => {
        setShowTooltip(true)
        setHasShownTooltip(true)
        
        // Store in localStorage that we've shown the tooltip for this session
        localStorage.setItem('fix-tooltip-shown', 'true')
        
        // Auto-hide after 10 seconds
        setTimeout(() => {
          setShowTooltip(false)
        }, 10000)
      }, 2000) // 2 second delay after error appears
      
      return () => clearTimeout(timer)
    }
  }, [hasError, isFirstMessage, hasShownTooltip])

  // Check if tooltip was already shown in this session
  useEffect(() => {
    const wasShown = localStorage.getItem('fix-tooltip-shown')
    if (wasShown) {
      setHasShownTooltip(true)
    }
  }, [])

  // Don't show if conditions aren't met
  if (!hasError || !isFirstMessage || hasShownTooltip) {
    return null
  }

  return (
    <AnimatePresence>
      {showTooltip && (
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.95 }}
          className="absolute top-4 right-4 z-50"
        >
          <TooltipProvider>
            <Tooltip open={showTooltip}>
              <TooltipTrigger asChild>
                <div className="relative">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onFixClick}
                    className="bg-[#FF7F7F]/10 border-[#FF7F7F]/30 text-[#FF7F7F] hover:bg-[#FF7F7F]/20 hover:border-[#FF7F7F]/50 transition-all duration-200 shadow-lg"
                  >
                    <WrenchIcon className="h-4 w-4 mr-2" />
                    Fix Error
                  </Button>
                  
                  {/* Close button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowTooltip(false)}
                    className="absolute -top-2 -right-2 h-6 w-6 p-0 bg-white border border-gray-200 rounded-full hover:bg-gray-50"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </TooltipTrigger>
              <TooltipContent 
                side="left" 
                className="bg-[#FF7F7F] text-white text-sm px-4 py-3 border-2 border-[#FF6666] shadow-lg max-w-xs"
              >
                <div className="text-center text-white">
                  <p className="font-medium text-white mb-1">🔧 Fix Error with AI</p>
                  <p className="text-xs opacity-90 text-white">
                    Click the fix button to automatically resolve this error using AI. 
                    This feature helps you debug and fix code issues quickly!
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </motion.div>
      )}
    </AnimatePresence>
  )
}