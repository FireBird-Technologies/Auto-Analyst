"use client"

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Head from 'next/head'
import Link from 'next/link'
import { Elements } from '@stripe/react-stripe-js'
import { loadStripe, StripeElementsOptions } from '@stripe/stripe-js'
import { motion } from 'framer-motion'
import { ArrowLeft, CreditCard, ShieldCheck, Lock, CheckCircle } from 'lucide-react'
import CheckoutForm from '@/components/CheckoutForm'
import { useSession } from 'next-auth/react'

// Load stripe outside of component to avoid recreating it on each render
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

export default function CheckoutPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session, status } = useSession()
  const [loadingPlan, setLoadingPlan] = useState(true)
  
  const plan = searchParams?.get('plan')
  const initialCycle = searchParams?.get('cycle')
  
  const [planDetails, setPlanDetails] = useState({
    name: '',
    amount: 0,
    cycle: 'month',
    priceId: '',
  })
  
  // Add state for billing cycle toggle
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>(initialCycle === 'yearly' ? 'yearly' : 'monthly')
  
  const [clientSecret, setClientSecret] = useState('')
  const [setupIntentId, setSetupIntentId] = useState('')
  const [isTrialSetup, setIsTrialSetup] = useState(false)
  const [paymentLoading, setPaymentLoading] = useState(false)
  const [paymentError, setPaymentError] = useState('')
  const [promoError, setPromoError] = useState('')
  const [promoCode, setPromoCode] = useState('')
  const [discountApplied, setDiscountApplied] = useState(false)
  const [discountInfo, setDiscountInfo] = useState<{type: string, value: number} | null>(null)

  // Plan configurations with both monthly and yearly options
  const pricingTiers = [
    {
      name: 'Standard',
      monthly: {
        price: 15,
        priceId: process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID,
      },
      yearly: {
        price: 126, // $15 * 12 months = $180, with 30% discount = $126
        priceId: process.env.NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID,
        savings: 54, // $180 - $126 = $54 savings
      },
      daily: {
        price: 0.75,
        priceId: process.env.NEXT_PUBLIC_STRIPE_DAILY_PRICE_ID,
      },
    }
  ]

  // Function to update plan details when billing cycle changes
  const updatePlanForCycle = (newCycle: 'monthly' | 'yearly') => {
    if (!plan) return

    const selectedPlan = pricingTiers.find(p => p.name.toLowerCase() === plan)
    if (selectedPlan) {
      const billing = newCycle === 'yearly' ? 'yearly' : 'monthly'
      const planData = {
        name: selectedPlan.name,
        amount: selectedPlan[billing]?.price || 0,
        cycle: billing === 'yearly' ? 'year' : 'month',
        priceId: selectedPlan[billing]?.priceId || '',
      }
      
      setPlanDetails(planData)
      
      // Re-create payment intent with new plan data
      createPaymentIntent(planData, promoCode)
    }
  }

  // Handle billing cycle change
  const handleBillingCycleChange = (newCycle: 'monthly' | 'yearly') => {
    if (newCycle === billingCycle || paymentLoading) return
    
    
    setPaymentLoading(true)
    setBillingCycle(newCycle)
    
    // Update URL to reflect the new billing cycle
    const newUrl = new URL(window.location.href)
    newUrl.searchParams.set('cycle', newCycle)
    window.history.replaceState({}, '', newUrl.toString())
    
    // Clear existing payment intents to force creation of new ones
    setClientSecret('')
    setSetupIntentId('')
    setPaymentError('')
    setPromoError('')
    
    
    // Add a small delay to show loading state
    setTimeout(() => {
      updatePlanForCycle(newCycle)
      setPaymentLoading(false)
    }, 300)
  }

  // Create or recreate payment intent
  const createPaymentIntent = async (planData: any, promoCodeValue: string = '') => {
    if (!planData.priceId || !session) return

    setPaymentLoading(true)
    
    // Clear previous state to avoid stale data
    setClientSecret('')
    setSetupIntentId('')
    setPaymentError('')
    if (!promoCodeValue) {
      setPromoError('')
      setDiscountApplied(false)
      setDiscountInfo(null)
    }

    try {
      const response = await fetch('/api/checkout-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          priceId: planData.priceId,
          userId: session.user?.email,
          planName: planData.name,
          interval: planData.cycle,
          promoCode: promoCodeValue.trim() || undefined,
        }),
      })

      const data = await response.json()

      if (data.message) {
        if (promoCodeValue) {
          setPromoError(data.message)
          setDiscountApplied(false)
          setDiscountInfo(null)
        } else {
          setPaymentError(data.message)
          setClientSecret('')
          setSetupIntentId('')
        }
      } else {
        // Successfully created new setup intent
        setClientSecret(data.clientSecret)
        setSetupIntentId(data.setupIntentId)
        setIsTrialSetup(data.isTrialSetup || false)
        setDiscountApplied(data.discountApplied || false)
        setPaymentError('')
        setPromoError('')
        
        if (data.discountApplied && data.couponId) {
          fetchCouponDetails(data.couponId, planData.amount)
        } else {
          setDiscountInfo(null)
        }
        
        
      }
    } catch (err) {
      console.error('Error creating payment intent:', err)
      if (promoCodeValue) {
        setPromoError('Failed to validate promo code. Please try again.')
        setDiscountApplied(false)
        setDiscountInfo(null)
      } else {
        setPaymentError('Failed to set up payment. Please try again.')
        setClientSecret('')
        setSetupIntentId('')
      }
    } finally {
      setPaymentLoading(false)
    }
  }

  // Fetch coupon details for discount calculation
  const fetchCouponDetails = async (couponId: string, originalAmount: number) => {
    try {
      const response = await fetch(`/api/coupon-details?couponId=${couponId}`)
      if (response.ok) {
        const coupon = await response.json()
        setDiscountInfo({
          type: coupon.percent_off ? 'percent' : 'amount',
          value: coupon.percent_off || (coupon.amount_off / 100)
        })
      }
    } catch (err) {
      // Silently fail - discount info is not critical
    }
  }

  // Handle promo code changes
  const handlePromoCodeChange = (newPromoCode: string) => {
    if (newPromoCode.trim() && planDetails.priceId) {
      createPaymentIntent(planDetails, newPromoCode)
    } else if (!newPromoCode.trim() && clientSecret) {
      setDiscountApplied(false)
      setDiscountInfo(null)
      setPromoError('')
      createPaymentIntent(planDetails, '')
    }
  }
  
  useEffect(() => {
    if (!plan || !initialCycle || status === 'loading') {
      return
    }
    
    if (status === 'unauthenticated') {
      router.push('/login?redirect=/pricing')
      return
    }
    
    // Get plan details based on URL parameters
    const pricingTiers = [
      {
        name: 'Standard',
        monthly: {
          price: 15,
          priceId: process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID,
        },
        yearly: {
          price: 126,
          priceId: process.env.NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID,
        },
        daily: {
          price: 0.75,
          priceId: process.env.NEXT_PUBLIC_STRIPE_DAILY_PRICE_ID,
        },
      },
      {
        name: 'Pro',
        monthly: {
          price: 29,
          priceId: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID,
        },
        yearly: {
          price: 244,
          priceId: process.env.NEXT_PUBLIC_STRIPE_PRO_YEARLY_PRICE_ID,
        },
      },
    ]
    
    const selectedPlan = pricingTiers.find(p => p.name.toLowerCase() === plan)
    
    if (selectedPlan) {
      const billing = initialCycle === 'yearly' ? 'yearly' : initialCycle === 'daily' ? 'daily' : 'monthly'
      const planData = {
        name: selectedPlan.name,
        amount: selectedPlan[billing]?.price || 0,
        cycle: billing === 'yearly' ? 'year' : billing === 'daily' ? 'day' : 'month',
        priceId: selectedPlan[billing]?.priceId || '',
      }
      
      setPlanDetails(planData)
      
      // Create initial payment intent without promo code
      createPaymentIntent(planData)
    } else {
      // Plan not found, redirect to pricing
      router.push('/pricing')
    }
    
    setLoadingPlan(false)
  }, [plan, initialCycle, router, status, session])
  
  if (status === 'loading' || loadingPlan || paymentLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-10 h-10 rounded-full border-t-2 border-[#FF7F7F]"
        />
      </div>
    )
  }
  
  return (
    <>
      <Head>
        <title>Checkout | Auto-Analyst</title>
      </Head>
      
      <div className="min-h-screen bg-gray-50 py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-10">
            <Link href="/pricing" className="flex items-center text-gray-700 hover:text-[#FF7F7F] transition-colors cursor-pointer">
              <ArrowLeft size={16} className="mr-1" />
              <span>Back to pricing</span>
            </Link>
            
            <div className="flex items-center gap-1 text-sm text-gray-500">
              <Lock size={14} />
              <span>Secure Checkout</span>
            </div>
          </div>
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <h1 className="text-3xl font-bold text-gray-900 mb-2 text-center">Complete your purchase</h1>
            <p className="text-gray-600 mb-6 text-center">
              You're subscribing to the {planDetails.name} plan
            </p>
            
            {/* Billing Cycle Toggle */}
            <div className="mb-10 flex flex-col items-center">
              <div className="mb-3 text-center">
                <span className="inline-block bg-[#FF7F7F] text-white font-bold py-1 px-3 rounded-full text-sm animate-pulse">
                  SAVE 30% WITH YEARLY BILLING
                </span>
              </div>
              <div className="relative bg-white p-0.5 rounded-lg shadow-sm flex border border-gray-200">
                <button
                  onClick={() => handleBillingCycleChange('monthly')}
                  disabled={paymentLoading}
                  className={`relative px-6 py-2 text-sm font-medium rounded-md focus:outline-none transition-colors ${
                    billingCycle === 'monthly'
                      ? 'bg-[#FF7F7F] text-white'
                      : 'text-gray-700 hover:text-gray-900'
                  } ${paymentLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  Monthly
                </button>
                <button
                  onClick={() => handleBillingCycleChange('yearly')}
                  disabled={paymentLoading}
                  className={`relative px-6 py-2 text-sm font-medium rounded-md focus:outline-none flex items-center transition-colors ${
                    billingCycle === 'yearly'
                      ? 'bg-[#FF7F7F] text-white'
                      : 'text-gray-700 hover:text-gray-900'
                  } ${paymentLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  Yearly
                  <span className={`ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    billingCycle === 'yearly'
                      ? 'bg-white text-[#FF7F7F]'
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    Save 30%
                  </span>
                </button>
              </div>
              
              {/* Price comparison */}
              {billingCycle === 'yearly' && planDetails.name === 'Standard' && (
                <div className="mt-3 text-center">
                  <p className="text-sm text-green-600 font-medium">
                    Save $54 per year compared to monthly billing!
                  </p>
                  <p className="text-xs text-gray-500">
                    That's ${(planDetails.amount / 12).toFixed(2)}/month when billed yearly
                  </p>
                </div>
              )}
            </div>
            
            {paymentError && (
              <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-md">
                {paymentError}
              </div>
            )}
            
            <div className="grid gap-6 lg:gap-10 grid-cols-1 lg:grid-cols-2">
              <div className="order-2 lg:order-1">
                {paymentLoading && (
                  <div className="flex items-center justify-center p-8 bg-white rounded-lg shadow-md border border-gray-100">
                    <div className="flex items-center gap-3">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#FF7F7F]"></div>
                      <span className="text-gray-600">Updating plan details...</span>
                    </div>
                  </div>
                )}
                
                {clientSecret && !paymentLoading && (
                  <Elements 
                    key={clientSecret}
                    stripe={stripePromise} 
                    options={{ 
                      clientSecret,
                      appearance: {
                        theme: 'stripe' as const
                      }
                    } as StripeElementsOptions}
                  >
                    <CheckoutForm 
                      planName={planDetails.name}
                      amount={planDetails.amount}
                      interval={planDetails.cycle as 'month' | 'year' | 'day'}
                      clientSecret={clientSecret}
                      isTrialSetup={isTrialSetup}
                      setupIntentId={setupIntentId}
                    />
                    
                    {/* Debug info - remove in production */}
                    {process.env.NODE_ENV === 'development' && setupIntentId && (
                      <div className="mt-2 p-2 bg-gray-100 rounded text-xs text-gray-600">
                        <strong>Debug:</strong> Setup Intent: {setupIntentId.substring(0, 20)}...
                        <br />
                        <strong>Plan:</strong> {planDetails.name} {planDetails.cycle} (${planDetails.amount})
                      </div>
                    )}
                  </Elements>
                )}
              </div>
              
              <div className="order-1 lg:order-2">
                {/* Promo Code Section */}
                <div className="bg-white p-6 rounded-lg shadow-md border border-gray-100 mb-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Promo Code</h3>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={promoCode}
                        onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                        placeholder="Enter promo code"
                        className="w-full h-12 px-4 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#FF7F7F] focus:border-[#FF7F7F] transition-all text-center sm:text-left"
                        disabled={paymentLoading}
                      />
                      {discountApplied && (
                        <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                          <CheckCircle className="w-5 h-5 text-green-500" />
                        </div>
                      )}
                    </div>
                    {!discountApplied ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (promoCode.trim()) {
                            handlePromoCodeChange(promoCode.trim())
                          }
                        }}
                        disabled={!promoCode.trim() || paymentLoading}
                        className="h-12 px-8 bg-[#FF7F7F] hover:bg-[#FF6666] text-white rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed font-medium whitespace-nowrap w-full sm:w-auto"
                      >
                        Apply
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setPromoCode('')
                          handlePromoCodeChange('')
                        }}
                        disabled={paymentLoading}
                        className="h-12 px-8 bg-gray-500 hover:bg-gray-600 text-white rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed font-medium whitespace-nowrap w-full sm:w-auto"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {promoError && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md">
                      <p className="text-sm text-red-600 text-center sm:text-left">{promoError}</p>
                    </div>
                  )}
                  {discountApplied && (
                    <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-md">
                      <p className="text-sm text-green-600 text-center sm:text-left">✓ Promo code applied!</p>
                    </div>
                  )}
                </div>

                <div className="bg-white p-6 rounded-lg shadow-md border border-gray-100">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Order Summary</h3>
                  
                  <div className="border-t border-gray-200 py-4">
                    <div className="flex justify-between mb-2">
                      <span className="text-gray-700">
                        {planDetails.name} Plan ({planDetails.cycle === 'year' ? 'Yearly' : 'Monthly'})
                      </span>
                      <span className={`text-gray-900 ${discountApplied ? 'line-through text-gray-500' : ''}`}>
                        ${planDetails.amount}
                      </span>
                    </div>
                    
                    {/* Show yearly savings */}
                    {billingCycle === 'yearly' && planDetails.name === 'Standard' && (
                      <div className="flex justify-between mb-2">
                        <span className="text-green-700 font-medium text-sm">
                          Yearly Discount (30% off)
                        </span>
                        <span className="text-green-700 font-medium text-sm">
                          -$54.00
                        </span>
                      </div>
                    )}
                    
                    {discountApplied && discountInfo && (
                      <div className="flex justify-between mb-2">
                        <span className="text-green-700 font-medium">
                          Promo Discount ({discountInfo.type === 'percent' ? `${discountInfo.value}% off` : `$${discountInfo.value} off`})
                        </span>
                        <span className="text-green-700 font-medium">
                          {discountInfo.type === 'percent' 
                            ? `-$${((planDetails.amount * discountInfo.value) / 100).toFixed(2)}`
                            : `-$${discountInfo.value.toFixed(2)}`
                          }
                        </span>
                      </div>
                    )}
                    
                    <div className="mt-3 pt-2 border-t border-gray-100">
                    <p className="text-sm text-gray-500">
                      Billed {planDetails.cycle === 'year' ? 'yearly' : planDetails.cycle === 'day' ? 'daily' : 'monthly'}
                    </p>
                      {billingCycle === 'yearly' && (
                        <p className="text-xs text-gray-400 mt-1">
                          Credits reset monthly, but you're billed yearly
                        </p>
                      )}
                    </div>
                    
                    {(discountApplied || billingCycle === 'yearly') && (
                      <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded-md">
                        {discountApplied && (
                          <p className="text-sm text-green-700 font-medium">✓ Promo code applied!</p>
                        )}
                        {billingCycle === 'yearly' && !discountApplied && (
                          <p className="text-sm text-green-700 font-medium">✓ 30% yearly discount applied!</p>
                        )}
                      </div>
                    )}
                  </div>
                  
                  <div className="border-t border-gray-200 py-4">
                    <div className="flex justify-between font-medium text-gray-900">
                      <span>Total (USD)</span>
                      <span>
                        {(discountApplied && discountInfo) || billingCycle === 'yearly' ? (
                          <div className="text-right">
                            <div className="text-lg font-bold text-green-600">
                              ${(() => {
                                let total = planDetails.amount
                                
                                // Apply promo discount if any
                                if (discountApplied && discountInfo) {
                                  if (discountInfo.type === 'percent') {
                                    total = total - (total * discountInfo.value) / 100
                                  } else {
                                    total = Math.max(0, total - discountInfo.value)
                                  }
                                }
                                
                                return total.toFixed(2)
                              })()}
                            </div>
                            <div className="text-xs text-gray-500">
                              {billingCycle === 'yearly' && planDetails.name === 'Standard' && !discountApplied && (
                                'You save $54.00 with yearly billing!'
                              )}
                              {discountApplied && discountInfo && (
                                `You save $${
                              discountInfo.type === 'percent' 
                                ? ((planDetails.amount * discountInfo.value) / 100).toFixed(2)
                                : discountInfo.value.toFixed(2)
                                } with promo code!`
                              )}
                              {billingCycle === 'yearly' && planDetails.name === 'Standard' && discountApplied && discountInfo && (
                                `Total savings: $${(54 + (
                                  discountInfo.type === 'percent' 
                                    ? (planDetails.amount * discountInfo.value) / 100
                                    : discountInfo.value
                                )).toFixed(2)}!`
                              )}
                            </div>
                          </div>
                        ) : (
                          `$${planDetails.amount}`
                        )}
                      </span>
                    </div>
                  </div>
                  
                  <div className="mt-6 space-y-4">
                    <div className="flex items-center text-sm text-gray-600">
                      <ShieldCheck size={16} className="mr-2 text-green-500" />
                      <span>Your subscription is protected by our 30-day guarantee</span>
                    </div>
                    <div className="flex items-center text-sm text-gray-600">
                      <CreditCard size={16} className="mr-2 text-gray-400" />
                      <span>We accept all major credit cards</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </>
  )
} 