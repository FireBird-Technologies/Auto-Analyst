"use client"

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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
  const [paymentLoading, setPaymentLoading] = useState(false)
  const [promoLoading, setPromoLoading] = useState(false) // Add separate loading state for promo codes
  const [paymentError, setPaymentError] = useState('')
  const [promoError, setPromoError] = useState('')
  const [promoCode, setPromoCode] = useState('')
  const [discountApplied, setDiscountApplied] = useState(false)
  const [discountInfo, setDiscountInfo] = useState<{type: string, value: number} | null>(null)
  const [discountAmount, setDiscountAmount] = useState(0) // Add this state
  const [promoCodeInfo, setPromoCodeInfo] = useState<{
    productName: string
    billingCycle: string
    discountType: 'percentage' | 'amount'
    discountValue: number
    appliesTo: {
      products: string[]
      prices: string[]
    }
  } | null>(null)

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

    console.log('🔍 Creating payment intent with plan data:', planData)
    console.log('🔍 Price ID:', planData.priceId)
    console.log('🔍 Plan name:', planData.name)
    console.log('🔍 Interval:', planData.cycle)
    console.log('🔍 Promo code:', promoCodeValue)

    // Set appropriate loading state
    if (promoCodeValue) {
      setPromoLoading(true)
    } else {
      setPaymentLoading(true)
    }
    
    // Clear previous state to avoid stale data
    if (!promoCodeValue) {
      setClientSecret('')
    }
    setPaymentError('')
    
    // Always clear promo-related state when creating new payment intent
    if (!promoCodeValue) {
      setPromoError('')
      setDiscountApplied(false)
      setDiscountAmount(0) // Reset discount amount
      setDiscountInfo(null)
    } else {
      // Clear previous promo state when applying new code
      setPromoError('')
      setDiscountApplied(false)
      setDiscountAmount(0) // Reset discount amount
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
          promotionCode: promoCodeValue.trim() || undefined, // Fixed: was promoCode, should be promotionCode
        }),
      })

      const data = await response.json()
      console.log('📡 API Response:', data)

      // Check for HTTP error status
      if (!response.ok) {
        console.error('❌ API Error:', data.error)
        setPromoError(data.error || 'An error occurred')
        setDiscountApplied(false)
        setDiscountAmount(0) // Reset discount amount
        setDiscountInfo(null)
        setPromoCodeInfo(null)
        
        // Don't set clientSecret or other success states for promo code errors
        if (!promoCodeValue) {
          setClientSecret('')
        }
        return
      }

      // Success case - setup intent created
      console.log('✅ Setup intent created:', data.clientSecret)
      setClientSecret(data.clientSecret)
      setPaymentError('')
      
      // Handle promo code success
      if (data.discountAmount > 0 && data.promoCodeInfo) {
        setDiscountApplied(true)
        setPromoError('')
        setDiscountAmount(data.discountAmount) // Store the actual discount amount
        setDiscountInfo({
          type: data.promoCodeInfo.discountType,
          value: data.promoCodeInfo.discountValue
        })
        setPromoCodeInfo(data.promoCodeInfo)
      } else {
        // No promo code or no discount
        setDiscountApplied(false)
        setPromoError('')
        setDiscountAmount(0) // Reset discount amount
        setDiscountInfo(null)
        setPromoCodeInfo(null)
      }
      
      setPaymentError('')

    } catch (err) {
      console.error('❌ Error creating payment intent:', err)
      
      // Set appropriate error state based on whether this was a promo code validation
      if (promoCodeValue) {
        setPromoError('Failed to validate promo code. Please try again.')
        setDiscountApplied(false)
        setDiscountAmount(0) // Reset discount amount
        setDiscountInfo(null)
      } else {
        setPaymentError('Failed to set up payment. Please try again.')
        setClientSecret('')
      }
    } finally {
      // Clear appropriate loading state
      if (promoCodeValue) {
        setPromoLoading(false)
      } else {
        setPaymentLoading(false)
      }
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
      // Clear previous discount state before validation
      setDiscountApplied(false)
      setDiscountAmount(0) // Reset discount amount
      setDiscountInfo(null)
      setPromoError('')
      
      createPaymentIntent(planDetails, newPromoCode)
    } else if (!newPromoCode.trim() && clientSecret) {
      setDiscountApplied(false)
      setDiscountAmount(0) // Reset discount amount
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
                      priceId={planDetails.priceId}
                      promoCodeInfo={promoCodeInfo} // Add this
                    />
                    
                    {/* Debug info - remove in production */}
                    {process.env.NODE_ENV === 'development' && clientSecret && (
                      <div className="mt-2 p-2 bg-gray-100 rounded text-xs text-gray-600">
                        <strong>Debug:</strong> Setup Intent: {clientSecret.split('_secret_')[0]}...
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
                        disabled={!promoCode.trim() || promoLoading}
                        className="h-12 px-8 bg-[#FF7F7F] hover:bg-[#FF6666] text-white rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed font-medium whitespace-nowrap w-full sm:w-auto"
                      >
                        {promoLoading ? 'Validating...' : 'Apply'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setPromoCode('')
                          handlePromoCodeChange('')
                        }}
                        disabled={promoLoading}
                        className="h-12 px-8 bg-gray-500 hover:bg-gray-600 text-white rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed font-medium whitespace-nowrap w-full sm:w-auto"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  
                  {/* Promo Code Validation Messages */}
                  {promoError && (
                    <p className="text-sm text-red-600 mt-2">{promoError}</p>
                  )}
                  
                  {/* Promo Code Success Message */}
                  {promoCodeInfo && !promoError && (
                    <div className="bg-green-50 border border-green-200 rounded-md p-3 mt-3">
                      <div className="flex items-start">
                        <CheckCircle className="h-5 w-5 text-green-400 mt-0.5 mr-2 flex-shrink-0" />
                        <div className="text-sm">
                          <p className="font-medium text-green-800">
                            Promo code applied successfully!
                          </p>
                          <p className="text-green-700 mt-1">
                            This promo code applies to: <strong>{promoCodeInfo.productName}</strong> ({promoCodeInfo.billingCycle === 'month' ? 'monthly' : promoCodeInfo.billingCycle === 'year' ? 'yearly' : promoCodeInfo.billingCycle} billing)
                          </p>
                          <p className="text-green-700">
                            Discount: {promoCodeInfo.discountType === 'percentage' 
                              ? `${(promoCodeInfo.discountValue * 100)}% off` 
                              : `$${promoCodeInfo.discountValue} off`
                            }
                          </p>
                        </div>
                      </div>
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
                    
                    {/* Show yearly savings - only if no promo code is applied or promo code is invalid */}
                    {billingCycle === 'yearly' && planDetails.name === 'Standard' && !discountApplied && (
                      <div className="flex justify-between mb-2">
                        <span className="text-green-700 font-medium text-sm">
                          Yearly Discount (30% off)
                        </span>
                        <span className="text-green-700 font-medium text-sm">
                          -$54.00
                        </span>
                      </div>
                    )}
                    
                    {/* Show promo discount - only if backend confirms it's valid */}
                    {discountApplied && discountInfo && !promoError && (
                      <div className="flex justify-between mb-2">
                        <span className="text-green-700 font-medium">
                          Promo Discount ({discountInfo.type === 'percentage' ? `${(discountInfo.value * 100)}% off` : `$${discountInfo.value} off`})
                        </span>
                        <span className="text-green-700 font-medium">
                          -${(discountAmount / 100).toFixed(2)} {/* Use discountAmount directly */}
                        </span>
                      </div>
                    )}
                    
                    {/* Show promo code error if validation failed */}
                    {promoError && (
                      <div className="flex justify-between mb-2">
                        <span className="text-red-600 font-medium text-sm">
                          Promo Code Error
                        </span>
                        <span className="text-red-600 font-medium text-sm">
                          {promoError}
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
                    
                    {/* Success messages - only show valid discounts */}
                    {(discountApplied || (billingCycle === 'yearly' && !discountApplied)) && (
                      <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded-md">
                        {discountApplied && !promoError && (
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
                        {(() => {
                          if (discountApplied && discountAmount > 0 && !promoError) {
                            const total = (planDetails.amount * 100 - discountAmount) / 100
                            return (
                              <div className="text-right">
                                <div className="text-lg font-bold text-green-600">
                                  {total.toFixed(2)}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {`You save $${(discountAmount / 100).toFixed(2)} with promo code!`}
                                  {billingCycle === 'yearly' && planDetails.name === 'Standard' && (
                                    ` Total savings: $${(54 + (discountAmount / 100)).toFixed(2)}!`
                                  )}
                                </div>
                              </div>
                            )
                          } else {
                            return (
                              <div className="text-right">
                                <div className="text-lg font-bold text-green-600">
                                  {planDetails.amount.toFixed(2)}
                                </div>
                                {billingCycle === 'yearly' && planDetails.name === 'Standard' && !discountApplied && (
                                  <div className="text-xs text-gray-500">
                                    You save $54.00 with yearly billing!
                                  </div>
                                )}
                              </div>
                            )
                          }
                        })()}
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