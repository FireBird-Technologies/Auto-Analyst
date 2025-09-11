"use client"

import React, { useEffect, useRef, useCallback, useState } from "react"
import { motion } from "framer-motion"
import LoadingIndicator from "@/components/chat/LoadingIndicator"
import MessageContent from "@/components/chat/MessageContent"
import PlotlyChart from "@/components/chat/PlotlyChart"
import MatplotlibChart from "@/components/chat/MatplotlibChart"
import { ChatMessage } from "@/lib/store/chatHistoryStore"
import WelcomeSection from "./WelcomeSection"
import CodeCanvas from "./CodeCanvas"
import CodeIndicator from "./CodeIndicator"
import CodeFixButton from "./CodeFixButton"
import { v4 as uuidv4 } from 'uuid'
import { Code, AlertTriangle, Lock, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import axios from "axios"
import { useSessionStore } from '@/lib/store/sessionStore'
import logger from '@/lib/utils/logger'
import { useToast } from "@/components/ui/use-toast"
import API_URL from '@/config/api'
import { useUserSubscription, useUserSubscriptionStore } from '@/lib/store/userSubscriptionStore'
import { useFeatureAccess } from '@/lib/hooks/useFeatureAccess'
import { PremiumFeatureButton } from '@/components/features/FeatureGate'
import { useVisualizationsStore } from '@/lib/store/visualizationsStore'
import { Pin, PinOff, Maximize2, X } from 'lucide-react'

interface PlotlyMessage {
  type: "plotly"
  data: any
  layout: any
}

interface Message {
  text: string | PlotlyMessage
  sender: "user" | "ai"
}

interface CodeEntry {
  id: string;
  language: string;
  code: string;
  timestamp: number;
  title?: string;
  isExecuting?: boolean;
  output?: string;
  hasError?: boolean;
  messageIndex: number; // Track which message this code belongs to
}

interface CodeOutput {
  type: 'output' | 'error' | 'plotly' | 'matplotlib';
  content: string | any;
  messageIndex: number;
  codeId: string;
  vizIndex?: number; // Add visualization index for multiple viz from same code
}

interface ChatWindowProps {
  messages: ChatMessage[]
  isLoading: boolean
  onSendMessage: (message: string) => void
  showWelcome: boolean
  chatNameGenerated?: boolean
  sessionId?: string
  setSidebarOpen?: (isOpen: boolean) => void
}

interface CodeFixState {
  isFixing: boolean
  codeBeingFixed: string | null
}

// Simple text cycling loader like ChatGPT - just text, no background
const SimpleThinkingLoader = () => {
  const [currentIndex, setCurrentIndex] = useState(0)
  
  const thinkingTexts = [
    "Analyzing your data...",
    "Processing patterns...",
    "Generating insights...",
    "Running calculations...",
    "Preparing visualization...",
  ]

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % thinkingTexts.length)
    }, 1500) // Change text every 1.5 seconds

    return () => clearInterval(interval)
  }, [])

  return (
    <motion.span
      key={currentIndex}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{
        duration: 0.3,
        ease: "easeInOut",
      }}
      className="text-gray-600 font-medium"
    >
      {thinkingTexts[currentIndex]}
    </motion.span>
  )
}

