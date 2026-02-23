import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import redis, { KEYS } from '@/lib/redis'
import Stripe from 'stripe'

// Initialize Stripe
const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-05-28.basil', // Use a stable API version
    })
  : null

export async function POST(request: NextRequest) {
  try {
    // Test Redis connection
    try {
      await redis.ping()
      console.log('✅ Redis connection successful')
    } catch (redisError) {
      console.error('❌ Redis connection failed:', redisError)
      return NextResponse.json({ 
        error: 'Database connection failed',
        details: redisError instanceof Error ? redisError.message : 'Unknown Redis error'
      }, { status: 500 })
    }

    // Authenticate user
    const token = await getToken({ req: request })
    if (!token?.sub) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = token.sub
    console.log(`[Cancel Subscription] Processing cancellation for user: ${userId}`)

    // Check if Stripe is initialized
    if (!stripe) {
      console.error('❌ Stripe is not initialized - missing API key')
      return NextResponse.json({ 
        error: 'Subscription service unavailable',
        details: 'Stripe API key not configured'
      }, { status: 500 })
    }
    
    // Get current subscription data from Redis
    console.log(`[Cancel Subscription] Getting subscription data from Redis for user: ${userId}`)
    const subscriptionData = await redis.hgetall(KEYS.USER_SUBSCRIPTION(userId))
    console.log(`[Cancel Subscription] Redis data:`, subscriptionData)
    
    if (!subscriptionData || Object.keys(subscriptionData).length === 0) {
      console.log(`[Cancel Subscription] No subscription data found for user: ${userId}`)
      return NextResponse.json({ 
        error: 'No active subscription found',
        details: 'No subscription data in database'
      }, { status: 400 })
    }

    // Use stripeSubscriptionId field
    const stripeSubscriptionId = subscriptionData.stripeSubscriptionId as string
    const isLegacyUser = !stripeSubscriptionId || !stripeSubscriptionId.startsWith('sub_')
    
    console.log(`[Cancel Subscription] Stripe ID: ${stripeSubscriptionId}, Is Legacy: ${isLegacyUser}`)
    
    try {
      let canceledSubscription = null
      
      // Only make Stripe API calls for new users with proper subscription IDs
      if (!isLegacyUser) {
        console.log(`[Cancel Subscription] Canceling Stripe subscription: ${stripeSubscriptionId}`)
        // Cancel the subscription in Stripe
        canceledSubscription = await stripe.subscriptions.update(stripeSubscriptionId, {
          cancel_at_period_end: true,
        })
        console.log(`[Cancel Subscription] Stripe cancellation successful`)
      } else {
        console.log(`Legacy user ${userId} - skipping Stripe API calls, updating Redis only`)
      }
      
      // Update the subscription data in Redis with cancellation info (for both legacy and new users)
      const now = new Date()
      
      // Use atomic Redis transaction for consistency
      const multi = redis.multi()
      
      multi.hset(KEYS.USER_SUBSCRIPTION(userId), {
        status: isLegacyUser ? 'canceled' : 'cancel_at_period_end', // Standardized status flow
        canceledAt: now.toISOString(),
        lastUpdated: now.toISOString(),
        cancel_at_period_end: 'true',
        subscriptionCanceled: 'true'
      })
      
      // For legacy users, immediately set credits to 0
      if (isLegacyUser) {
        multi.hset(KEYS.USER_CREDITS(userId), {
          total: '0',
          used: '0',
          resetDate: '',
          lastUpdate: now.toISOString(),
          canceledUser: 'true'
        })
      }
      
      await multi.exec()
      
      // Handle credits - ALL users keep their credits until period ends
      console.log(`User ${userId} - keeping current credits until subscription period ends`)
      
      // Get period end date from Stripe subscription for better user feedback
      let periodEndDate = null
      if (!isLegacyUser && canceledSubscription) {
        periodEndDate = new Date((canceledSubscription as any).current_period_end * 1000).toISOString()
      }

      return NextResponse.json({
        success: true,
        message: isLegacyUser 
          ? 'Subscription canceled successfully. Your access has been removed.'
          : 'Subscription will be canceled at the end of the current billing period',
        canceledAt: now.toISOString(),
        periodEndDate: periodEndDate,
        immediateCancellation: isLegacyUser
      })
      
    } catch (stripeError: any) {
      console.error('Stripe error canceling subscription:', stripeError)
      
      // Handle common Stripe errors (like the working code)
      if (stripeError.code === 'resource_missing') {
        // Subscription doesn't exist in Stripe but exists in our DB
        // Update our records to show there's no subscription
        await redis.hset(KEYS.USER_SUBSCRIPTION(userId), {
          status: 'inactive',
          stripeSubscriptionId: '',
          lastUpdated: new Date().toISOString(),
        })
        
        return NextResponse.json({
          success: true,
          message: 'Subscription record updated',
        })
      }
      
      return NextResponse.json(
        { error: 'Failed to cancel subscription with payment provider' },
        { status: 500 }
      )
    }

  } catch (error: any) {
    console.error('Error canceling subscription:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to cancel subscription' },
      { status: 500 }
    )
  }
} 