"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import Image from "next/image"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { 
  Database, 
  Bot, 
  Network, 
  Server, 
  MessageSquare, 
  ArrowRight,
  Facebook,
  Linkedin,
  LineChart,
  Chrome,
  Loader2,
  ArrowLeft
} from "lucide-react"

const features = [
  {
    icon: Network,
    title: "Custom API Integration",
    description: "Seamlessly connect with your marketing platforms",
    examples: [
      { icon: Facebook, name: "Meta Ads" },
      { icon: Linkedin, name: "LinkedIn Analytics" },
      { icon: Chrome, name: "Google Ads" }
    ]
  },
  {
    icon: Database,
    title: "SQL Database Integration",
    description: "On-premise deployment with direct database connections",
    subFeatures: ["Secure data handling", "Real-time sync", "Custom schema support"]
  },
  {
    icon: Bot,
    title: "Custom Analysis Agents",
    description: "Tailored AI agents that match your analysis workflow",
    subFeatures: ["Industry-specific analysis", "Custom metrics", "Automated reporting"]
  },
  {
    icon: MessageSquare,
    title: "LLM API Support",
    description: "Integration with all major language models",
    subFeatures: ["OpenAI", "Anthropic", "Custom deployment"]
  }
]

interface FormData {
  name: string
  email: string
  company: string
  budget?: string
  message: string
}

export default function EnterprisePage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formData, setFormData] = useState<FormData>({
    name: "",
    email: "",
    company: "",
    budget: "",
    message: ""
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)
    
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      if (response.ok) {
        setSubmitted(true)
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to submit form. Please try again.')
      }
    } catch (error) {
      console.error('Error submitting form:', error)
      setError('Network error. Please check your connection and try again.')
    }
    
    setIsLoading(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white">
      {/* Back to Home Button */}
      <div className="container mx-auto px-4 pt-6">
        <Link href="/" passHref>
          <button className="flex items-center text-gray-700 hover:text-[#FF7F7F] transition-colors">
            <ArrowLeft className="h-5 w-5 mr-2" />
            Back to Home
          </button>
        </Link>
      </div>
      
      {/* Hero Section */}
      <section className="pt-20 pb-16">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center max-w-4xl mx-auto"
          >
            <h1 className="text-5xl font-bold text-gray-900 mb-6">
              Enterprise-Grade Analytics Solution
            </h1>
            <p className="text-xl text-gray-600 mb-8">
              Customize Auto-Analyst to your organization's specific needs with our enterprise solutions
            </p>
          </motion.div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-16 bg-white">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-2 gap-8">
            {features.map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                viewport={{ once: true }}
                className="p-8 rounded-2xl bg-gray-50 hover:shadow-xl transition-all duration-300"
              >
                <feature.icon className="w-12 h-12 text-[#FF7F7F] mb-4" />
                <h3 className="text-2xl font-semibold text-gray-900 mb-4">{feature.title}</h3>
                <p className="text-gray-600 mb-6">{feature.description}</p>
                
                {feature.examples && (
                  <div className="flex gap-4 mt-4">
                    {feature.examples.map((example, i) => (
                      <div key={i} className="flex items-center gap-2 text-gray-700">
                        <example.icon className="w-5 h-5" />
                        <span>{example.name}</span>
                      </div>
                    ))}
                  </div>
                )}
                
                {feature.subFeatures && (
                  <ul className="space-y-2 mt-4">
                    {feature.subFeatures.map((subFeature, i) => (
                      <li key={i} className="flex items-center gap-2 text-gray-700">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#FF7F7F]" />
                        {subFeature}
                      </li>
                    ))}
                  </ul>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact Form */}
      <section className="py-16 bg-white">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="bg-white rounded-2xl shadow-xl p-8"
            >
              {submitted ? (
                <div className="text-center py-8">
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">Thank You!</h2>
                  <p className="text-gray-600 mb-6">
                    We'll be in touch with you shortly.
                  </p>
                </div>
              ) : (
                <>
                  <h2 className="text-3xl font-bold text-gray-900 mb-6">Contact Us</h2>
                  {error && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-600">
                      <p>{error}</p>
                    </div>
                  )}
                  <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Name
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.name}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({...formData, name: e.target.value})}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#FF7F7F] focus:border-transparent text-black"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Business Email
                      </label>
                      <input
                        type="email"
                        required
                        value={formData.email}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({...formData, email: e.target.value})}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#FF7F7F] focus:border-transparent text-black"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Company
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.company}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({...formData, company: e.target.value})}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#FF7F7F] focus:border-transparent text-black"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Budget (USD)
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.budget}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({...formData, budget: e.target.value})}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#FF7F7F] focus:border-transparent text-black"
                        placeholder="Enter your budget"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Message
                      </label>
                      <textarea
                        required
                        value={formData.message}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFormData({...formData, message: e.target.value})}
                        rows={4}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#FF7F7F] focus:border-transparent text-black"
                        placeholder="Tell us about your needs..."
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isLoading}
                      className="w-full bg-[#FF7F7F] text-white px-6 py-3 rounded-full hover:bg-[#FF6666] disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Submitting...
                        </>
                      ) : (
                        'Contact Us'
                      )}
                    </button>
                  </form>
                </>
              )}
            </motion.div>
          </div>
        </div>
      </section>
    </div>
  )
} 