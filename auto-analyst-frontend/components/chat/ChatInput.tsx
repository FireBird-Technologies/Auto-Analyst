"use client"

import React, { forwardRef, useImperativeHandle, useState, useEffect, useRef, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Eye, Zap, Paperclip, Send, Square, FileText, Database, Loader2 } from 'lucide-react'
import { Button } from "../ui/button"
import { Textarea } from "../ui/textarea"
import { useChatInput } from '@/lib/hooks/useChatInput'
import { ChatInputProps, ChatInputRef } from '@/types/chatInput.types'
import ExcelUploadDialog from './ExcelUploadDialog'
import CSVUploadDialog from './CSVUploadDialogue'
import DeepAnalysisSidebar from '../deep-analysis/DeepAnalysisSidebar'
import UploadSummaryDialog from './UploadSummaryDialog'
import AttachButtonTooltip from './AttachButtonTooltip'
import axios from 'axios'
import API_URL from '@/config/api'
import { useUserSubscriptionStore } from '@/lib/store/userSubscriptionStore'
import { useFeatureAccess } from '@/lib/hooks/useFeatureAccess'
import { useAgentMentions, AgentInfo } from '@/lib/hooks/useAgentMentions'
import { useSessionStore } from '@/lib/store/sessionStore';

const ChatInput = forwardRef<ChatInputRef, ChatInputProps>((props, ref) => {
  const chatInput = useChatInput(props)
  
  const {
    showAgentMentions,
    mentionPosition,
    filteredAgents,
    selectedMentionIndex,
    mentionRef,
    handleInputChange,
    handleMentionSelect,
    handleKeyDown,
    getReplacementRange,
    hideMentions,  // Add this function
  } = useAgentMentions(chatInput.sessionId || undefined)

  const insertMention = (agentName: string) => {
    const textarea = chatInput.inputRef.current
    if (!textarea) return
    const value = chatInput.message
    const cursor = textarea.selectionStart || value.length
    const range = getReplacementRange(value, cursor)
    const mentionText = `@${agentName}`
    if (range) {
      const newValue = value.slice(0, range.start) + mentionText + value.slice(range.end)
      chatInput.setMessage(newValue)
      requestAnimationFrame(() => {
        textarea.focus()
        const pos = range.start + mentionText.length
        textarea.setSelectionRange(pos, pos)
      })
    }
  }

  // File upload status display
  const [showUploadStatus, setShowUploadStatus] = useState(false)
  const [uploadStatusMessage, setUploadStatusMessage] = useState('')
  const [uploadStatusType, setUploadStatusType] = useState<'loading' | 'success' | 'error'>('loading')
  
  // Expose methods to parent component
  useImperativeHandle(ref, () => ({
    handlePreviewDefaultDataset: chatInput.handlePreviewDefaultDataset,
    handleSilentDefaultDataset: chatInput.handleSilentDefaultDataset
  }))

  // Monitor file upload status and show loading indicator
  useEffect(() => {
    if (chatInput.fileUpload) {
      const { status, file, errorMessage } = chatInput.fileUpload
      
      if (status === 'uploading') {
        setShowUploadStatus(true)
        setUploadStatusType('loading')
        setUploadStatusMessage(`Uploading ${file.name}...`)
      } else if (status === 'success') {
        setShowUploadStatus(true)
        setUploadStatusType('success')
        setUploadStatusMessage(`${file.name} uploaded successfully`)
        
        // Hide success message after 3 seconds
        setTimeout(() => {
          setShowUploadStatus(false)
        }, 3000)
      } else if (status === 'error') {
        setShowUploadStatus(true)
        setUploadStatusType('error')
        setUploadStatusMessage(errorMessage || `Failed to upload ${file.name}`)
        
        // Hide error message after 5 seconds
        setTimeout(() => {
          setShowUploadStatus(false)
        }, 5000)
      }
    } else {
      setShowUploadStatus(false)
    }
  }, [chatInput.fileUpload])

  // Handle file selection from input
  const handleFileSelect = (file: File) => {
    if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      chatInput.handleExcelFileSelected(file)
    } else {
      chatInput.handleFileUpload(file)
    }
  }

  // Handle input changes
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    const cursorPosition = e.target.selectionStart || 0
    
    chatInput.setMessage(value)
    
    // Handle agent mentions
    handleInputChange(value, cursorPosition, e.target)
    
    // Auto-resize textarea with reduced max height
    const textarea = e.target
    textarea.style.height = 'auto'
    textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px'
  }

  // Handle key down events
  const handleKeyDownEvent = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    handleKeyDown(
      e,
      chatInput.message,
      chatInput.inputRef.current?.selectionStart || 0,
      chatInput.inputRef.current || (e.target as HTMLTextAreaElement)
    )
    const selected = (window as any).__aa_selected_agent__
    if (selected) {
      insertMention(selected.name)
      ;(window as any).__aa_selected_agent__ = undefined
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!chatInput.disabled && !chatInput.isLoading && chatInput.message.trim()) {
        chatInput.handleSendMessage()
      }
    }
  }

  // Handle agent selection
  const handleAgentSelect = (agent: any) => {
    handleMentionSelect(agent)
  }

  // Close mentions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (mentionRef.current && !mentionRef.current.contains(event.target as Node)) {
        // setShowAgentMentions(false) // This is now handled by useAgentMentions
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  // Get status icon based on upload status type
  const getStatusIcon = () => {
    switch (uploadStatusType) {
      case 'loading':
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
      case 'success':
        return <Database className="h-4 w-4 text-green-500" />
      case 'error':
        return <Square className="h-4 w-4 text-red-500" />
      default:
        return <Eye className="h-4 w-4 text-gray-500" />
    }
  }

  // Get status text color based on upload status type
  const getStatusTextColor = () => {
    switch (uploadStatusType) {
      case 'loading':
        return 'text-blue-600'
      case 'success':
        return 'text-green-600'
      case 'error':
        return 'text-red-600'
      default:
        return 'text-gray-600'
    }
  }

  // Add feature access logic
  const { subscription } = useUserSubscriptionStore()
  const deepAnalysisAccess = useFeatureAccess('DEEP_ANALYSIS', subscription)

  return (
    <div className="relative w-full max-w-5xl mx-auto px-4">
      {/* Action buttons row - ChatGPT style above input */}
      <div className="flex items-center justify-center gap-2 mb-2">
        {/* Preview Default Dataset Button - only show if no file uploaded */}
        {!chatInput.fileUpload && (
          <div className="relative flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={chatInput.handlePreviewDefaultDataset}
              className="bg-white/90 border-gray-200 text-[#FF7F7F] hover:text-[#FF6666] hover:bg-[#FF7F7F]/10 hover:border-[#FF7F7F]/30 transition-all duration-200 flex items-center gap-2 px-4 py-2 rounded-full shadow-sm"
              disabled={chatInput.disabled || chatInput.isLoading}
            >
              <Eye className="h-4 w-4" />
              <span className="text-sm font-medium">Preview Default Dataset</span>
            </Button>
          </div>
        )}
        
        {/* Dataset Info - show after upload - clickable to show details */}
        {chatInput.fileUpload && chatInput.fileUpload.status === 'success' && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // Set the correct preview data before opening dialog
              if (chatInput.fileUpload?.preview) {
                chatInput.setCSVPreview(chatInput.fileUpload.preview)
              }
              
              // Show the appropriate dialog based on file type
              if (chatInput.fileUpload?.isExcel) {
                chatInput.setShowExcelDialog(true)
              } else {
                chatInput.setShowCSVDialog(true)
              }
            }}
            className="bg-[#FF7F7F]/10 border-[#FF7F7F]/30 text-[#FF7F7F] hover:bg-[#FF7F7F]/20 hover:border-[#FF7F7F]/50 transition-all duration-200 flex items-center gap-2 px-4 py-2 rounded-full shadow-sm cursor-pointer"
          >
            <Database className="h-4 w-4" />
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                Dataset: {chatInput.datasetDescription.name || chatInput.fileUpload.file.name}
              </span>
              {chatInput.fileUpload.selectedSheet && (
                <span className="text-xs bg-[#FF7F7F]/20 text-[#FF7F7F] px-2 py-0.5 rounded-full">
                  {chatInput.fileUpload.selectedSheet}
                </span>
              )}
            </div>
          </Button>
        )}
        
        {/* Deep Analysis Button - conditional based on access */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => chatInput.setShowDeepAnalysisSidebar(true)}
          className="bg-white/90 border-gray-200 text-[#FF7F7F] hover:text-[#FF6666] hover:bg-[#FF7F7F]/10 hover:border-[#FF7F7F]/30 transition-all duration-200 flex items-center gap-2 px-4 py-2 rounded-full shadow-sm relative"
          disabled={chatInput.disabled || chatInput.isLoading}
        >
          <Zap className="h-4 w-4" />
          <span className="text-sm font-medium">Deep Analysis</span>
          {/* Only show Premium badge if user doesn't have access */}
          {!deepAnalysisAccess.hasAccess && (
            <span className="absolute -top-1 -right-1 bg-[#FF7F7F] text-white text-xs px-1.5 py-0.5 rounded-full">
              Premium
            </span>
          )}
        </Button>
      </div>

      {/* File Upload Status Indicator */}
      <AnimatePresence>
        {showUploadStatus && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className="flex items-center justify-center mb-3"
          >
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-full px-4 py-2 shadow-sm">
              {getStatusIcon()}
              <span className={`text-sm font-medium ${getStatusTextColor()}`}>
                {uploadStatusMessage}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main input container - ChatGPT style but wider */}
      <div className="bg-white border border-gray-300 rounded-3xl shadow-lg hover:shadow-xl transition-shadow duration-200 overflow-hidden w-full">
        
        {/* Main Input Section - ChatGPT style but wider */}
        <div className="flex items-center gap-4 p-4"> {/* Reduced padding from p-5 to p-4 */}
          {/* File attachment button with tooltip */}
          <AttachButtonTooltip
            onClick={() => chatInput.fileInputRef.current?.click()}
            disabled={!!(chatInput.disabled || chatInput.isLoading)}
            sessionId={chatInput.sessionId}
          />

          {/* Message input - wider */}
          <div className="flex-1 relative min-w-0">
            <Textarea
              ref={chatInput.inputRef}
              value={chatInput.message}
              onChange={handleInput}
              onKeyDown={handleKeyDownEvent}
              placeholder="Ask data related questions, use @agent_name to call agents for specific tasks"
              disabled={chatInput.disabled}
              className="min-h-[44px] max-h-[150px] resize-none border-0 shadow-none focus:ring-0 focus-visible:ring-0 bg-transparent text-gray-900 placeholder-gray-500 text-base leading-6 pr-16 py-2.5 w-full"
              style={{ fontSize: '16px', lineHeight: '24px' }}
            />

            
            
            {/* Send/Stop button - better positioned and Auto-Analyst colors */}
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {chatInput.isLoading ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={props.onStopGeneration}
                  className="h-9 w-9 p-0 text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors duration-200 rounded-lg"
                >
                  <Square className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  onClick={chatInput.handleSendMessage}
                  disabled={chatInput.disabled || !chatInput.message.trim()}
                  className="h-9 w-9 p-0 bg-[#FF7F7F] hover:bg-[#FF6666] disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors duration-200 rounded-lg shadow-sm"
                >
                  <Send className="h-4 w-4 text-white" />
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Hidden file input */}
        <input
          ref={chatInput.fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0]
            if (file) handleFileSelect(file)
          }}
          className="hidden"
        />
      </div>
      
      {/* Agent Mentions Dropdown - Fixed positioning */}
      <AnimatePresence>
        {showAgentMentions && filteredAgents.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            ref={mentionRef}
            style={{
              position: 'fixed',
              top: mentionPosition.top - 300,
              left: mentionPosition.left,
              zIndex: 9999,
            }}
            className="bg-white border border-gray-200 rounded-md shadow-lg w-64 max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300"
          >
            {filteredAgents.map((agent, idx) => (
              <button
                key={agent.name}
                type="button"
                onClick={() => {
                  insertMention(agent.name)
                  hideMentions()
                }}
                className={`w-full text-left px-3 py-2 text-sm ${
                  idx === selectedMentionIndex ? 'bg-[#FF7F7F]/10 text-[#FF7F7F]' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium">@{agent.name}</div>
                  <div className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">
                    Tab
                  </div>
                </div>
                <div className="text-xs text-gray-500 truncate">{agent.description}</div>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Deep Analysis Sidebar */}
      <DeepAnalysisSidebar
        isOpen={chatInput.showDeepAnalysisSidebar}
        onClose={() => chatInput.setShowDeepAnalysisSidebar(false)}
        sessionId={chatInput.sessionId || undefined}
        userId={props.userId}
      />

      {/* Excel Upload Dialog */}
      <ExcelUploadDialog
        isOpen={chatInput.showExcelDialog}
        onClose={async () => {
          chatInput.setShowExcelDialog(false)
          try {
            await chatInput.handleRestoreDefaultDataset()
          } catch (_) {}
        }}
        sheets={chatInput.excelSheets}
        fileName={chatInput.excelFileName}
        onConfirm={chatInput.handleExcelConfirmUpload}
        isSubmitting={chatInput.isExcelSubmitting}
        sessionId={chatInput.sessionId || ''}
      />

      {/* CSV Upload Dialog */}
      <CSVUploadDialog
        isOpen={chatInput.showCSVDialog}
        onClose={async () => {
          chatInput.setShowCSVDialog(false)
          try {
            await chatInput.handleRestoreDefaultDataset()
          } catch (_) {}
        }}
        fileName={chatInput.csvFileName}
        filePreview={chatInput.csvPreview || undefined}
        onConfirm={(name, description, fillNulls, convertTypes, columns) =>
          chatInput.handleCSVConfirmUpload(name, description, fillNulls, convertTypes, columns)
        }
        isSubmitting={chatInput.isCSVSubmitting}
        sessionId={chatInput.sessionId || ''}
        onDescriptionUpdate={(description) => chatInput.updateDatasetDescription(description)}
      />

      {/* Upload Summary Dialog - shows after successful upload */}
      <UploadSummaryDialog
        isOpen={chatInput.showUploadSummary}
        onClose={() => chatInput.setShowUploadSummary(false)}
        uploadData={{
          fileName: chatInput.fileUpload?.file.name || '',
          datasetName: chatInput.datasetDescription.name,
          description: chatInput.datasetDescription.description,
          selectedSheets: chatInput.fileUpload?.selectedSheets || [],
          isExcel: chatInput.fileUpload?.isExcel || false
        }}
        onRestoreDefault={chatInput.handleRestoreDefaultDataset}
      />

      {/* Default Dataset Upload Dialog - show dialog instead of preview */}
      <CSVUploadDialog
        isOpen={chatInput.showPreview && !chatInput.fileUpload}
        onClose={() => chatInput.setShowPreview(false)}
        fileName="Default Dataset"
        filePreview={chatInput.filePreview || undefined}
        onConfirm={(name, description, fillNulls, convertTypes, columns) => {
          // Optionally forward to handler if you want to upload default preview as dataset too
          // chatInput.handleCSVConfirmUpload(name, description, fillNulls, convertTypes, columns)
          chatInput.setDatasetDescription({ name, description })
          chatInput.setShowPreview(false)
          chatInput.setUploadSuccess(true)
          setTimeout(() => chatInput.setUploadSuccess(false), 3000)
        }}
        isSubmitting={false}
        sessionId={chatInput.sessionId || ''}
      />
    </div>
  )
})

ChatInput.displayName = "ChatInput"

export default React.memo(ChatInput)