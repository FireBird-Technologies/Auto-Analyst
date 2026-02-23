import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
// Remove: import { TrialUtils } from '@/lib/credits-config'

export const dynamic = 'force-dynamic'

// Initialize Stripe only if the secret key exists
const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-05-28.basil', // Use the exact version the types expect
    })
  : null

export async function POST(request: NextRequest) {
  try {
    // Check if Stripe is initialized
    if (!stripe) {
      return NextResponse.json(
        { error: 'Stripe is not configured' },
        { status: 500 }
      )
    }

    const { priceId, promotionCode, userId } = await request.json()

    if (!priceId) {
      return NextResponse.json(
        { error: 'Price ID is required' },
        { status: 400 }
      )
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      )
    }

    // Create or get customer for the user
    let customer
    try {
      // Try to find existing customer by email
      const customers = await stripe.customers.list({
        email: userId,
        limit: 1
      })
      
      if (customers.data.length > 0) {
        customer = customers.data[0]
        console.log('✅ Found existing customer:', customer.id)
      } else {
        // Create new customer
        customer = await stripe.customers.create({
          email: userId,
        })
        console.log('✅ Created new customer:', customer.id)
      }
    } catch (customerError) {
      console.error('❌ Error with customer:', customerError)
      return NextResponse.json(
        { error: 'Failed to create customer account' },
        { status: 500 }
      )
    }

    // Get the price to extract product information
    const price = await stripe.prices.retrieve(priceId)
    const productId = price.product as string

    // Validate promotion code if provided (keep existing validation logic)
    let validatedPromotionCode = null
    let discountAmount = 0
    let coupon = null

    if (promotionCode) {
      try {
        console.log('🔍 Validating promo code:', promotionCode)
        
        // List promotion codes to find the one with the given code
        const promotionCodes = await stripe.promotionCodes.list({
          code: promotionCode,
          active: true,
          limit: 1
        })

        console.log('🔍 Found promotion codes:', promotionCodes.data.length)

        if (promotionCodes.data.length === 0) {
          console.log('❌ No promotion code found')
          return NextResponse.json(
            { error: `Promo code "${promotionCode}" is invalid or inactive` },
            { status: 400 }
          )
        }

        const promotionCodeObj = promotionCodes.data[0]
        console.log('✅ Found promotion code:', promotionCodeObj.id)
        
        // Check if the promotion code has expired
        if (promotionCodeObj.expires_at && promotionCodeObj.expires_at < Math.floor(Date.now() / 1000)) {
          console.log('❌ Promotion code expired')
          return NextResponse.json(
            { error: 'This promotion code has expired' },
            { status: 400 }
          )
        }

        // Safely access coupon with error handling
        try {
          // Retrieve the coupon with expanded applies_to information
          coupon = await stripe.coupons.retrieve(promotionCodeObj.coupon.id, {
            expand: ['applies_to']
          })
          
          console.log('🔍 Coupon details:', {
            id: coupon.id,
            percent_off: coupon.percent_off,
            amount_off: coupon.amount_off,
            applies_to: coupon.applies_to
          })
        } catch (couponError) {
          console.error('❌ Error retrieving coupon:', couponError)
          return NextResponse.json(
            { error: 'Failed to retrieve promotion code details' },
            { status: 400 }
          )
        }

        // Check if coupon has restrictions
        if (coupon.applies_to) {
          console.log('🔍 Checking coupon restrictions...')
          console.log('🔍 Full applies_to object:', JSON.stringify(coupon.applies_to, null, 2))
          console.log('🔍 Current priceId:', priceId)
          console.log('🔍 Current productId:', productId)
          
          // Check product restrictions
          if (coupon.applies_to.products !== undefined) {
            console.log('🔍 Product restrictions:', coupon.applies_to.products)
            console.log('🔍 Product restrictions length:', coupon.applies_to.products.length)
            
            // If products array exists (even if empty), check restrictions
            if (coupon.applies_to.products.length > 0) {
              const isProductAllowed = coupon.applies_to.products.includes(productId)
              console.log('🔍 Product allowed:', isProductAllowed)
              
              if (!isProductAllowed) {
                // Get product names for better error message
                const allowedProductIds = coupon.applies_to.products
                const allowedProductNames = []
                
                for (const allowedProductId of allowedProductIds) {
                  try {
                    const allowedProduct = await stripe.products.retrieve(allowedProductId)
                    allowedProductNames.push(allowedProduct.name)
                  } catch (err) {
                    console.log('Could not retrieve product name for:', allowedProductId)
                  }
                }
                
                const errorMessage = allowedProductNames.length > 0 
                  ? `This promo code is valid only for ${allowedProductNames.join(' and ')} and does not apply to your selected ${price.recurring?.interval || 'unknown'} plan.`
                  : 'This promo code is not valid for the selected plan.'
                
                return NextResponse.json(
                  { error: errorMessage },
                  { status: 400 }
                )
              }
            } else {
              console.log('✅ No specific product restrictions - applies to all products')
            }
          }
          
          // Check price restrictions
          const appliesTo = coupon.applies_to as any
          if (appliesTo.prices !== undefined) {
            console.log('🔍 Price restrictions:', appliesTo.prices)
            console.log('🔍 Price restrictions length:', appliesTo.prices.length)
            
            // If prices array exists (even if empty), check restrictions
            if (appliesTo.prices.length > 0) {
              const isPriceAllowed = appliesTo.prices.includes(priceId)
              console.log('🔍 Price allowed:', isPriceAllowed)
              
              if (!isPriceAllowed) {
                // Get billing cycle info for better error message
                const priceInfo = await stripe.prices.retrieve(priceId)
                const productInfo = await stripe.products.retrieve(priceInfo.product as string)
                const currentBillingCycle = priceInfo.recurring?.interval || 'unknown'
                
                return NextResponse.json(
                  { 
                    error: `This promo code is valid only for ${productInfo.name} (${currentBillingCycle === 'month' ? 'monthly' : 'yearly'} billing) and does not apply to your selected ${price.recurring?.interval || 'unknown'} plan.` 
                  },
                  { status: 400 }
                )
              }
            } else {
              // Empty prices array means NO prices are allowed
              console.log('❌ Empty price restrictions - promo code applies to NO prices')
              return NextResponse.json(
                { error: 'This promo code is not valid for the selected billing cycle' },
                { status: 400 }
              )
            }
          }
        }

        // Calculate discount amount
        if (coupon.amount_off) {
          discountAmount = coupon.amount_off
          console.log('💰 Fixed discount:', discountAmount)
        } else if (coupon.percent_off) {
          discountAmount = Math.round((price.unit_amount || 0) * (coupon.percent_off / 100))
          console.log('💰 Percentage discount:', coupon.percent_off, '% =', discountAmount)
        }

        // If no discount was calculated, the promo code doesn't apply
        if (discountAmount === 0) {
          console.log('❌ No discount calculated')
          return NextResponse.json(
            { error: 'This promo code does not provide any discount for the selected plan' },
            { status: 400 }
          )
        }

        validatedPromotionCode = promotionCodeObj.code // Store the actual code string
        console.log('✅ Promo code validated successfully')
        
      } catch (error) {
        console.error('❌ Error validating promotion code:', error)
        return NextResponse.json(
          { error: 'Failed to validate promotion code. Please try again.' },
          { status: 500 }
        )
      }
    }

    // Create Setup Intent with promo code support
    const setupIntentParams: Stripe.SetupIntentCreateParams = {
      customer: customer.id,
      payment_method_types: ['card'],
      usage: 'off_session',
      metadata: {
        priceId: priceId,
        userId: userId,
        // Store promo code in metadata for later use during subscription creation
        ...(validatedPromotionCode && { promotionCode: validatedPromotionCode })
      }
    }

    const setupIntent = await stripe.setupIntents.create(setupIntentParams)

    // Get product information for response
    const product = await stripe.products.retrieve(productId)
    
    const response = {
      clientSecret: setupIntent.client_secret,
      priceId: priceId,
      productId: productId,
      originalAmount: price.unit_amount || 0,
      discountAmount: discountAmount,
      finalAmount: (price.unit_amount || 0) - discountAmount,
      ...(validatedPromotionCode && { promotionCode: validatedPromotionCode }),
      billingCycle: price.recurring?.interval || 'month',
      // Include detailed promo code info for frontend display
      ...(validatedPromotionCode && coupon && {
        promoCodeInfo: {
          productName: product.name || 'Unknown Product',
          billingCycle: price.recurring?.interval || 'month',
          discountType: coupon.percent_off ? 'percentage' : 'amount',
          discountValue: coupon.percent_off ? coupon.percent_off / 100 : (coupon.amount_off ? coupon.amount_off / 100 : 0),
          appliesTo: coupon.applies_to || { products: [], prices: [] },
          promotionCode: validatedPromotionCode
        }
      })
    }

    console.log('✅ Setup Intent created successfully with promo code support:', setupIntent.id)
    return NextResponse.json(response)

  } catch (error) {
    console.error('Error creating setup intent:', error)
    return NextResponse.json(
      { error: 'Failed to create setup intent' },
      { status: 500 }
    )
  }
}

// Helper function to calculate discount amount
function calculateDiscountAmount(price: Stripe.Price, coupon: Stripe.Coupon): number {
  let amount = 0
  
  if (coupon.amount_off) {
    amount = coupon.amount_off
  } else if (coupon.percent_off) {
    amount = Math.round((price.unit_amount || 0) * (coupon.percent_off / 100))
  }
  
  return amount
}