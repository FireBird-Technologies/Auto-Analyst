import React from 'react'
import { Send, Square, Paperclip } from 'lucide-react'
import { Button } from "../ui/button"
import { Textarea } from "../ui/textarea"

interface InputSectionProps {
  message: string
  setMessage: (message: string) => void
  onSendMessage: () => void
  disabled?: boolean
  isLoading?: boolean
  onStopGeneration?: () => void
  inputRef: React.RefObject<HTMLTextAreaElement>
  onFileUpload?: () => void
}

export const InputSection: React.FC<InputSectionProps> = ({
  message,
  setMessage,
  onSendMessage,
  disabled,
  isLoading,
  onStopGeneration,
  inputRef,
  onFileUpload
}) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!disabled && !isLoading && message.trim()) {
        onSendMessage()
      }
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value)
    
    // Auto-resize textarea
    const textarea = e.target
    textarea.style.height = 'auto'
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px'
  }

  return (
    <div className="flex items-end gap-3 p-4">
      {/* File attachment button */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onFileUpload}
        disabled={disabled || isLoading}
        className="text-gray-500 hover:text-pink-600 hover:bg-pink-50 transition-colors duration-200 p-2 rounded-lg flex-shrink-0"
      >
        <Paperclip className="h-5 w-5" />
      </Button>

      {/* Message input */}
      <div className="flex-1 relative">
        <Textarea
          ref={inputRef}
          value={message}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Message Auto-Analyst..."
          disabled={disabled}
          className="min-h-[44px] max-h-[200px] resize-none border-0 shadow-none focus:ring-0 focus-visible:ring-0 bg-transparent text-gray-900 placeholder-gray-500 text-base leading-6 pr-12"
          style={{ 
            fontSize: '16px',
            lineHeight: '24px',
            padding: '10px 0'
          }}
        />
        
        {/* Send/Stop button */}
        <div className="absolute right-2 bottom-2">
          {isLoading ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onStopGeneration}
              className="h-8 w-8 p-0 text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors duration-200 rounded-lg"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onSendMessage}
              disabled={disabled || !message.trim()}
              className="h-8 w-8 p-0 text-gray-500 hover:text-pink-600 hover:bg-pink-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 rounded-lg"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}