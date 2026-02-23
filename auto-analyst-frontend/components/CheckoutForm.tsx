"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import {
  PaymentElement,
  useStripe,
  useElements
} from '@stripe/react-stripe-js'
import { motion } from 'framer-motion'
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import { Button } from './ui/button'

interface CheckoutFormProps {
  planName: string
  amount: number
  interval: 'month' | 'year' | 'day'
  clientSecret: string
  priceId: string
  promoCodeInfo?: any // Add this
}

export default function CheckoutForm({ planName, amount, interval, clientSecret, priceId, promoCodeInfo }: CheckoutFormProps) {
  const router = useRouter()
  const { data: session } = useSession()
  const stripe = useStripe()
  const elements = useElements()
  
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [succeeded, setSucceeded] = useState(false)
  const [setupIntentId, setSetupIntentId] = useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!stripe || !elements || !clientSecret) {
      setError('Payment system not ready. Please refresh and try again.')
      return
    }

    // Prevent multiple submissions
    if (processing || succeeded) {
      return
    }

    // Check if we already have a setup intent ID (from URL params or previous submission)
    const urlParams = new URLSearchParams(window.location.search)
    const existingSetupIntentId = urlParams.get('setup_intent')
    
    if (existingSetupIntentId || setupIntentId) {
      // If we already have a setup intent, try to create subscription directly
      const intentId = existingSetupIntentId || setupIntentId
      if (intentId) {
        await createSubscription(intentId)
      }
      return
    }

    // Validate client secret format
    if (!clientSecret.includes('_secret_')) {
      setError('Invalid payment configuration. Please refresh and try again.')
      return
    }

    setProcessing(true)
    
    try {
      // Direct payment confirmation - no trial setup
      const { error: submitError, setupIntent } = await stripe.confirmSetup({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/checkout/success`,
        },
        redirect: 'if_required',
      })

      // Better error handling for specific Stripe errors
      if (submitError) {
        console.error('Setup intent confirmation error:', submitError)
        
        // Handle specific error types
        if (submitError.code === 'setup_intent_unexpected_state') {
          // Setup intent already succeeded, try to create subscription
          if (submitError.setup_intent?.id) {
            await createSubscription(submitError.setup_intent.id)
            return
          }
          setError('Payment was already processed. Please refresh the page.')
        } else if (submitError.code === 'payment_method_unexpected_state') {
          setError('Payment method is in an unexpected state. Please try again.')
        } else {
          setError(submitError.message || 'An error occurred during payment setup')
        }
        
        setProcessing(false)
        return
      }

      if (setupIntent && setupIntent.status === 'succeeded') {
        setSetupIntentId(setupIntent.id)
        await createSubscription(setupIntent.id)
      }

    } catch (err) {
      console.error('Payment error:', err)
      setError('Payment failed. Please try again.')
      setProcessing(false)
    }
  }

  const createSubscription = async (intentId: string) => {
    try {
      setError(null)
      setSucceeded(true)
      
      const response = await fetch('/api/create-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          setupIntentId: intentId,
          priceId: priceId,
          promoCodeInfo: promoCodeInfo,
          promotionCode: promoCodeInfo?.promotionCode // Add the actual promo code string
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create subscription')
      }

      // Redirect to success page with subscription ID
      setTimeout(() => {
        router.push(`/checkout/success?subscription_id=${data.subscriptionId}`)
      }, 1500)

    } catch (subscriptionError) {
      console.error('Subscription creation error:', subscriptionError)
      setError('Payment setup succeeded but subscription creation failed. Please contact support.')
      setSucceeded(false)
      setProcessing(false)
    }
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-md border border-gray-100">
      <form onSubmit={handleSubmit}>
        <div className="mb-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Payment Information</h3>
          <PaymentElement 
            options={{
              layout: 'tabs'
            }}
          />
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-center"
          >
            <AlertCircle className="h-5 w-5 text-red-500 mr-2 flex-shrink-0" />
            <p className="text-sm text-red-600">{error}</p>
          </motion.div>
        )}

        {succeeded && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-4 p-4 bg-green-50 border border-green-200 rounded-md flex items-center justify-center"
          >
            <CheckCircle className="h-6 w-6 text-green-500 mr-2" />
            <p className="text-green-700 font-medium">Payment setup successful!</p>
          </motion.div>
        )}

        <Button
          type="submit"
          disabled={!stripe || processing || succeeded}
          className="w-full bg-[#FF7F7F] hover:bg-[#FF6666] text-white font-medium py-3 px-4 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {processing ? (
            <div className="flex items-center justify-center">
              <Loader2 className="animate-spin h-5 w-5 mr-2" />
              Processing...
            </div>
          ) : succeeded ? (
            <div className="flex items-center justify-center">
              <CheckCircle className="h-5 w-5 mr-2" />
              Complete!
            </div>
          ) : (
            `Subscribe to ${planName} - $${amount}/${interval === 'year' ? 'year' : 'month'}`
          )}
        </Button>
      </form>

      <div className="mt-4 text-center">
        <p className="text-xs text-gray-500">
          Your payment information is secure and encrypted
        </p>
      </div>
    </div>
  )
} 
