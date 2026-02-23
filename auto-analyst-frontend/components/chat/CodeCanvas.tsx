"use client"

import React, { useState, useEffect, useRef, useCallback, Dispatch, SetStateAction } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism"
import { ChevronRight, Copy, Check, Play, Edit2, Save, X, Maximize2, Minimize2, Wand2, AlertTriangle, WrenchIcon, Send, Scissors, CreditCard, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import MonacoEditor, { useMonaco } from '@monaco-editor/react'
import { useToast } from "@/components/ui/use-toast"
import { useSessionStore } from '@/lib/store/sessionStore'
import axios from "axios"
import API_URL from '@/config/api'
import { Textarea } from "@/components/ui/textarea"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { useSession } from "next-auth/react"
import { useCredits } from '@/lib/contexts/credit-context'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import logger from '@/lib/utils/logger'
import CodeFixButton from './CodeFixButton'
import { useFeatureAccess } from '@/lib/hooks/useFeatureAccess'
import { useUserSubscriptionStore } from '@/lib/store/userSubscriptionStore'
import FeatureGate from '@/components/features/FeatureGate'
import { PremiumFeatureButton } from '@/components/features/FeatureGate'

interface CodeEntry {
  id: string;
  language: string;
  code: string;
  timestamp: number;
  title?: string;
  isExecuting?: boolean;
  output?: string;
  hasError?: boolean;
  messageIndex: number;
}

interface CodeCanvasProps {
  isOpen: boolean;
  onToggle: () => void;
  codeEntries: CodeEntry[];
  onCodeExecute?: (entryId: string, result: any) => void;
  chatCompleted?: boolean;
  hiddenCanvas?: boolean;
  codeFixes: Record<string, number>;
  setCodeFixes: Dispatch<SetStateAction<Record<string, number>>>;
  setCodeEntries: Dispatch<SetStateAction<CodeEntry[]>>;
}

interface SelectionPosition {
  top: number;
  left: number;
  width: number;
}

const CodeCanvas: React.FC<CodeCanvasProps> = ({ 
  isOpen, 
  onToggle, 
  codeEntries,
  onCodeExecute,
  chatCompleted = false,
  hiddenCanvas = false,
  codeFixes,
  setCodeFixes,
  setCodeEntries
}) => {
  const { toast } = useToast()
  const { sessionId } = useSessionStore()
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null)
  const [editingMap, setEditingMap] = useState<Record<string, boolean>>({})
  const [editedCodeMap, setEditedCodeMap] = useState<Record<string, string>>({})
  const [copiedMap, setCopiedMap] = useState<Record<string, boolean>>({})
  const [isMaximized, setIsMaximized] = useState(false)
  const [showAIEditField, setShowAIEditField] = useState<Record<string, boolean>>({})
  const [aiEditPrompt, setAIEditPrompt] = useState("")
  const [isAIEditing, setIsAIEditing] = useState(false)
  const [isFixingCode, setIsFixingCode] = useState(false)
  const [execOutputMap, setExecOutputMap] = useState<Record<string, {output: string, hasError: boolean}>>({})
  const [selectedText, setSelectedText] = useState<{text: string, range: any} | null>(null)
  const [selectionPosition, setSelectionPosition] = useState<SelectionPosition | null>(null)
  const monaco = useMonaco()
  const editorRef = useRef<any>(null)
  const [isCleaningCode, setIsCleaningCode] = useState(false)
  const [autoRunEnabled, setAutoRunEnabled] = useState(true)
  const previousChatCompletedRef = useRef(false)
  const { data: session } = useSession()
  const { remainingCredits, checkCredits, hasEnoughCredits } = useCredits()
  const [insufficientCreditsOpen, setInsufficientCreditsOpen] = useState(false)
  const [creditAction, setCreditAction] = useState<'edit' | 'fix' | null>(null)
  const [pendingEntryId, setPendingEntryId] = useState<string | null>(null)
  const [showFeedbackPopup, setShowFeedbackPopup] = useState(false)
  const [showFixLimitNotification, setShowFixLimitNotification] = useState(false)
  const [canvasJustOpened, setCanvasJustOpened] = useState(false)
  const { subscription } = useUserSubscriptionStore()
  const aiCodeEditAccess = useFeatureAccess('AI_CODE_EDIT', subscription)

  // Define executeCode with useCallback at the top
  const executeCode = useCallback(async (entryId: string, code: string, language: string) => {
    // Only execute Python code for now
    if (language !== 'python') {
      toast({
        title: "Unsupported language",
        description: `${language} code execution is not supported yet.`,
        variant: "destructive"
      })
      return
    }
    
    // Find the code entry in our list
    const entryIndex = codeEntries.findIndex(entry => entry.id === entryId)
    if (entryIndex === -1) {
      toast({
        title: "Error",
        description: "Code entry not found",
        variant: "destructive"
      })
      return
    }
    
    // Get the associated message ID or use the fall back to the generic messageId prop
    const codeToExecute = code.trim()
    const codeEntry = codeEntries[entryIndex]
    const messageId = codeEntry.messageIndex
    
    // Set entry as executing
    const updatedEntries = [...codeEntries]
    updatedEntries[entryIndex] = {
      ...updatedEntries[entryIndex],
      isExecuting: true
    }
    setCodeEntries(updatedEntries)
    
    try {
      // Set the message ID in the session first so the backend knows which message this code belongs to
      let sessionMessageId: number | null = null; // To store message ID from session
      
      if (messageId) {
        try {
          console.log(`Setting message_id in backend: ${messageId}`);
          await axios.post(`${API_URL}/set-message-info`, {
            message_id: messageId
          }, {
            headers: {
              ...(sessionId && { 'X-Session-ID': sessionId }),
            },
          });
        } catch (error) {
          console.error("Error setting message ID:", error);
        }
      } else {
        console.warn("No message ID available for code execution");
        
        // For regular queries without messageId, try to get the latest message_id from session
        try {
          const sessionResponse = await axios.get(`${API_URL}/session-info`, {
            headers: {
              ...(sessionId && { 'X-Session-ID': sessionId }),
            },
          });
          
          if (sessionResponse.data && sessionResponse.data.current_message_id) {
            sessionMessageId = sessionResponse.data.current_message_id;
            
            // Set this message ID for the current execution
            await axios.post(`${API_URL}/set-message-info`, {
              message_id: sessionMessageId
            }, {
              headers: {
                ...(sessionId && { 'X-Session-ID': sessionId }),
              },
            });
          }
        } catch (sessionError) {
          console.error("Error getting current message ID from session:", sessionError);
        }
      }
      
      // Now execute the code with the associated message ID
      const response = await axios.post(`${API_URL}/code/execute`, {
        code: codeToExecute, // Use the edited code
        session_id: sessionId,
        message_id: messageId || sessionMessageId // Use messageId if available, otherwise use sessionMessageId if retrieved
      }, {
        headers: {
          ...(sessionId && { 'X-Session-ID': sessionId }),
        },
      })
      
      // console.log("Code execution response:", response.data);
      
      // Mark execution as complete
      const updatedEntries = [...codeEntries];
      updatedEntries[entryIndex] = {
        ...updatedEntries[entryIndex],
        isExecuting: false
      };
      
      // Store execution output for showing error messages and fix button
      if (response.data.error) {
        setExecOutputMap(prev => ({
          ...prev,
          [entryId]: { 
            output: response.data.error,
            hasError: true
          }
        }));
      } else if (response.data.output) {
        // Check if the output contains error indicators
        const errorPatterns = [
          "error", "exception", "traceback", "invalid", "failed", "syntax error", 
          "name error", "type error", "value error", "index error"
        ];
        const hasErrorInOutput = errorPatterns.some(pattern => 
          response.data.output.toLowerCase().includes(pattern.toLowerCase())
        );
        
        setExecOutputMap(prev => ({
          ...prev,
          [entryId]: { 
            output: response.data.output,
            hasError: hasErrorInOutput
          }
        }));
      } else {
        // Clear any previous error/output
        setExecOutputMap(prev => {
          const newMap = { ...prev };
          delete newMap[entryId];
          return newMap;
        });
      }
      
      // Pass execution result to parent component
      if (onCodeExecute) {
        // console.log("Passing execution results to parent:", response.data);
        onCodeExecute(entryId, response.data);
      }
      
    } catch (error) {
      console.error("Error executing code:", error)
      const errorMessage = error instanceof Error ? error.message : "Failed to execute code";
      
      // Mark execution as complete
      const updatedEntries = [...codeEntries]
      updatedEntries[entryIndex] = {
        ...updatedEntries[entryIndex],
        isExecuting: false
      }
      
      // Store error for fix button
      setExecOutputMap(prev => ({
        ...prev,
        [entryId]: { 
        output: errorMessage,
        hasError: true
      }
      }));
      
      if (onCodeExecute) {
        onCodeExecute(entryId, { error: errorMessage });
      }
    } finally {
      // Cleanup edited code map entry if we've saved the edit
      if (editingMap[entryId] === false) {
        setEditedCodeMap(prev => {
          const newMap = { ...prev };
          delete newMap[entryId];
          return newMap;
        });
      }
    }
  }, [codeEntries, editedCodeMap, editingMap, onCodeExecute, sessionId]);

  // Set the most recent entry as active when entries change
  useEffect(() => {
    if (codeEntries.length > 0 && (!activeEntryId || !codeEntries.find(entry => entry.id === activeEntryId))) {
      setActiveEntryId(codeEntries[codeEntries.length - 1].id);
      
      // Initialize editing state for entries
      const newEntryId = codeEntries[codeEntries.length - 1].id;
      
      // When new code entries are loaded, make sure their edited code is properly initialized
      if (!editedCodeMap[newEntryId]) {
        setEditedCodeMap(prev => ({
          ...prev,
          [newEntryId]: codeEntries[codeEntries.length - 1].code
        }));
      }
      
      // If autoRun is enabled and this is a new entry, execute it automatically
      // Note: We only auto-run when chatCompleted is true, not when the canvas opens
      if (autoRunEnabled && chatCompleted && !isOpen) {
        const newestEntry = codeEntries[codeEntries.length - 1];
        
        // Only auto-run Python code
        if (newestEntry.language === "python") {
          // Add a small delay to ensure state is updated
          setTimeout(() => {
            executeCode(newestEntry.id, newestEntry.code, newestEntry.language);
            
            // Only show toast if canvas is open and not hidden
            if (isOpen && !hiddenCanvas) {
              toast({
                title: "Auto-running code",
                description: "Code is automatically running after AI response completed",
                duration: 3000,
              });
            }
          }, 500);
        }
      }
    }
  }, [codeEntries, activeEntryId, autoRunEnabled, chatCompleted, executeCode, isOpen, hiddenCanvas, toast]);

  // Auto-run code when chat is completed
  useEffect(() => {
    // Auto-run ONLY when chatCompleted changes from false to true
    if (chatCompleted && !previousChatCompletedRef.current) {
      if (autoRunEnabled && codeEntries.length > 0 && activeEntryId) {
        const activeEntry = codeEntries.find(entry => entry.id === activeEntryId);
        
        // Only execute Python code automatically
        if (activeEntry && activeEntry.language === "python" && !editingMap[activeEntryId]) {
          logger.log("Auto-running code for entry:", activeEntry.id);
          // Execute immediately - no need to check if canvas is open
          executeCode(activeEntryId, activeEntry.code, activeEntry.language);
          
          // Only show toast notification if canvas is open and not hidden
          if (isOpen && !hiddenCanvas) {
            toast({
              title: "Auto-running code",
              description: "Code is automatically running after AI response completed",
              duration: 3000,
            });
          }
        }
      }
      
      // Reset code fix counters when a new message is complete
      setCodeFixes({});
      logger.log("Code fix counters reset for new message");
    }
    
    // Update the ref for the next check
    previousChatCompletedRef.current = chatCompleted;
  }, [chatCompleted, autoRunEnabled, codeEntries, activeEntryId, editingMap, executeCode, isOpen, hiddenCanvas, toast]);

  // Track canvas opening to prevent auto-run when canvas opens
  useEffect(() => {
    if (isOpen) {
      setCanvasJustOpened(true);
      // Reset after a short delay
      const timer = setTimeout(() => {
        setCanvasJustOpened(false);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Initialize edited code when switching to edit mode
  const startEditing = (entryId: string, code: string) => {
    setEditingMap(prev => ({ ...prev, [entryId]: true }))
    setEditedCodeMap(prev => ({ ...prev, [entryId]: code }))
  }

  const saveEdit = (entryId: string) => {
    const updatedCode = editedCodeMap[entryId]
    // Find the entry and update it
    const entryIndex = codeEntries.findIndex(entry => entry.id === entryId)
    if (entryIndex !== -1) {
      const updatedEntries = [...codeEntries]
      updatedEntries[entryIndex] = {
        ...updatedEntries[entryIndex],
        code: updatedCode
      }
      
      // Get the associated message ID from the code entry
      const codeEntry = codeEntries[entryIndex];
      const messageId = codeEntry.messageIndex;
      
      // Update the backend with message ID if available
      if (messageId) {
        axios.post(`${API_URL}/set-message-info`, {
          message_id: messageId
        }, {
          headers: {
            ...(sessionId && { 'X-Session-ID': sessionId }),
          },
        })
        .then(() => {
          // Update the entries in the parent component with the message ID we have
          if (onCodeExecute) {
            onCodeExecute(entryId, { 
              savedCode: updatedCode,
              message_id: messageId
            });
          }
        })
        .catch(error => {
          console.error("Error setting message ID for edit:", error);
          // Still update entries if there's an error
          if (onCodeExecute) {
            onCodeExecute(entryId, { 
              savedCode: updatedCode
            });
          }
        });
      } else {
        console.warn("No message ID available for code edit, trying to get from session");
        // For regular edits without messageId, try to get the latest message_id from session
        axios.get(`${API_URL}/session-info`, {
          headers: {
            ...(sessionId && { 'X-Session-ID': sessionId }),
          },
        })
        .then(sessionResponse => {
          const sessionMessageId = sessionResponse.data?.current_message_id;
          if (sessionMessageId) {
            
            // Update the session with this message ID
            axios.post(`${API_URL}/set-message-info`, {
              message_id: sessionMessageId
            }, {
              headers: {
                ...(sessionId && { 'X-Session-ID': sessionId }),
              },
            })
            .then(() => {
              // Update the entries in the parent component with the message ID from session
              if (onCodeExecute) {
                onCodeExecute(entryId, { 
                  savedCode: updatedCode,
                  message_id: sessionMessageId
                });
              }
            })
            .catch(error => {
              console.error("Error setting session message ID for edit:", error);
              // Still update entries if there's an error
              if (onCodeExecute) {
                onCodeExecute(entryId, { 
                  savedCode: updatedCode
                });
              }
            });
          } else {
            // No message ID found, update the entries in the parent component without it
            if (onCodeExecute) {
              onCodeExecute(entryId, { 
                savedCode: updatedCode
              });
            }
          }
        })
        .catch(sessionError => {
          console.error("Error getting current message ID from session for edit:", sessionError);
          // Still update the entries in the parent component even if there's an error
          if (onCodeExecute) {
            onCodeExecute(entryId, { savedCode: updatedCode });
          }
        });
      }
    }
    setEditingMap(prev => ({ ...prev, [entryId]: false }))
  }

  const cancelEdit = (entryId: string) => {
    setEditingMap(prev => ({ ...prev, [entryId]: false }))
  }

  const copyToClipboard = async (code: string, entryId: string) => {
    try {
      await navigator.clipboard.writeText(code)
      toast({
        title: "Copied to clipboard",
        variant: "default",
        duration: 2000, // 2 seconds
      })
      setCopiedMap(prev => ({ ...prev, [entryId]: true }))
      setTimeout(() => {
        setCopiedMap(prev => ({ ...prev, [entryId]: false }))
      }, 2000)
    } catch (err) {
      console.error("Failed to copy text: ", err)
      toast({
        title: "Copy failed",
        description: "Could not copy to clipboard",
        variant: "destructive",
        duration: 3000, // 3 seconds
      })
    }
  }

  // Handle editor mount
  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor;
    
    // Listen for selection changes
    editor.onDidChangeCursorSelection((e: any) => {
      const selection = editor.getSelection();
      
      if (selection && !selection.isEmpty()) {
        const selectedText = editor.getModel().getValueInRange(selection);
        if (selectedText.trim()) {
          setSelectedText({
            text: selectedText,
            range: selection
          });
          
          // Calculate position for the popover
          const lineHeight = editor.getOption(monaco?.editor.EditorOption.lineHeight);
          const { startLineNumber, startColumn } = selection;
          const position = editor.getScrolledVisiblePosition({ lineNumber: startLineNumber, column: startColumn });
          
          // Get editor container dimensions for positioning
          const editorContainer = editor.getContainerDomNode();
          const editorRect = editorContainer.getBoundingClientRect();
          
          if (position) {
            // Calculate position that ensures it stays inside the canvas
            const top = Math.max(10, Math.min(position.top - 5, editorRect.height - 250));
            const left = Math.max(10, Math.min(position.left, editorRect.width - 180));
            
            setSelectionPosition({
              top: top,
              left: left,
              width: 160
            });
          }
        }
      } else {
        setSelectedText(null);
        setSelectionPosition(null);
      }
    });
  };

  const getActiveEntry = () => {
    return activeEntryId ? codeEntries.find(entry => entry.id === activeEntryId) : null;
  }

  // Direct code edit without animations
  const handleAIEditRequest = async (entryId: string) => {
    // Check if user has feature access
    if (!aiCodeEditAccess.hasAccess) {
      toast({
        title: "Feature not available",
        description: `AI Code Edit requires a ${aiCodeEditAccess.requiredTier} subscription.`,
        variant: "destructive",
        duration: 5000,
      })
      return;
    }
    
    if (!aiEditPrompt.trim()) return;
    
    const activeEntry = codeEntries.find(entry => entry.id === entryId);
    if (!activeEntry) return;
    
    // Check if user has credits for AI edit (only for logged in users)
    if (session) {
      try {
        // Credit cost for AI code edit is 1
        const creditCost = 1;
        const hasEnough = await hasEnoughCredits(creditCost);
        
        if (!hasEnough) {
          // Show insufficient credits dialog
          setCreditAction('edit');
          setPendingEntryId(entryId);
          setInsufficientCreditsOpen(true);
          return;
        }
      } catch (error) {
        console.error("Error checking credits:", error);
      }
    }
    
    setIsAIEditing(true);
    
    try {
      let originalCode = "";
      let fullCode = editedCodeMap[entryId] || activeEntry.code;
      
      // If there's selected text, only edit that portion
      if (selectedText && editorRef.current) {
        originalCode = selectedText.text;
      } else {
        originalCode = fullCode;
      }
      
      toast({
        title: "Processing edit request",
        description: "AI is modifying your code...",
        duration: 3000,
      });
      
      const response = await axios.post(`${API_URL}/code/edit`, {
        original_code: originalCode,
        user_prompt: aiEditPrompt,
        session_id: sessionId,
      }, {
        headers: {
          ...(sessionId && { 'X-Session-ID': sessionId }),
        },
      });

      if (response.data && response.data.edited_code) {
        const editedCode = response.data.edited_code;
        
        // If editing needs to happen, make sure we're in edit mode
        if (!editingMap[entryId]) {
          startEditing(entryId, fullCode);
          // Small delay to ensure editor is ready
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // If we're editing a selection, only replace that part
        if (selectedText && editorRef.current) {
          // Apply the edit directly to the editor
          editorRef.current.executeEdits('apply-edit', [{
            range: selectedText.range,
            text: editedCode,
            forceMoveMarkers: true
          }]);
          
          // Get the updated full code
          const updatedFullCode = editorRef.current.getModel().getValue();
          
          // Update the code in state
          setEditedCodeMap(prev => ({
            ...prev,
            [entryId]: updatedFullCode
          }));
          
          // Update the entry code
          const entryIndex = codeEntries.findIndex(entry => entry.id === entryId);
          if (entryIndex !== -1) {
            const updatedEntries = [...codeEntries];
            updatedEntries[entryIndex] = {
              ...updatedEntries[entryIndex],
              code: updatedFullCode
            };
          }
          
          // Notify parent component of the code change
          if (onCodeExecute) {
            onCodeExecute(entryId, { savedCode: updatedFullCode });
          }
        } else {
          // Apply edit to the entire document
          if (editorRef.current) {
            editorRef.current.executeEdits('apply-edit', [{
              range: {
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: editorRef.current.getModel().getLineCount(),
                endColumn: editorRef.current.getModel().getLineMaxColumn(editorRef.current.getModel().getLineCount())
              },
              text: editedCode,
              forceMoveMarkers: true
            }]);
          }
          
          // Update the code state
          setEditedCodeMap(prev => ({
            ...prev,
            [entryId]: editedCode
          }));
          
          // Update the code entry
          const entryIndex = codeEntries.findIndex(entry => entry.id === entryId);
          if (entryIndex !== -1) {
            const updatedEntries = [...codeEntries];
            updatedEntries[entryIndex] = {
              ...updatedEntries[entryIndex],
              code: editedCode
            };
          }
          
          // Notify parent component of the code change
      if (onCodeExecute) {
            onCodeExecute(entryId, { savedCode: editedCode });
          }
        }
        
        // Deduct credits for successful edit (only for logged in users)
        if (session?.user) {
          try {
            // Determine user ID for credit deduction
            let userIdForCredits = '';
            
            if ((session.user as any).sub) {
              userIdForCredits = (session.user as any).sub;
            } else if ((session.user as any).id) {
              userIdForCredits = (session.user as any).id;
            } else if (session.user.email) {
              userIdForCredits = session.user.email;
            }
            
            if (userIdForCredits) {
              // Deduct 1 credit for AI code edit
              await axios.post('/api/user/deduct-credits', {
                userId: userIdForCredits,
                credits: 1,
                description: 'Used AI to edit code'
              });
              
              // Refresh credits display
              if (checkCredits) {
                await checkCredits();
              }
            }
          } catch (creditError) {
            console.error("Failed to deduct credits for code edit:", creditError);
          }
        }
        
        // Show success message
        toast({
          title: "Code updated",
          description: "AI successfully modified your code.",
          variant: "default",
          duration: 3000,
        });
      }
      
      // Handle error message from backend
      if (response.data && response.data.error) {
        toast({
          title: "Error modifying code",
          description: response.data.error,
          variant: "destructive",
          duration: 5000,
        });
      }
    } catch (error) {
      console.error("Error editing code with AI:", error);
      toast({
        title: "Error",
        description: "Failed to modify code. Please try again.",
        variant: "destructive",
        duration: 5000,
      });
    } finally {
      setIsAIEditing(false);
      setShowAIEditField(prev => ({ ...prev, [entryId]: false }));
      setAIEditPrompt("");
      setSelectedText(null);
      setSelectionPosition(null);
    }
  };
  
  // Direct code fix without animations (modified to use CodeFixButton)
  const handleFixCode = async (entryId: string) => {
    const errorOutput = execOutputMap[entryId]?.output;
    const hasError = execOutputMap[entryId]?.hasError;
    
    if (!errorOutput || !hasError) return;
    
    setIsFixingCode(true);
    
    // The actual fix logic is now handled in CodeFixButton
    // This is just a wrapper to maintain compatibility
  };

  // Handle fix start from CodeFixButton
  const handleFixStart = (codeId: string) => {
    setIsFixingCode(true);
  };

  // Handle fix complete from CodeFixButton
  const handleFixComplete = (codeId: string, fixedCode: string) => {
    // Always reset fixing state first
    setIsFixingCode(false);
    
    // Increment the fix count
    setCodeFixes(prev => {
      const newCodeFixes = { ...prev };
      newCodeFixes[codeId] = (prev[codeId] || 0) + 1;
      console.log("CodeCanvas: Updated code fixes count:", newCodeFixes);
      return newCodeFixes;
    });
    
    // Find the entry and update the code
    const entryIndex = codeEntries.findIndex(entry => entry.id === codeId);
    if (entryIndex === -1) {
      setIsFixingCode(false);
      return;
    }
    
    // Create a new array to ensure React detects the change
    const updatedEntries = [...codeEntries];
    updatedEntries[entryIndex] = {
      ...updatedEntries[entryIndex],
      code: fixedCode
    };
    setCodeEntries(updatedEntries);
    
    // If fixing code, ensure we're in edit mode
    if (!editingMap[codeId]) {
      startEditing(codeId, fixedCode);
    } else {
      // Already in edit mode, update the edited code
      setEditedCodeMap(prev => ({
        ...prev,
        [codeId]: fixedCode
      }));
    }

    // Update the code in editor if it's open
    if (editorRef.current && activeEntryId === codeId) {
      editorRef.current.executeEdits('apply-fix', [{
        range: {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: editorRef.current.getModel().getLineCount(),
          endColumn: editorRef.current.getModel().getLineMaxColumn(editorRef.current.getModel().getLineCount())
        },
        text: fixedCode,
        forceMoveMarkers: true
      }]);
    }
    
    // Clear the error
    setExecOutputMap(prev => {
      const newMap = { ...prev };
      delete newMap[codeId];
      return newMap;
    });
    
    // Notify parent component of the code change
    if (onCodeExecute) {
      onCodeExecute(codeId, { savedCode: fixedCode });
    }
    
    // Show success toast
    toast({
      title: "Code fixed",
      description: "AI has fixed your code. Auto-running to verify the fix...",
      variant: "default",
      duration: 3000,
    });
    
    setIsFixingCode(false);
    
    // Auto-run the fixed code after a short delay to ensure state is updated
    setTimeout(() => {
      const fixedEntry = updatedEntries[entryIndex];
      if (fixedEntry && fixedEntry.language === "python") {
        console.log("Auto-running fixed code for entry:", codeId);
        executeCode(codeId, fixedCode, fixedEntry.language);
        
        toast({
          title: "Running fixed code",
          description: "Automatically testing the fixed code...",
          duration: 2000,
        });
      }
    }, 500);
  };

  // Handle insufficient credits
  const handleCreditCheck = (codeId: string, hasEnough: boolean) => {
    if (!hasEnough) {
      // Show insufficient credits dialog
      setCreditAction('fix');
      setPendingEntryId(codeId);
      setInsufficientCreditsOpen(true);
      setIsFixingCode(false);
    }
  };

  // Direct code cleaning without animations
  const handleCleanCode = async (entryId: string) => {
    const activeEntry = codeEntries.find(entry => entry.id === entryId);
    if (!activeEntry || activeEntry.language !== "python") return;
    
    setIsCleaningCode(true);
    try {
      // Use the edited code if available, otherwise use the original code
      const codeToClean = editedCodeMap[entryId] || activeEntry.code;
      
      toast({
        title: "Cleaning code",
        description: "Organizing imports and formatting...",
        duration: 2000,
      });
      
      const response = await axios.post(`${API_URL}/code/clean-code`, {
        code: codeToClean,
        session_id: sessionId,
      }, {
        headers: {
          ...(sessionId && { 'X-Session-ID': sessionId }),
        },
      });

      if (response.data && response.data.cleaned_code) {
        const cleanedCode = response.data.cleaned_code;
        
        // If not in edit mode, start editing
        if (!editingMap[entryId]) {
          startEditing(entryId, codeToClean);
          // Small delay to ensure editor is ready
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Apply the cleaned code directly
        if (editorRef.current) {
          editorRef.current.executeEdits('apply-clean', [{
            range: {
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: editorRef.current.getModel().getLineCount(),
              endColumn: editorRef.current.getModel().getLineMaxColumn(editorRef.current.getModel().getLineCount())
            },
            text: cleanedCode,
            forceMoveMarkers: true
          }]);
        }
        
        // Update the code state
        setEditedCodeMap(prev => ({
          ...prev,
          [entryId]: cleanedCode
        }));
        
        // Update the entry
        const entryIndex = codeEntries.findIndex(entry => entry.id === entryId);
        if (entryIndex !== -1) {
          const updatedEntries = [...codeEntries];
          updatedEntries[entryIndex] = {
            ...updatedEntries[entryIndex],
            code: cleanedCode
          };
        }
        
        // Notify parent component of the code change
        if (onCodeExecute) {
          onCodeExecute(entryId, { savedCode: cleanedCode });
        }
        
        toast({
          title: "Code cleaned",
          description: "Successfully organized imports and formatted code.",
          variant: "default",
          duration: 2000,
        });
      }
    } catch (error) {
      console.error("Error cleaning code:", error);
      toast({
        title: "Error",
        description: "Failed to clean code. Please try again.",
        variant: "destructive",
        duration: 3000,
      });
    } finally {
      setIsCleaningCode(false);
    }
  };

  // Add this before the return statement
  const handleCreditDialogContinue = () => {
    setInsufficientCreditsOpen(false);
    
    // Upgrade plan: redirect to pricing page
    window.location.href = '/pricing';
  };

  // Instead of returning null when not open, we'll render a hidden div to keep the component mounted
  // This ensures auto-run still works even when canvas is closed
  const activeEntry = getActiveEntry();
  const hasError = activeEntry ? execOutputMap[activeEntry.id]?.hasError : false;
  
  // Enhanced error detection - check both hasError flag and output content
  const outputText = activeEntry ? (execOutputMap[activeEntry.id]?.output || '') : '';
  const looksLikeError = /error|traceback|exception|failed|invalid/i.test(outputText);
  const hasValidErrorContent = outputText.trim().length > 0 && looksLikeError;
  const shouldShowFixButton = (hasError && outputText.trim().length > 0) || hasValidErrorContent;

  // Check for pending error fix data
  useEffect(() => {
    // Only run this when the canvas becomes visible
    if (isOpen && !hiddenCanvas) {
      try {
        const pendingFixData = localStorage.getItem('pending-error-fix');
        
        if (pendingFixData) {
          const fixData = JSON.parse(pendingFixData);
          
          // Only process if the data is less than 5 seconds old
          const now = Date.now();
          if (now - fixData.timestamp < 5000) {
            const { codeId, error } = fixData;
            
            // Find the matching code entry
            const entry = codeEntries.find(e => e.id === codeId);
            
            if (entry) {
              // Set as active entry
              setActiveEntryId(entry.id);
              
              // Delay slightly to ensure entry is selected
              setTimeout(() => {
                // Initiate the fix
                logger.log("Auto-initiating fix for code:", codeId);
                logger.log("Error message:", error);
                
                // Store the error in execOutputMap to enable the fix button
                setExecOutputMap(prev => ({
                  ...prev,
                  [entry.id]: {
                    output: error,
                    hasError: true
                  }
                }));
              }, 500);
            }
          }
          
          // Clean up
          localStorage.removeItem('pending-error-fix');
        }
      } catch (e) {
        console.error("Error processing pending fix data:", e);
      }
    }
  }, [isOpen, hiddenCanvas, codeEntries]);

  if (!isOpen) {
    // Return an empty div instead of null to keep the component mounted
    return <div className="hidden" />;
  }

  // If hiddenCanvas is true, keep the component mounted but visually hidden
  if (hiddenCanvas) {
    return <div className="hidden" />;
  }

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 20 }}
        className={`fixed right-0 top-0 z-40 h-screen bg-white shadow-xl flex flex-col
                   ${isMaximized ? 'w-full' : 'w-1/2'}`}
      >
        <div className="flex items-center justify-between border-b p-3 bg-gray-50">
          <h2 className="text-base font-semibold">Code Canvas</h2>
          <div className="flex items-center space-x-1">
            <div className="flex items-center mr-4 space-x-2">
              <Switch 
                id="auto-run" 
                checked={autoRunEnabled}
                onCheckedChange={setAutoRunEnabled}
                size="sm"
              />
              <Label htmlFor="auto-run" className="text-xs font-medium">Auto-run</Label>
            </div>
            
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
            <Button 
              variant="ghost" 
              size="sm"
                    onClick={() => setIsMaximized(!isMaximized)}
                    aria-label={isMaximized ? "Minimize" : "Maximize"}
            >
                    {isMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{isMaximized ? "Minimize" : "Maximize"}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button 
              variant="ghost" 
              size="sm"
              onClick={onToggle}
              aria-label="Close code canvas"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
        </div>
        
        <div className="flex flex-1 overflow-hidden">
          {/* Simplified sidebar */}
          {codeEntries.length > 1 && (
            <div className="w-48 border-r overflow-y-auto">
            {codeEntries.map((entry) => (
              <div 
                key={entry.id}
                  className={`p-2 border-b cursor-pointer hover:bg-gray-100 transition-colors
                           ${activeEntryId === entry.id ? 'bg-gray-100' : ''}`}
                onClick={() => setActiveEntryId(entry.id)}
              >
                  <div className="font-medium truncate text-sm">
                    {entry.language}
                </div>
              </div>
            ))}
          </div>
          )}
          
          {/* Active code entry */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {activeEntry ? (
              <>
                <div className="p-2 border-b flex items-center justify-between bg-gray-50">
                  <div className="flex items-center">
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-200 mr-2">
                      {activeEntry.language}
                    </span>
                  </div>
                  
                  <div className="flex items-center space-x-1">
                    {activeEntry.language === "python" && !editingMap[activeEntry.id] && !selectedText && (
                      <FeatureGate 
                        featureId="AI_CODE_EDIT" 
                        fallback={
                          <PremiumFeatureButton
                            featureId="AI_CODE_EDIT"
                            variant="icon"
                          />
                        }
                      >
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => {
                                  setShowAIEditField(prev => ({ 
                                    ...prev, 
                                    [activeEntry.id]: !prev[activeEntry.id] 
                                  }))
                                }} 
                                className="text-[#FF7F7F] hover:bg-[#FF7F7F]/20"
                              >
                                <Wand2 className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                              <p className="text-sm">Edit with AI</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </FeatureGate>
                    )}
                    
                    {/* Add clean code button for Python */}
                    {activeEntry.language === "python" && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleCleanCode(activeEntry.id)}
                              disabled={isCleaningCode}
                              className="text-blue-500 hover:bg-blue-100"
                            >
                              {isCleaningCode ? (
                                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                              ) : (
                                <Scissors className="h-4 w-4" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            <p className="text-sm">Clean code (organize imports)</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    
                    {shouldShowFixButton && activeEntry.language === "python" && !editingMap[activeEntry.id] && (
                      <CodeFixButton
                        codeId={activeEntry.id}
                        errorOutput={execOutputMap[activeEntry.id]?.output || outputText || 'Error occurred during execution'}
                        code={activeEntry.code}
                        isFixing={isFixingCode}
                        codeFixes={codeFixes}
                        sessionId={sessionId || ''}
                        onFixStart={handleFixStart}
                        onFixComplete={handleFixComplete}
                        onCreditCheck={handleCreditCheck}
                        onCanvasOpen={() => {}} // Canvas already open, no action needed
                        variant="default"
                      />
                    )}
                    
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => copyToClipboard(activeEntry.code, activeEntry.id)}
                            aria-label="Copy code"
                          >
                            {copiedMap[activeEntry.id] ? (
                              <Check className="h-4 w-4" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Copy code</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    
                    {activeEntry.language === "python" && !editingMap[activeEntry.id] && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => executeCode(activeEntry.id, activeEntry.code, activeEntry.language)}
                              aria-label="Execute code"
                            >
                              <Play className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Execute code</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    
                    {editingMap[activeEntry.id] ? (
                      <>
                        {activeEntry.language === "python" && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button 
                                  variant="ghost" 
                                  size="sm"
                                  onClick={() => executeCode(activeEntry.id, editedCodeMap[activeEntry.id], activeEntry.language)}
                                  disabled={activeEntry.isExecuting}
                                  aria-label="Execute code"
                                >
                                  <Play className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Execute code</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={() => saveEdit(activeEntry.id)}
                                aria-label="Save edits"
                              >
                                <Save className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Save edits</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={() => cancelEdit(activeEntry.id)}
                                aria-label="Cancel edits"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Cancel edits</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </>
                    ) : (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => startEditing(activeEntry.id, activeEntry.code)}
                              aria-label="Edit code"
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Edit code</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                </div>
                
                {/* AI Edit Field for entire code */}
                {showAIEditField[activeEntry.id] && (
                  <div className="flex flex-col px-4 py-2 bg-[#f8f8f8] border-b">
                    <Textarea
                      placeholder="Describe how to modify the code (e.g., Add error handling, optimize the loop, etc.)"
                      value={aiEditPrompt}
                      onChange={(e) => setAIEditPrompt(e.target.value)}
                      className="bg-white border-gray-300 text-gray-800 h-20 mb-2 resize-none"
                      disabled={isAIEditing}
                    />
                    <div className="flex justify-end space-x-2">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => setShowAIEditField(prev => ({ ...prev, [activeEntry.id]: false }))}
                        className="border-gray-300 text-gray-600 hover:bg-gray-100 h-8"
                      >
                        <X className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                      <FeatureGate
                        featureId="AI_CODE_EDIT"
                        fallback={
                          <PremiumFeatureButton
                            featureId="AI_CODE_EDIT"
                            buttonText="Upgrade Required"
                            icon={<Lock className="h-4 w-4 mr-1" />}
                          />
                        }
                      >
                        <Button
                          size="sm"
                          onClick={() => handleAIEditRequest(activeEntry.id)}
                          disabled={isAIEditing || !aiEditPrompt.trim()}
                          className="bg-[#FF7F7F] text-white hover:bg-[#FF7F7F]/80 shadow-md h-8"
                        >
                          {isAIEditing ? (
                            <span className="flex items-center">
                              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              Processing...
                            </span>
                          ) : (
                            <>
                              <Send className="h-4 w-4 mr-1"/>
                              Apply
                            </>
                          )}
                        </Button>
                      </FeatureGate>
                    </div>
                  </div>
                )}
                
                <div className="flex-1 overflow-hidden relative">
                  {editingMap[activeEntry.id] ? (
                    <>
                      {/* Selection-based AI edit popup */}
                      {selectedText && selectionPosition && (
                        <div 
                          className="absolute z-10"
                          style={{
                            top: `${selectionPosition.top}px`,
                            left: `${selectionPosition.left}px`,
                          }}
                        >
                          <FeatureGate 
                            featureId="AI_CODE_EDIT" 
                            fallback={
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                className="p-1 h-6 w-6 rounded-full bg-gray-200 text-gray-600"
                                onClick={() => {
                                  toast({
                                    title: "Premium Feature",
                                    description: "AI Code Edit requires a paid subscription.",
                                    duration: 5000,
                                  });
                                }}
                              >
                                <Lock className="h-5 w-5" />
                              </Button>
                            }
                          >
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="p-1 h-6 w-6 rounded-full bg-[#FF7F7F] text-white hover:bg-[#FF7F7F]/80 shadow-md"
                                >
                                  <Wand2 className="h-5 w-5" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-96 p-3" sideOffset={5} align="start">
                                <div className="space-y-2">
                                  <h4 className="font-medium text-xs mb-1">Edit Selection</h4>
                                  <Textarea
                                    placeholder="Describe the change..."
                                    value={aiEditPrompt}
                                    onChange={(e) => setAIEditPrompt(e.target.value)}
                                    className="bg-white border-gray-300 text-gray-800 h-16 w-full text-xs resize-none min-h-[64px]"
                                    disabled={isAIEditing}
                                  />
                                  <div className="flex justify-end space-x-1 pt-1">
                                    <Button 
                                      variant="outline" 
                                      size="sm" 
                                      onClick={() => {
                                        setSelectedText(null);
                                        setSelectionPosition(null);
                                        setAIEditPrompt("");
                                      }}
                                      className="h-6 text-xs px-2"
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      size="sm"
                                      onClick={() => handleAIEditRequest(activeEntry.id)}
                                      disabled={isAIEditing || !aiEditPrompt.trim()}
                                      className="bg-[#FF7F7F] text-white hover:bg-[#FF7F7F]/80 h-6 text-xs px-2"
                                    >
                                      {isAIEditing ? 
                                        <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg> 
                                        : "Apply"
                                      }
                                    </Button>
                                  </div>
                                </div>
                              </PopoverContent>
                            </Popover>
                          </FeatureGate>
                        </div>
                      )}
                    <MonacoEditor
                      height="100%"
                      language={activeEntry.language}
                      value={editedCodeMap[activeEntry.id]}
                      onChange={(value) => {
                        if (value !== undefined) {
                          setEditedCodeMap(prev => ({ ...prev, [activeEntry.id]: value }))
                        }
                      }}
                      onMount={handleEditorDidMount}
                      options={{ 
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        fontSize: 14
                      }}
                    />
                    </>
                  ) : (
                    <SyntaxHighlighter
                      language={activeEntry.language}
                      style={vscDarkPlus}
                      customStyle={{
                        margin: 0,
                        borderRadius: 0,
                        height: '100%',
                        overflow: 'auto',
                        fontSize: '14px'
                      }}
                    >
                      {activeEntry.code}
                    </SyntaxHighlighter>
                  )}
                </div>
                
                {/* Show error indicator but not the full output */}
                {hasError && (
                  <div className="border-t px-4 py-2 bg-red-50 flex items-center text-red-600 text-sm">
                    <AlertTriangle className="h-4 w-4 mr-2" />
                    <span>Code execution resulted in an error. Click the <WrenchIcon className="h-3 w-3 inline mx-1" /> button to attempt to fix it.</span>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                No code selected
              </div>
            )}
          </div>
        </div>
        
        {/* Insufficient credits dialog */}
        <Dialog open={insufficientCreditsOpen} onOpenChange={setInsufficientCreditsOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-xl font-semibold">Insufficient Credits</DialogTitle>
              <DialogDescription className="text-sm text-gray-500 mt-2">
                You need at least 1 credit to {creditAction === 'edit' ? 'edit code with AI' : 'fix code errors with AI'}.
              </DialogDescription>
            </DialogHeader>
            
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 my-4">
              <div className="flex items-start gap-3">
                <div className="bg-amber-100 rounded-full p-2 flex-shrink-0">
                  <CreditCard className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <h4 className="text-sm font-medium text-amber-800">Free Limit Exceeded</h4>
                  <p className="text-xs text-amber-700 mt-1">
                    You've used your free code fixes for this message. Upgrade your plan for unlimited fixes.
                  </p>
                </div>
              </div>
            </div>
            
            <div className="flex justify-end space-x-2 pt-4">
              <Button variant="outline" onClick={() => setInsufficientCreditsOpen(false)} className="text-gray-700">
                Cancel
              </Button>
              <Button 
                onClick={handleCreditDialogContinue}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white"
              >
                <CreditCard className="h-4 w-4 mr-2" />
                Upgrade Plan
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        {/* TODO: HAS ALIGNMENT ISSUE; WILL FIX LATER */}
        {/* {showFixLimitNotification && (
          <div className="fixed bottom-20 left-1/2 transform -translate-x-1/2 z-50 max-w-sm w-full">
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="bg-white rounded-lg shadow-lg border border-amber-200 overflow-hidden"
            >
              <div className="bg-gradient-to-r from-amber-500 to-amber-400 h-1"></div>
              <div className="p-4 flex gap-3">
                <div className="bg-amber-100 rounded-full p-2 h-fit">
                  <CreditCard className="h-5 w-5 text-amber-600" />
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-gray-800">Free fix limit reached</h4>
                  <p className="text-xs text-gray-600 mt-1">
                    You've used all 3 free code fixes for this message. Additional fixes will use 1 credit each.
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        )} */}
      </motion.div>
    </AnimatePresence>
  )
}

export default CodeCanvas