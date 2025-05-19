"use client"

import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { Loader2, Star, StarHalf, Info } from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line
} from 'recharts'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { format } from 'date-fns'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip as TooltipUI, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const ratingColors = {
  1: '#FF9A9A', // light pink
  2: '#FF8A8A', // medium-light pink
  3: '#FF7F7F', // brand pink
  4: '#FF6B6B', // medium-dark pink
  5: '#FF5252', // dark pink
}

const getAPIKey = () => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('adminApiKey') || '';
  }
  return '';
}

const FeedbackAnalytics = () => {
  const { toast } = useToast()
  const [period, setPeriod] = useState('30d')
  const [summary, setSummary] = useState<any>(null)
  const [detailedFeedback, setDetailedFeedback] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingDetailed, setLoadingDetailed] = useState(true)
  const [minRating, setMinRating] = useState<number | null>(null)
  const [maxRating, setMaxRating] = useState<number | null>(null)
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(0)

  useEffect(() => {
    fetchSummary()
  }, [period])

  useEffect(() => {
    setPage(0)
    setDetailedFeedback([])
    fetchDetailedFeedback(0)
  }, [period, minRating, maxRating, selectedModel])

  const fetchSummary = async () => {
    setLoading(true)
    try {
      const apiKey = getAPIKey()
      console.log('Fetching feedback summary with API key:', apiKey ? 'Key provided' : 'No key')
      
      // Check if API key is missing
      if (!apiKey) {
        toast({
          title: 'Authentication Error',
          description: 'Admin API key is missing. Please login as admin.',
          variant: 'destructive',
        })
        setLoading(false)
        return
      }

      const response = await fetch(`/api/analytics/feedback/summary?period=${period}&admin_api_key=${apiKey}`)
      
      if (!response.ok) {
        const errorText = await response.text()
        console.error('Error response:', response.status, errorText)
        throw new Error(`Failed to fetch feedback summary (${response.status}): ${errorText.substring(0, 100)}`)
      }
      
      const data = await response.json()
      console.log('Received feedback summary data:', data)
      setSummary(data)
    } catch (error) {
      console.error('Error fetching feedback summary:', error)
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to fetch feedback summary data',
        variant: 'destructive',
      })
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }

  const fetchDetailedFeedback = async (pageToFetch = page) => {
    setLoadingDetailed(true)
    try {
      const apiKey = getAPIKey()
      console.log('Fetching detailed feedback with API key:', apiKey ? 'Key provided' : 'No key')
      
      // Check if API key is missing
      if (!apiKey) {
        toast({
          title: 'Authentication Error',
          description: 'Admin API key is missing. Please login as admin.',
          variant: 'destructive',
        })
        setLoadingDetailed(false)
        return
      }
      
      let url = `/api/analytics/feedback/detailed?period=${period}&offset=${pageToFetch * 10}&limit=10&admin_api_key=${apiKey}`
      
      if (minRating !== null) {
        url += `&min_rating=${minRating}`
      }
      
      if (maxRating !== null) {
        url += `&max_rating=${maxRating}`
      }
      
      if (selectedModel) {
        url += `&model_name=${encodeURIComponent(selectedModel)}`
      }
      
      console.log('Fetching detailed feedback from URL:', url)
      const response = await fetch(url)
      
      if (!response.ok) {
        const errorText = await response.text()
        console.error('Error response:', response.status, errorText)
        throw new Error(`Failed to fetch detailed feedback (${response.status}): ${errorText.substring(0, 100)}`)
      }
      
      const data = await response.json()
      console.log('Received detailed feedback data:', data)
      
      if (!data.feedback || !Array.isArray(data.feedback)) {
        console.warn('Feedback data is missing or not an array', data)
        setDetailedFeedback([])
        setHasMore(false)
        return
      }
      
      if (pageToFetch === 0) {
        setDetailedFeedback(data.feedback)
      } else {
        setDetailedFeedback(prev => [...prev, ...data.feedback])
      }
      
      setHasMore(data.total > (pageToFetch + 1) * 10)
    } catch (error) {
      console.error('Error fetching detailed feedback:', error)
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to fetch detailed feedback data',
        variant: 'destructive',
      })
      setDetailedFeedback([])
      setHasMore(false)
    } finally {
      setLoadingDetailed(false)
    }
  }

  const loadMore = () => {
    const nextPage = page + 1
    setPage(nextPage)
    fetchDetailedFeedback(nextPage)
  }

  const renderStars = (rating: number) => {
    return (
      <div className="flex items-center space-x-1">
        {[1, 2, 3, 4, 5].map(star => (
          <Star
            key={star}
            size={16}
            className={star <= rating ? 'fill-current text-[#FF7F7F]' : 'text-[#FFD1D1]'}
          />
        ))}
      </div>
    )
  }

  const getColorForRating = (rating: number) => {
    return ratingColors[rating as keyof typeof ratingColors] || '#64748b'
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 border border-[#FFD1D1] rounded shadow-lg">
          <p className="font-medium">{`Date: ${label}`}</p>
          <p className="text-[#FF7F7F]">{`Average Rating: ${payload[0].value?.toFixed(1) || 'No data'}`}</p>
          <p className="text-[#FF5252]">{`Count: ${payload[1]?.value || 0} ratings`}</p>
        </div>
      )
    }
    return null
  }

  if (loading) {
    return (
      <div className="space-y-6 p-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="space-y-6 p-4">
        <div className="flex items-center justify-center p-8">
          <p className="text-lg text-gray-500">No feedback data available</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Feedback Analytics</h2>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="Period" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-medium text-[#FF5252]">Total Feedback</CardTitle>
            <CardDescription>Number of ratings received</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-[#FF7F7F]">{summary.total_feedback}</div>
            <p className="text-sm text-gray-500 mt-1">From {summary.chats_with_feedback} unique chats</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-medium text-[#FF5252]">Average Rating</CardTitle>
            <CardDescription>Overall satisfaction score</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <div className="text-3xl font-bold">
                {summary.avg_rating.toFixed(1)}
              </div>
              <div className="flex mt-1">
                {renderStars(Math.round(summary.avg_rating))}
              </div>
            </div>
            <p className="text-sm text-gray-500 mt-1">Out of 5 stars</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-medium text-[#FF5252]">Rating Distribution</CardTitle>
            <CardDescription>Breakdown by star rating</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {summary.ratings_distribution.map((item: any) => (
                <div key={item.rating} className="flex items-center space-x-2">
                  <div className="w-16 flex items-center">
                    <span className="font-medium">{item.rating}</span>
                    <Star size={14} className="ml-1 fill-current text-[#FF7F7F]" />
                  </div>
                  <div className="flex-1 h-2 bg-[#FFF0F0] rounded-full overflow-hidden">
                    <div 
                      className="h-full rounded-full" 
                      style={{ 
                        width: `${(item.count / summary.total_feedback) * 100}%`,
                        backgroundColor: getColorForRating(item.rating)
                      }} 
                    />
                  </div>
                  <div className="w-10 text-xs text-right">{item.count}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="trend">
        <TabsList>
          <TabsTrigger value="trend">Feedback Trend</TabsTrigger>
          <TabsTrigger value="models">Model Performance</TabsTrigger>
          <TabsTrigger value="detailed">Detailed Feedback</TabsTrigger>
        </TabsList>
        
        <TabsContent value="trend" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-[#FF5252]">Feedback Over Time</CardTitle>
              <CardDescription>Average rating trend for the selected period</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-96">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={summary.feedback_trend}
                    margin={{ top: 5, right: 30, left: 20, bottom: 25 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#FFE5E5" />
                    <XAxis 
                      dataKey="date" 
                      tick={{ fontSize: 12 }}
                      tickFormatter={(date) => {
                        const d = new Date(date);
                        return format(d, 'MMM d');
                      }}
                      angle={-45}
                      textAnchor="end"
                      height={60}
                    />
                    <YAxis domain={[0, 5]} tick={{ fontSize: 12 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ color: '#FF7F7F' }} />
                    <Line 
                      type="monotone" 
                      dataKey="avg_rating" 
                      stroke="#FF7F7F" 
                      strokeWidth={2}
                      name="Average Rating"
                      activeDot={{ r: 8, fill: "#FF5252" }}
                      connectNulls
                    />
                    <Line 
                      type="monotone" 
                      dataKey="count" 
                      stroke="#FFB1B1" 
                      strokeWidth={1}
                      name="Number of Ratings"
                      hide
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="models" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-[#FF5252]">Feedback by Model</CardTitle>
              <CardDescription>Average ratings across different models</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-96">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={summary.models_data}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 150, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#FFE5E5" />
                    <XAxis type="number" domain={[0, 5]} />
                    <YAxis 
                      type="category" 
                      dataKey="model_name" 
                      tick={{ fontSize: 12 }}
                      width={150}
                    />
                    <Tooltip 
                      cursor={{ fill: '#FFF0F0', opacity: 0.3 }}
                      contentStyle={{ borderColor: '#FFD1D1', backgroundColor: 'white' }}
                      formatter={(value: any) => [`${value.toFixed(1)} / 5`, 'Rating']}
                      labelFormatter={(label) => `Model: ${label}`}
                    />
                    <Legend wrapperStyle={{ color: '#FF7F7F' }} />
                    <Bar 
                      dataKey="avg_rating" 
                      name="Average Rating" 
                      fill="#FF7F7F"
                      label={{ position: 'right', formatter: (value: number) => value.toFixed(1), fill: "#FF5252" }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="detailed" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-[#FF5252]">Detailed Feedback</CardTitle>
              <CardDescription>Review individual feedback entries</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex flex-wrap gap-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Min Rating</label>
                  <Select 
                    value={minRating?.toString() || 'any'} 
                    onValueChange={(value) => setMinRating(value === 'any' ? null : parseInt(value))}
                  >
                    <SelectTrigger className="w-28">
                      <SelectValue placeholder="Any" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any</SelectItem>
                      {[1, 2, 3, 4, 5].map(rating => (
                        <SelectItem key={rating} value={rating.toString()}>
                          {rating} ★
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <label className="text-sm font-medium mb-1 block">Max Rating</label>
                  <Select 
                    value={maxRating?.toString() || 'any'} 
                    onValueChange={(value) => setMaxRating(value === 'any' ? null : parseInt(value))}
                  >
                    <SelectTrigger className="w-28">
                      <SelectValue placeholder="Any" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any</SelectItem>
                      {[1, 2, 3, 4, 5].map(rating => (
                        <SelectItem key={rating} value={rating.toString()}>
                          {rating} ★
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <label className="text-sm font-medium mb-1 block">Model</label>
                  <Select 
                    value={selectedModel || 'all'} 
                    onValueChange={(value) => setSelectedModel(value === 'all' ? null : value)}
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="All Models" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Models</SelectItem>
                      {summary.models_data.map((model: any) => (
                        <SelectItem key={model.model_name} value={model.model_name}>
                          {model.model_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              {loadingDetailed && detailedFeedback.length === 0 ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-[#FF7F7F]" />
                </div>
              ) : detailedFeedback.length === 0 ? (
                <div className="flex justify-center py-8 text-gray-500">
                  No feedback entries match your criteria
                </div>
              ) : (
                <>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Rating</TableHead>
                          <TableHead>Model</TableHead>
                          <TableHead className="hidden md:table-cell">Message Preview</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detailedFeedback.map((item) => (
                          <TableRow key={item.feedback_id}>
                            <TableCell className="font-medium">
                              {new Date(item.created_at).toLocaleDateString()}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center" style={{ color: getColorForRating(item.rating) }}>
                                {renderStars(item.rating)}
                              </div>
                            </TableCell>
                            <TableCell>
                              <TooltipProvider>
                                <TooltipUI>
                                  <TooltipTrigger>
                                    <Badge variant="outline" className="cursor-default border-[#FFD1D1] text-[#FF7F7F]">
                                      {item.model_name ? item.model_name.split('/').pop() : 'Unknown'}
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs border-[#FFD1D1]">
                                    <div>
                                      <p><strong className="text-[#FF7F7F]">Provider:</strong> {item.model_provider || 'Unknown'}</p>
                                      <p><strong className="text-[#FF7F7F]">Temperature:</strong> {item.temperature || 'N/A'}</p>
                                      <p><strong className="text-[#FF7F7F]">Max Tokens:</strong> {item.max_tokens || 'N/A'}</p>
                                    </div>
                                  </TooltipContent>
                                </TooltipUI>
                              </TooltipProvider>
                            </TableCell>
                            <TableCell className="hidden md:table-cell">
                              <p className="text-sm text-gray-500 truncate w-72">
                                {item.message_sender === 'ai' 
                                  ? item.message_preview 
                                  : <span className="italic">User message</span>}
                              </p>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  
                  {hasMore && (
                    <div className="flex justify-center mt-4">
                      <button
                        className="px-4 py-2 text-sm bg-white border border-[#FFD1D1] text-[#FF7F7F] rounded-md hover:bg-[#FFF0F0]"
                        onClick={loadMore}
                        disabled={loadingDetailed}
                      >
                        {loadingDetailed ? (
                          <div className="flex items-center space-x-2">
                            <Loader2 className="h-4 w-4 animate-spin text-[#FF7F7F]" />
                            <span>Loading...</span>
                          </div>
                        ) : (
                          'Load More'
                        )}
                      </button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default FeedbackAnalytics 