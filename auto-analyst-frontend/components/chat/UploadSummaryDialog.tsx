import React, { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { FileText, BarChart3, CheckCircle2, FileSpreadsheet, ChevronDown, ChevronUp } from "lucide-react"

interface UploadSummaryDialogProps {
  isOpen: boolean
  onClose: () => void
  uploadData: {
    fileName: string
    datasetName: string
    description: string
    selectedSheets: string[]
    isExcel: boolean
  }
  onRestoreDefault?: () => void
}

export default function UploadSummaryDialog({
  isOpen,
  onClose,
  uploadData,
  onRestoreDefault
}: UploadSummaryDialogProps) {
  const { fileName, datasetName, description, selectedSheets, isExcel } = uploadData
  const [showFullDescription, setShowFullDescription] = useState(false)
  
  // Truncate description to first 150 characters
  const truncatedDescription = description.length > 150 
    ? description.substring(0, 150) + "..." 
    : description

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            Upload Summary
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Success Message */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <span className="font-medium text-green-900">Upload Successful!</span>
            </div>
            <p className="text-green-700 text-sm">
              Your {isExcel ? 'Excel' : 'CSV'} file has been processed and is ready for analysis.
            </p>
          </div>

          {/* File Information */}
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
              {isExcel ? (
                <FileSpreadsheet className="w-5 h-5 text-[#FF7F7F] mt-0.5" />
              ) : (
                <FileText className="w-5 h-5 text-[#FF7F7F] mt-0.5" />
              )}
              <div className="flex-1">
                <h3 className="font-medium text-gray-900 mb-1">File Details</h3>
                <div className="space-y-1 text-sm text-gray-600">
                  <p><span className="font-medium">Original File:</span> {fileName}</p>
                  <p><span className="font-medium">Dataset Name:</span> {datasetName}</p>
                </div>
              </div>
            </div>

            {/* Excel Sheets (if applicable) */}
            {isExcel && selectedSheets.length > 0 && (
              <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-lg">
                <BarChart3 className="w-5 h-5 text-blue-600 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-medium text-blue-900 mb-2">Selected Sheets</h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedSheets.map((sheet: string, index: number) => (
                      <span
                        key={index}
                        className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                      >
                        {sheet}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Description */}
            <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
              <FileText className="w-5 h-5 text-gray-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-medium text-gray-900 mb-1">Description</h3>
                <div 
                  className={`text-sm text-gray-600 whitespace-pre-wrap ${
                    showFullDescription 
                      ? 'max-h-[200px] overflow-y-auto pr-2' 
                      : ''
                  }`}
                >
                  {showFullDescription ? description : truncatedDescription}
                </div>
                {description.length > 150 && (
                  <button
                    onClick={() => setShowFullDescription(!showFullDescription)}
                    className="flex items-center gap-1 text-xs text-[#FF7F7F] hover:text-[#FF6666] mt-2 transition-colors"
                  >
                    {showFullDescription ? (
                      <>
                        <ChevronUp className="w-3 h-3" />
                        Show Less
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-3 h-3" />
                        Show More
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-between items-center pt-4 border-t">
            <div className="flex items-center gap-2">
              {onRestoreDefault && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRestoreDefault}
                  className="text-xs h-8 px-3 hover:bg-blue-50 hover:border-blue-300"
                >
                  Restore Default Dataset
                </Button>
              )}
            </div>
            <Button
              onClick={onClose}
              className="bg-[#FF7F7F] hover:bg-[#FF6666] text-white"
            >
              Continue
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}


