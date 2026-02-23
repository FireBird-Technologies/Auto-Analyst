import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import Stripe from 'stripe'
import redis, { KEYS } from '@/lib/redis'

// Initialize Stripe with the same pattern as working files
const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-05-28.basil',
    })
  : null

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request })
    if (!token?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { newPriceId } = await request.json()
    if (!newPriceId) return NextResponse.json({ error: 'Missing price ID' }, { status: 400 })

    if (!stripe) return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 })

    const userId = token.sub
    
    // Get current subscription from Redis
    const subscriptionData = await redis.hgetall(KEYS.USER_SUBSCRIPTION(userId))
    if (!subscriptionData?.id) {
      return NextResponse.json({ error: 'No active subscription found' }, { status: 400 })
    }

    // Get current subscription from Stripe to access the items
    const subscriptionId = String(subscriptionData.id) // Ensure it's a string
    const currentSubscription = await stripe!.subscriptions.retrieve(subscriptionId)

    // Update subscription in Stripe
    const subscriptionResponse = await stripe!.subscriptions.update(subscriptionId, {
      items: [{
        id: currentSubscription.items.data[0].id,
        price: newPriceId,
      }],
      proration_behavior: 'create_prorations',
    })

    // Extract the subscription object from the response
    const subscription = subscriptionResponse as any // Type assertion for Stripe API version compatibility

    // Update Redis with new subscription data
    await redis.hset(KEYS.USER_SUBSCRIPTION(userId), {
      ...subscriptionData,
      priceId: newPriceId,
      status: subscription.status,
      current_period_start: String(subscription.current_period_start || ''),
      current_period_end: String(subscription.current_period_end || ''),
    })

    // Update credits based on new plan
    const price = await stripe!.prices.retrieve(newPriceId)
    const product = await stripe!.products.retrieve(price.product as string)
    
    let newCredits = 0
    if (product.name && product.name.includes('Standard')) {
      newCredits = 500 // Standard plan gets 500 credits
    } else if (product.name && product.name.includes('Enterprise')) {
      newCredits = 2000 // Enterprise plan (when defined)
    } else {
      // This shouldn't happen for subscription changes, but fallback
      newCredits = 20 // Free plan default
    }

    if (newCredits > 0) {
      await redis.hset(KEYS.USER_CREDITS(userId), {
        available: String(newCredits),
        used: '0',
        lastReset: String(Date.now())
      })
    }

    return NextResponse.json({
      success: true,
      subscriptionId: subscription.id,
      status: subscription.status,
      message: 'Subscription updated successfully'
    })

  } catch (error) {
    console.error('Error changing subscription:', error)
    return NextResponse.json(
      { error: 'Failed to change subscription' },
      { status: 500 }
    )
  }
}
