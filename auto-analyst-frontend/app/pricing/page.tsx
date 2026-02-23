"use client"

import { useState, useEffect } from 'react';
import Head from 'next/head';
import { useSession } from 'next-auth/react';
import { motion } from 'framer-motion';
import { CheckCircle, X, Check, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Infinity as InfinityIcon } from 'lucide-react';
import { MODEL_TIERS } from '@/lib/model-tiers';
import { useRouter, useSearchParams } from 'next/navigation';

// Define pricing tiers with both monthly and yearly options
const pricingTiers = [
  {
    name: 'Free',
    monthly: {
      price: 0,
      priceId: null,
    },
    yearly: {
      price: 0,
      priceId: null,
    },
    credits: {
      monthly: 20,
      yearly: 20,
    },
    features: [
      '20 credits',
      'No support',
      '1 free code fix per query',
      '4 messages per month',
    ],
    highlight: false,
    trial: false,
  },
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
    credits: {
      monthly: 500,
      yearly: 500,
    },
    features: [
      '500 credits or 100+ analysis/month',
      'Deep Analysis',
      'AI Code Edit',
      '3 free code fix per query',
      'Latest models',
      'Priority support',
    ],
    highlight: true,
    trial: true,
  },
  {
    name: 'Enterprise',
    monthly: {
      price: null, // Custom pricing
      priceId: null, // No direct subscription
    },
    yearly: {
      price: null, // Custom pricing
      priceId: null, // No direct subscription
    },
    credits: {
      monthly: 'Unlimited',
      yearly: 'Unlimited',
    },
    features: [
      'Everything in Standard',
      'Dedicated support',
      'Priority processing',
      'Custom integrations',
      'Tailored solutions',
      'Marketing Analytics APIs',
      'Specialized Agents'  
    ],
    highlight: false,
  }
];