const ChatWindow: React.FC<ChatWindowProps> = ({ messages, isLoading, onSendMessage, showWelcome, chatNameGenerated = false, sessionId, setSidebarOpen }) => {
  const chatWindowRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>(messages)
  const [codeCanvasOpen, setCodeCanvasOpen] = useState(false)
  const [codeEntries, setCodeEntries] = useState<CodeEntry[]>([])
  const [currentMessageIndex, setCurrentMessageIndex] = useState<number | null>(null)
  const [codeOutputs, setCodeOutputs] = useState<Record<string | number, CodeOutput[]>>({})
  const [chatCompleted, setChatCompleted] = useState(false)
  const [autoRunEnabled, setAutoRunEnabled] = useState(true)
  const [hiddenCanvas, setHiddenCanvas] = useState<boolean>(true)
  const [pendingCodeExecution, setPendingCodeExecution] = useState(false)
  const [codeFixes, setCodeFixes] = useState<Record<string, number>>({})
  const [codeFixState, setCodeFixState] = useState<CodeFixState>({ isFixing: false, codeBeingFixed: null })
  const { sessionId: storeSessionId } = useSessionStore()
  const { toast } = useToast()
  const { subscription } = useUserSubscriptionStore()
  const codeEditAccess = useFeatureAccess('AI_CODE_EDIT', subscription)
  const codeFixAccess = useFeatureAccess('AI_CODE_FIX', subscription)
  const { addOrUpdatePlotly, addOrUpdateMatplotlib, unpinVisualization, visualizations } = useVisualizationsStore()
  
  // Add state for fullscreen visualization
  const [fullscreenViz, setFullscreenViz] = useState<{ type: 'plotly' | 'matplotlib', content: any } | null>(null)
  
  // Simple hash function for code content
  const hashCode = useCallback((str: string): string => {
    let hash = 0;
    if (str.length === 0) return hash.toString();
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString();
  }, []);

  // Helper function to check if a visualization is pinned
  const isVisualizationPinned = useCallback((content: any, code: string, vizIndex?: number): boolean => {
    try {
      // Use the same hash logic as togglePinVisualization
      const hashInput = code + (vizIndex !== undefined ? `_viz_${vizIndex}` : '');
      const codeHash = hashInput ? hashCode(hashInput) : '';
      return visualizations.some(viz => viz.codeHash === codeHash);
    } catch (error) {
      console.warn('Error checking pin status:', error);
      return false;
    }
  }, [visualizations, hashCode]);

  // Helper function to toggle pin status
  const togglePinVisualization = useCallback((content: any, code: string, type: 'plotly' | 'matplotlib', vizIndex?: number) => {
    try {
      // Include visualization index in hash to make multiple viz from same code unique
      const hashInput = code + (vizIndex !== undefined ? `_viz_${vizIndex}` : '');
      const codeHash = hashInput ? hashCode(hashInput) : '';
      const existingViz = visualizations.find(viz => viz.codeHash === codeHash);
      
      console.log('Pin toggle:', { codeHash, exists: !!existingViz, type, vizIndex });
      
      if (existingViz) {
        unpinVisualization(codeHash);
        console.log('Unpinned visualization');
      } else {
        if (type === 'plotly') {
          addOrUpdatePlotly(content.data || [], content.layout || {}, `Chart ${vizIndex ? `#${vizIndex + 1}` : ''} from Chat`, hashInput);
          console.log('Pinned plotly visualization');
        } else if (type === 'matplotlib') {
          addOrUpdateMatplotlib(content, `Chart ${vizIndex ? `#${vizIndex + 1}` : ''} from Chat`, hashInput);
          console.log('Pinned matplotlib visualization');
        }
      }
    } catch (error) {
      console.error('Pin toggle error:', error);
    }
  }, [visualizations, hashCode, unpinVisualization, addOrUpdatePlotly, addOrUpdateMatplotlib]);

  // Set chatCompleted when chat name is generated
  useEffect(() => {
    if (chatNameGenerated && messages.length > 0) {
      setChatCompleted(true);
      
      // Reset chatCompleted after a delay to prepare for the next response
      const timer = setTimeout(() => {
        setChatCompleted(false);
      }, 10000); // Increase to 10 seconds
      
      return () => clearTimeout(timer);
    }
  }, [chatNameGenerated, messages.length]);
  
  // Scrolling helper
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])
  
  // Add the fetchLatestCode function before extractCodeFromMessages
  const fetchLatestCode = useCallback(async (messageId: number) => {
    if (!messageId) {
      return null;
    }
    
    try {
      
      const response = await axios.post(`${API_URL}/code/get-latest-code`, {
        message_id: messageId
      }, {
        headers: {
          ...(sessionId && { 'X-Session-ID': sessionId }),
        },
      });
      
      
      if (response.data.found) {
        return response.data;
      }
      
      return null;
    } catch (error) {
      console.error("Error fetching latest code:", error);
      return null;
    }
  }, [sessionId]);
  
  // Extract code blocks from messages with support for latest code
  const extractCodeFromMessages = useCallback(async (messagesToExtract: ChatMessage[], messageIndex: number) => {
    // logger.log("messagesToExtract", messagesToExtract);
    
    // First, try to fetch the latest code if we have a message_id
    const message = messagesToExtract[0];
    const actualMessageId = message?.message_id || messageIndex;
    
    if (actualMessageId && typeof actualMessageId === 'number') {
      const latestCodeData = await fetchLatestCode(actualMessageId);
      
      // If we have latest code from a previous execution, use it
      if (latestCodeData && latestCodeData.latest_code) {
        
        // Get the language from the code (assuming Python for now)
        const language = 'python'; // Default to Python
        
        const newEntry: CodeEntry = {
          id: uuidv4(),
          language,
          code: latestCodeData.latest_code,
          timestamp: Date.now(),
          title: `${language} snippet from AI`,
          messageIndex: actualMessageId
        };
        
        setCodeEntries([newEntry]);
        return;
      }
    }
    
    // If no latest code found, extract code blocks from messages as before
    const codeByLanguage: Record<string, { code: string, blocks: string[], agents: string[] }> = {};
    
    messagesToExtract.forEach((message) => {
      if (message.sender === "ai" && typeof message.text === "string") {
        const codeBlockRegex = /```([a-zA-Z0-9_]+)?\n([\s\S]*?)```/g;
        
        // Look for agent markers in the text
        const agentMarkersMap: Record<number, string> = {};
        const agentMarkerRegex = /<!-- AGENT: ([^>]+) -->\s*```([a-zA-Z0-9_]+)?/g;
        let markerMatch;
        while ((markerMatch = agentMarkerRegex.exec(message.text)) !== null) {
          const markerPos = markerMatch.index;
          const agentName = markerMatch[1];
          agentMarkersMap[markerPos] = agentName;
        }
        
        let match;
        while ((match = codeBlockRegex.exec(message.text)) !== null) {
          const language = match[1] || 'text';
          const code = match[2].trim();
          
          // Skip plotly code blocks as they're handled separately
          if (language === 'plotly') continue;
          
          // Initialize entry for this language if it doesn't exist
          if (!codeByLanguage[language]) {
            codeByLanguage[language] = {
              code: '',
              blocks: [],
              agents: []
            };
          }
          
          // Add this code block to the appropriate language group
          codeByLanguage[language].blocks.push(code);
          
          // Find the closest agent marker before this code block
          let blockAgentName = message.agent || "AI";
          const blockPos = match.index;
          
          // Find the closest agent marker before this position
          let closestMarkerPos = -1;
          for (const markerPos in agentMarkersMap) {
            if (parseInt(markerPos) < blockPos && parseInt(markerPos) > closestMarkerPos) {
              closestMarkerPos = parseInt(markerPos);
              blockAgentName = agentMarkersMap[markerPos];
            }
          }
          
          // If no agent marker was found and we have an agent in the message, use that
          if (closestMarkerPos === -1 && message.agent) {
            blockAgentName = message.agent;
          }
          
          codeByLanguage[language].agents.push(blockAgentName);
        }
      }
    });
    
    // Combine code blocks for each language and create entries
    const newEntries: CodeEntry[] = [];
    
    for (const [language, { blocks, agents }] of Object.entries(codeByLanguage)) {
      if (blocks.length > 0) {
        // Create combined code with agent names
        let combinedCode = "";
        for (let i = 0; i < blocks.length; i++) {
          // Add agent name header for all blocks, including the first one
          combinedCode += `# ${agents[i]} code start\n\n`;
          combinedCode += blocks[i];
          // Add a print statement in the code to indicate the agent has finished
          combinedCode += `\nprint("${agents[i]} has done, check code canvas")\n`;
          combinedCode += `\n\n# ${agents[i]} code end\n\n`;
          
          // Add separator between blocks if not the last block
          if (i < blocks.length - 1) {
            combinedCode += `\n\n`;
          }
        }
        
        // Use the actual message_id from the database if available, otherwise use the index
        const actualMessageId = messagesToExtract[0].message_id || messageIndex;
        
        // Get the agent name from the message if available
        const messageAgent = messagesToExtract[0].agent || "AI";
        
        newEntries.push({
          id: uuidv4(),
          language,
          code: combinedCode,
          timestamp: Date.now(),
          title: `${language} snippet from ${messageAgent}`,
          messageIndex: actualMessageId
        });
      }
    }
    
    if (newEntries.length > 0) {
      setCodeEntries(newEntries);
    }
  }, [fetchLatestCode]);
  
  // Clear code entries for new chats or messages
  const clearCodeEntries = useCallback(() => {
    setCodeEntries([])
    setCodeOutputs({})  // Clear all outputs
    // Don't close the canvas anymore, just hide it
    setHiddenCanvas(true)
  }, [])
  
  // Clear only code entries but keep outputs (for new AI messages)
  const clearCodeEntriesKeepOutput = useCallback(() => {
    setCodeEntries([])
    // Don't close the canvas, just make it hidden
    setHiddenCanvas(true)
  }, [])
  
  // Update the handleCanvasToggle function to fetch latest code
  const handleCanvasToggle = useCallback(() => {
    // Toggle canvas visibility instead of existence
    setCodeCanvasOpen(!codeCanvasOpen)
    setHiddenCanvas(false) // Make sure it's not hidden when manually toggled

    // If we have a current message with a message_id, make sure it's set in the canvas
    if (currentMessageIndex !== null && messages[currentMessageIndex] && messages[currentMessageIndex].message_id) {
      // Log to debug
      // logger.log(`Setting message_id in canvas: ${messages[currentMessageIndex].message_id} for message index ${currentMessageIndex}`);
      
      // Fetch the latest code for this message_id
      const messageId = messages[currentMessageIndex].message_id;
      if (messageId && typeof messageId === 'number') {
        // Clear previous code entries but preserve outputs
        clearCodeEntriesKeepOutput();
        
        // Extract code with latest version from the database
        extractCodeFromMessages([messages[currentMessageIndex]], messageId);
      }
    }
  }, [codeCanvasOpen, currentMessageIndex, messages, clearCodeEntriesKeepOutput, extractCodeFromMessages]);
  
  // Add a function to process all AI messages in the chat
  const processAllAiMessages = useCallback(() => {
    if (messages.length === 0) return;
    
    // Get all AI messages
    const aiMessages = messages.filter(m => m.sender === "ai");
    if (aiMessages.length === 0) return;
    
    // Set the latest AI message as active
    const lastAiMessageIndex = messages.lastIndexOf(aiMessages[aiMessages.length - 1]);
    setCurrentMessageIndex(lastAiMessageIndex);
    
    // Get the actual message from the messages array
    const currentMessage = messages[lastAiMessageIndex];
    
    // Log the message ID for debugging
    const messageId = currentMessage.message_id;
    // logger.log(`Processing AI message at index ${lastAiMessageIndex} with message_id: ${messageId}`);
    
    // Skip if this is an empty message
    if (!currentMessage.text || 
        (typeof currentMessage.text === 'string' && currentMessage.text.trim() === '') ||
        (typeof currentMessage.text === 'object' && currentMessage.text.type === 'plotly')) {
      // Skip empty text messages or plotly messages (which don't contain code)
      return;
    }
    
    // Clear previous code entries but preserve outputs
    clearCodeEntriesKeepOutput();
    
    // Extract code from the latest AI message - make sure to use the message_id
    if (messageId) {
      // Use the explicit message ID for code operations if available
      extractCodeFromMessages([currentMessage], messageId);
      
      // Update the backend with the current message ID
      if (sessionId) {
        axios.post(`${API_URL}/set-message-info`, {
          message_id: messageId
        }, {
          headers: { 'X-Session-ID': sessionId },
        })
        .then(() => {
          logger.log(`Updated backend with message_id: ${messageId} for auto-execution`);
        })
        .catch(error => {
          console.error("Error setting message ID for auto-execution:", error);
        });
      }
    } else {
      // Fall back to using index if no message_id is available
      extractCodeFromMessages([currentMessage], lastAiMessageIndex);
    }
    
    // Trigger auto-run for the code will happen via the chatCompleted state
  }, [messages, clearCodeEntriesKeepOutput, extractCodeFromMessages, sessionId]);
  
  // Detect when loading completes and trigger code execution
  useEffect(() => {
    if (pendingCodeExecution && !isLoading) {
      // The entire response is now complete (loading finished)
      logger.log("Loading complete - triggering code execution for all messages");
      
      // Process all AI messages to find and execute code
      // This ensures we wait for the ENTIRE conversation/response to complete
      // before auto-running any code, rather than running code for each
      // individual message as it arrives
      processAllAiMessages();
      
      // Set chatCompleted to true to trigger auto-run
      setChatCompleted(true);
      
      // Reset flags
      setPendingCodeExecution(false);
      
      // Reset chatCompleted after a delay
      const timer = setTimeout(() => {
        setChatCompleted(false);
      }, 10000);
      
      return () => clearTimeout(timer);
    }
  }, [isLoading, pendingCodeExecution, processAllAiMessages]);
  
  // When loading starts, mark that we need to process code when loading ends
  useEffect(() => {
    if (isLoading) {
      setChatCompleted(false);
      setPendingCodeExecution(true);
    }
  }, [isLoading]);

  // Update local messages when prop messages change
  useEffect(() => {
    setLocalMessages(messages)
    
    // Check if this is a new message set (chat reset or new response)
    if (messages.length !== localMessages.length) {
      // If a new AI message was added
      if (messages.length > localMessages.length && messages.length > 0) {
        const newMessageIndex = messages.length - 1
        
        // Only if it's an AI message
        if (messages[newMessageIndex].sender === "ai") {
          // Clear previous code entries but preserve outputs, and set the current message index
          clearCodeEntriesKeepOutput()
          setCurrentMessageIndex(newMessageIndex)
          
          // Extract code blocks from the new message but DON'T auto-run yet
          if (typeof messages[newMessageIndex].text === "string") {
            extractCodeFromMessages([messages[newMessageIndex]], newMessageIndex)
            
            // We'll wait for loading to complete before auto-running
            // so we've removed the setChatCompleted(true) calls here
          }
        }
      } else if (messages.length < localMessages.length || messages.length === 0) {
        // Chat was reset or cleared
        clearCodeEntries()
        setCurrentMessageIndex(null)
      }
    }
  }, [messages, localMessages.length, clearCodeEntries, clearCodeEntriesKeepOutput, extractCodeFromMessages])

  // Modify the useEffect for loading chat to process all messages
  useEffect(() => {
    if (!showWelcome && messages.length > 0) {
      setLocalMessages(messages);
      processAllAiMessages();
      
      // Trigger auto-run when switching between chats
      if (!isLoading) {
        setChatCompleted(true);
        
        // Reset after a delay
        const timer = setTimeout(() => {
          setChatCompleted(false);
        }, 1000);
        
        return () => clearTimeout(timer);
      }
    }
  }, [showWelcome, messages, processAllAiMessages, setLocalMessages, isLoading]);

  // Track sessionId changes to detect chat switching
  useEffect(() => {
    if (sessionId && messages.length > 0 && !isLoading) {
      // When session ID changes (switching chats), run the last chat's code
      processAllAiMessages();
      setChatCompleted(true);
      
      // Reset chatCompleted after a delay
      const timer = setTimeout(() => {
        setChatCompleted(false);
      }, 1000);
      
      return () => clearTimeout(timer);
    }
  }, [sessionId, messages, processAllAiMessages, isLoading]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom()
  }, [localMessages, isLoading, scrollToBottom])

  // Process a message to replace code blocks with indicators
  const processMessageWithCodeIndicators = useCallback((message: ChatMessage, index: number) => {
    if (typeof message.text !== "string") return message.text;
    
    const parts: (string | { type: 'code'; language: string; })[] = [];
    let lastIndex = 0;
    const codeBlockRegex = /```([a-zA-Z0-9_]+)?\n([\s\S]*?)```/g;
    let match;
    
    // Find all code blocks and split the text
    while ((match = codeBlockRegex.exec(message.text)) !== null) {
      // Add text before the code block
      if (match.index > lastIndex) {
        parts.push(message.text.substring(lastIndex, match.index));
      }
      
      // Add a placeholder for the code block
      const language = match[1] || 'text';
      // Skip plotly code blocks as they're handled separately
      if (language !== 'plotly') {
        parts.push({ type: 'code', language });
      } else {
        // Keep plotly blocks as is
        parts.push(match[0]);
      }
      
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining text after the last code block
    if (lastIndex < message.text.length) {
      parts.push(message.text.substring(lastIndex));
    }
    
    return parts;
  }, []);

  const handleCodeExecute = useCallback((result: any, updateCodeBlock: (code: string) => void) => {
    if (result.savedCode) {
      // Just update the code block without adding a message
      updateCodeBlock(result.savedCode)
    } else {
      // Add execution output as a separate message
      let executionResult = ""

      if (result.error) {
        executionResult = `\`\`\`error\n${result.error}\n\`\`\``
      } else {
        if (result.output) {
          executionResult = `\`\`\`output\n${result.output}\n\`\`\``
        }
        if (result.plotly_outputs && result.plotly_outputs.length > 0) {
          executionResult += "\nPlotly charts generated:\n"
          result.plotly_outputs.forEach((plotlyOutput: string, index: number) => {
            executionResult += `\`\`\`plotly\n${plotlyOutput}\n\`\`\`\n\n`
          })
        }
      }

      // if (executionResult) {
      //   setLocalMessages((prev) => [
      //     ...prev,
      //     {
      //       text: executionResult,
      //       sender: "ai",
      //     },
      //   ])
      // }
    }
  }, [])
  
  // Handle code execution from CodeCanvas
  const handleCodeCanvasExecute = useCallback((entryId: string, result: any) => {
    // Find the code entry
    const codeEntry = codeEntries.find(entry => entry.id === entryId);
    if (!codeEntry) {
      console.error("Could not find code entry with ID:", entryId);
      return;
    }
    
    // console.log("Code canvas executed with result:", result);
    // console.log("For code entry:", codeEntry);
    
    // Get the unique message identifier
    const messageId = codeEntry.messageIndex;
    
    // If this is just a code update without execution (savedCode)
    if (result.savedCode) {
      // Update the code in our state without generating output
      setCodeEntries(prev => 
        prev.map(entry => 
          entry.id === entryId 
            ? { ...entry, code: result.savedCode } 
            : entry
        )
      );
      
      // Even for just saving code, make sure the backend knows the message_id
      // This ensures code changes are properly tracked in the database
      if (messageId && sessionId) {
        // Log to help with debugging
        logger.log(`Setting message_id in backend for saved code: ${messageId}`);
        
        axios.post(`${API_URL}/set-message-info`, {
          message_id: messageId
        }, {
          headers: {
            'X-Session-ID': sessionId
          },
        }).then(() => {
          logger.log(`Successfully set message_id for saved code: ${messageId}`);
        }).catch(error => {
          console.error("Error setting message ID for saved code:", error);
        });
      } else {
        // If no message ID, try to get from session
        if (sessionId) {
          axios.get(`${API_URL}/session-info`, {
            headers: {
              'X-Session-ID': sessionId
            },
          }).then(response => {
            if (response.data && response.data.current_message_id) {
              logger.log(`Using current message ID from session for saved code: ${response.data.current_message_id}`);
            }
          }).catch(error => {
            console.error("Error getting session info for saved code:", error);
          });
        }
      }
      
      return;
    }
    
    // Start with a clean slate for this message's outputs
    const newOutputs: Record<string | number, CodeOutput[]> = { ...codeOutputs };
    newOutputs[messageId] = []; // Reset outputs for this message
    
    // Add output if available
    if (result.error) {
      // Add error output
      // console.log("Adding error output:", result.error);
      newOutputs[messageId] = [
        {
          type: 'error',
          content: result.error,
          messageIndex: messageId,
          codeId: entryId
        }
      ];
    } else if (result.output) {
      // Add text output
      newOutputs[messageId] = [
        {
          type: 'output',
          content: result.output,
          messageIndex: messageId,
          codeId: entryId
        }
      ];
    }
    
    // Add plotly outputs if any
    if (result.plotly_outputs && result.plotly_outputs.length > 0) {
      
      // Process all plotly outputs
      const plotlyOutputItems: CodeOutput[] = [];
      
      result.plotly_outputs.forEach((plotlyOutput: string, vizIndex: number) => {
        try {
          const plotlyContent = plotlyOutput.replace(/```plotly\n|\n```/g, "");
          
          const plotlyData = JSON.parse(plotlyContent);
          plotlyOutputItems.push({
            type: 'plotly',
            content: plotlyData,
            messageIndex: messageId,
            codeId: entryId,
            vizIndex: vizIndex // Add visualization index
          });
        } catch (e) {
          console.error("Error parsing Plotly data:", e);
        }
      });
      
      // Add any plotly outputs to the existing text output
      if (plotlyOutputItems.length > 0) {
        newOutputs[messageId] = [
          ...(newOutputs[messageId] || []),
          ...plotlyOutputItems
        ];
      }
    }

    // Add matplotlib outputs if any
    if (result.matplotlib_outputs && result.matplotlib_outputs.length > 0) {
      
      // Process all matplotlib outputs
      const matplotlibOutputItems: CodeOutput[] = [];
      
      result.matplotlib_outputs.forEach((matplotlibOutput: string) => {
        try {
          const matplotlibContent = matplotlibOutput.replace(/```matplotlib\n|\n```/g, "");
          
          matplotlibOutputItems.push({
            type: 'matplotlib',
            content: matplotlibContent, // base64 string directly
            messageIndex: messageId,
            codeId: entryId
          });
        } catch (e) {
          console.error("Error parsing Matplotlib data:", e);
        }
      });
      
      // Add any matplotlib outputs to the existing text output
      if (matplotlibOutputItems.length > 0) {
        newOutputs[messageId] = [
          ...(newOutputs[messageId] || []),
          ...matplotlibOutputItems
        ];
      }
    }
    
    // Update state with all the outputs
    setCodeOutputs(newOutputs);
    
    // Log the current outputs after updating
    setTimeout(() => {
      console.log("Current code outputs after update:", codeOutputs);
    }, 100);
  }, [codeEntries, codeOutputs]);

  // Handle fix start
  const handleFixStart = useCallback((codeId: string) => {
    setCodeFixState({ isFixing: true, codeBeingFixed: codeId })
  }, [])

  // Handle insufficient credits
  const handleCreditCheck = useCallback((codeId: string, hasEnough: boolean) => {
    if (!hasEnough) {
      // You would typically show a credits modal here
      // For now, just reset the fixing state
      setCodeFixState({ isFixing: false, codeBeingFixed: null })
    }
  }, [])

  // Execute code function for auto-run after fixes
  const executeCodeFromChatWindow = useCallback(async (entryId: string, code: string, language: string) => {
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
    
    const codeEntry = codeEntries[entryIndex]
    const messageId = codeEntry.messageIndex
    
    try {
      // Set the message ID in the session first so the backend knows which message this code belongs to
      if (messageId) {
        try {
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
      }
      
      // Now execute the code with the associated message ID
      const response = await axios.post(`${API_URL}/code/execute`, {
        code: code.trim(),
        session_id: sessionId,
        message_id: messageId
      }, {
        headers: {
          ...(sessionId && { 'X-Session-ID': sessionId }),
        },
      })
      
      
      // Pass execution result to handleCodeCanvasExecute
      handleCodeCanvasExecute(entryId, response.data);
      
    } catch (error) {
      console.error("Error executing code:", error)
      const errorMessage = error instanceof Error ? error.message : "Failed to execute code";
      
      // Pass error to handleCodeCanvasExecute
      handleCodeCanvasExecute(entryId, { error: errorMessage });
    }
  }, [codeEntries, sessionId, handleCodeCanvasExecute, toast]);

  // Handle fix complete
  const handleFixComplete = useCallback((codeId: string, fixedCode: string) => {
    // Increment the fix count
    setCodeFixes(prev => {
      const updatedFixes = { ...prev };
      updatedFixes[codeId] = (prev[codeId] || 0) + 1;
      // console.log("ChatWindow: Updated fix counts:", updatedFixes);
      return updatedFixes;
    });

    // Update the code in the appropriate entry
    const codeEntry = codeEntries.find(entry => entry.id === codeId)
    if (codeEntry) {
      // Create a new array to ensure React detects the change
      setCodeEntries(prev =>
        prev.map(entry =>
          entry.id === codeId
            ? { ...entry, code: fixedCode }
            : entry
        )
      )

      // Notify parent about the code change
      handleCodeCanvasExecute(codeId, { savedCode: fixedCode })

      // Clear error output - need to adjust for the new structure
      setCodeOutputs(prev => {
        // Find the messageIndex associated with this code ID
        const messageId = codeEntry.messageIndex;
        const newOutputs = { ...prev };
        
        // If this message has outputs, filter out the ones for this code ID
        if (newOutputs[messageId]) {
          newOutputs[messageId] = newOutputs[messageId].filter(output => output.codeId !== codeId);
        }
        
        return newOutputs;
      });
      
      // Open the code canvas if it's not already open
      if (!codeCanvasOpen) {
        setCodeCanvasOpen(true)
      }
      
      // Make sure canvas is visible
      setHiddenCanvas(false)
      
      // Auto-run the fixed code after a short delay to ensure state is updated
      setTimeout(() => {
        if (codeEntry.language === "python") {
          // console.log("Auto-running fixed code for entry:", codeId);
          executeCodeFromChatWindow(codeId, fixedCode, codeEntry.language);
          
          toast({
            title: "Running fixed code",
            description: "Automatically testing the fixed code...",
            duration: 2000,
          });
        }
      }, 500);
    }

    // Reset fixing state
    setCodeFixState({ isFixing: false, codeBeingFixed: null })
    
    // Show a toast to guide the user
    toast({
      title: "Code fixed and testing",
      description: "The code has been fixed and is being automatically tested.",
      duration: 3000,
    })
  }, [codeEntries, handleCodeCanvasExecute, codeCanvasOpen, toast, executeCodeFromChatWindow]);

  // Add a handleOpenCanvasForFix function to ChatWindow which passes the error message to CodeCanvas
  const handleOpenCanvasForFix = useCallback((errorMessage: string, codeId: string) => {
    // Check if user has access to the code fix feature
    if (!codeFixAccess.hasAccess) {
      toast({
        title: "Feature not available",
        description: `AI Code Fix requires a ${codeFixAccess.requiredTier} subscription.`,
        variant: "destructive",
        duration: 5000,
      })
      return
    }
    
    // Set current message index if we've passed a valid codeId
    const codeEntry = codeEntries.find(entry => entry.id === codeId);
    
    if (codeEntry) {
      // If we have a matching code entry, use it directly
      setCurrentMessageIndex(codeEntry.messageIndex);
      setCodeCanvasOpen(true);
      setHiddenCanvas(false);
      
      // Close sidebar if it's open
      if (setSidebarOpen) {
        setSidebarOpen(false);
      }
      
      // Mark as fixing
      setCodeFixState({ isFixing: true, codeBeingFixed: codeId });
      
      // Set the AI to fix this specific code with the provided error
      if (codeEntry.code) {
        logger.log("Setting up code fixing for:", codeId);
        
        try {
          // Store the error message in localStorage temporarily
          // This is a workaround to pass the error message to CodeCanvas
          // without having to modify all the prop chains
          localStorage.setItem('pending-error-fix', JSON.stringify({
            codeId,
            error: errorMessage,
            timestamp: Date.now()
          }));
        } catch (e) {
          console.error("Failed to store error fix data:", e);
        }
      }
    } else {
      // Otherwise, we need to search the message for appropriate code
      const aiMessages = messages.filter(m => m.sender === "ai");
      
      if (aiMessages.length > 0) {
        const lastAiMessage = aiMessages[aiMessages.length - 1];
        const messageIndex = messages.findIndex(m => m === lastAiMessage);
        
        if (messageIndex !== -1) {
          setCurrentMessageIndex(messageIndex);
          clearCodeEntriesKeepOutput();
          extractCodeFromMessages([lastAiMessage], messageIndex);
          setCodeCanvasOpen(true);
          setHiddenCanvas(false);
          
          // Store the error info for later use
          try {
            localStorage.setItem('pending-error-fix', JSON.stringify({
              codeId: 'new-code-' + Date.now(),
              error: errorMessage,
              timestamp: Date.now()
            }));
          } catch (e) {
            console.error("Failed to store error fix data:", e);
          }
        }
      }
    }
  }, [codeEntries, messages, clearCodeEntriesKeepOutput, extractCodeFromMessages, codeFixAccess]);

  // Modified CodeIndicator render function with feature access
  const renderCodeIndicator = (language: string, index: number, partIndex: number) => {
    const message = messages[index];
    return (
      <CodeIndicator
        key={`${index}-${partIndex}-code`}
        language={language}
        onClick={async () => {
          // When clicking on a code indicator, process the message and make the canvas visible
          setCurrentMessageIndex(index);
          clearCodeEntriesKeepOutput();
          
          // Make sure we're using the correct message_id
          const actualMessageId = message.message_id || index;
          logger.log(`Code indicator clicked for message at index ${index} with message_id: ${actualMessageId}`);
          
          // Extract code with the correct message ID - this will fetch the latest code if available
          await extractCodeFromMessages([message], actualMessageId);
          
          // Make the canvas visible
          setCodeCanvasOpen(true);
          setHiddenCanvas(false); // Make the canvas visible when clicked
          
          // Close sidebar if it's open
          if (setSidebarOpen) {
            setSidebarOpen(false);
          }
          
          // Show premium upgrade toast if needed
          if (!codeEditAccess.hasAccess) {
            toast({
              title: "Premium Feature",
              description: "AI Code Edit requires a paid subscription.",
              duration: 5000,
            });
          }
        }}
      />
    );
  };

  const renderMessage = (message: ChatMessage, index: number) => {
    if (typeof message.text === "object" && message.text.type === "plotly") {
      return (
        <motion.div key={index} className="flex justify-start mb-8">
          <div className="relative max-w-[95%] rounded-2xl p-6 bg-white shadow-md">
            <PlotlyChart data={message.text.data} layout={message.text.layout} />
          </div>
        </motion.div>
      )
    }
    
    // Process message to replace code blocks with indicators
    const messageContent = typeof message.text === 'string' 
      ? processMessageWithCodeIndicators(message, index) 
      : JSON.stringify(message.text);
    
    // Render the entire message
    return (
      <motion.div
        key={index}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={`flex ${message.sender === "user" ? "justify-end" : "justify-start"} mb-8`}
      >
        <div
          className={`relative rounded-2xl p-6 transition-shadow duration-200 hover:shadow-lg ${
            message.sender === "user"
              ? "bg-[#FF7F7F] text-white shadow-pink-200/50 max-w-[95%]"
              : "bg-white text-gray-900 shadow-md shadow-gray-200/50 max-w-full md:max-w-[95%] overflow-hidden"
          }`}
        >
          <div className={message.sender === "ai" ? "overflow-x-auto" : ""}>
            {Array.isArray(messageContent) ? (
              // Render message with code indicators
              messageContent.map((part, partIndex) => {
                if (typeof part === 'string') {
                  // Handle plotly blocks embedded in the string
                  if (part.includes('```plotly')) {
                    const plotlyParts = part.split(/(```plotly[\s\S]*?```)/);
                    return plotlyParts.map((plotlyPart, plotlyIndex) => {
                      if (plotlyPart.startsWith('```plotly') && plotlyPart.endsWith('```')) {
                        return renderPlotlyBlock(plotlyPart, `${index}-${partIndex}-${plotlyIndex}`);
                      } else if (plotlyPart.trim()) {
                        return <MessageContent 
                          key={`${index}-${partIndex}-${plotlyIndex}`} 
                          message={plotlyPart} 
                          fullMessage={typeof message.text === 'string' ? message.text : ''}
                          onCodeExecute={handleCodeExecute}
                          codeFixes={codeFixes}
                          setCodeFixes={setCodeFixes}
                          onOpenCanvas={handleOpenCanvasForFix}
                          isFixingError={codeFixState.isFixing}
                          isAIMessage={message.sender === "ai"}
                          messageId={message.message_id}
                          chatId={message.chat_id}
                          isLastPart={partIndex === messageContent.length - 1 && plotlyIndex === plotlyParts.length - 1}
                          outputs={codeOutputs[message.message_id || index] || []}
                        />;
                      }
                      return null;
                    });
                  }
                  // Regular text part
                  return <MessageContent 
                    key={`${index}-${partIndex}`} 
                    message={part} 
                    fullMessage={typeof message.text === 'string' ? message.text : ''}
                    onCodeExecute={handleCodeExecute}
                    codeFixes={codeFixes}
                    setCodeFixes={setCodeFixes}
                    onOpenCanvas={handleOpenCanvasForFix}
                    isFixingError={codeFixState.isFixing}
                    isAIMessage={message.sender === "ai"}
                    messageId={message.message_id}
                    chatId={message.chat_id}
                    isLastPart={partIndex === messageContent.length - 1}
                    outputs={codeOutputs[message.message_id || index] || []}
                  />;
                } else if (part.type === 'code') {
                  // Code indicator
                  return renderCodeIndicator(part.language, index, partIndex);
                }
                return null;
              })
            ) : (
              // Fallback for non-array content
              <MessageContent 
                message={typeof messageContent === 'string' ? messageContent : JSON.stringify(messageContent)} 
                fullMessage={typeof message.text === 'string' ? message.text : JSON.stringify(message.text)}
                onCodeExecute={handleCodeExecute}
                codeFixes={codeFixes}
                setCodeFixes={setCodeFixes}
                onOpenCanvas={handleOpenCanvasForFix}
                isFixingError={codeFixState.isFixing}
                isAIMessage={message.sender === "ai"}
                messageId={message.message_id}
                chatId={message.chat_id}
                isLastPart={true}
                outputs={codeOutputs[message.message_id || index] || []}
              />
            )}
          </div>
        </div>
      </motion.div>
    );
  };

  // Helper function to render Plotly blocks
  const renderPlotlyBlock = (plotlyPart: string, key: string) => {
    const plotlyContent = plotlyPart.slice(9, -3).trim();
    try {
      const plotlyData = JSON.parse(plotlyContent);
      if (plotlyData.data && plotlyData.data.length > 0) {
        return (
          <div key={key} className="w-full my-4 overflow-x-auto">
            <PlotlyChart data={plotlyData.data} layout={plotlyData.layout} />
          </div>
        );
          }
        } catch (e) {
      console.error("Error parsing Plotly data:", e);
          return (
        <div key={key} className="text-red-500 my-2">
          Error rendering Plotly chart
              </div>
      );
    }
    return null;
  };

  // Helper function to process table markers in error content (similar to processTableMarkersInOutput but with red styling)
  const processTableMarkersInErrorOutput = useCallback((content: string) => {
    const tableRegex = /<TABLE_START>\n?([\s\S]*?)\n?<TABLE_END>/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;
    let partIndex = 0;
    
    // Process all table markers
    while ((match = tableRegex.exec(content)) !== null) {
      // Add content before the table if any
      if (match.index > lastIndex) {
        const beforeContent = content.substring(lastIndex, match.index);
        if (beforeContent.trim()) {
          parts.push(
            <pre key={`before-${partIndex}`} className="text-xs text-red-700 font-mono whitespace-pre-wrap">
              {beforeContent}
            </pre>
          );
        }
      }
      
      // Process the table content
      const tableContent = match[1];
      
      // Simple table parser for errors - use better formatting
      const parseErrorTableContent = (content: string) => {
        return (
          <div className="overflow-x-auto max-w-full">
            <pre className="text-xs font-mono text-red-700 whitespace-pre leading-relaxed bg-red-25 p-2 rounded">
              {content}
            </pre>
          </div>
        );
      };
      
      // Add the formatted table with error styling
      parts.push(
        <div key={`table-${partIndex}`} className="bg-red-50 border border-red-200 rounded-md p-3 my-2">
          {parseErrorTableContent(tableContent)}
        </div>
      );
      
      lastIndex = match.index + match[0].length;
      partIndex++;
    }
    
    // Add remaining content after the last table
    if (lastIndex < content.length) {
      const remainingContent = content.substring(lastIndex);
      if (remainingContent.trim()) {
        parts.push(
          <pre key={`after-${partIndex}`} className="text-xs text-red-700 font-mono whitespace-pre-wrap">
            {remainingContent}
          </pre>
        );
      }
    }
    
    // If no tables were found, return the original content as pre
    if (parts.length === 0) {
      return (
        <pre className="text-xs text-red-700 font-mono whitespace-pre-wrap">
          {content}
        </pre>
      );
    }
    
    return <div>{parts}</div>;
  }, []);

  // Helper function to process table markers in output content
  const processTableMarkersInOutput = useCallback((content: string) => {
    const tableRegex = /<TABLE_START>\n?([\s\S]*?)\n?<TABLE_END>/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;
    let partIndex = 0;
    
    // Process all table markers
    while ((match = tableRegex.exec(content)) !== null) {
      // Add content before the table if any
      if (match.index > lastIndex) {
        const beforeContent = content.substring(lastIndex, match.index);
        if (beforeContent.trim()) {
          parts.push(
            <pre key={`before-${partIndex}`} className="text-xs text-gray-800 font-mono whitespace-pre-wrap">
              {beforeContent}
            </pre>
          );
        }
      }
      
      // Process the table content
      const tableContent = match[1];
      
      // Simple table parser for common pandas output formats
      const parseTableContent = (content: string) => {
        const lines = content.split('\n').filter(line => line.trim());
        if (lines.length === 0) return null;
        
        // Generic table parser that works for any table type
        const parseGenericTable = (tableLines: string[]) => {
          const rows: string[][] = [];
          
          // Parse all lines into potential columns
          tableLines.forEach(line => {
            if (line.trim()) {
              // Check if line contains pipe delimiters (new format)
              if (line.includes('|')) {
                // Split by pipe delimiter and trim each part
                const columns = line.split('|').map(col => col.trim()).filter(Boolean);
                if (columns.length > 0) {
                  rows.push(columns);
                }
              } else {
                // Fallback to old format - split on multiple spaces
                const columns = line.trim().split(/\s{2,}/).filter(col => col.trim());
                if (columns.length > 0) {
                  rows.push(columns);
                }
              }
            }
          });
          
          if (rows.length === 0) return null;
          
          // Find the maximum number of columns across all rows
          const maxCols = Math.max(...rows.map(row => row.length));
          
          // Step 1: Analyze the content and structure of the table
          // - Identify potential header rows (first row or rows with all text)
          // - Identify potential row labels (first column with text values)
          // - Determine if index column is used (first column with sequential numbers 0,1,2...)
          
          let hasHeaderRow = false;
          let headerRowIndex = -1;
          let hasRowLabels = false;
          let hasIndexColumn = false;
          let indexColumnIndex = -1;
          let rowLabelColumnIndex = 0; // Default to first column
          
          // Check first row - if it has mostly text, likely a header
          if (rows.length > 0 && rows[0].length > 0) {
            const firstRow = rows[0];
            const textCellCount = firstRow.filter(cell => isNaN(Number(cell))).length;
            hasHeaderRow = textCellCount / firstRow.length > 0.5; // If more than half are text
            if (hasHeaderRow) headerRowIndex = 0;
          }
          
          // Check first column - look for patterns
          if (rows.length > 2) {
            // If first column contains sequential numbers starting from 0 or 1, it's likely an index
            const firstColValues = rows.slice(hasHeaderRow ? 1 : 0).map(row => row[0]);
            
            // Check if first column is numeric and sequential
            if (firstColValues.every(val => !isNaN(Number(val)))) {
              const nums = firstColValues.map(Number);
              // Check if sequential (0,1,2... or 1,2,3...)
              const isSequential = nums.every((num, i) => 
                i === 0 || num === nums[i-1] + 1 || num === nums[i-1]);
                
              hasIndexColumn = isSequential;
              if (hasIndexColumn) indexColumnIndex = 0;
            }
            
            // If not index but has text values, likely row labels
            if (!hasIndexColumn) {
              // Check for row labels in first column
              const firstColLabels = firstColValues.some(val => 
                isNaN(Number(val)) && val.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/));
                
              hasRowLabels = firstColLabels;
              rowLabelColumnIndex = 0;
              
              // Special case: Sometimes row labels are last column in pandas dataframes
              if (!hasRowLabels && rows[0].length > 1) {
                const lastColValues = rows.slice(hasHeaderRow ? 1 : 0).map(row => 
                  row.length > 0 ? row[row.length-1] : '');
                const lastColLabels = lastColValues.some(val => 
                  isNaN(Number(val)) && val.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/));
                
                if (lastColLabels) {
                  hasRowLabels = true;
                  rowLabelColumnIndex = rows[0].length - 1;
                }
              }
              
              // Special case for "stories" or similar categorical columns that should be row labels
              // Check each column for keywords that suggest it should be a row label
              if (!hasRowLabels) {
                // Check header row for column names that suggest categorical values
                const rowLabelKeywords = ['stories', 'category', 'type', 'group', 'class', 'label', 'year'];
                
                if (hasHeaderRow && rows[0].length > 0) {
                  // Check each column in the header
                  for (let i = 0; i < rows[0].length; i++) {
                    const colName = rows[0][i].toLowerCase();
                    if (rowLabelKeywords.some(keyword => colName.includes(keyword))) {
                      // Found a likely row label column
                      hasRowLabels = true;
                      rowLabelColumnIndex = i;
                      break;
                    }
                  }
                }
                
                // If we still don't have row labels, check data rows for string values in any column
                if (!hasRowLabels) {
                  for (let colIdx = 0; colIdx < maxCols; colIdx++) {
                    // Skip the first column which was already checked
                    if (colIdx === 0) continue;
                    
                    const colValues = rows.slice(hasHeaderRow ? 1 : 0).map(row => 
                      colIdx < row.length ? row[colIdx] : '');
                    
                    // Check if this column has mostly text values
                    const textValues = colValues.filter(val => 
                      isNaN(Number(val)) && val.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/));
                    
                    if (textValues.length > colValues.length / 2) {
                      hasRowLabels = true;
                      rowLabelColumnIndex = colIdx;
                      break;
                    }
                  }
                }
              }
            }
          }
          
          // Step 2: Normalize the table based on detected structure
          const normalizedRows = rows.map((row, rowIndex) => {
            let normalizedRow = [...row];
            
            // Identify row type
            const isHeader = rowIndex === headerRowIndex;
            
            // Fix header row - ensure it aligns with data columns
            if (isHeader && normalizedRow.length < maxCols) {
              // Check if we need to add empty cells at beginning for alignment
              if (hasIndexColumn || hasRowLabels) {
                normalizedRow = ['', ...normalizedRow];
              }
              
              // Ensure row has maxCols columns
              while (normalizedRow.length < maxCols) {
                normalizedRow.push('');
              }
            }
            
            // For all rows, ensure consistent length
            while (normalizedRow.length < maxCols) {
              normalizedRow.push('');
            }
            
            // For data rows, check if row label needs to be moved to front
            if (!isHeader && hasRowLabels && rowLabelColumnIndex > 0) {
              // Move row label to front for consistent display
              const label = normalizedRow[rowLabelColumnIndex];
              normalizedRow.splice(rowLabelColumnIndex, 1); // Remove from original position
              normalizedRow.unshift(label); // Add to front
            }
            
            return {
              row: normalizedRow,
              isHeader,
              isDataRow: !isHeader && rowIndex > 0,
              hasRowLabel: hasRowLabels && !isHeader,
              hasIndexColumn: hasIndexColumn && !isHeader
            };
          });
          
          return {
            rows: normalizedRows,
            hasHeaderRow,
            hasRowLabels,
            hasIndexColumn,
            headerRowIndex,
            rowLabelColumnIndex,
            indexColumnIndex
          };
        };
        
        const tableInfo = parseGenericTable(lines);
        if (!tableInfo) return null;
        
        const { rows, hasHeaderRow, hasRowLabels } = tableInfo;
        
        return (
          <div className="overflow-x-auto max-w-full">
            <table className="min-w-full text-sm">
              <tbody>
                {rows.map((rowInfo, rowIndex) => {
                  const { row, isHeader, isDataRow, hasRowLabel, hasIndexColumn } = rowInfo;
                  
                  return (
                    <tr key={rowIndex} className={isHeader ? "bg-gray-100" : "hover:bg-gray-25"}>
                      {row.map((cell, cellIndex) => {
                        const isNumber = !isNaN(Number(cell.replace(/,/g, ''))) && cell !== '' && !isHeader;
                        const isFirstCol = cellIndex === 0;
                        const isRowLabel = hasRowLabel && isFirstCol;
                        const isIndex = hasIndexColumn && isFirstCol;
                        const isColumnHeader = isHeader && cell !== '';
                        const isEmpty = cell === '';
                        
                        return (
                          <td 
                            key={cellIndex} 
                            className={`px-2 py-1.5 font-mono text-xs border-r border-gray-150 last:border-r-0 ${
                              isColumnHeader ? 'font-semibold text-gray-900 bg-gray-100' : 
                              isRowLabel ? 'font-semibold text-gray-900 bg-gray-50' : ''
                            } ${
                              isEmpty ? 'bg-gray-100' :
                              isColumnHeader ? 'text-center bg-gray-100' :
                              isRowLabel ? 'text-left min-w-16 bg-gray-50' :
                              isIndex ? 'text-center min-w-10 bg-gray-50' :
                              isNumber ? 'text-right text-gray-700 min-w-16' : 
                              'text-center text-gray-700'
                            }`}
                          >
                            {isNumber ? Number(cell.replace(/,/g, '')).toLocaleString() : cell}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      };
      
      // Add the formatted table with simpler styling
      parts.push(
        <div key={`table-${partIndex}`} className="bg-white border border-gray-200 rounded-lg p-3 my-2 shadow-sm">
          {parseTableContent(tableContent)}
        </div>
      );
      
      lastIndex = match.index + match[0].length;
      partIndex++;
    }
    
    // Add remaining content after the last table
    if (lastIndex < content.length) {
      const remainingContent = content.substring(lastIndex);
      if (remainingContent.trim()) {
        parts.push(
          <pre key={`after-${partIndex}`} className="text-xs text-gray-800 font-mono whitespace-pre-wrap">
            {remainingContent}
          </pre>
        );
      }
    }
    
    // If no tables were found, return the original content as pre
    if (parts.length === 0) {
      return (
        <pre className="text-xs text-gray-800 font-mono whitespace-pre-wrap overflow-auto max-h-[400px]">
          {content}
        </pre>
      );
    }
    
    return <div>{parts}</div>;
  }, []);

  // Update the renderCodeOutputs function to include fullscreen buttons
  const renderCodeOutputs = (messageIndex: number) => {
    // Detect if we have an actual message ID or just an array index
    const message = messages[messageIndex];
    const actualMessageId = message?.message_id || messageIndex;
    
    // Get outputs for this specific message
    const relevantOutputs = codeOutputs[actualMessageId] || [];
    
    if (relevantOutputs.length === 0) return null;
    
    // Group outputs by type for organized display
    const errorOutputs = relevantOutputs.filter(output => output.type === 'error');
    const textOutputs = relevantOutputs.filter(output => output.type === 'output');
    const plotlyOutputs = relevantOutputs.filter(output => output.type === 'plotly');
    const matplotlibOutputs = relevantOutputs.filter(output => output.type === 'matplotlib');
    
    return (
      <div className="mt-2 space-y-4">
        {/* Show error outputs first */}
        {errorOutputs.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3 overflow-auto relative">
            <div className="flex items-center text-red-600 font-medium mb-2">
              <AlertTriangle size={16} className="mr-2" />
              Error Output
            </div>
            
            {errorOutputs[0].codeId && (
              <CodeFixButton
                codeId={errorOutputs[0].codeId}
                errorOutput={errorOutputs[0].content as string}
                code={codeEntries.find(entry => entry.id === errorOutputs[0].codeId)?.code || ''}
                isFixing={codeFixState.isFixing && codeFixState.codeBeingFixed === errorOutputs[0].codeId}
                codeFixes={codeFixes}
                sessionId={sessionId || storeSessionId || ''}
                onFixStart={handleFixStart}
                onFixComplete={handleFixComplete}
                onCreditCheck={handleCreditCheck}
                variant="inline"
              />
            )}
            
            {(() => {
              const content = errorOutputs[0].content;
              
              // Process table markers in the content
              return processTableMarkersInErrorOutput(content as string);
            })()}
          </div>
        )}
        
        {/* Show text outputs */}
        {textOutputs.length > 0 && (
          <div className="bg-gray-50 border border-gray-200 rounded-md p-3 relative">
            <div className="flex items-center text-gray-700 font-medium mb-2">
              Output
            </div>
            
            {/* Add a fix button for outputs that look like errors */}
            {textOutputs[0].codeId && 
             (textOutputs[0].content.toString().toLowerCase().includes("error") || 
              textOutputs[0].content.toString().toLowerCase().includes("traceback") || 
              textOutputs[0].content.toString().toLowerCase().includes("exception")) && (
              <CodeFixButton
                codeId={textOutputs[0].codeId}
                errorOutput={textOutputs[0].content as string}
                code={codeEntries.find(entry => entry.id === textOutputs[0].codeId)?.code || ''}
                isFixing={codeFixState.isFixing && codeFixState.codeBeingFixed === textOutputs[0].codeId}
                codeFixes={codeFixes}
                sessionId={sessionId || storeSessionId || ''}
                onFixStart={handleFixStart}
                onFixComplete={handleFixComplete}
                onCreditCheck={handleCreditCheck}
                variant="inline"
              />
            )}
            
            {(() => {
              const content = textOutputs[0].content;
              
              // Process table markers in the content
              return processTableMarkersInOutput(content as string);
            })()}
          </div>
        )}
        
        {/* Show plotly visualizations with pin and fullscreen buttons */}
        {plotlyOutputs.map((output, idx) => {
          const codeEntry = codeEntries.find(entry => entry.id === output.codeId);
          const currentCode = codeEntry?.code || '';
          const isPinned = isVisualizationPinned(output.content, currentCode, idx);
          
          return (
            <div key={`plotly-${messageIndex}-${idx}`} className="bg-white border border-gray-200 rounded-md p-3 overflow-auto relative">
              <div className="flex items-center justify-between text-gray-700 font-medium mb-2">
                <span>📊 Interactive Visualization</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFullscreenViz({ type: 'plotly', content: output.content })}
                    className="flex items-center gap-1 h-7 px-2 text-xs text-gray-600 border-gray-300 hover:bg-gray-100"
                  >
                    <Maximize2 className="h-3 w-3" />
                    <span className="hidden sm:inline">Fullscreen</span>
                  </Button>
                  <Button
                    variant={isPinned ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      const currentCode = codeEntries.find(entry => entry.id === output.codeId)?.code || '';
                      console.log('Pin click - Code found:', !!currentCode, 'CodeId:', output.codeId, 'Available entries:', codeEntries.map(e => e.id));
                      
                      if (currentCode) {
                        togglePinVisualization(output.content, currentCode, 'plotly', idx);
                      } else {
                        // FALLBACK: Try to extract code from the output content itself
                        console.warn('No code found for codeId:', output.codeId);
                        
                        // Check if we can get the code from the message content
                        const messageWithCode = localMessages.find(msg => 
                          msg.text && typeof msg.text === 'string' && 
                          msg.text.includes('```') && 
                          msg.text.includes('python')
                        );
                        
                        if (messageWithCode && typeof messageWithCode.text === 'string') {
                          // Extract code from markdown
                          const codeMatch = messageWithCode.text.match(/```python\n([\s\S]*?)\n```/);
                          if (codeMatch && codeMatch[1]) {
                            console.log('Using fallback code extraction');
                            togglePinVisualization(output.content, codeMatch[1], 'plotly', idx);
                            return;
                          }
                        }
                        
                        // If still no code found, show error
                        toast({
                          title: "Cannot Pin Visualization",
                          description: "Code data is missing. Please refresh and try again.",
                          variant: "destructive",
                          duration: 5000
                        });
                      }
                    }}
                    className={`flex items-center gap-1 h-7 px-2 text-xs ${
                      isPinned 
                        ? 'bg-[#FF7F7F] hover:bg-[#FF6666] text-white' 
                        : 'text-[#FF7F7F] border-[#FF7F7F] hover:bg-[#FF7F7F] hover:text-white'
                    }`}
                  >
                    {isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                    <span className="hidden sm:inline">
                      {isPinned ? 'Unpin' : 'Pin'}
                    </span>
                  </Button>
                </div>
              </div>
              
              <div className="w-full">
                <PlotlyChart data={output.content.data} layout={output.content.layout} />
              </div>
            </div>
          );
        })}
        
        {/* Render matplotlib charts with pin and fullscreen buttons */}
        {matplotlibOutputs.map((output, idx) => {
          const codeEntry = codeEntries.find(entry => entry.id === output.codeId);
          const currentCode = codeEntry?.code || '';
          const isPinned = isVisualizationPinned(output.content, currentCode, idx);
          
          return (
            <div key={`matplotlib-${messageIndex}-${idx}`} className="bg-white border border-gray-200 rounded-md p-3 overflow-auto relative">
              <div className="flex items-center justify-between text-gray-700 font-medium mb-2">
                <span>📈 Chart Visualization</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFullscreenViz({ type: 'matplotlib', content: output.content })}
                    className="flex items-center gap-1 h-7 px-2 text-xs text-gray-600 border-gray-300 hover:bg-gray-100"
                  >
                    <Maximize2 className="h-3 w-3" />
                    <span className="hidden sm:inline">Fullscreen</span>
                  </Button>
                  <Button
                    variant={isPinned ? "default" : "outline"}
                    size="sm"
                    onClick={() => togglePinVisualization(output.content, currentCode, 'matplotlib', idx)}
                    className={`flex items-center gap-1 h-7 px-2 text-xs ${
                      isPinned 
                        ? 'bg-[#FF7F7F] hover:bg-[#FF6666] text-white' 
                        : 'text-[#FF7F7F] border-[#FF7F7F] hover:bg-[#FF7F7F] hover:text-white'
                    }`}
                  >
                    {isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                    <span className="hidden sm:inline">
                      {isPinned ? 'Unpin' : 'Pin'}
                    </span>
                  </Button>
                </div>
              </div>
              
              <div className="w-full">
                <MatplotlibChart imageData={output.content} />
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Modified render message function to include code outputs
  const renderMessageWithOutputs = (message: ChatMessage, index: number) => {
    const renderedMessage = renderMessage(message, index);
    const codeOutputsComponent = renderCodeOutputs(index);
    
    if (!codeOutputsComponent) {
      return renderedMessage;
    }
    
    // If we have both message and outputs, wrap them together
    return (
      <div key={`message-with-outputs-${index}`} className="mb-8">
        {renderedMessage}
        {codeOutputsComponent}
      </div>
    );
  };

  return (
    <div className="h-full overflow-hidden flex flex-col relative">
      <div 
        ref={chatWindowRef}
        className={`flex-1 overflow-y-auto transition-all duration-300 ${codeCanvasOpen && !hiddenCanvas ? 'pr-[50%]' : ''}`}
      >
        {showWelcome ? (
          <WelcomeSection onSampleQueryClick={(query) => {
            clearCodeEntries(); // Clear ALL code canvas data for new chat
            onSendMessage(query);
          }} />
        ) : (
          <div className="max-w-4xl mx-auto py-8 px-4">
            <div className="space-y-8">
              {messages.length > 0 ? (
                messages.map((message, index) => renderMessageWithOutputs(message, index))
              ) : (
                <div className="text-center text-gray-500">No messages yet</div>
              )}
            </div>
          </div>
        )}
        
        {isLoading && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="flex justify-start mb-8 max-w-4xl mx-auto px-4"
          >
            {/* Simple loading with just spinner and text - no background */}
            <div className="flex items-center space-x-3">
              <Loader2 className="w-5 h-5 text-[#FF7F7F] animate-spin" />
              <SimpleThinkingLoader />
            </div>
          </motion.div>
        )}
        <div ref={messagesEndRef} />
      </div>
      
      {/* Fullscreen Modal for visualizations */}
      {fullscreenViz && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full h-full max-w-[95vw] max-h-[95vh] flex flex-col">
            {/* Header with close button */}
            <div className="flex justify-between items-center p-4 border-b bg-white rounded-t-lg">
              <h2 className="text-xl font-semibold">
                {fullscreenViz.type === 'plotly' ? '📊 Interactive Visualization' : '📈 Chart Visualization'}
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFullscreenViz(null)}
                className="h-8 w-8 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            
            {/* Full chart area */}
            <div className="flex-1 p-4 overflow-hidden">
              {fullscreenViz.type === 'plotly' ? (
                <div className="w-full h-full">
                  <PlotlyChart data={fullscreenViz.content.data} layout={fullscreenViz.content.layout} />
                </div>
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <MatplotlibChart imageData={fullscreenViz.content} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* Code Canvas - always render it if we have code, but control visibility */}
      {currentMessageIndex !== null && codeEntries.length > 0 && (
        <CodeCanvas 
          isOpen={codeCanvasOpen}
          onToggle={handleCanvasToggle}
          codeEntries={codeEntries}
          onCodeExecute={handleCodeCanvasExecute}
          chatCompleted={chatCompleted}
          hiddenCanvas={hiddenCanvas}
          // @ts-ignore - We'll add these props to CodeCanvas in the next step
          codeFixes={codeFixes}
          setCodeFixes={setCodeFixes}
          setCodeEntries={setCodeEntries}
        />
      )}
    </div>
  )
}

export default React.memo(ChatWindow)
