"use client"

import React from 'react'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Search, Calendar, User, Tag, ArrowRight } from 'lucide-react'
import { BlogPost as BlogPostType } from './types'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function BlogPage() {
  const [posts, setPosts] = useState<BlogPostType[]>([])
  const [filteredPosts, setFilteredPosts] = useState<BlogPostType[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTag, setSelectedTag] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  // Load posts from backend API
  useEffect(() => {
    const loadPosts = async () => {
      try {
        setLoading(true)
        setError(null)
        
        if (process.env.NODE_ENV === 'development') {
          console.log('Fetching from:', `${API_BASE_URL}/api/blog/posts`)
        }
        
        const response = await fetch(`${API_BASE_URL}/api/blog/posts`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        })
        
        if (process.env.NODE_ENV === 'development') {
          console.log('Response status:', response.status)
        }
        
        if (!response.ok) {
          const errorText = await response.text()
          console.error('Error response:', errorText)
          throw new Error(`Failed to fetch posts: ${response.status} ${response.statusText}`)
        }
        
        const data = await response.json()
        if (process.env.NODE_ENV === 'development') {
          console.log('Received data:', data)
        }
        
        // Validate the data structure
        if (!Array.isArray(data)) {
          throw new Error('Invalid data format: expected array of posts')
        }
        
        setPosts(data)
        setFilteredPosts(data)
      } catch (error) {
        console.error('Error loading posts:', error)
        setError(error instanceof Error ? error.message : 'Failed to load blog posts')
        setPosts([])
        setFilteredPosts([])
      } finally {
        setLoading(false)
      }
    }
    
    loadPosts()
  }, [])

  // Get all unique tags
  const allTags = Array.from(new Set(posts.flatMap(post => post.tags)))

  // Filter posts based on search and tag
  useEffect(() => {
    let filtered = posts

    if (searchQuery) {
      filtered = filtered.filter(post =>
        post.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        post.excerpt.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }

    if (selectedTag !== 'all') {
      filtered = filtered.filter(post => post.tags.includes(selectedTag))
    }

    setFilteredPosts(filtered)
  }, [searchQuery, selectedTag, posts])

  const featuredPost = useMemo(() => 
    filteredPosts.find(post => post.featured), 
    [filteredPosts]
  )

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-[#FF7F7F] mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading blog posts...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 text-xl mb-4">Error Loading Blog Posts</div>
          <p className="text-gray-600 mb-4">{error}</p>
          <div className="text-sm text-gray-500 mb-4">
            <p>Make sure the backend server is running on {API_BASE_URL}</p>
            <p>Check the browser console for more details</p>
          </div>
          <Button 
            onClick={() => window.location.reload()}
            className="bg-[#FF7F7F] text-white hover:bg-[#FF6666]"
          >
            Try Again
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white">
      {/* Navigation */}
      <nav className="sticky top-0 left-0 right-0 w-full z-50 bg-white/90 backdrop-blur-sm shadow-sm border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex flex-row justify-between items-center">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => router.push('/')}
              className="text-lg font-semibold text-gray-900"
            >
              Auto-Analyst
            </Button>
            <span className="text-gray-400">/</span>
            <span className="text-lg font-semibold text-[#FF7F7F]">Blog</span>
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

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="text-center space-y-4 mb-8">
          <h1 className="text-4xl font-bold text-gray-900">
            Auto-Analyst Blog
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Insights, tutorials, and updates from the Auto-Analyst team
          </p>
        </div>

        {/* Search and Filter */}
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between mb-8">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input
              placeholder="Search blog posts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={selectedTag === 'all' ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => setSelectedTag('all')}
            >
              All
            </Badge>
            {allTags.map(tag => (
              <Badge
                key={tag}
                variant={selectedTag === tag ? 'default' : 'outline'}
                className="cursor-pointer"
                onClick={() => setSelectedTag(tag)}
              >
                {tag}
              </Badge>
            ))}
          </div>
        </div>

        {/* Featured Post */}
        {featuredPost && (
          <Card className="border-2 border-[#FF7F7F] mb-8">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Badge className="bg-[#FF7F7F]">Featured</Badge>
                <CardTitle className="text-2xl">
                  {featuredPost.title}
                </CardTitle>
              </div>
              <CardDescription className="text-lg">
                {featuredPost.excerpt}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 text-sm text-gray-500 mb-4">
                <div className="flex items-center gap-1">
                  <User className="h-4 w-4" />
                  {featuredPost.author}
                </div>
                <div className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {new Date(featuredPost.publishedAt || '').toLocaleDateString()}
                </div>
                <div className="flex items-center gap-1">
                  <Tag className="h-4 w-4" />
                  {featuredPost.readTime}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mb-4">
                {featuredPost.tags.map(tag => (
                  <Badge key={tag} variant="secondary">{tag}</Badge>
                ))}
              </div>
              <Button
                onClick={() => router.push(`/blog/${featuredPost.id}`)}
                className="bg-[#FF7F7F] text-white hover:bg-[#FF6666]"
              >
                Read More <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Posts Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredPosts
            .filter(post => !post.featured)
            .map(post => (
              <Card 
                key={post.id} 
                className="hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => router.push(`/blog/${post.id}`)}
              >
                <CardHeader>
                  <CardTitle className="line-clamp-2">{post.title}</CardTitle>
                  <CardDescription className="line-clamp-3">{post.excerpt}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 text-sm text-gray-500 mb-4">
                    <div className="flex items-center gap-1">
                      <User className="h-4 w-4" />
                      {post.author}
                    </div>
                    <div className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      {new Date(post.publishedAt).toLocaleDateString()}
                    </div>
                    <div className="flex items-center gap-1">
                      <Tag className="h-4 w-4" />
                      {post.readTime}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {post.tags.map(tag => (
                      <Badge key={tag} variant="secondary">{tag}</Badge>
                    ))}
                  </div>
                  <Button
                    onClick={() => router.push(`/blog/${post.id}`)}
                    className="w-full bg-[#FF7F7F] text-white hover:bg-[#FF6666]"
                  >
                    Read More <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
        </div>

        {filteredPosts.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500 text-lg">No posts found matching your criteria.</p>
          </div>
        )}
      </div>
    </div>
  )
}