export default function PricingPage() {
  const { data: session } = useSession();
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('yearly');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [referringPage, setReferringPage] = useState<string>('home');
  
  useEffect(() => {
    // Get the referring page from the query parameters or localStorage
    const referrer = searchParams?.get('from') || localStorage.getItem('referringPage') || 'home';
    setReferringPage(referrer);
    
    // Store the current page as the referring page for future navigation
    localStorage.setItem('referringPage', 'pricing');
  }, [searchParams]);
  
  const getBackButtonText = () => {
    switch (referringPage) {
      case 'chat':
        return 'Back to Chat';
      case 'account':
        return 'Back to Account';
      case 'home':
      default:
        return 'Back to Home';
    }
  };
  
  const getBackButtonUrl = () => {
    switch (referringPage) {
      case 'chat':
        return '/chat';
      case 'account':
        return '/account';
      case 'home':
      default:
        return '/';
    }
  };
  
  // Updated handleCheckout function with better error handling
  const handleCheckout = async (priceId: string | null | undefined, tierName: string) => {
    if (!priceId) {
      if (tierName === 'Free') {
        // Redirect free users to the chat page
        router.push('/chat');
        return;
      }
      return;
    }
    
    setSelectedTier(tierName);
    setIsLoading(true);
    
    try {
      // Redirect to the checkout page instead of creating a Stripe session directly
      router.push(`/checkout?plan=${tierName.toLowerCase()}&cycle=${billingCycle}`);
    } catch (error) {
      console.error('Error during checkout:', error);
      alert(`Checkout error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsLoading(false);
    }
  };

  const handleSubscribe = (plan: string, cycle: string) => {
    if (plan === 'enterprise') {
      router.push('/contact?subject=Enterprise%20Plan%20Inquiry');
      return;
    }
    
    if (plan === 'free') {
      router.push('/chat');
      return;
    }
    
    if (!session) {
      // Encode the entire checkout URL with plan parameters for proper redirection after login
      const checkoutUrl = `/checkout?plan=${plan}&cycle=${cycle}`;
      router.push(`/login?redirect=${encodeURIComponent(checkoutUrl)}`);
      return;
    }
    
    // All plans now require checkout (trial for Standard)
    router.push(`/checkout?plan=${plan}&cycle=${cycle}`);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-24">
      <Head>
        <title>Pricing - Auto-Analyst</title>
        <meta name="description" content="Choose a plan that works for you" />
      </Head>
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Back button */}
        <div className="absolute top-8 left-8">
          <Link href={getBackButtonUrl()} passHref>
            <button className="flex items-center text-gray-700 hover:text-[#FF7F7F] transition-colors">
              <ArrowLeft className="h-5 w-5 mr-2" />
              {getBackButtonText()}
            </button>
          </Link>
        </div>
        
        <div className="text-center">
          <h1 className="text-4xl font-extrabold text-gray-900 sm:text-5xl sm:tracking-tight lg:text-6xl">
            Simple, Transparent Pricing
          </h1>
          <p className="mt-5 max-w-xl mx-auto text-xl text-gray-500">
            Choose the plan that works best for your needs.
          </p>
        </div>
        
        {/* Billing cycle toggle with enhanced 30% discount visibility */}
        <div className="mt-12 flex flex-col items-center">
          <div className="mb-2 text-center">
            <span className="inline-block bg-[#FF7F7F] text-white font-bold py-1 px-3 rounded-full mb-3 animate-pulse">
              SAVE 30% WITH YEARLY BILLING
            </span>
          </div>
          <div className="relative bg-white p-0.5 rounded-lg shadow-sm flex">
            <button
              onClick={() => setBillingCycle('monthly')}
              className={`relative px-6 py-2 text-sm font-medium rounded-md focus:outline-none ${
                billingCycle === 'monthly'
                  ? 'bg-[#FF7F7F] text-white'
                  : 'text-gray-700'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingCycle('yearly')}
              className={`relative px-6 py-2 text-sm font-medium rounded-md focus:outline-none flex items-center ${
                billingCycle === 'yearly'
                  ? 'bg-[#FF7F7F] text-white'
                  : 'text-gray-700'
              }`}
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
        </div>
        
        {/* Pricing cards - Updated to show 3 cards */}
        <div className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-3 max-w-6xl mx-auto">
          {pricingTiers.map((tier) => (
            <motion.div
              key={tier.name}
              className={`flex flex-col h-full bg-white rounded-lg shadow-md ${
                tier.highlight 
                  ? 'border-2 border-[#FF7F7F] shadow-lg relative' 
                  : 'border border-gray-200'
              }`}
              whileHover={{ translateY: -5 }}
              transition={{ duration: 0.3 }}
            >
              {tier.highlight && (
                <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-[#FF7F7F] text-white py-1 px-4 rounded-full text-sm font-medium">
                  Most Popular
                </div>
              )}
              
              <div className="p-6 flex-1">
                <h3 className="text-2xl font-bold text-gray-900">{tier.name}</h3>
                
                <div className="mt-4 flex items-baseline">
                  <span className="text-5xl font-extrabold tracking-tight text-gray-900">
                    {tier.name === 'Enterprise' 
                      ? '' 
                      : tier.name === 'Free'
                        ? '$0'
                        : `$${billingCycle === 'monthly' 
                            ? tier.monthly.price
                            : tier.name === 'Standard'
                              ? (tier.yearly.price ? (tier.yearly.price / 12).toFixed(2) : '0.00')
                              : tier.yearly.price}`}
                  </span>
                  <span className="ml-1 text-xl font-medium text-gray-500">
                    {tier.name === 'Free' || tier.monthly.price === 0 || tier.name === 'Enterprise'
                      ? '' 
                      : `/${billingCycle === 'monthly' ? 'mo' : (tier.name === 'Standard' ? 'mo' : 'yr')}`}
                  </span>
                </div>
                
                {tier.name === 'Enterprise' && (
                  <p className="mt-2 text-lg text-gray-700">
                    Custom pricing for your needs
                  </p>
                )}
                
                {billingCycle === 'yearly' && tier.yearly.savings && (
                  <p className="mt-2 text-sm text-green-600 font-medium">
                    Save ${tier.yearly.savings.toFixed(2)} per year
                  </p>
                )}
                
                <p className="mt-4 text-lg text-gray-500">
                  {typeof tier.credits?.[billingCycle] === 'string' 
                    ? tier.credits?.[billingCycle] 
                    : <>{tier.credits?.[billingCycle]?.toLocaleString() || '0'} credits</>}
                </p>
                
                <ul className="mt-6 space-y-4">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start">
                      <CheckCircle className="flex-shrink-0 h-5 w-5 text-green-500" />
                      <span className="ml-3 text-gray-700">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
              
              <div className="p-6 bg-gray-50 border-t border-gray-100">
                <button
                  onClick={() => handleSubscribe(tier.name.toLowerCase(), billingCycle)}
                  className={`w-full py-3 px-6 rounded-lg font-medium transition-colors ${
                    tier.highlight
                      ? 'bg-[#FF7F7F] hover:bg-[#FF6666] text-white'
                      : tier.name === 'Free'
                        ? 'bg-gray-100 text-gray-700 border border-gray-300 hover:bg-gray-200'
                        : 'bg-white text-gray-900 border border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {tier.name === 'Free'
                    ? 'Get Started'
                    : tier.trial
                      ? `Get Started`
                      : tier.name === 'Enterprise'
                        ? 'Contact Sales'
                        : 'Subscribe'}
                </button>
              </div>
            </motion.div>
          ))}
        </div>
        
        {/* Feature comparison table - Updated to include Free plan */}
        <div className="mt-24">
          <h2 className="text-2xl font-bold text-center mb-12">Compare Plans</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full bg-white rounded-lg overflow-hidden shadow-lg">
              <thead>
                <tr>
                  <th className="py-4 px-6 bg-gray-50 text-left font-medium text-gray-500 uppercase tracking-wider border-b">Features</th>
                  {pricingTiers.map((tier) => (
                    <th key={tier.name} className="py-4 px-6 bg-gray-50 text-center font-medium text-gray-900 border-b">
                      {tier.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="py-4 px-6 border-b text-gray-700 font-medium">Credits</td>
                  {pricingTiers.map((tier) => (
                    <td key={`${tier.name}-credits`} className="py-4 px-6 border-b text-center">
                      {typeof tier.credits?.[billingCycle] === 'string' 
                        ? <InfinityIcon className="h-5 w-5 text-[#FF7F7F] mx-auto" />
                        : tier.credits?.[billingCycle]?.toLocaleString() || '0'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-4 px-6 border-b text-gray-700 font-medium">Data Analysis</td>
                  <td className="py-4 px-6 border-b text-center">Basic</td>
                  <td className="py-4 px-6 border-b text-center">Deep Analysis</td>
                  <td className="py-4 px-6 border-b text-center">Deep Analysis</td>
                </tr>
                <tr>
                  <td className="py-4 px-6 border-b text-gray-700 font-medium">Code Fixes per Query</td>
                  <td className="py-4 px-6 border-b text-center">1 free</td>
                  <td className="py-4 px-6 border-b text-center">3 free</td>
                  <td className="py-4 px-6 border-b text-center">3 free</td>
                </tr>
                <tr>
                  <td className="py-4 px-6 border-b text-gray-700 font-medium">Messages per Month</td>
                  <td className="py-4 px-6 border-b text-center">4</td>
                  <td className="py-4 px-6 border-b text-center">Unlimited</td>
                  <td className="py-4 px-6 border-b text-center">Unlimited</td>
                </tr>
                <tr>
                  <td className="py-4 px-6 border-b text-gray-700 font-medium">Model Access</td>
                  <td className="py-4 px-6 border-b text-center">Basic</td>
                  <td className="py-4 px-6 border-b text-center">Latest models</td>
                  <td className="py-4 px-6 border-b text-center">Latest models</td>
                </tr>
                <tr>
                  <td className="py-4 px-6 border-b text-gray-700 font-medium">Support Level</td>
                  <td className="py-4 px-6 border-b text-center">No support</td>
                  <td className="py-4 px-6 border-b text-center">Priority</td>
                  <td className="py-4 px-6 border-b text-center">Dedicated</td>
                </tr>
                <tr>
                  <td className="py-4 px-6 border-b text-gray-700 font-medium">Custom API Access</td>
                  <td className="py-4 px-6 border-b text-center">
                    <X className="h-5 w-5 text-red-500 mx-auto" />
                  </td>
                  <td className="py-4 px-6 border-b text-center">
                    <Check className="h-5 w-5 text-green-500 mx-auto" />
                  </td>
                  <td className="py-4 px-6 border-b text-center">
                    <Check className="h-5 w-5 text-green-500 mx-auto" />
                  </td>
                </tr>
                <tr>
                  <td className="py-4 px-6 border-b text-gray-700 font-medium">Custom Integrations</td>
                  <td className="py-4 px-6 border-b text-center">
                    <X className="h-5 w-5 text-red-500 mx-auto" />
                  </td>
                  <td className="py-4 px-6 border-b text-center">
                    <X className="h-5 w-5 text-red-500 mx-auto" />
                  </td>
                  <td className="py-4 px-6 border-b text-center">
                    <Check className="h-5 w-5 text-green-500 mx-auto" />
                  </td>
                </tr>
                <tr>
                  <td className="py-4 px-6 border-b text-gray-700 font-medium">SLA Guarantees</td>
                  <td className="py-4 px-6 border-b text-center">
                    <X className="h-5 w-5 text-red-500 mx-auto" />
                  </td>
                  <td className="py-4 px-6 border-b text-center">
                    <Check className="h-5 w-5 text-green-500 mx-auto" />
                  </td>
                  <td className="py-4 px-6 border-b text-center">
                    <Check className="h-5 w-5 text-green-500 mx-auto" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        
        <div className="mt-24">
          <h2 className="text-2xl font-bold text-center mb-8">How Model Credits Work</h2>
          <p className="text-lg text-center text-gray-700 mb-8 max-w-3xl mx-auto">
            Different AI models require different amounts of computational resources. We use a credit system to balance usage across our model offerings.
          </p>
          
          <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-md overflow-hidden">
            <table className="min-w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="py-3 px-6 text-left font-medium text-gray-700">Model Tier</th>
                  <th className="py-3 px-6 text-left font-medium text-gray-700">Credits Per Query</th>
                  <th className="py-3 px-6 text-left font-medium text-gray-700">Available Models</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                <tr className="hover:bg-gray-50">
                  <td className="py-4 px-6 text-gray-700">
                    <span className="font-medium">{MODEL_TIERS.tier1.name}</span>
                  </td>
                  <td className="py-4 px-6 text-gray-700">{MODEL_TIERS.tier1.credits}</td>
                  <td className="py-4 px-6 text-gray-700">
                    <div className="flex flex-wrap gap-1">
                      {MODEL_TIERS.tier1.models.slice(0, 3).map((model: string) => (
                        <span key={model} className="inline-flex bg-gray-100 text-gray-700 rounded-full px-2 py-1 text-xs">
                          {model}
                        </span>
                      ))}
                      <span className="inline-flex bg-gray-100 text-gray-700 rounded-full px-2 py-1 text-xs">
                        +{MODEL_TIERS.tier1.models.length - 3} more
                      </span>
                    </div>
                  </td>
                </tr>
                <tr className="hover:bg-gray-50">
                  <td className="py-4 px-6 text-gray-700">
                    <span className="font-medium">{MODEL_TIERS.tier2.name}</span>
                  </td>
                  <td className="py-4 px-6 text-gray-700">{MODEL_TIERS.tier2.credits}</td>
                  <td className="py-4 px-6 text-gray-700">
                    <div className="flex flex-wrap gap-1">
                      {MODEL_TIERS.tier2.models.map((model: string) => (
                        <span key={model} className="inline-flex bg-gray-100 text-gray-700 rounded-full px-2 py-1 text-xs">
                          {model}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
                <tr className="hover:bg-gray-50">
                  <td className="py-4 px-6 text-gray-700">
                    <span className="font-medium">{MODEL_TIERS.tier3.name}</span>
                  </td>
                  <td className="py-4 px-6 text-gray-700">{MODEL_TIERS.tier3.credits}</td>
                  <td className="py-4 px-6 text-gray-700">
                    <div className="flex flex-wrap gap-1">
                      {MODEL_TIERS.tier3.models.slice(0, 3).map((model: string) => (
                        <span key={model} className="inline-flex bg-gray-100 text-gray-700 rounded-full px-2 py-1 text-xs">
                          {model}
                        </span>
                      ))}
                      <span className="inline-flex bg-gray-100 text-gray-700 rounded-full px-2 py-1 text-xs">
                        +{MODEL_TIERS.tier3.models.length - 3} more
                      </span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          
          <div className="mt-6 max-w-3xl mx-auto text-center text-gray-600">
            <p className="text-sm">
              Example: If you have 100 credits and use a Premium tier model that costs 5 credits per query, 
              you can make 20 queries. Using a Basic tier model at 1 credit per query would allow for 100 queries.
            </p>
            <p className="text-sm mt-2">
              <span className="font-medium">Enterprise plan users</span> have unlimited access to all models regardless of tier.
            </p>
          </div>
        </div>
        
        <div className="mt-16 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Need a custom plan?</h2>
          <p className="text-lg text-gray-700 mb-6">
            Contact us for enterprise pricing and custom solutions.
          </p>
          <Link href="/contact" passHref>
            <button className="bg-white border-2 border-[#FF7F7F] text-[#FF7F7F] font-medium py-2 px-6 rounded-md hover:bg-[#FF7F7F] hover:text-white transition-colors">
              Contact Sales
            </button>
          </Link>
        </div>
        
        {/* FAQ Section */}
        <div className="mt-24">
          <h2 className="text-2xl font-bold text-center mb-8">Frequently Asked Questions</h2>
          <div className="max-w-3xl mx-auto divide-y divide-gray-200">
            <div className="py-6">
              <h3 className="text-lg font-medium text-gray-900">What are credits?</h3>
              <p className="mt-2 text-gray-600">Credits are used to process your requests. Each request consumes a certain number of credits based on complexity and model used.</p>
            </div>
            <div className="py-6">
              <h3 className="text-lg font-medium text-gray-900">How are credits reset?</h3>
              <p className="mt-2 text-gray-600">Credits are reset each month from your individual checkout date, not on the first of the month.</p>
            </div>
            <div className="py-6">
              <h3 className="text-lg font-medium text-gray-900">Can I upgrade or downgrade my plan?</h3>
              <p className="mt-2 text-gray-600">Yes, you can change your plan at any time. Changes will be reflected in your next billing cycle.</p>
            </div>
            <div className="py-6">
              <h3 className="text-lg font-medium text-gray-900">Do unused credits roll over?</h3>
              <p className="mt-2 text-gray-600">No, credits reset at the beginning of each billing cycle. This ensures you always start fresh with your full allocation.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 
