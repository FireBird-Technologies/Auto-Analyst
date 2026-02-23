"use client";

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, ShieldAlert, CheckCircle } from 'lucide-react'
import Layout from '@/components/layout'
import logger from '@/lib/utils/logger'
import { CreditConfig, CREDIT_THRESHOLDS } from '@/lib/credits-config'

export default function CheckoutSuccess() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const { toast } = useToast()
  const [isProcessing, setIsProcessing] = useState(true)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [debugInfo, setDebugInfo] = useState<any>(null)

  useEffect(() => {
    if (!session) return;
    
    // Extract subscription ID from URL (trial already started) or payment_intent (legacy)
    const subscription_id = searchParams?.get('subscription_id');
    const payment_intent = searchParams?.get('payment_intent');
    
    if (subscription_id) {
      // Trial was already started in CheckoutForm - just show success and redirect
      logger.log('Trial already started, showing success message');
      
      toast({
        title: 'Trial Started!',
        description: `Your subscription has been activated with full access.`,
        duration: 4000
      });
      
      // Wait 1 second before redirecting to account page
      setTimeout(() => {
        setIsProcessing(false);
        setIsRedirecting(true);
        setTimeout(() => {
          router.push(`/account?refresh=${Date.now()}`);
        }, 1500);
      }, 1000);
      
    } else if (payment_intent) {
      // Legacy payment intent processing for old flows
      const processPayment = async () => {
        try {
          const response = await fetch('/api/trial/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              paymentIntentId: payment_intent,
              planName: 'Standard',
              interval: 'month',
              amount: 15,
              timestamp: new Date().getTime() 
            }),
          });
          
          if (!response) {
            throw new Error('No valid payment method found');
          }
          
          const data = await response.json();
          
          if (!response.ok) {
            setDebugInfo(data);
            throw new Error(data.error || 'Payment verification failed');
          }
          
          // Check if it was already processed
          if (data.alreadyProcessed) {
            logger.log('Payment was already processed');
          }
          
          // Success! Show toast and redirect
          toast({
            title: 'Subscription Activated!',
            description: 'Your plan has been successfully activated.',
            duration: 4000
          });
          
          // Wait 1 second before redirecting to account page
          setTimeout(() => {
            setIsProcessing(false);
            setIsRedirecting(true);
            setTimeout(() => {
              router.push(`/account?refresh=${Date.now()}`);
            }, 1500);
          }, 1000);
        } catch (error: any) {
          console.error('Payment verification error:', error);
          
          // If we haven't tried too many times, retry
          if (retryCount < 3) {
            setRetryCount(prev => prev + 1);
            // Wait 2 seconds before retrying
            setTimeout(() => {
              processPayment();
            }, 2000);
          } else {
            setIsProcessing(false);
            setError(error.message || 'Failed to process payment');
          }
        }
      };
      
      processPayment();
    } else {
      setIsProcessing(false);
      setError('No payment information found');
    }
  }, [session, searchParams, retryCount]);

  // Force refresh account data when coming back from payment
  useEffect(() => {
    if (session) {
      // Invalidate any cached subscription data
      fetch('/api/user/data?_t=' + Date.now());
    }
  }, [session]);

  return (
    <Layout>
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-4">
        <div className="w-full max-w-md p-8 space-y-6 bg-white rounded-lg shadow-md">
          {isProcessing && (
            <div className="text-center bg-white p-8 rounded-lg shadow-lg">
              <Loader2 className="w-16 h-16 mx-auto text-[#FF7F7F] animate-spin" />
              <h1 className="mt-6 text-2xl font-bold text-black">
                Finalizing Your Trial
              </h1>
              <p className="mt-3 text-lg text-black font-semibold status-message">
                Almost ready! Setting up your account...
              </p>
              {retryCount > 0 && (
                <div className="mt-4 py-3 px-4 bg-amber-100 border-2 border-amber-300 rounded-md">
                  <p className="text-amber-800 font-bold text-lg">
                    Retry attempt {retryCount}/3
                  </p>
                </div>
              )}
            </div>
          )}
          
          {isRedirecting && (
            <div className="text-center">
              <CheckCircle className="w-16 h-16 mx-auto text-green-500" />
              <h1 className="mt-6 text-2xl font-bold text-gray-900">
                Success!
              </h1>
              <p className="mt-2 text-gray-600">
                Your trial has been activated. Taking you to your account...
              </p>
            </div>
          )}
          
          {error && (
            <div className="text-center">
              <ShieldAlert className="w-16 h-16 mx-auto text-red-500" />
              <h1 className="text-2xl font-bold text-red-600">
                Subscription Activation Issue
              </h1>
              <p className="mt-2 text-gray-600">
                {error}
              </p>
              <p className="mt-2 text-sm text-gray-500">
                Don't worry! If your payment was successful, your subscription
                will be activated automatically. Please go to your account page.
              </p>
              <button
                onClick={() => router.push('/account')}
                className="mt-4 px-4 py-2 bg-[#FF7F7F] text-white rounded hover:bg-[#FF6666]"
              >
                Go to my account
              </button>
              
              {/* Debug information - only in development */}
              {process.env.NODE_ENV === 'development' && debugInfo && (
                <div className="mt-4 p-3 bg-gray-100 rounded text-left">
                  <p className="text-xs font-mono">Debug Info:</p>
                  <pre className="text-xs overflow-auto max-h-32">
                    {JSON.stringify(debugInfo, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
} 