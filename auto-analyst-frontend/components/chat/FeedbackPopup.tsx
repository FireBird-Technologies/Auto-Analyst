"use client"

import React, { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import { Label } from '../ui/label'
import { RadioGroup, RadioGroupItem } from '../ui/radio-group'
import { Upload, X, Check, AlertCircle, Loader2 } from 'lucide-react'
import axios from 'axios'
import API_URL from '@/config/api'

interface FeedbackPopupProps {
  isOpen: boolean
  onClose: () => void
}

interface FeedbackData {
  type: 'suggestion' | 'bug'
  message: string
  images: File[]
}

const FeedbackPopup = ({ isOpen, onClose }: FeedbackPopupProps) => {
  const [feedbackType, setFeedbackType] = useState<"suggestion" | "bug">("suggestion")
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [images, setImages] = useState<File[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    const validFiles = files.filter(file => {
      if (file.size > 5 * 1024 * 1024) { // 5MB limit
        alert(`File ${file.name} is too large. Maximum size is 5MB.`)
        return false
      }
      if (!file.type.startsWith('image/')) {
        alert(`File ${file.name} is not an image.`)
        return false
      }
      return true
    })

    if (images.length + validFiles.length > 5) {
      alert('Maximum 5 images allowed.')
      return
    }

    setImages(prev => [...prev, ...validFiles])
  }

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!feedbackMessage.trim()) return

    setIsSubmitting(true)
    setError('')

    try {
      const formData = new FormData()
      formData.append('type', feedbackType)
      formData.append('message', feedbackMessage.trim())
      
      images.forEach((image, index) => {
        formData.append(`image_${index}`, image)
      })

      const response = await axios.post(`${API_URL}/feedback`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      })

      if (response.status === 200) {
        setIsSuccess(true)
        setFeedbackMessage('')
        setImages([])
        setFeedbackType('suggestion')
        
        // Close popup after 2 seconds
        setTimeout(() => {
          setIsSuccess(false)
          onClose()
        }, 2000)
      }
    } catch (err: any) {
      console.error('Error submitting feedback:', err)
      setError(err.response?.data?.detail || 'Failed to submit feedback. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl text-gray-800">Send Feedback</DialogTitle>
          <div className="bg-gradient-to-r from-[#FF7F7F]/10 to-[#FF6666]/10 border border-[#FF7F7F]/20 rounded-lg p-3 mt-2">
            <p className="text-sm text-gray-700">
              <span className="font-semibold text-[#FF7F7F]">🎉 Special Offer:</span> If you suggest an improvement or specify a bug that our team acts on, we will give you a <span className="font-bold text-[#FF7F7F]">20% discount</span> on the paid plan!
            </p>
          </div>
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
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center hover:border-[#FF7F7F] transition-colors">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="mb-2"
              >
                <Upload className="w-4 h-4 mr-2" />
                Upload Images
              </Button>
              <p className="text-sm text-gray-500">
                Drag and drop images here, or click to select
              </p>
            </div>
            
            {/* Display uploaded images */}
            {images.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                {images.map((image, index) => (
                  <div key={index} className="relative">
                    <img
                      src={URL.createObjectURL(image)}
                      alt={`Upload ${index + 1}`}
                      className="w-full h-20 object-cover rounded border"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(index)}
                      className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Error message */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {/* Success message */}
          <AnimatePresence>
            {isSuccess && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700"
              >
                <Check className="w-4 h-4" />
                <span className="text-sm">Feedback submitted successfully! Thank you for your input.</span>
              </motion.div>
            )}
          </AnimatePresence>
          
          {/* Submit button */}
          <div className="flex justify-end gap-2 pt-2">
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
              disabled={isSubmitting || !feedbackMessage.trim()}
              className="bg-[#FF7F7F] hover:bg-[#FF6666] text-white"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                'Submit Feedback'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default FeedbackPopup
