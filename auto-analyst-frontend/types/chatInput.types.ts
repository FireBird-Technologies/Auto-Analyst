// Move all interfaces and types here
export interface FileUpload {
  file: File
  status: 'uploading' | 'success' | 'error'
  isExcel: boolean
  selectedSheets: string[]
  sheets?: string[]
  selectedSheet?: string
  errorMessage?: string
  preview?: FilePreview // Add preview data to FileUpload
}

export interface AgentSuggestion {
  name: string
  description: string
}

export interface FilePreview {
  headers: string[];
  rows: string[][];
  name: string;
  description: string;
}

export interface DatasetDescription {
  name: string;
  description: string;
}

export interface ChatInputProps {
  onSendMessage: (message: string) => void
  onFileUpload: (file: File) => void
  disabled?: boolean
  isLoading?: boolean
  onStopGeneration?: () => void
  chatId?: number | null
  userId?: number | null
}

export interface DatasetUploadStats {
  upload_id: number;
  status: string;
  file_size: number;
  row_count?: number;
  column_count?: number;
  processing_time_ms?: number;
  error_message?: string;
  error_details?: any;
}

export interface ChatInputRef {
  handlePreviewDefaultDataset: () => void;
  handleSilentDefaultDataset: () => void;
}

export interface ErrorNotification {
  message: string;
  details: string;
}
