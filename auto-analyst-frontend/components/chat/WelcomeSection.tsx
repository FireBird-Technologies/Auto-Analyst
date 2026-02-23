"use client"

import { motion } from "framer-motion"
import { LineChart, Bot, Database, Code2 } from "lucide-react"

interface WelcomeSectionProps {
  onSampleQueryClick: (message: string) => void
}


const sampleQueries = [
  {
    text: "@data_viz_agent tell me visually how the numbers are changing, what is growing & what is in decline",
    icon: <LineChart className="w-5 h-5" />,
    description: "Get comprehensive data analysis and visualizations",
  },
  {
    text: "@data_viz_agent visualize this entire dataset",
    icon: <Bot className="w-5 h-5" />,
    description: "Use specialized agents for specific tasks",
  },
  {
    text: "Build me a Dashboard",
    icon: <LineChart className="w-5 h-5" />,
    description: "See all of your data visualized",
  },
  {
    text: "What are the key insights from this data? @preprocessing_agent?",
    icon: <Database className="w-5 h-5" />,
    description: "Extract meaningful insights from your data",
  }
]

export default function WelcomeSection({ onSampleQueryClick }: WelcomeSectionProps) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-5xl mx-auto px-4 py-8">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold mb-2">Welcome to Auto-Analyst</h1>
        <p className="text-gray-600">Your AI data assistant. Upload data and start analyzing.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        {/* Left Column - Try These */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-xl font-semibold mb-2">Try These</h2>
          <div className="space-y-1">
            {sampleQueries.map((query, index) => (
              <div
                key={index}
                className="flex gap-3 cursor-pointer group p-3 rounded-lg transition-all duration-200 ease-in-out hover:bg-gray-100"
                onClick={() => onSampleQueryClick(query.text)}
              >
                <div className="text-[#FF7F7F] mt-1 transition-transform duration-200 ease-in-out group-hover:scale-110">
                  {query.icon}
                </div>
                <div className="transition-all duration-200 ease-in-out group-hover:translate-x-1">
                  <p className="text-gray-800 text-sm font-medium mb-0.5 group-hover:text-gray-900">{query.text}</p>
                  <p className="text-gray-500 text-xs group-hover:text-gray-600">{query.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column - Features & Quick Start */}
        <div className="space-y-12">
          {/* Features */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-xl font-semibold mb-4">Features</h2>
            <div className="grid grid-cols-2 gap-y-2">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-[#FF7F7F] rounded-full" />
                <span className="text-gray-600 text-sm">Data Analysis</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-[#FF7F7F] rounded-full" />
                <span className="text-gray-600 text-sm">Visualizations</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-[#FF7F7F] rounded-full" />
                <span className="text-gray-600 text-sm">AI Agents</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-[#FF7F7F] rounded-full" />
                <span className="text-gray-600 text-sm">Code Gen</span>
              </div>
            </div>
          </div>

          {/* Quick Start */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-xl font-semibold mb-4">Quick Start</h2>
            <div className="grid grid-cols-2 gap-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[#FF7F7F]">1.</span>
                <span className="text-gray-600 text-sm">Upload Data</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#FF7F7F]">2.</span>
                <span className="text-gray-600 text-sm">Ask Away</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#FF7F7F]">3.</span>
                <span className="text-gray-600 text-sm">Use @agents</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#FF7F7F]">4.</span>
                <span className="text-gray-600 text-sm">Get Results</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

