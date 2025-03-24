import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getServerSession } from 'next-auth'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-02-24.acacia',
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { priceId, userId, email } = body

    if (!priceId) {
      return NextResponse.json({ error: 'Price ID is required' }, { status: 400 })
    }

    // Get user session to ensure they're logged in
    const session = await getServerSession()
    
    if (!session) {
      return NextResponse.json({ error: 'You must be logged in to subscribe' }, { status: 401 })
    }

    // Create a checkout session with the specified price
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      // Use metadata to store user ID for webhooks
      metadata: {
        userId: userId || session.user.id,
      },
      customer_email: email || session.user.email,
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/pricing`,
    })

    return NextResponse.json({ 
      clientSecret: checkoutSession.client_secret,
      id: checkoutSession.id,
    })
  } catch (error: any) {
    console.error('Stripe checkout error:', error)
    return NextResponse.json({ 
      error: error.message || 'Something went wrong with the checkout process' 
    }, { status: 500 })
  }
} 