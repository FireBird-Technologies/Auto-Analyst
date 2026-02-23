import React, { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { FileText, BarChart3, Loader2 } from "lucide-react"  // Remove CheckSquare, Square

interface ExcelUploadDialogProps {
  isOpen: boolean
  onClose: () => void
  sheets: string[]
  fileName: string
  onConfirm: (selectedSheets: string[], name: string, description: string, fillNulls: boolean, convertTypes: boolean) => void
  isSubmitting: boolean
  sessionId: string
}

export default function ExcelUploadDialog({
  isOpen,
  onClose,
  sheets,
  fileName,
  onConfirm,
  isSubmitting,
  sessionId
}: ExcelUploadDialogProps) {
  const [selectedSheets, setSelectedSheets] = useState<string[]>([])
  const [datasetName, setDatasetName] = useState<string>("")
  const [description, setDescription] = useState<string>("")
  
  // Preprocessing options (default to checked)
  const [fillNulls, setFillNulls] = useState(true)
  const [convertTypes, setConvertTypes] = useState(true)

  // Initialize dataset name from filename
  useEffect(() => {
    if (sheets.length > 0 && selectedSheets.length === 0) {
      setSelectedSheets([sheets[0]]) // Auto-select first sheet
    }
    if (fileName && !datasetName) {
      const baseFileName = fileName.replace(/\.(xlsx|xls)$/i, '')
      setDatasetName(baseFileName)
    }
  }, [sheets, fileName, selectedSheets.length, datasetName])

  const handleSheetToggle = (sheetName: string) => {
    setSelectedSheets(prev => 
      prev.includes(sheetName) 
        ? prev.filter(s => s !== sheetName)
        : [...prev, sheetName]
    )
  }

  const handleConfirm = () => {
    if (selectedSheets.length > 0 && datasetName.trim() && description.trim()) {
      onConfirm(selectedSheets, datasetName.trim(), description.trim(), fillNulls, convertTypes)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Excel Upload Configuration
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Sheet selection - Updated to use Checkbox component */}
          <div className="space-y-3">
            <label className="text-sm font-medium">Select Sheets to Import</label>
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {sheets.map((sheet) => (
                <div key={sheet} className="flex items-center space-x-2">
                  <Checkbox
                    id={`sheet-${sheet}`}
                    checked={selectedSheets.includes(sheet)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedSheets(prev => [...prev, sheet])
                      } else {
                        setSelectedSheets(prev => prev.filter(s => s !== sheet))
                      }
                    }}
                  />
                  <label
                    htmlFor={`sheet-${sheet}`}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                  >
                    {sheet}
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* Dataset name */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Dataset Name</label>
            <Input
              value={datasetName}
              onChange={(e) => setDatasetName(e.target.value)}
              placeholder="Enter dataset name"
              disabled={isSubmitting}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your dataset..."
              disabled={isSubmitting}
              className="min-h-[100px] resize-none"
            />
          </div>

          {/* Preprocessing Options - Same styling as sheet selection */}
          <div className="space-y-3">
            <label className="text-sm font-medium">Preprocessing Options</label>
            
            <div className="flex items-center space-x-2">
              <Checkbox
                id="fillNulls"
                checked={fillNulls}
                onCheckedChange={(checked) => setFillNulls(checked as boolean)}
              />
              <label
                htmlFor="fillNulls"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
              >
                Fill nulls
              </label>
            </div>
            
            <div className="flex items-center space-x-2">
              <Checkbox
                id="convertTypes"
                checked={convertTypes}
                onCheckedChange={(checked) => setConvertTypes(checked as boolean)}
              />
              <label
                htmlFor="convertTypes"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
              >
                Convert types for better analysis
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 pt-4">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button 
            onClick={handleConfirm}
            disabled={isSubmitting || selectedSheets.length === 0 || !datasetName.trim() || !description.trim()}
            className="bg-[#FF7F7F] hover:bg-[#FF6666] text-white"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Uploading...
              </>
            ) : (
              'Upload'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
