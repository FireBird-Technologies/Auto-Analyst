"use client"

import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import API_URL from '@/config/api'
import { useSessionStore } from '@/lib/store/sessionStore'
import apiClient from '@/lib/api/axiosConfig'

// Export the interface (was missing export)
export interface AgentInfo {
  name: string;
  description?: string;
}

export function useAgentMentions(sessionId?: string | null) {
  const [availableAgents, setAvailableAgents] = useState<AgentInfo[]>([])
  const [showAgentMentions, setShowAgentMentions] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 })
  const [filteredAgents, setFilteredAgents] = useState<AgentInfo[]>([])
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0)
  const mentionRef = useRef<HTMLDivElement>(null)

  // Fixed fetch function with proper sessionId handling
  useEffect(() => {
    const fetchAgents = async () => {
      try {
        console.log('🔄 Fetching agents...')
        
        // Use apiClient instead of axios - it will auto-handle sessionId
        const response = await apiClient.get('/agents')
        
        console.log('📋 Agents response:', response.data)
        
        if (response.data && response.data.available_agents) {
          const agentList = response.data.available_agents.map((name: string) => ({
            name,
            description: `Specialized ${name.replace(/_/g, " ")} agent`,
          }))
          setAvailableAgents(agentList)
          console.log('✅ Agents set:', agentList)
        } else {
          console.log('❌ Invalid agents response format')
          setAvailableAgents([])
        }
      } catch (error) {
        console.error('❌ Error fetching agents:', error)
        setAvailableAgents([])
      }
    }

    fetchAgents()
  }, [sessionId])

  // Filter agents based on mention query
  useEffect(() => {
    if (mentionQuery.trim() === '') {
      setFilteredAgents(availableAgents)
    } else {
      const filtered = availableAgents.filter(agent =>
        agent.name.toLowerCase().includes(mentionQuery.toLowerCase())
      )
      setFilteredAgents(filtered)
    }
    setSelectedMentionIndex(0)
  }, [mentionQuery, availableAgents])

  const showMentions = (position: { top: number; left: number }, query: string) => {
    console.log('🔍 Showing mentions at position:', position, 'query:', query)
    setMentionPosition(position)
    setMentionQuery(query)
    setShowAgentMentions(true)
    setSelectedMentionIndex(0)
  }

  const hideMentions = () => {
    console.log('❌ Hiding mentions')
    setShowAgentMentions(false)
    setMentionQuery('')
    setSelectedMentionIndex(0)
  }

  const selectAgent = (agent: AgentInfo) => {
    hideMentions()
    return agent
  }

  // Separate functions for document listener vs component
  const parseMention = (value: string, cursorPosition: number) => {
    console.log('🔍 Parsing mention - value:', value, 'cursor:', cursorPosition)
    
    let i = cursorPosition - 1
    while (i >= 0 && value[i] !== '@' && value[i] !== ' ' && value[i] !== '\n') i--
    
    if (i >= 0 && value[i] === '@') {
      const start = i
      const end = cursorPosition
      const query = value.slice(start + 1, end)
      console.log('✅ Found mention - start:', start, 'end:', end, 'query:', query)
      return { start, end, query }
    }
    
    console.log('❌ No mention found')
    return null
  }

  const handleDocumentKeyDown = (event: KeyboardEvent) => {
    if (!showAgentMentions || filteredAgents.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedMentionIndex((i) => (i + 1) % filteredAgents.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedMentionIndex((i) => (i - 1 + filteredAgents.length) % filteredAgents.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const agent = filteredAgents[selectedMentionIndex]
      if (agent) {
        ;(window as any).__aa_selected_agent__ = agent
      }
    } else if (event.key === 'Tab') {
      event.preventDefault()
      const agent = filteredAgents[selectedMentionIndex]
      if (agent) {
        ;(window as any).__aa_selected_agent__ = agent
      }
    } else if (event.key === 'Escape') {
      hideMentions()
    }
  }

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>, 
    message: string, 
    cursorPosition: number, 
    target: HTMLTextAreaElement
  ) => {
    handleDocumentKeyDown(event.nativeEvent as KeyboardEvent)
  }

  // Fixed event listener
  useEffect(() => {
    document.addEventListener('keydown', handleDocumentKeyDown)
    return () => document.removeEventListener('keydown', handleDocumentKeyDown)
  }, [showAgentMentions, filteredAgents, selectedMentionIndex])

  // DEFAULT ABOVE: anchor to textarea top
  const handleInputChange = (value: string, cursorPosition: number, target: HTMLTextAreaElement) => {
    console.log('📝 Input change - value:', value, 'cursor:', cursorPosition)
    
    const mention = parseMention(value, cursorPosition)
    if (mention) {
      const rect = target.getBoundingClientRect()
      const position = { top: rect.top + window.scrollY, left: rect.left + window.scrollX }
      console.log('📍 Setting mention position:', position)
      setMentionPosition(position)
      setMentionQuery(mention.query)
      setShowAgentMentions(true)
      console.log('✅ Mentions should be visible now')
    } else {
      hideMentions()
    }
  }

  const handleMentionSelect = (agent: AgentInfo) => selectAgent(agent)

  const getReplacementRange = (value: string, cursorPosition: number) => {
    const m = parseMention(value, cursorPosition)
    if (!m) return null
    return { start: m.start, end: m.end }
  }

  return {
    availableAgents,
    showAgentMentions,
    mentionQuery,
    mentionPosition,
    filteredAgents,
    selectedMentionIndex,
    mentionRef,
    showMentions,
    hideMentions,
    selectAgent,
    handleInputChange,     // Fixed signature
    handleMentionSelect,
    handleKeyDown,         // Fixed signature
    getReplacementRange,
  }
}
