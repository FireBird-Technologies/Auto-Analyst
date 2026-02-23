import React, { useEffect,  useState } from "react"
import { motion } from "framer-motion"
const ChatProcessingSpin = () => {
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
        setCurrentIndex((prev: number) => (prev + 1) % thinkingTexts.length)
      }, 3500) // Change text every 1.5 seconds
  
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

  export default ChatProcessingSpin