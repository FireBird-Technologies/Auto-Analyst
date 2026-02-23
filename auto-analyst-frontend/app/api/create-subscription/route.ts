import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import Stripe from 'stripe'
import redis, { KEYS } from '@/lib/redis'

export const dynamic = 'force-dynamic'

const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-05-28.basil',
    })
  : null

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request })
    if (!token?.sub) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!stripe) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 })
    }

    const { setupIntentId, priceId, promoCodeInfo, promotionCode } = await request.json()
    console.log('🔍 FULL REQUEST DATA:', { 
      setupIntentId, 
      priceId, 
      promoCodeInfo: JSON.stringify(promoCodeInfo, null, 2),
      promotionCode,
      hasPromoCodeInfo: !!promoCodeInfo,
      hasPromotionCodeField: !!promoCodeInfo?.promotionCode
    })

    if (!setupIntentId || !priceId) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
    }

    // Retrieve the setup intent to get the payment method and metadata
    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId)
    console.log('🔍 Setup intent retrieved:', { 
      status: setupIntent.status, 
      payment_method: setupIntent.payment_method,
      customer: setupIntent.customer,
      metadata: setupIntent.metadata
    })
    
    if (setupIntent.status !== 'succeeded' || !setupIntent.payment_method) {
      return NextResponse.json({ 
        error: `Invalid setup intent: status=${setupIntent.status}, payment_method=${setupIntent.payment_method}` 
      }, { status: 400 })
    }

    // Prepare subscription parameters
    const subscriptionParams: Stripe.SubscriptionCreateParams = {
      customer: setupIntent.customer as string,
      items: [{ price: priceId }],
      default_payment_method: setupIntent.payment_method as string,
      expand: ['latest_invoice.payment_intent'],
    }

    // Apply promo code if provided from frontend
    if (promoCodeInfo?.promotionCode) {
      console.log('🔍 APPLYING PROMO CODE:', {
        promotionCode: promoCodeInfo.promotionCode,
        discountType: promoCodeInfo.discountType,
        discountValue: promoCodeInfo.discountValue
      })
      
      try {
        // Look up the promotion code object by the code string
        const promotionCodeList = await stripe.promotionCodes.list({
          code: promoCodeInfo.promotionCode,
          active: true,
          limit: 1
        })

        console.log('🔍 STRIPE PROMOTION CODE LOOKUP:', {
          searchedCode: promoCodeInfo.promotionCode,
          foundCount: promotionCodeList.data.length,
          foundCodes: promotionCodeList.data.map(pc => ({
            id: pc.id,
            code: pc.code,
            active: pc.active,
            couponId: pc.coupon?.id
          }))
        })

        if (promotionCodeList.data.length > 0) {
          const promotionCodeObj = promotionCodeList.data[0]
          const couponId = promotionCodeObj.coupon.id
          
          // Apply coupon to the subscription
          subscriptionParams.discounts = [{
            coupon: couponId
          }]
          
          console.log('✅ COUPON ADDED TO SUBSCRIPTION PARAMS:', {
            promotionCodeString: promoCodeInfo.promotionCode,
            promotionCodeId: promotionCodeObj.id,
            couponId: couponId,
            finalSubscriptionParams: JSON.stringify(subscriptionParams, null, 2)
          })
        } else {
          console.log('❌ PROMO CODE NOT FOUND IN STRIPE:', promoCodeInfo.promotionCode)
        }
      } catch (promoError) {
        console.error('❌ ERROR LOOKING UP PROMO CODE:', promoError)
      }
    } else {
      console.log('❌ NO PROMO CODE TO APPLY:', {
        hasPromoCodeInfo: !!promoCodeInfo,
        hasPromotionCode: !!promoCodeInfo?.promotionCode,
        promoCodeInfo: JSON.stringify(promoCodeInfo, null, 2)
      })
    }

    // Create subscription with detailed logging
    console.log('🔍 CREATING SUBSCRIPTION WITH FINAL PARAMS:', JSON.stringify(subscriptionParams, null, 2))
    
    const subscription = await stripe.subscriptions.create(subscriptionParams)
    
    console.log('✅ SUBSCRIPTION CREATED:', {
      id: subscription.id,
      status: subscription.status,
      hasDiscounts: !!(subscription.discounts && subscription.discounts.length > 0),
      discounts: subscription.discounts
    })

    // Update Redis with subscription info
    const userId = token.sub
    
    // Check if user has existing subscription data and clear it if it exists
    const existingSubscriptionData = await redis.hgetall(KEYS.USER_SUBSCRIPTION(userId))
    if (existingSubscriptionData && Object.keys(existingSubscriptionData).length > 0) {
      console.log('🔍 Found existing subscription data, clearing it for clean state')
      await redis.del(KEYS.USER_SUBSCRIPTION(userId))
    } else {
      console.log('🔍 No existing subscription data found, proceeding with new subscription')
    }
    
    const subscriptionData = {
      id: subscription.id,
      stripeSubscriptionId: subscription.id,
      status: subscription.status,
      current_period_start: String((subscription as any).current_period_start || ''),
      current_period_end: String((subscription as any).current_period_end || ''),
      priceId: priceId,
      created: String(subscription.created),
      // Add promo code info to Redis for tracking
      ...(promoCodeInfo && { 
        promoCodeApplied: 'true',
        promoCodeValue: String(promoCodeInfo.discountValue || ''),
        promoCodeType: promoCodeInfo.discountType || ''
      })
    }

    await redis.hset(KEYS.USER_SUBSCRIPTION(userId), subscriptionData)
    console.log('✅ Redis subscription data updated')
    
    // Add credits based on plan
    const price = await stripe.prices.retrieve(priceId)
    const product = await stripe.products.retrieve(price.product as string)
    console.log('🔍 Retrieved product:', { name: product.name, priceId })
    
    // Determine credits based on product name
    let credits = 0
    if (product.name && product.name.includes('Standard')) {
      credits = 500 // Standard plan gets 500 credits
    } else if (product.name && product.name.includes('Enterprise')) {
      credits = 2000 // Enterprise plan (when defined)
    } else {
      credits = 20 // Free plan default
    }

    if (credits > 0) {
      await redis.hset(KEYS.USER_CREDITS(userId), {
        total: String(credits),
        available: String(credits),
        used: '0',
        lastReset: String(Date.now())
      })
      console.log('✅ Redis credits updated:', credits)
    }

    return NextResponse.json({
      success: true,
      subscriptionId: subscription.id,
      status: subscription.status,
      promoCodeApplied: !!promoCodeInfo
    })

  } catch (error) {
    console.error('❌ Error creating subscription:', error)
    
    let errorMessage = 'Failed to create subscription'
    if (error instanceof Error) {
      errorMessage = error.message
    }
    
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
