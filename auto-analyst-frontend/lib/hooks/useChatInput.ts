import { useState, useEffect, useRef } from 'react'
import { useSession } from "next-auth/react"
import { useSessionStore } from '@/lib/store/sessionStore'
import { useCredits } from '@/lib/contexts/credit-context'
import { ChatInputProps, FileUpload, FilePreview, DatasetDescription, ErrorNotification } from '@/types/chatInput.types'
import axios from 'axios'
import API_URL from '@/config/api'
import logger from '@/lib/utils/logger'
import { SessionRecovery } from '@/lib/utils/sessionRecovery';
import { toast } from '@/components/ui/use-toast'

const PREVIEW_API_URL = API_URL;
const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

export const useChatInput = (props: ChatInputProps) => {
  // State management
  const [message, setMessage] = useState("")
  const [fileUpload, setFileUpload] = useState<FileUpload | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showHint, setShowHint] = useState(false)
  const [input, setInput] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { data: session, status } = useSession()
  const [showPreview, setShowPreview] = useState(false)
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null)
  const [datasetDescription, setDatasetDescription] = useState<DatasetDescription>({
    name: '',
    description: '',
  });
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const { sessionId, setSessionId, clearSessionId } = useSessionStore()
  const { remainingCredits, isChatBlocked, creditResetDate, checkCredits } = useCredits()
  const [showCreditInfo, setShowCreditInfo] = useState(false)
  const [datasetMismatch, setDatasetMismatch] = useState(false)
  const popupShownForChatIdsRef = useRef<Set<number>>(new Set());
  const [descriptionTab, setDescriptionTab] = useState<"edit" | "preview">("edit")
  const [errorNotification, setErrorNotification] = useState<ErrorNotification | null>(null);
  const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);
  const [showUploadSummary, setShowUploadSummary] = useState(false)

  // Excel-specific states
  const [showExcelDialog, setShowExcelDialog] = useState(false)
  const [excelSheets, setExcelSheets] = useState<string[]>([])
  const [excelFileName, setExcelFileName] = useState('')
  const [isExcelSubmitting, setIsExcelSubmitting] = useState(false)

  // CSV-specific states
  const [showCSVDialog, setShowCSVDialog] = useState(false)
  const [csvFileName, setCSVFileName] = useState('')
  const [csvPreview, setCSVPreview] = useState<FilePreview | null>(null)
  const [isCSVSubmitting, setIsCSVSubmitting] = useState(false)

  // Deep Analysis states
  const [showDeepAnalysisSidebar, setShowDeepAnalysisSidebar] = useState(false)
  const [showTemplatesSidebar, setShowTemplatesSidebar] = useState(false)
  const [showCreditExhaustedModal, setShowCreditExhaustedModal] = useState(false)

  // Add a ref to prevent multiple initializations
  const sessionInitialized = useRef(false)
  const lastUserId = useRef<string | null>(null)

  // Initialize session ID ONLY after user logs in and send to backend
  useEffect(() => {
    // Wait for authentication status to be determined
    if (status === 'loading') return

    const currentUserId = session?.user?.id || null
    
    // If user ID changed (login/logout), reset session initialization
    if (currentUserId !== lastUserId.current) {
      sessionInitialized.current = false
      lastUserId.current = currentUserId
    }

    // Skip if already initialized for this user
    if (sessionInitialized.current) return

    if (session?.user?.id) {
      const initializeSession = async () => {
        try {
          // Add this check to be extra safe
          if (!session.user.id) {
            console.error('❌ No user ID available for session initialization')
            return
          }
          
          // User is logged in - generate user-specific session ID
          const userSessionId = `user_${session.user.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
          console.log(`🔐 User logged in - generating new session ID: ${userSessionId}`)
          
          // Set sessionId in frontend first
          setSessionId(userSessionId)
          SessionRecovery.storeSessionId(userSessionId)

          // Store current user data in localStorage for the interceptor
          localStorage.setItem('current-user-data', JSON.stringify({
            user_id: parseInt(session.user.id),
            user_email: session.user.email || '',
            user_name: session.user.name || ''
          }))

          // Send to backend to initialize session
          console.log('�� Sending session to backend...')
          const response = await axios.post(`${API_URL}/initialize-session`, {
            session_id: userSessionId,
            user_id: session.user.id ? parseInt(session.user.id) : 0,
            user_email: session.user.email || '',
            user_name: session.user.name || ''
          }, {
            headers: {
              'X-Session-ID': userSessionId,
              'Content-Type': 'application/json'
            }
          })
          
          console.log('✅ Backend session initialized:', response.data)
          sessionInitialized.current = true
          
        } catch (error) {
          console.error('❌ Failed to initialize session on backend:', error)
          sessionInitialized.current = true
        }
      }
      
      initializeSession()
    }
    // NO session ID for anonymous users - they must log in first
  }, [session, status, setSessionId])

  // Clear session when user logs out
  useEffect(() => {
    if (status === 'unauthenticated' && sessionInitialized.current) {
      console.log('🚪 User logged out - clearing session')
      clearSessionId()
      SessionRecovery.clearStoredSessionId()
      sessionInitialized.current = false
      lastUserId.current = null
    }
  }, [status, clearSessionId])

  // Add cleanup effect to store session ID when it changes
  useEffect(() => {
    if (sessionId && sessionId.length > 0) {
      // Store in localStorage for persistence across browser sessions
      localStorage.setItem('auto-analyst-session-id', sessionId)
      // Store in sessionStorage for current browser session
      sessionStorage.setItem('auto-analyst-session-id', sessionId)
    }
  }, [sessionId])

  // Clean up any old anonymous sessions on app start
  useEffect(() => {
    const currentSessionId = localStorage.getItem('auto-analyst-session-id');
    if (currentSessionId && (currentSessionId.startsWith('anon_') || currentSessionId.startsWith('temp_'))) {
      localStorage.removeItem('auto-analyst-session-id');
      sessionStorage.removeItem('auto-analyst-session-id');
      clearSessionId();
      console.log('🧹 Cleaned up old anonymous session:', currentSessionId);
    }
  }, []); // Run once on mount

  useEffect(() => {
    if (errorNotification) {
      toast({
        title: errorNotification.message || 'Upload Failed',
        description: errorNotification.details || 'An error occurred while uploading your file.',
        variant: 'destructive',
        duration: 7000,
      })
    }
  }, [errorNotification])

  // Helper function to safely update session ID (with persistence)
  const updateSessionIdSafely = (newSessionId: string) => {
    if (newSessionId && newSessionId !== sessionId) {
      console.log(`Session ID update: ${sessionId} -> ${newSessionId}`)
      setSessionId(newSessionId)
      
      // Immediately persist the new session ID
      localStorage.setItem('auto-analyst-session-id', newSessionId)
      sessionStorage.setItem('auto-analyst-session-id', newSessionId)
    }
  }

  // Helper function to get headers with session ID
  const getHeaders = (additionalHeaders: Record<string, string> = {}) => {
    return {
      ...additionalHeaders,
      ...(sessionId && { 'X-Session-ID': sessionId }),
    }
  }

  // Helper function to get error messages
  const getErrorMessage = (error: any): string => {
    if (axios.isAxiosError(error)) {
      return error.response?.data?.detail || error.response?.data?.message || error.message
    }
    return error.message || 'Unknown error occurred'
  }

  // Handler functions
  const handleSendMessage = () => {
    if (message.trim() && !props.disabled && !props.isLoading) {
      props.onSendMessage(message)
      setMessage("")
    }
  }

  const handleFileUpload = async (file: File) => {
    const isCSV = file.name.toLowerCase().endsWith('.csv')
    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls')
    
    // Enforce 5MB client-side size limit
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      const humanLimit = '5MB'
      const actualSizeMb = (file.size / (1024 * 1024)).toFixed(2)
      toast({
        title: 'File too large',
        description: `The selected file is ${actualSizeMb}MB. Maximum allowed size is ${humanLimit}.`,
        variant: 'destructive',
        duration: 7000,
      })
      setFileUpload({
        file,
        status: 'error',
        isExcel: isExcel,
        selectedSheets: [],
        errorMessage: `File size exceeds ${humanLimit} limit.`
      })
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      return
    }
    // If there is an existing custom dataset, reset session before new upload to erase previous
    try {
      await axios.post(`${PREVIEW_API_URL}/reset-session`, {}, { headers: getHeaders() })
      // Clear local upload state and any cached preview
      setFileUpload(null)
      setCSVPreview(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (e) {
      // Non-blocking: continue even if reset fails
    }

    if (isCSV) {
      // Handle CSV files - preview first, then show dialog
      try {
        setCSVFileName(file.name)
        console.log('Setting status to uploading for:', file.name)
        setFileUpload({ 
          file, 
          status: 'uploading', 
          isExcel: false,
          selectedSheets: []
        })

        // Step 1: Upload for preview only (non-destructive)
        const previewFormData = new FormData()
        previewFormData.append('file', file)
        previewFormData.append('name', file.name.replace(/\.csv$/i, ''))

        console.log('Starting CSV preview upload...')
        const previewResponse = await axios.post(`${PREVIEW_API_URL}/preview-csv-upload`, previewFormData, {
          headers: getHeaders(),
        })
        console.log('CSV preview upload completed')

        // Update session ID if backend generated a new one
        if (previewResponse.data && previewResponse.data.session_id) {
          updateSessionIdSafely(previewResponse.data.session_id)
        }

        const preview = {
          headers: previewResponse.data.headers || [],
          rows: previewResponse.data.rows || [],
          name: previewResponse.data.name || file.name.replace(/\.csv$/i, ''),
          description: `CSV data from ${file.name}` // Basic description to start
        }

        setCSVPreview(preview)
        setFileUpload({ 
          file, 
          status: 'success', 
          preview: preview,
          isExcel: false,
          selectedSheets: []
        })
        
        // Show the Dataset Preview dialog
        setShowCSVDialog(true)
        
      } catch (error) {
        console.error('CSV upload error:', error)
        setFileUpload({ 
          file, 
          status: 'error', 
          isExcel: false,
          selectedSheets: [],
          errorMessage: getErrorMessage(error) || 'Failed to upload CSV file. Please try again.'
        })
        setErrorNotification({
          message: 'CSV Upload Failed',
          details: getErrorMessage(error) || 'There was an error processing your CSV file.'
        })
        toast({
          title: 'CSV Upload Failed',
          description: getErrorMessage(error) || 'There was an error processing your CSV file.',
          variant: 'destructive',
          duration: 7000,
        })
        try {
          await handleRestoreDefaultDataset()
        } catch (_) {}
      }
    } else if (isExcel) {
      // Handle Excel files - existing logic
      await handleExcelFileSelected(file)
    } else {
      // Invalid file type
      setFileUpload({
        file,
        status: 'error',
        isExcel: false,
        selectedSheets: [],
        errorMessage: 'Please upload a CSV or Excel file only'
      })
      setErrorNotification({
        message: 'Invalid file format',
        details: 'Please upload a CSV or Excel file only. Other file formats are not supported.'
      })
    }
  }

  const handleRemoveFile = () => {
    setFileUpload(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  // ADD MISSING FUNCTION: handleExcelFileSelected
  const handleExcelFileSelected = async (file: File) => {
    try {
      setExcelFileName(file.name)
      setFileUpload({ 
        file, 
        status: 'uploading', // Changed from 'loading' to match type
        isExcel: true,
        selectedSheets: []
      })

      const formData = new FormData()
      formData.append('file', file)

      const response = await axios.post(`${PREVIEW_API_URL}/api/excel-sheets`, formData, {
        headers: getHeaders(),
      })

      // Update session ID if backend generated a new one
      if (response.data && response.data.session_id) {
        updateSessionIdSafely(response.data.session_id)
      }

      const sheets: string[] = Array.isArray(response.data?.sheets) ? response.data.sheets : []
      if (!sheets.length) throw new Error('No sheets found in Excel file')

      setExcelSheets(sheets)
      setDatasetDescription(prev => ({
        ...prev,
        name: file.name.replace(/\.(xlsx|xls)$/i, ''),
        description: prev.description || `Excel data from ${file.name}`
      }))
      setFileUpload(prev => (prev ? { ...prev, status: 'success', sheets } : null))
      setShowExcelDialog(true)
    } catch (error: any) {
      console.error('Error processing Excel file:', error)
      setFileUpload(prev =>
        prev ? { ...prev, status: 'error', errorMessage: error?.message || 'Failed to read Excel file' } : null
      )
      setErrorNotification({
        message: 'Excel processing failed',
        details: error?.message || 'Failed to read Excel file'
      });
      toast({
        title: 'Excel processing failed',
        description: error?.message || 'Failed to read Excel file',
        variant: 'destructive',
        duration: 7000,
      })
    }
  }

  const handlePreviewDefaultDataset = async () => {
    try {
      setFileUpload(null);
      localStorage.removeItem('lastUploadedFile');
      
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      
      popupShownForChatIdsRef.current = new Set();
      
      // DON'T reset session for default dataset preview - just get the data
      const response = await axios.get(`${PREVIEW_API_URL}/api/default-dataset`, {
        headers: getHeaders(),
      });
      
      // Update session ID if backend generated a new one
      if (response.data && response.data.session_id) {
        updateSessionIdSafely(response.data.session_id)
      }

      const defaultDescription = response.data.description || 'Default housing dataset containing information about residential properties';
      
      setFilePreview({
        headers: response.data.headers,
        rows: response.data.rows,
        name: response.data.name,
        description: defaultDescription
      });
      
      setDatasetDescription({
        name: response.data.name || 'Dataset',
        description: defaultDescription
      });
      
      setShowPreview(true);
      
      setDatasetMismatch(false);
    } catch (error) {
      console.error('Error loading default dataset:', error);
    }
  }

  const handleSilentDefaultDataset = async () => {
    try {
      setFileUpload(null);
      localStorage.removeItem('lastUploadedFile');
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      
      popupShownForChatIdsRef.current = new Set();
      
      // DON'T reset session for silent default dataset - just get the data
      const response = await axios.get(`${PREVIEW_API_URL}/api/default-dataset`, {
        headers: getHeaders(),
      });
      
      // Update session ID if backend generated a new one
      if (response.data && response.data.session_id) {
        updateSessionIdSafely(response.data.session_id)
      }

      const defaultDescription = response.data.description || 'Default housing dataset containing information about residential properties';
      
      setFilePreview({
        headers: response.data.headers,
        rows: response.data.rows,
        name: response.data.name,
        description: defaultDescription
      });
      
      setDatasetDescription({
        name: response.data.name || 'Dataset',
        description: defaultDescription
      });
      
      setDatasetMismatch(false);
    } catch (error) {
      console.error('Error loading default dataset:', error);
    }
  }

  const handleExcelConfirmUpload = async (selectedSheets: string[], name: string, description: string) => {
    if (!fileUpload?.file) return
    
    setIsExcelSubmitting(true)
    
    try {
      // Only reset session if we're uploading a new custom dataset
      if (sessionId) {
        try {
          const response = await axios.post(`${PREVIEW_API_URL}/reset-session`, null, {
            headers: getHeaders(),
          })
          
          // Update session ID if backend generated a new one
          if (response.data && response.data.session_id) {
            updateSessionIdSafely(response.data.session_id)
          }
        } catch (resetError) {
          console.warn('Session reset failed, continuing with upload:', resetError);
        }
      }

      const formData = new FormData()
      formData.append('file', fileUpload.file)
      formData.append('name', name)
      formData.append('description', description)
      formData.append('selected_sheets', JSON.stringify(selectedSheets))

      const response = await axios.post(`${PREVIEW_API_URL}/upload_excel`, formData, {
        headers: getHeaders(), // Remove { 'X-Force-Refresh': 'true' }
      })

      // Update session ID if backend generated a new one
      if (response.data && response.data.session_id) {
        updateSessionIdSafely(response.data.session_id)
      }

      if (response.status === 200) {
        // Only update session ID if it's provided and different
        if (response.data.session_id) {
          updateSessionIdSafely(response.data.session_id);
        }
        
        // Update file upload state with selected sheets
        setFileUpload(prev => prev ? { 
          ...prev, 
          status: 'success', 
          sheets: response.data.sheets_processed || selectedSheets,
          selectedSheets: selectedSheets
        } : null)
        
        setDatasetDescription({ name, description })
        setUploadSuccess(true)
        setShowExcelDialog(false)
        
        // Show upload summary after successful upload
        setTimeout(() => {
          setShowUploadSummary(true)
          setUploadSuccess(false)
        }, 500)
      }
    } catch (error) {
      console.error('Excel upload failed:', error);
      setErrorNotification({ 
        message: 'Excel Upload Failed', 
        details: getErrorMessage(error) || 'Failed to process Excel file. Please check the file format and try again.',
      })
      setFileUpload(prev => prev ? { 
        ...prev, 
        status: 'error', 
        errorMessage: getErrorMessage(error) || 'Excel upload failed. Please try again.'
      } : null)
      toast({
        title: 'Excel Upload Failed',
        description: getErrorMessage(error) || 'Failed to process Excel file. Please check the file format and try again.',
        variant: 'destructive',
        duration: 7000,
      })
      
      // Automatically restore default dataset on failure
      await handleRestoreDefaultDataset()
    } finally {
      setIsExcelSubmitting(false)
    }
  }

  // CSV confirm upload handler
  const handleCSVConfirmUpload = async (
    name: string,
    description: string,
    fillNulls: boolean,
    convertTypes: boolean,
    columns: string[]
  ) => {
    try {
      setIsCSVSubmitting(true)
      
      console.log('🚀 CSV Upload Started:', {
        name,
        description,
        fillNulls,
        convertTypes,
        selectedColumns: columns,
        selectedCount: columns?.length || 0,
        totalHeaders: csvPreview?.headers?.length || 0,
        allHeaders: csvPreview?.headers || []
      })
      
      if (!fileUpload?.file) return
      
      // Step 3: Final upload with user's name and description
      const uploadFormData = new FormData()
      uploadFormData.append('file', fileUpload.file)
      uploadFormData.append('name', name)
      uploadFormData.append('description', description)

      // Append preprocessing options
      uploadFormData.append('fill_nulls', String(fillNulls))
      uploadFormData.append('convert_types', String(convertTypes))

      // Append selected columns (repeat field for list semantics)
      const colsToSend = (columns && columns.length > 0)
        ? columns
        : (csvPreview?.headers || [])
      
      console.log('📋 Columns being sent to backend:', colsToSend)
      colsToSend.forEach(col => uploadFormData.append('columns', col))

      console.log('Starting final CSV upload...')
      const uploadResponse = await axios.post(`${PREVIEW_API_URL}/upload_dataframe`, uploadFormData, {
        headers: getHeaders(),
      })
      console.log('Final CSV upload completed')
      
      // Update session ID if backend generated a new one
      if (uploadResponse.data && uploadResponse.data.session_id) {
        updateSessionIdSafely(uploadResponse.data.session_id)
      }

      if (uploadResponse.data) {
        // Update local state
        setDatasetDescription({ name, description })
        setUploadSuccess(true)
        setShowCSVDialog(false)
        
        // Show upload summary after successful upload
        // The description will be automatically updated by the background generation callback
        setTimeout(() => {
          setShowUploadSummary(true)
          setUploadSuccess(false)
        }, 1000)
      }
    } catch (error) {
      console.error('CSV confirm upload error:', error)
      
      setErrorNotification({
        message: 'Dataset Upload Failed',
        details: getErrorMessage(error) || 'Failed to upload your dataset. Please try again.',
      })
      
      if (fileUpload?.file) {
        setFileUpload({ 
          file: fileUpload.file, 
          status: 'error', 
          isExcel: false,
          selectedSheets: [],
          errorMessage: getErrorMessage(error) || 'Upload failed. Please try again.'
        })
      }
      toast({
        title: 'Dataset Upload Failed',
        description: getErrorMessage(error) || 'Failed to upload your dataset. Please try again.',
        variant: 'destructive',
        duration: 7000,
      })
      try {
        await handleRestoreDefaultDataset()
      } catch (_) {}
    } finally {
      setIsCSVSubmitting(false)
    }
  }

  // Update dataset description (for background generation)
  const updateDatasetDescription = (newDescription: string) => {
    setDatasetDescription(prev => ({
      ...prev,
      description: newDescription
    }))
    console.log('📋 Dataset description updated from background generation')
  }

  // File preview handler for CSV
  const handleFilePreview = async (file: File, isNewDataset = false) => {
    try {
      const formData = new FormData()
      formData.append('file', file)
      
      const response = await axios.post(`${PREVIEW_API_URL}/upload_csv_preview`, formData, {
        headers: getHeaders(),
      })
      
      // Update session ID if backend generated a new one
      if (response.data && response.data.session_id) {
        updateSessionIdSafely(response.data.session_id)
      }

      if (response.data) {
        const { headers, rows, name, description } = response.data
        const fileName = name || file.name.replace('.csv', '')
        const fileDesc = description || 'Please describe what this dataset contains and its purpose'
        
        setCSVPreview({ 
          headers, 
          rows, 
          name: fileName,
          description: fileDesc
        })
        
        setDatasetDescription({ 
          name: fileName, 
          description: fileDesc
        })
      }
    } catch (error) {
      console.error('Error previewing file:', error)
      throw error
    }
  }

  // Add restore default dataset function
  const handleRestoreDefaultDataset = async () => {
    try {
      const response = await axios.post(`${PREVIEW_API_URL}/reset-session`, {}, {
        headers: getHeaders(),
      })
      
      // Update session ID if backend generated a new one
      if (response.data && response.data.session_id) {
        updateSessionIdSafely(response.data.session_id)
      }
      
      if (response.status === 200) {
        // Clear any error states
        setFileUpload(null)
        setErrorNotification(null)
        setUploadSuccess(false)
        
        // Show success message
        setUploadSuccess(true)
        setTimeout(() => setUploadSuccess(false), 3000)
        
        // Update session ID if provided
        if (response.data.session_id) {
          updateSessionIdSafely(response.data.session_id)
        }
      }
    } catch (error) {
      console.error('Failed to restore default dataset:', error)
      setErrorNotification({
        message: 'Failed to restore default dataset',
        details: getErrorMessage(error)
      })
    }
  }

  // Return all state and handlers
  return {
    // State
    message,
    setMessage,
    fileUpload,
    setFileUpload,
    showPreview,
    setShowPreview,
    filePreview,
    setFilePreview,
    datasetDescription,
    setDatasetDescription,
    uploadSuccess,
    setUploadSuccess,
    sessionId,
    setSessionId,
    remainingCredits,
    isChatBlocked,
    showCreditInfo,
    setShowCreditInfo,
    datasetMismatch,
    setDatasetMismatch,
    descriptionTab,
    setDescriptionTab,
    errorNotification,
    setErrorNotification,
    isGeneratingDescription,
    setIsGeneratingDescription,
    showExcelDialog,
    setShowExcelDialog,
    excelSheets,
    setExcelSheets,
    excelFileName,
    setExcelFileName,
    isExcelSubmitting,
    setIsExcelSubmitting,
    showDeepAnalysisSidebar,
    setShowDeepAnalysisSidebar,
    showTemplatesSidebar,
    setShowTemplatesSidebar,
    showCreditExhaustedModal,
    setShowCreditExhaustedModal,
    showUploadSummary,
    setShowUploadSummary,
    showCSVDialog,
    setShowCSVDialog,
    csvFileName,
    setCSVFileName,
    csvPreview,
    setCSVPreview,
    isCSVSubmitting,
    setIsCSVSubmitting,
    
    // Refs
    fileInputRef,
    inputRef,
    popupShownForChatIdsRef,
    errorTimeoutRef,
    
    // Handlers
    handleSendMessage,
    handleFileUpload,
    handleRemoveFile,
    handlePreviewDefaultDataset,
    handleSilentDefaultDataset,
    handleExcelFileSelected, // ADDED THIS MISSING HANDLER
    handleExcelConfirmUpload,
    handleCSVConfirmUpload,
    handleFilePreview,
    updateDatasetDescription,
    clearSessionId, // Add this new function
    handleRestoreDefaultDataset,
    
    // Props
    ...props
  }
}




