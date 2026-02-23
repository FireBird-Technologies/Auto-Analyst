import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { Readable } from 'stream'
import redis, { creditUtils, KEYS, profileUtils } from '@/lib/redis'
import { sendSubscriptionConfirmation, sendPaymentConfirmationEmail } from '@/lib/email'
import logger from '@/lib/utils/logger'
import { headers } from 'next/headers'
import { CreditConfig } from '@/lib/credits-config'

// Use the correct App Router configuration instead of the default body parser
export const dynamic = 'force-dynamic'

// Initialize Stripe only if the secret key exists
const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-05-28.basil',
    })
  : null

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || ''

export async function POST(request: NextRequest) {
  try {
    // Check if Stripe is initialized
    if (!stripe) {
      console.error('Stripe is not initialized - missing API key')
      return NextResponse.json({ error: 'Stripe configuration error' }, { status: 500 })
    }
    
    // Debug webhook secret availability
    if (!webhookSecret) {
      console.error('❌ STRIPE_WEBHOOK_SECRET is not set in environment variables')
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
    }
    
    const signature = headers().get('Stripe-Signature') as string
    
    if (!signature) {
      console.error('❌ No Stripe signature found in request headers')
      return NextResponse.json({ error: 'No Stripe signature found' }, { status: 400 })
    }
    
    const body = await request.text()
    
    // Verify the webhook signature
    let event
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
    } catch (err: any) {
      console.error(`❌ Webhook signature verification failed:`)
      console.error(`   Error: ${err.message}`)
      console.error(`   Signature: ${signature?.substring(0, 50)}...`)
      console.error(`   Body length: ${body.length}`)
      console.error(`   Webhook secret set: ${!!webhookSecret}`)
      console.error(`   Webhook secret prefix: ${webhookSecret?.substring(0, 10)}...`)
      
      // Check if this is a common signature verification issue
      if (err.message.includes('No signatures found')) {
        console.error('   ⚠️  This usually means the request body was modified by a proxy/CDN')
        console.error('   ⚠️  Or the webhook secret is incorrect')
      }
      
      return NextResponse.json({ 
        error: `Webhook Error: ${err.message}`,
        debug: {
          hasSignature: !!signature,
          hasSecret: !!webhookSecret,
          bodyLength: body.length,
          secretPrefix: webhookSecret?.substring(0, 10)
        }
      }, { status: 400 })
    }
    
    // logger.log(`Event received: ${event.type}`)
    
    // Handle different event types
    switch (event.type) {
      case 'checkout.session.completed': {
        // All checkouts now use trial subscriptions, handled by trial/start endpoint
        // This webhook is kept for logging purposes only
        const session = event.data.object as Stripe.Checkout.Session
        return NextResponse.json({ received: true })
      }
        
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        
          const customerId = subscription.customer as string
          if (!customerId) {
            console.error('No customer ID found in subscription')
            return NextResponse.json({ error: 'No customer ID found' }, { status: 400 })
          }
          
          const userKey = await redis.get(`stripe:customer:${customerId}`)
          if (!userKey) {
            console.error(`No user found for Stripe customer ${customerId}`)
            return NextResponse.json({ received: true })
          }
          
          const userId = userKey.toString()
          
        // Get current subscription data from Redis
        const currentSubscriptionData = await redis.hgetall(KEYS.USER_SUBSCRIPTION(userId))
        const currentStatus = currentSubscriptionData?.status
        
            
        // Always sync the status with Stripe, but handle special cases
        const updateData: any = {
          status: subscription.status || '',
          lastUpdated: new Date().toISOString(),
          stripeSubscriptionStatus: subscription.status || ''
        }
        
        // Handle specific status transitions
        if (currentStatus === 'trialing' && subscription.status === 'active') {
          updateData.trialEndedAt = new Date().toISOString()
          updateData.trialToActiveDate = new Date().toISOString()
        }
        
        if (subscription.status === 'canceled') {
          updateData.canceledAt = new Date().toISOString()
        }
        
        if (subscription.status === 'unpaid' || subscription.status === 'past_due') {
          updateData.unpaidAt = new Date().toISOString()
        }
          
        // Update subscription data
        await redis.hset(KEYS.USER_SUBSCRIPTION(userId), updateData)
        
        
        return NextResponse.json({ received: true })
      }
        
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        // Handle subscription cancellation/deletion
        // logger.log('Subscription deleted event received:', subscription.id)
        
        // Get the customer ID from the subscription
        const customerId = subscription.customer as string
        if (!customerId) {
          console.error('No customer ID found in subscription')
          return NextResponse.json({ error: 'No customer ID found' }, { status: 400 })
        }
        
        // Look up the user by customer ID in our database
        const userKey = await redis.get(`stripe:customer:${customerId}`)
        if (!userKey) {
          console.error(`No user found for Stripe customer ${customerId}`)
          return NextResponse.json({ received: true })
        }
        
        const userId = userKey.toString()
        // logger.log(`Found user ${userId} for Stripe customer ${customerId}`)
        
        // Get the current subscription data
        const subscriptionData = await redis.hgetall(KEYS.USER_SUBSCRIPTION(userId))
        if (!subscriptionData) {
          console.error(`No subscription data found for user ${userId}`)
          return NextResponse.json({ received: true })
        }
        
        // Handle subscription cancellation - set credits to 0 (no free plan anymore)
        const now = new Date()
        
        // Use atomic Redis transaction for final cancellation
        const multi = redis.multi()
        
        // Update subscription data to reflect final cancellation
        multi.hset(KEYS.USER_SUBSCRIPTION(userId), {
          plan: 'No Active Plan',
          planType: 'NONE',
          status: 'canceled', // Final status after period ends
          amount: '0',
          interval: 'month',
          lastUpdated: now.toISOString(),
          canceledAt: now.toISOString(),
          // Clear Stripe IDs as they're no longer valid
          stripeCustomerId: '',
          stripeSubscriptionId: ''
        })
        
        // Set credits to 0 when subscription actually ends
        multi.hset(KEYS.USER_CREDITS(userId), {
          total: '0',
          used: '0',
          resetDate: '', // No resets for users without subscription
          lastUpdate: now.toISOString(),
          subscriptionDeleted: 'true' // Mark this as a genuine subscription deletion
        })
        
        await multi.exec()
        
        // logger.log(`User ${userId} downgraded to Free plan after subscription cancellation`)
        
        return NextResponse.json({ received: true })
      }
        
      case 'customer.subscription.trial_will_end': {
        const subscription = event.data.object as Stripe.Subscription
        // logger.log('Trial will end event received:', subscription.id)
        
        // Get the customer ID from the subscription
        const customerId = subscription.customer as string
        if (!customerId) {
          console.error('No customer ID found in subscription')
          return NextResponse.json({ error: 'No customer ID found' }, { status: 400 })
        }
        
        // Look up the user by customer ID
        const userKey = await redis.get(`stripe:customer:${customerId}`)
        if (!userKey) {
          console.error(`No user found for Stripe customer ${customerId}`)
          return NextResponse.json({ received: true })
        }
        
        const userId = userKey.toString()
        
        // Optional: Send reminder email about trial ending
        // You can add email notification logic here
        
        return NextResponse.json({ received: true })
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        
        // Check if this is for a subscription payment
        if ((invoice as any).subscription_id) {
          const subscription = await stripe.subscriptions.retrieve((invoice as any).subscription_id as string)
          
          // Get customer and user info
          const customerId = subscription.customer as string
          const userKey = await redis.get(`stripe:customer:${customerId}`)
          
          if (userKey) {
            const userId = userKey.toString()
            console.log(`Processing payment success for user ${userId}, subscription status: ${subscription.status}`)
            
            // Get current subscription data from Redis
            const currentSubscriptionData = await redis.hgetall(KEYS.USER_SUBSCRIPTION(userId))
            
            // Handle different payment scenarios
            if (invoice.billing_reason === 'subscription_cycle') {
              // This is a regular billing cycle payment (trial ended or monthly renewal)
              console.log(`Subscription cycle payment for user ${userId} - updating status to active`)
              
              await redis.hset(KEYS.USER_SUBSCRIPTION(userId), {
                status: 'active',
                lastUpdated: new Date().toISOString(),
                trialEndedAt: new Date().toISOString(),
                lastPaymentDate: new Date().toISOString(),
                stripeSubscriptionStatus: subscription.status // Keep Stripe status in sync
              })
              
            } else if (invoice.billing_reason === 'subscription_create') {
              // This is the initial subscription creation payment (if any)
              
              await redis.hset(KEYS.USER_SUBSCRIPTION(userId), {
                status: subscription.status, // Use Stripe's status
                lastUpdated: new Date().toISOString(),
                initialPaymentDate: new Date().toISOString(),
                stripeSubscriptionStatus: subscription.status
              })
            } else {
              // Other billing reasons (proration, etc.)
              console.log(`Other payment type for user ${userId}: ${invoice.billing_reason}`)
              
              await redis.hset(KEYS.USER_SUBSCRIPTION(userId), {
                status: subscription.status, // Always sync with Stripe status
                lastUpdated: new Date().toISOString(),
                lastPaymentDate: new Date().toISOString(),
                stripeSubscriptionStatus: subscription.status
              })
            }
          } else {
            console.log(`No user found for Stripe customer ${customerId}`)
          }
        }
        
        return NextResponse.json({ received: true })
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        
        // Handle failed payment after trial
        if ((invoice as any).subscription_id && invoice.billing_reason === 'subscription_cycle') {
          const subscription = await stripe.subscriptions.retrieve((invoice as any).subscription_id as string)
          
          // Get customer and user info
          const customerId = subscription.customer as string
          const userKey = await redis.get(`stripe:customer:${customerId}`)
          
          if (userKey) {
            const userId = userKey.toString()
            
            // Set credits to 0 and mark subscription as past_due
            await creditUtils.setZeroCredits(userId)
            
            await redis.hset(KEYS.USER_SUBSCRIPTION(userId), {
              status: 'past_due',
              lastUpdated: new Date().toISOString(),
              paymentFailedAt: new Date().toISOString()
            })
            
            // logger.log(`User ${userId} payment failed after trial, access removed`)
          }
        }
        
        return NextResponse.json({ received: true })
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        
        // Check if this is a trial payment intent by looking at metadata
        if (paymentIntent.metadata?.isTrial === 'true') {
          const userId = paymentIntent.metadata?.userId
          
          if (userId) {
            // Prevent trial access by ensuring credits remain at 0
            await creditUtils.setZeroCredits(userId)
            
            // Mark the attempt as failed in subscription data
            await redis.hset(KEYS.USER_SUBSCRIPTION(userId), {
              status: 'payment_failed',
              lastUpdated: new Date().toISOString(),
              paymentFailedAt: new Date().toISOString(),
              failureReason: 'Payment authorization failed during trial signup'
            })
          }
        }
        
        return NextResponse.json({ received: true })
      }

      case 'payment_intent.canceled': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        
        // Check if this is a trial payment intent
        if (paymentIntent.metadata?.isTrial === 'true') {
          const userId = paymentIntent.metadata?.userId
          
          if (userId) {
            
            // Ensure user doesn't get trial access
            await creditUtils.setZeroCredits(userId)
            
            // Update subscription data to reflect cancellation
            await redis.hset(KEYS.USER_SUBSCRIPTION(userId), {
              status: 'canceled',
              lastUpdated: new Date().toISOString(),
              canceledAt: new Date().toISOString(),
              cancelReason: 'Payment intent canceled during trial signup'
            })
            
            // console.log(`Trial access prevented for user ${userId} due to payment intent cancellation`)
          }
        }
        
        return NextResponse.json({ received: true })
      }

      case 'setup_intent.setup_failed': {
        const setupIntent = event.data.object as Stripe.SetupIntent
        console.log(`Setup intent failed: ${setupIntent.id}`)
        
        // Check if this is a trial setup intent
        if (setupIntent.metadata?.is_trial_setup === 'true') {
          const subscriptionId = setupIntent.metadata?.subscription_id
          
          if (subscriptionId) {
            // Get the subscription to find the customer
            try {
              const subscription = await stripe.subscriptions.retrieve(subscriptionId)
              const customerId = subscription.customer as string
              const userKey = await redis.get(`stripe:customer:${customerId}`)
              
              if (userKey) {
                const userId = userKey.toString()
                // console.log(`Trial setup failed for user ${userId}`)
                
                // Cancel the trial subscription since setup failed
                await stripe.subscriptions.cancel(subscriptionId)
                
                // Ensure user doesn't get trial access
                await creditUtils.setZeroCredits(userId)
                
                // Update subscription data
                await redis.hset(KEYS.USER_SUBSCRIPTION(userId), {
                  status: 'setup_failed',
                  lastUpdated: new Date().toISOString(),
                  setupFailedAt: new Date().toISOString(),
                  failureReason: 'Payment method setup failed during trial signup'
                })
                
                // console.log(`Trial access prevented for user ${userId} due to setup failure`)
              }
            } catch (error) {
              console.error('Error handling setup intent failure:', error)
            }
          }
        }
        
        return NextResponse.json({ received: true })
      }

      case 'payment_intent.requires_action': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        // console.log(`Payment intent requires action (3D Secure): ${paymentIntent.id}`)
        
        // For trial payment intents, log the authentication requirement
        if (paymentIntent.metadata?.isTrial === 'true') {
          const userId = paymentIntent.metadata?.userId
          
          // Don't grant trial access until authentication is complete
          // The payment will either succeed (triggering payment_intent.succeeded) 
          // or fail (triggering payment_intent.payment_failed)
        }
        
        return NextResponse.json({ received: true })
      }
        
      // Add more event types as needed
      
      default:
        // logger.log(`Unhandled event type: ${event.type}`)
        return NextResponse.json({ received: true })
    }
  } catch (error: any) {
    console.error('Webhook error:', error)
    return NextResponse.json({ error: error.message || 'Webhook handler failed' }, { status: 500 })
  }
} 