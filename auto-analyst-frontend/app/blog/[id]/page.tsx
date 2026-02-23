"use client"

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowLeft, Calendar, User, Tag, Clock } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import { BlogPost as BlogPostType } from '@/components/blog/types'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface BlogPostPageProps {
  params: {
    id: string
  }
}

export default function BlogPostPage({ params }: BlogPostPageProps) {
  const [post, setPost] = useState<BlogPostType | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    const loadPost = async () => {
      try {
        setLoading(true)
        setError(null)
        
        const response = await fetch(`${API_BASE_URL}/api/blog/posts/${params.id}`)
        
        if (!response.ok) {
          throw new Error(`Failed to fetch post: ${response.statusText}`)
        }
        
        const data = await response.json()
        setPost(data)
      } catch (error) {
        console.error('Error loading post:', error)
        setError(error instanceof Error ? error.message : 'Failed to load blog post')
      } finally {
        setLoading(false)
      }
    }
    
    loadPost()
  }, [params.id])

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-[#FF7F7F] mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading blog post...</p>
        </div>
      </div>
    )
  }

  if (error || !post) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 text-xl mb-4">Error Loading Blog Post</div>
          <p className="text-gray-600 mb-4">{error || 'Post not found'}</p>
          <Button 
            onClick={() => router.push('/blog')}
            className="bg-[#FF7F7F] text-white hover:bg-[#FF6666]"
          >
            Back to Blog
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white">
      {/* Navigation */}
      <nav className="sticky top-0 left-0 right-0 w-full z-50 bg-white/90 backdrop-blur-sm shadow-sm border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-2 flex flex-row justify-between items-center">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => router.push('/blog')}
              className="text-lg font-semibold text-gray-900"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Blog
            </Button>
          </div>
          <div className="flex flex-row gap-2">
            <Button
              onClick={() => router.push('/pricing')}
              className="bg-white text-[#FF7F7F] border border-[#FF7F7F] hover:bg-gray-50 shadow-sm"
            >
              Pricing
            </Button>
            <Button
              onClick={() => router.push('/login')}
              className="bg-[#FF7F7F] text-white hover:bg-[#FF6666] shadow-md"
            >
              Try Auto-Analyst
            </Button>
          </div>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Post Header */}
        <Card className="mb-8">
          <CardHeader>
            <div className="flex items-center gap-2 mb-4">
              {post.featured && <Badge className="bg-[#FF7F7F]">Featured</Badge>}
            </div>
            <CardTitle className="text-3xl font-bold mb-4">{post.title}</CardTitle>
            <CardDescription className="text-lg text-gray-600 mb-6">
              {post.excerpt}
            </CardDescription>
            
            <div className="flex items-center gap-6 text-sm text-gray-500 mb-4">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4" />
                {post.author}
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {new Date(post.publishedAt).toLocaleDateString()}
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                {post.readTime}
              </div>
            </div>
            
            <div className="flex flex-wrap gap-2">
              {post.tags.map(tag => (
                <Badge key={tag} variant="secondary">{tag}</Badge>
              ))}
            </div>
          </CardHeader>
        </Card>

        {/* Post Content */}
        <Card>
          <CardContent className="prose prose-lg max-w-none">
            <ReactMarkdown
              rehypePlugins={[rehypeRaw]}
              remarkPlugins={[remarkGfm]}
              className="markdown-content"
            >
              {post.content}
            </ReactMarkdown>
          </CardContent>
        </Card>

        {/* Back to Blog Button */}
        <div className="text-center mt-8">
          <Button
            onClick={() => router.push('/blog')}
            variant="outline"
            className="border-[#FF7F7F] text-[#FF7F7F] hover:bg-[#FF7F7F] hover:text-white"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to All Posts
          </Button>
        </div>
      </div>
    </div>
  )
}
