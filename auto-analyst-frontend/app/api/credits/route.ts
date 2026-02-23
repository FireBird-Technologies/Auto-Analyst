import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { creditUtils } from '@/lib/redis'
import { CreditConfig } from '@/lib/credits-config'

export async function GET(request: Request) {
  try {
    // Get user info from session or query params
    const session = await getServerSession()
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId') || (session?.user?.email || 'guest-user')
    
    // Get user's remaining credits
    const credits = await creditUtils.getRemainingCredits(userId as string)
    
    return NextResponse.json({ credits })
  } catch (error) {
    console.error('Error fetching credits:', error)
    return NextResponse.json(
      { error: 'Failed to fetch credits' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession()
    const { userId, action, amount } = await request.json()
    
    // Ensure authenticated or valid request
    if (!session?.user && !userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    
    const userIdentifier = userId || session?.user?.email
    
    if (action === 'reset') {
      // Reset credits - check if user should get free credits
      const shouldGetFree = await creditUtils.shouldGetFreeCredits(userIdentifier)
      
      if (!shouldGetFree) {
        return NextResponse.json({
          error: 'Cannot reset credits for users with active subscriptions',
          message: 'Please cancel your subscription first or wait for it to end'
        }, { status: 400 })
      }
      
      // Check if they already got free credits this month
      const alreadyReceived = await creditUtils.hasReceivedFreeCreditsThisMonth(userIdentifier)
      
      if (alreadyReceived) {
        return NextResponse.json({
          error: 'Free credits already received this month',
          message: 'You can only get 20 free credits once per month'
        }, { status: 400 })
      }
      
      // Allow reset for eligible users (they get 20 credits)
      await creditUtils.initializeCredits(userIdentifier, 20)
      return NextResponse.json({ success: true, credits: 20 })
    } else if (action === 'add') {
      // Add credits to user's total
      if (!amount || amount <= 0) {
        return NextResponse.json(
          { error: 'Amount must be greater than 0' },
          { status: 400 }
        )
      }
      
      // Get current credits
      const currentCredits = await creditUtils.getRemainingCredits(userIdentifier)
      
      // Add the specified amount to current total
      const newTotal = currentCredits + amount
      
      // Initialize with new total
      await creditUtils.initializeCredits(userIdentifier, newTotal)
      
      const updatedCredits = await creditUtils.getRemainingCredits(userIdentifier)
      return NextResponse.json({ 
        success: true, 
        creditsAdded: amount,
        newTotal: updatedCredits,
        message: `Successfully added ${amount} credits`
      })
    } else if (action === 'deduct') {
      // Deduct credits
      const success = await creditUtils.deductCredits(userIdentifier, amount)
      if (success) {
        const remaining = await creditUtils.getRemainingCredits(userIdentifier)
        return NextResponse.json({ success: true, credits: remaining })
      } else {
        return NextResponse.json(
          { error: 'Insufficient credits' },
          { status: 400 }
        )
      }
    }
    
    return NextResponse.json(
      { error: 'Invalid action. Use: reset, add, or deduct' },
      { status: 400 }
    )
  } catch (error) {
    console.error('Error managing credits:', error)
    return NextResponse.json(
      { error: 'Failed to manage credits' },
      { status: 500 }
    )
  }
} 
