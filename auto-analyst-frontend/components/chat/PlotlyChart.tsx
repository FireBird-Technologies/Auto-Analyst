"use client"

import dynamic from "next/dynamic"
import React, { useRef, useEffect, useState, useCallback, useMemo } from "react"

// Dynamically import Plot to avoid SSR issues
const Plot = dynamic(() => import("react-plotly.js"), { ssr: false })

interface PlotlyChartProps {
  data: any[]
  layout?: any
  isFullscreen?: boolean
}

const PlotlyChart: React.FC<PlotlyChartProps> = ({ data, layout = {}, isFullscreen = false }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })

  const updateDimensions = useCallback(() => {
    if (containerRef.current) {
      const container = containerRef.current
      
      if (isFullscreen) {
        // For fullscreen: get the actual available space from the container
        const containerRect = container.getBoundingClientRect()
        
        // Use the actual container dimensions, accounting for padding and margins
        const availableWidth = containerRect.width - 120 // Account for plot margins (60px each side)
        const availableHeight = containerRect.height - 120 // Account for plot margins (60px each side)
        
        // Ensure minimum sizes and reasonable maximums
        const width = Math.min(Math.max(availableWidth, 400), 1400)
        const height = Math.min(Math.max(availableHeight, 300), 800)
        
        console.log('Fullscreen dimensions:', { 
          width, 
          height, 
          containerWidth: containerRect.width, 
          containerHeight: containerRect.height,
          availableWidth, 
          availableHeight 
        })
        
        setDimensions((prev: { width: number; height: number }) => {
          if (prev.width !== width || prev.height !== height) {
            return { width, height }
          }
          return prev
        })
      } else {
        // For regular view: use container-based calculation
        const parentWidth = container.parentElement?.getBoundingClientRect().width || 0
        const width = Math.max(parentWidth - 40, 600)
        const height = Math.max(width * 0.6, 400)
        setDimensions((prev: { width: number; height: number }) => {
          if (prev.width !== width || prev.height !== height) {
            return { width, height }
          }
          return prev
        })
      }
    }
  }, [isFullscreen])

  useEffect(() => {
    // Add a small delay to ensure the modal is fully rendered
    const timer = setTimeout(() => {
      updateDimensions()
    }, isFullscreen ? 100 : 0)
    
    const resizeObserver = new ResizeObserver(updateDimensions)
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }
    
    // For fullscreen, also listen to window resize
    if (isFullscreen) {
      window.addEventListener('resize', updateDimensions)
    }
    
    return () => {
      clearTimeout(timer)
      if (containerRef.current) {
        resizeObserver.unobserve(containerRef.current)
      }
      resizeObserver.disconnect()
      if (isFullscreen) {
        window.removeEventListener('resize', updateDimensions)
      }
    }
  }, [updateDimensions, isFullscreen])

  const memoizedLayout = useMemo(() => ({
    ...layout,
    width: dimensions.width,
    height: dimensions.height,
    margin: isFullscreen ? { t: 60, b: 60, l: 60, r: 60 } : { t: 50, b: 50, l: 50, r: 50 },
    autosize: false,
    paper_bgcolor: isFullscreen ? "white" : "transparent",
    plot_bgcolor: isFullscreen ? "white" : "transparent",
    font: {
      ...layout.font,
      size: isFullscreen ? 14 : (layout.font?.size || 12),
    },
    xaxis: {
      ...layout.xaxis,
      automargin: true,
    },
    yaxis: {
      ...layout.yaxis,
      automargin: true,
    },
  }), [layout, dimensions.width, dimensions.height, isFullscreen])

  const memoizedConfig = useMemo(() => ({
    responsive: false,
    displayModeBar: true,
    displaylogo: false,
  }), [])

  const memoizedStyle = useMemo(() => ({
    width: `${dimensions.width}px`,
    height: `${dimensions.height}px`,
  }), [dimensions.width, dimensions.height])

  return (
    <div ref={containerRef} className={`overflow-hidden ${isFullscreen ? 'w-full h-full flex items-center justify-center' : 'px-2'}`}>
      <Plot
        data={data}
        layout={memoizedLayout}
        config={memoizedConfig}
        style={memoizedStyle}
      />
    </div>
  )
}

export default React.memo(PlotlyChart)
