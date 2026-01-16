"use client"

import { useState, useRef, useEffect } from "react"
import axios from "axios"
import { Loader2, X, Upload, Image as ImageIcon } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useSession } from "next-auth/react"
import { useSessionStore } from '@/lib/store/sessionStore'
import API_URL from '@/config/api'
import logger from '@/lib/utils/logger'
interface FeedbackPopupProps {
  isOpen: boolean
  onClose: () => void
}

interface AttachedImage {
  id: string
  file: File
  preview: string
}

interface ModelSettings {
  model_name: string;
  model_provider: string;
  temperature: number;
  max_tokens: number;
}

const FeedbackPopup = ({ isOpen, onClose }: FeedbackPopupProps) => {
  const [feedbackType, setFeedbackType] = useState<"suggestion" | "bug">("suggestion")
  const [feedbackMessage, setFeedbackMessage] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const { data: session } = useSession()
  const { sessionId } = useSessionStore()
  const [sessionInfo, setSessionInfo] = useState<any>(null)
  const [recentChats, setRecentChats] = useState<any[]>([])
  const [modelSettings, setModelSettings] = useState<ModelSettings | null>(null)

  // Fetch model settings from localStorage when the popup opens
  useEffect(() => {
    if (isOpen) {
      try {
        // Get model settings from userModelSettings in localStorage
        const userModelSettingsStr = localStorage.getItem('userModelSettings')
        
        if (userModelSettingsStr) {
          const userSettings = JSON.parse(userModelSettingsStr)
          
          // Map the userModelSettings format to our ModelSettings interface
          const settings: ModelSettings = {
            model_name: userSettings.model || process.env.DEFAULT_PUBLIC_MODEL || 'claude-opus-4-5-20251101',
            model_provider: userSettings.provider || process.env.DEFAULT_MODEL_PROVIDER || 'anthropic',
            temperature: userSettings.temperature ?? 1,
            max_tokens: userSettings.maxTokens ?? 2500
          }
          
          setModelSettings(settings)
          logger.log('Model settings retrieved from localStorage:', settings)
        } else {
          // Fallback to environment defaults
          const settings: ModelSettings = {
            model_name: process.env.DEFAULT_PUBLIC_MODEL || 'claude-opus-4-5-20251101',
            model_provider: process.env.DEFAULT_MODEL_PROVIDER || 'anthropic',
            temperature: parseFloat(process.env.DEFAULT_TEMPERATURE || '1'),
            max_tokens: parseInt(process.env.PUBLIC_DEFAULT_MAX_TOKENS || '2500')
          }
          
          setModelSettings(settings)
        }
      } catch (error) {
        console.error("Error getting model settings from localStorage:", error)
      }
    }
  }, [isOpen])

  // Fetch session info when the popup opens
  useEffect(() => {
    if (isOpen && sessionId) {
      fetchSessionInfo()
      fetchRecentChats()
    }
  }, [isOpen, sessionId])

  // Fetch session information
  const fetchSessionInfo = async () => {
    if (!sessionId) return
    
    try {
      const response = await axios.get(`${API_URL}/api/session-info`, {
        headers: {
          'X-Session-ID': sessionId,
        }
      })
      
      setSessionInfo(response.data)
    } catch (error) {
      console.error("Error fetching session info:", error)
    }
  }

  // Fetch recent chat messages
  const fetchRecentChats = async () => {
    if (!sessionId) return
    
    try {
      // Get the user ID from the session if available
      const userId = session?.user?.id || null
      
      // Fetch the latest chats from the API
      const response = await axios.get(`${API_URL}/chats`, {
        params: {
          limit: 10,
          offset: 0,
          user_id: userId
        }
      })
      
      if (response.data && Array.isArray(response.data)) {
        setRecentChats(response.data)
      }
    } catch (error) {
      console.error("Error fetching recent chats:", error)
    }
  }

  // Clean up object URLs when component unmounts or images change
  useEffect(() => {
    return () => {
      attachedImages.forEach(image => URL.revokeObjectURL(image.preview))
    }
  }, [attachedImages])

  // Set up paste event listener
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!isOpen) return
      
      const items = e.clipboardData?.items
      if (!items) return

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile()
          if (file) handleImageAdd(file)
        }
      }
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [isOpen])

  // Set up drop zone event listeners
  useEffect(() => {
    const dropZone = dropZoneRef.current
    if (!dropZone) return

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dropZone.classList.add('bg-gray-50')
    }

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dropZone.classList.remove('bg-gray-50')
    }

    const handleDrop = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dropZone.classList.remove('bg-gray-50')

      if (e.dataTransfer?.files) {
        for (let i = 0; i < e.dataTransfer.files.length; i++) {
          const file = e.dataTransfer.files[i]
          if (file.type.startsWith('image/')) {
            handleImageAdd(file)
          }
        }
      }
    }

    dropZone.addEventListener('dragover', handleDragOver)
    dropZone.addEventListener('dragleave', handleDragLeave)
    dropZone.addEventListener('drop', handleDrop)

    return () => {
      dropZone.removeEventListener('dragover', handleDragOver)
      dropZone.removeEventListener('dragleave', handleDragLeave)
      dropZone.removeEventListener('drop', handleDrop)
    }
  }, [isOpen])

  const handleImageAdd = (file: File) => {
    // Limit to 5 images
    if (attachedImages.length >= 5) {
      alert("Maximum 5 images allowed")
      return
    }

    // Limit file size to 5MB
    if (file.size > 5 * 1024 * 1024) {
      alert("Image size must be less than 5MB")
      return
    }

    const newImage: AttachedImage = {
      id: Math.random().toString(36).substring(2, 11),
      file,
      preview: URL.createObjectURL(file)
    }

    setAttachedImages(prev => [...prev, newImage])
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return

    for (let i = 0; i < e.target.files.length; i++) {
      if (e.target.files[i].type.startsWith('image/')) {
        handleImageAdd(e.target.files[i])
      }
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleRemoveImage = (id: string) => {
    setAttachedImages(prev => {
      const imageToRemove = prev.find(img => img.id === id)
      if (imageToRemove) {
        URL.revokeObjectURL(imageToRemove.preview)
      }
      return prev.filter(img => img.id !== id)
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!feedbackMessage.trim()) return

    setIsSubmitting(true)
    setSubmitError(null)

    try {
      // Create FormData to handle file uploads
      const formData = new FormData()
      formData.append('type', feedbackType)
      formData.append('message', feedbackMessage)
      
      // Append session information
      formData.append('sessionId', sessionId || '')
      formData.append('userEmail', session?.user?.email || '')
      
      // Append model settings from localStorage
      if (modelSettings) {
        formData.append('modelSettings', JSON.stringify(modelSettings))
      }
      
      // Append session info as JSON string
      if (sessionInfo) {
        formData.append('sessionInfo', JSON.stringify(sessionInfo))
      }
      
      // Append recent chats as JSON string
      if (recentChats.length > 0) {
        formData.append('recentChats', JSON.stringify(recentChats))
      }
      
      // Append images
      attachedImages.forEach((image, index) => {
        formData.append(`image${index}`, image.file)
      })
      
      await axios.post("/api/feedback", formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })
      
      setSubmitSuccess(true)
      setFeedbackMessage("")
      setAttachedImages([])
      setTimeout(() => {
        onClose()
        setSubmitSuccess(false)
      }, 2000)
    } catch (error) {
      console.error("Error submitting feedback:", error)
      setSubmitError("Failed to send feedback. Please try again later.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl text-gray-800">Send Feedback</DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4 py-3">
          <div className="space-y-2">
            <Label>Feedback Type</Label>
            <RadioGroup 
              value={feedbackType} 
              onValueChange={(value: string) => setFeedbackType(value as "suggestion" | "bug")}
              className="flex space-x-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="suggestion" id="suggestion" />
                <Label htmlFor="suggestion">Suggestion</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="bug" id="bug" />
                <Label htmlFor="bug">Bug Report</Label>
              </div>
            </RadioGroup>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="feedback-message">
              {feedbackType === "suggestion" ? "Suggestion" : "Bug Details"}
            </Label>
            <Textarea
              id="feedback-message"
              value={feedbackMessage}
              onChange={(e) => setFeedbackMessage(e.target.value)}
              placeholder={
                feedbackType === "suggestion"
                  ? "Share your ideas for improvement..."
                  : "Please describe the bug and steps to reproduce it..."
              }
              rows={6}
              className="resize-none"
              required
            />
          </div>
          
          {/* Image upload area */}
          <div className="space-y-2">
            <Label>
              Attach Images <span className="text-xs text-gray-500">(Optional, max 5)</span>
            </Label>
            
            <div 
              ref={dropZoneRef}
              className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center transition-colors"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileSelect}
                className="hidden"
                id="image-upload"
              />
              
              <label 
                htmlFor="image-upload"
                className="flex flex-col items-center justify-center cursor-pointer"
              >
                <Upload className="h-8 w-8 text-gray-400 mb-2" />
                <p className="text-sm text-gray-600 mb-1">Drop images here or click to upload</p>
                <p className="text-xs text-gray-500">You can also paste screenshots directly</p>
              </label>
            </div>
            
            {/* Image previews */}
            {attachedImages.length > 0 && (
              <div className="grid grid-cols-3 gap-3 mt-3">
                {attachedImages.map(image => (
                  <div key={image.id} className="relative group">
                    <div className="relative h-24 rounded border overflow-hidden">
                      <img 
                        src={image.preview} 
                        alt="Preview" 
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveImage(image.id)}
                      className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {submitError && (
            <div className="text-red-600 text-sm">{submitError}</div>
          )}
          
          <div className="flex justify-end space-x-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-[#FF7F7F] hover:bg-[#FF6666] text-white"
              disabled={isSubmitting || !feedbackMessage.trim()}
            >
              {isSubmitting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...</>
              ) : submitSuccess ? (
                "Sent!"
              ) : (
                <>
                  {attachedImages.length > 0 ? (
                    <><ImageIcon className="mr-2 h-4 w-4" /> Send with {attachedImages.length} image{attachedImages.length !== 1 ? 's' : ''}</>
                  ) : (
                    "Send Feedback"
                  )}
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default FeedbackPopup 