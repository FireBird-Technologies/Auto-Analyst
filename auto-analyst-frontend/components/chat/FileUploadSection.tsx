import React from 'react'
import { X, Loader2, CheckCircle2, XCircle, FileText } from 'lucide-react'
import { Button } from "../ui/button"
import { FileUpload } from '@/types/chatInput.types'

interface FileUploadSectionProps {
  fileUpload: FileUpload | null
  fileInputRef: React.RefObject<HTMLInputElement>
  onFileSelect: (file: File) => void
  onRemoveFile: () => void
  disabled?: boolean
  onShowExcelDialog?: (file: File) => void
}

export const FileUploadSection: React.FC<FileUploadSectionProps> = ({
  fileUpload,
  fileInputRef,
  onFileSelect,
  onRemoveFile,
  disabled,
  onShowExcelDialog
}) => {
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls')
      
      if (isExcel && onShowExcelDialog) {
        onShowExcelDialog(file)
      } else {
        onFileSelect(file)
      }
    }
  }

  if (!fileUpload) return null

  return (
    <div className="px-4 py-2 bg-blue-50 border-b border-blue-100">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 p-3 bg-white rounded-xl border border-blue-200 shadow-sm">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".csv,.xlsx,.xls"
            className="hidden"
            disabled={disabled}
          />
          
          <div className="flex items-center justify-center w-8 h-8 bg-blue-100 rounded-lg">
            <FileText className="w-4 h-4 text-blue-600" />
          </div>
          
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {fileUpload.file.name}
            </p>
            <p className="text-xs text-gray-500">
              {(fileUpload.file.size / 1024).toFixed(1)} KB • {fileUpload.status}
            </p>
          </div>
          
          <div className="flex items-center gap-2">
            {fileUpload.status === 'uploading' && (
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            )}
            
            {fileUpload.status === 'success' && (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            )}
            
            {fileUpload.status === 'error' && (
              <XCircle className="h-4 w-4 text-red-500" />
            )}
            
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemoveFile}
              className="h-8 w-8 p-0 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}