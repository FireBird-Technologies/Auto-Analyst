import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    // Get the backend API URL from environment or use default
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
    
    // Get the search params
    const searchParams = request.nextUrl.searchParams
    
    // Create the backend URL with query parameters
    const backendEndpoint = `${backendUrl}/analytics/feedback/summary?${searchParams.toString()}`
    
    console.log(`Proxying request to: ${backendEndpoint}`)
    
    // Make the request to the backend
    const response = await fetch(backendEndpoint, {
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store'
    })
    
    // If the backend returns an error, forward it
    if (!response.ok) {
      console.error(`Error from backend: ${response.status}`)
      const errorText = await response.text()
      return new NextResponse(errorText, {
        status: response.status,
        headers: {
          'Content-Type': 'application/json'
        }
      })
    }
    
    // Get the data from the backend
    const data = await response.json()
    
    // Return the response
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in feedback summary proxy:', error)
    return NextResponse.json({ error: 'Failed to fetch feedback data from backend' }, { status: 500 })
  }
} 