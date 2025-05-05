"use client"

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Head from 'next/head'
import { useSession } from 'next-auth/react'
import Layout from '@/components/layout'
import { motion } from 'framer-motion'
import { 
  User, Settings, CreditCard, BarChart3, 
  LogOut, AlertCircle, CheckCircle, Loader2,
  Calendar, RefreshCw
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { signOut } from 'next-auth/react'
import { useToast } from '@/components/ui/use-toast'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface UserProfile {
  name: string;
  email: string;
  image?: string;
  joinedDate: string;
  role: string;
}

interface Subscription {
  plan: string;
  status: string;
  renewalDate?: string;
  amount: number;
  interval: string;
  planType?: string;
}

interface CreditUsage {
  used: number;
  total: number;
  resetDate: string;
  lastUpdate: string;
  nextMonthlyReset?: string;
}

interface UserDataResponse {
  profile: UserProfile;
  subscription: Subscription | null;
  credits: CreditUsage;
}

export default function AccountPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session, status } = useSession()
  const [activeTab, setActiveTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [credits, setCredits] = useState<CreditUsage | null>(null)
  const [error, setError] = useState('')
  const { toast } = useToast()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [confirmDowngradeOpen, setConfirmDowngradeOpen] = useState(false)
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false)
  const [targetPlan, setTargetPlan] = useState<string>('free')

  // Main heading styles - Updated for consistency
  const mainHeadingStyle = "text-2xl font-bold text-gray-900 mb-2"
  const sectionHeadingStyle = "text-lg font-medium text-gray-900 mb-2 flex items-center gap-2"
  const cardBgStyle = "bg-white border border-gray-200 rounded-lg shadow-sm" 
  const cardHeaderStyle = "border-b border-gray-100 bg-white text-gray-900"
  const cardContentStyle = "bg-white text-gray-800"

  const fetchUserData = async () => {
    try {
      console.log('Fetching user data from API')
      setIsRefreshing(true)
      
      // Add cache-busting parameter and force flag to ensure fresh data
      const response = await fetch('/api/user/data?_=' + new Date().getTime() + '&force=true')
      if (!response.ok) {
        throw new Error('Failed to fetch user data')
      }
      
      const data: UserDataResponse = await response.json()
      console.log('Received user data:', data)
      
      setProfile(data.profile)
      setSubscription(data.subscription)
      
      // Enhanced credits handling with special attention to plan changes
      console.log('Credits data:', data.credits)
      
      if (data.credits) {
        // Determine plan-specific default total
        let planDefaultTotal = 100; // Free plan default
        if (data.subscription?.plan) {
          const planName = data.subscription.plan.toLowerCase();
          if (planName.includes('standard')) {
            planDefaultTotal = 500;
          }
        }
        
        // First ensure all values are properly parsed with plan-aware defaults
        const formattedCredits = {
          ...data.credits,
          used: typeof data.credits.used === 'number' ? 
                 data.credits.used : 
                 parseInt(String(data.credits.used || '0')),
          total: typeof data.credits.total === 'number' ? 
                  data.credits.total : 
                  parseInt(String(data.credits.total || planDefaultTotal))
        };
        
        console.log('Formatted credits with plan-specific defaults:', formattedCredits);
        setCredits(formattedCredits);
      }
      
      setLoading(false)
      setLastUpdated(new Date())
      
      return data
    } catch (err: any) {
      console.error('Error fetching user data:', err)
      setError(err.message || 'Failed to load user data')
      setLoading(false)
      return null
    } finally {
      setIsRefreshing(false)
    }
  }

  const refreshUserData = async () => {
    setIsRefreshing(true)
    try {
      // Add a timestamp parameter to bypass cache
      const timestamp = new Date().getTime()
      const response = await fetch(`/api/user/data?_t=${timestamp}&refresh=true`)
      if (!response.ok) {
        throw new Error('Failed to refresh user data')
      }
      
      const freshData = await response.json()
      
      setProfile(freshData.profile)
      setSubscription(freshData.subscription)
      setCredits(freshData.credits)
      setLastUpdated(new Date())
      
      toast({
        title: 'Data refreshed',
        description: 'Your account information has been updated',
        duration: 3000
      })
    } catch (error) {
      console.error('Error refreshing user data:', error)
      toast({
        title: 'Could not refresh data',
        description: 'Please try again later',
        variant: 'destructive',
        duration: 3000
      })
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login')
    }

    if (status === 'authenticated' && session) {
      fetchUserData()
    }
  }, [status, session, router])

  useEffect(() => {
    // Check if we're returning from checkout success
    const refreshParam = searchParams?.get('refresh')
    const fromParam = searchParams?.get('from')
    
    if (refreshParam === 'true' || fromParam === 'checkout') {
      refreshUserData()
      // Remove the query param to prevent unnecessary refreshes
      router.replace('/account')
    }
  }, [searchParams, router, refreshUserData])

  useEffect(() => {
    // Add CSS for custom toggle switches
    const style = document.createElement('style');
    style.textContent = `
      input[type="checkbox"]:checked + label {
        background-color: #FF7F7F;
      }
      input[type="checkbox"]:checked + label .dot {
        transform: translateX(100%);
      }
    `;
    document.head.appendChild(style);
    
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  const getSubscriptionStatusDisplay = (status: string) => {
    if (status === 'active') {
      return <span className="text-green-600 font-medium">Active</span>
    } else if (status === 'inactive') {
      return <span className="text-gray-600 font-medium">Inactive</span>
    } else if (status === 'canceling') {
      return <span className="text-amber-600 font-medium">Canceling</span>
    } else {
      return <span className="text-gray-600 font-medium">{status}</span>
    }
  };

  const renderCreditsOverview = () => {
    if (!credits) {
      return (
        <div className="text-center py-4">
          <Loader2 className="h-6 w-6 mx-auto animate-spin text-[#FF7F7F]" />
          <p className="mt-2 text-sm text-gray-600">Loading credit information...</p>
        </div>
      );
    }
    
    // Ensure all values are numbers with proper fallbacks
    const used = typeof credits.used === 'number' ? 
                  credits.used : 
                  parseInt(String(credits.used || '0'));
    const total_remaining = typeof credits.total === 'number' ? 
                   credits.total : 
                   parseInt(String(credits.total || '100'));
    
    // Check if this is an "unlimited" plan (remove PRO plan check)
    const isUnlimited = total_remaining > 99999; // Remove check for PRO plan
    
    // Display text for total credits
    const totalDisplay = isUnlimited ? "No Limit" : total_remaining.toString();
    
    // Calculate remaining - only relevant for limited plans
    const remaining = isUnlimited ? "Unlimited" : Math.max(0, total_remaining - used).toString();
    
    // For unlimited plans, show a small percentage just to have some progress
    const usagePercentage = isUnlimited ? 5 : 
                           (total_remaining > 0 ? Math.min(100, (used / total_remaining) * 100) : 0);
    
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <span className="text-gray-700">Credits used {subscription?.interval === 'day' ? 'today' : 'this month'}</span>
          <span className="font-medium">{used} / {totalDisplay}</span>
        </div>
        <Progress value={usagePercentage} className="h-2" />
        <div className="flex justify-between items-center text-sm">
          <span className="text-gray-600">
            {remaining} credits remaining
          </span>
          <span className="text-gray-600">
            Resets on {credits.resetDate ? new Date(credits.resetDate).toLocaleDateString() : "Not set"}
          </span>
        </div>
        <div className="text-xs text-gray-500 mt-1">
          Last updated: {credits.lastUpdate ? new Date(credits.lastUpdate).toLocaleString() : "Never"}
        </div>
      </div>
    );
  };

  const renderDebugInfo = () => {
    if (process.env.NODE_ENV !== 'development') return null;
    
    return (
      <div className="mt-8 p-4 border border-gray-200 rounded-md bg-gray-50">
        <h3 className="text-sm font-semibold mb-2 text-gray-900">Debug Info</h3>
        <div className="flex flex-wrap space-x-2 mb-3">
          <Button 
            variant="outline" 
            size="sm" 
            className="bg-[#FF7F7F] hover:bg-[#FF6666] text-white"
            onClick={async () => {
              try {
                const res = await fetch('/api/debug/redis-check');
                const data = await res.json();
                console.log('Redis debug data:', data);
                toast({
                  title: 'Redis data logged',
                  description: 'Check the console for details',
                  duration: 3000
                });
              } catch (err) {
                console.error('Error fetching debug data:', err);
                toast({
                  title: 'Error',
                  description: 'Failed to check Redis data',
                  variant: 'destructive',
                  duration: 3000
                });
              }
            }}
          >
            Check Redis Data
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            className="bg-[#FF7F7F] hover:bg-[#FF6666] text-white"
            onClick={async () => {
              try {
                // Call the fix-status API
                const res = await fetch('/api/user/fix-status');
                const data = await res.json();
                console.log('Fix status result:', data);
                
                // Refresh the account data to see the changes
                refreshUserData();
                
                toast({
                  title: data.success ? 'Status fixed' : 'No change needed',
                  description: data.message,
                  duration: 3000
                });
              } catch (err) {
                console.error('Error fixing plan status:', err);
                toast({
                  title: 'Error',
                  description: 'Failed to fix plan status',
                  variant: 'destructive',
                  duration: 3000
                });
              }
            }}
          >
            Fix Free Plan Status
          </Button>
        </div>
      </div>
    );
  };

  // Add a function to handle plan downgrade
  const handlePlanDowngrade = async (targetPlan: string) => {
    // Set the target plan and open confirmation dialog
    setTargetPlan(targetPlan)
    setConfirmDowngradeOpen(true)
  }
  
  // Add function to execute the downgrade after confirmation
  const executeDowngrade = async () => {
    setIsRefreshing(true)
    try {
      const response = await fetch('/api/user/downgrade-plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ targetPlan }),
      })
      
      if (!response.ok) {
        throw new Error('Failed to downgrade plan')
      }
      
      const result = await response.json()
      console.log('Plan downgrade result:', result)
      
      // Refresh user data to reflect the changes
      await refreshUserData()
      
      toast({
        title: 'Plan downgraded successfully',
        description: `Your subscription has been changed to ${result.subscription.plan}`,
        duration: 3000
      })
    } catch (error) {
      console.error('Error downgrading plan:', error)
      toast({
        title: 'Failed to downgrade plan',
        description: 'Please try again later or contact support',
        variant: 'destructive',
        duration: 3000
      })
    } finally {
      setIsRefreshing(false)
      setConfirmDowngradeOpen(false)
    }
  }
  
  // Helper to determine if current plan can be downgraded
  const canDowngrade = () => {
    if (!subscription) return false
    const planName = subscription.plan.toLowerCase()
    return planName.includes('standard')
  }
  
  // Helper to get the next lower plan
  const getDowngradePlanName = () => {
    if (!subscription) return 'Free Plan'
    const planName = subscription.plan.toLowerCase()
    
    if (planName.includes('standard')) return 'Free Plan'
    return 'Standard Plan'
  }

  // Add function to handle subscription cancellation
  const handleCancelSubscription = () => {
    setConfirmCancelOpen(true)
  }
  
  // Add function to execute the cancellation after confirmation
  const executeCancellation = async () => {
    setIsRefreshing(true)
    try {
      const response = await fetch('/api/user/cancel-subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      })
      
      if (!response.ok) {
        throw new Error('Failed to cancel subscription')
      }
      
      const result = await response.json()
      console.log('Subscription cancellation result:', result)
      
      // Refresh user data to reflect the changes
      await refreshUserData()
      
      toast({
        title: 'Subscription canceled',
        description: 'Your subscription will remain active until the end of your current billing period',
        duration: 5000
      })
    } catch (error) {
      console.error('Error canceling subscription:', error)
      toast({
        title: 'Failed to cancel subscription',
        description: 'Please try again later or contact support',
        variant: 'destructive',
        duration: 3000
      })
    } finally {
      setIsRefreshing(false)
      setConfirmCancelOpen(false)
    }
  }
  
  // Helper to determine if current subscription can be canceled
  const canCancel = () => {
    if (!subscription) return false
    return subscription.status === 'active' && subscription.plan.toLowerCase() !== 'free'
  }

  if (status === 'loading' || loading) {
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
        <title>My Account | Auto-Analyst</title>
      </Head>

      <Layout>
        <div className="container mx-auto px-4 py-8 max-w-6xl">
          <div className="mb-6">
            <h1 className={mainHeadingStyle}>My Account</h1>
            <p className="text-gray-600">Manage your account settings and view your usage</p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-lg flex items-center gap-2">
              <AlertCircle size={20} />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Sidebar */}
            <div className="lg:col-span-3">
              <Card className="bg-white border border-gray-200 shadow-sm">
                <CardHeader className="text-center pb-2 bg-white border-b border-gray-100">
                  <div className="flex flex-col items-center">
                    <div className="w-20 h-20 bg-[#FFE5E5] rounded-full flex items-center justify-center mb-4 overflow-hidden">
                      {profile?.image ? (
                        <img src={profile.image} alt={profile.name} className="w-full h-full object-cover" />
                      ) : (
                        <User size={40} className="text-[#FF7F7F]" />
                      )}
                    </div>
                    <CardTitle className="text-gray-900">{profile?.name || 'User'}</CardTitle>
                    <CardDescription className="text-sm text-gray-600">{profile?.email || 'user@example.com'}</CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="pt-2 bg-white">
                  <div className="text-sm text-gray-600 mb-6">
                    <div className="flex justify-between py-1">
                      <span>Member since:</span>
                      <span>{profile?.joinedDate || '2023-01-01'}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span>Status:</span>
                      {getSubscriptionStatusDisplay(profile?.role || 'inactive')}
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Button 
                      variant="outline"
                      className={`w-full justify-start text-left ${
                        activeTab === 'overview' ? "bg-[#FF7F7F] text-white hover:bg-[#FF6666]" : "bg-white text-gray-700 hover:bg-[#FFE5E5] hover:text-gray-900"
                      }`}
                      onClick={() => setActiveTab('overview')}
                    >
                      <BarChart3 size={16} className="mr-2" />
                      Overview
                    </Button>
                    <Button 
                      variant="outline"
                      className={`w-full justify-start text-left ${
                        activeTab === 'subscription' ? "bg-[#FF7F7F] text-white hover:bg-[#FF6666]" : "bg-white text-gray-700 hover:bg-[#FFE5E5] hover:text-gray-900"
                      }`}
                      onClick={() => setActiveTab('subscription')}
                    >
                      <CreditCard size={16} className="mr-2" />
                      Subscription
                    </Button>
                    {/* TODO: Add settings page after launch */}
                    {/* <Button 
                      variant="outline"
                      className={`w-full justify-start text-left ${
                        activeTab === 'settings' ? "bg-[#FF7F7F] text-white hover:bg-[#FF6666]" : "bg-white text-gray-700 hover:bg-[#FFE5E5] hover:text-gray-900"
                      }`}
                      onClick={() => setActiveTab('settings')}
                    >
                      <Settings size={16} className="mr-2" />
                      Settings
                    </Button> */}
                    <Button
                      variant="ghost"
                      className="mt-4 w-full justify-start text-left text-[#FF5252] hover:text-white hover:bg-[#FF5252]"
                      onClick={() => signOut({ callbackUrl: '/' })}
                    >
                      <LogOut size={16} className="mr-2" />
                      Sign Out
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Main Content */}
            <div className="lg:col-span-9">
              {activeTab === 'overview' && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <Card className={`mb-6 ${cardBgStyle}`}>
                    <CardHeader className={cardHeaderStyle}>
                      <CardTitle className="text-gray-900">Subscription Summary</CardTitle>
                      <CardDescription className="text-gray-600">Your current plan and usage</CardDescription>
                    </CardHeader>
                    <CardContent className={cardContentStyle}>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="flex flex-col h-full">
                          <h3 className={sectionHeadingStyle}>
                            <CreditCard size={20} className="text-[#FF7F7F]" />
                            Current Plan
                          </h3>
                          <div className="bg-gray-50 p-4 rounded-lg text-gray-800 flex-grow">
                            <div className="flex justify-between mb-2">
                              <span className="text-gray-600">Plan:</span>
                              <span className="font-medium text-gray-900">{subscription?.plan || 'Standard'}</span>
                            </div>
                            <div className="flex justify-between mb-2">
                              <span className="text-gray-600">Status:</span>
                              {getSubscriptionStatusDisplay(subscription?.status || 'active')}
                            </div>
                            <div className="flex justify-between mb-2">
                              <span className="text-gray-600">Price:</span>
                              <span className="font-medium text-gray-900">
                                ${subscription?.amount || '0.00'}/{subscription?.interval || 'month'}
                              </span>
                            </div>
                            <div className="flex justify-between mb-2">
                              <span className="text-gray-600">Billing cycle:</span>
                              <span className="font-medium text-gray-900 capitalize">
                                {(() => {
                                  if (subscription?.interval === 'day') return 'Daily';
                                  if (subscription?.interval === 'year') return 'Yearly';
                                  return 'Monthly';
                                })()}
                              </span>
                            </div>
                            {subscription?.plan?.toLowerCase() !== 'free' && (
                              <div className="flex justify-between mb-2">
                                <span className="text-gray-600">Next billing date:</span>
                                <span className="font-medium text-gray-900">
                                  {subscription?.renewalDate ? 
                                    new Date(subscription.renewalDate).toLocaleDateString('en-US', {
                                      year: 'numeric',
                                      month: 'long',
                                      day: 'numeric'
                                    }) : 
                                    'Not available'}
                                </span>
                              </div>
                            )}
                            <div className="flex justify-between mb-2">
                              <span className="text-gray-600">Next credits reset:</span>
                              <span className="font-medium text-gray-900">
                                {credits?.resetDate ? 
                                  new Date(credits.resetDate).toLocaleDateString('en-US', {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric'
                                  }) : 
                                  'Not available'}
                              </span>
                            </div>
                            {subscription?.interval === 'year' && (
                              <div className="mt-2 px-3 py-2 bg-[#FFE5E5] border border-[#FFCACA] rounded-md text-xs text-[#FF7F7F]">
                                <span className="font-medium">Note:</span> Your subscription renews yearly, but credits reset monthly.
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-col h-full">
                          <h3 className={sectionHeadingStyle}>
                            <BarChart3 size={20} className="text-[#FF7F7F]" />
                            Credits Usage
                          </h3>
                          <div className="bg-gray-50 p-4 rounded-lg text-gray-800 flex-grow">
                            {renderCreditsOverview()}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                        <Button
                          className="w-full bg-[#FF7F7F] hover:bg-[#FF6666] text-white"
                          onClick={() => router.push('/pricing')}
                        >
                          {subscription?.status === 'active' ? 'Change Plan' : 'Upgrade Now'}
                        </Button>

                        <Button
                          onClick={refreshUserData}
                          disabled={isRefreshing}
                          className="w-full bg-[#FF7F7F] hover:bg-[#FF6666] text-white"
                        >
                          {isRefreshing ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Refreshing...
                            </>
                          ) : (
                            <>
                              <RefreshCw className="mr-2 h-4 w-4" />
                              Refresh
                            </>
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className={cardBgStyle}>
                    <CardHeader className={cardHeaderStyle}>
                      <CardTitle className="text-gray-900">Recent Activity</CardTitle>
                      <CardDescription className="text-gray-600">Your recent interactions with Auto-Analyst</CardDescription>
                    </CardHeader>
                    <CardContent className={cardContentStyle}>
                      <div className="text-center py-8 text-gray-500">
                        <BarChart3 size={48} className="mx-auto mb-4 text-gray-300" />
                        <p>Your activity history will appear here</p>
                        <p className="text-sm">Start analyzing data to see your recent activity</p>
                      </div>
                    </CardContent>
                    <CardFooter className="flex justify-center bg-white border-t border-gray-100">
                      <Button 
                        className="w-full bg-[#FF7F7F] hover:bg-[#FF6666] text-white"
                        onClick={() => router.push('/chat')}
                      >
                        Start Analyzing
                      </Button>
                    </CardFooter>
                  </Card>
                </motion.div>
              )}

              {activeTab === 'subscription' && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <Card className={`mb-6 ${cardBgStyle}`}>
                    <CardHeader className={cardHeaderStyle}>
                      <CardTitle className="text-gray-900">Your Subscription</CardTitle>
                      <CardDescription className="text-gray-600">Manage your subscription details and billing</CardDescription>
                    </CardHeader>
                    <CardContent className={cardContentStyle}>
                      <div className="space-y-6">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className={sectionHeadingStyle}>
                            <CreditCard size={20} className="text-[#FF7F7F]" />
                            Subscription Details
                          </h3>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={refreshUserData}
                            disabled={isRefreshing}
                            className="bg-[#FF7F7F] hover:bg-[#FF6666] text-white border-[#FF7F7F]"
                          >
                            {isRefreshing ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Refreshing...
                              </>
                            ) : (
                              <>
                                <RefreshCw className="mr-2 h-4 w-4" />
                                 Force Refresh 
                              </>
                            )}
                          </Button>
                        </div>
                        <div className="bg-gray-50 p-5 rounded-lg">
                          <div className="flex justify-between items-center">
                            <div>
                              <h3 className="text-xl font-medium text-gray-900">{subscription?.plan || 'Standard Plan'}</h3>
                              <p className="text-gray-600 mt-1">
                                ${subscription?.amount || '0.00'}/{subscription?.interval || 'month'}
                              </p>
                            </div>
                            <div className={`px-3 py-1 rounded-full text-sm font-medium ${
                              subscription?.status === 'active' 
                                ? 'bg-green-100 text-green-800' 
                                : 'bg-amber-100 text-amber-800'
                            }`}>
                              {subscription?.status === 'active' ? 'Active' : 'Inactive'}
                            </div>
                          </div>
                          
                          <div className="mt-4 pt-4 border-t border-gray-200">
                            <div className="flex justify-between mb-2">
                              <span className="text-gray-600">Billing period:</span>
                              <span className="text-gray-900 capitalize">
                                {(() => {
                                  if (subscription?.interval === 'day') return 'Daily';
                                  if (subscription?.interval === 'year') return 'Yearly';
                                  return 'Monthly';
                                })()}
                              </span>
                            </div>
                            {subscription?.plan?.toLowerCase() !== 'free' && (
                              <div className="flex justify-between mb-2">
                                <span className="text-gray-600">Next billing date:</span>
                                <span className="text-gray-900">
                                  {subscription?.renewalDate ? 
                                    new Date(subscription.renewalDate).toLocaleDateString('en-US', {
                                      year: 'numeric',
                                      month: 'long',
                                      day: 'numeric'
                                    }) : 
                                    'Not available'}
                                </span>
                              </div>
                            )}
                            <div className="flex justify-between mb-2">
                              <span className="text-gray-600">Next credits reset:</span>
                              <span className="text-gray-900">
                                {credits?.resetDate ? 
                                  new Date(credits.resetDate).toLocaleDateString('en-US', {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric'
                                  }) : 
                                  'Not available'}
                              </span>
                            </div>
                            {subscription?.interval === 'year' && (
                              <div className="mt-3 px-3 py-2 bg-blue-50 border border-blue-100 rounded-md text-xs text-blue-700">
                                <span className="font-medium">Note:</span> Your subscription renews yearly, but credits reset monthly.
                              </div>
                            )}
                            {/* <div className="flex justify-between mb-2">
                              <span className="text-gray-600">Payment method:</span>
                              <span className="text-gray-900">Credit Card •••• 4242</span>
                            </div> */}
                          </div>
                        </div>
                        
                        <div className="flex flex-wrap gap-3">
                          <Button
                            className="bg-[#FF7F7F] hover:bg-[#FF6666] text-white"
                            onClick={() => router.push('/pricing')}
                          >
                            Change Plan
                          </Button>
                          {/* <Button
                            variant="ghost"
                            className="text-white bg-[#FF7F7F] hover:bg-[#FF6666]"
                          >
                            Update Payment Method
                          </Button> */}
                          {canDowngrade() && (
                            <Button
                              variant="default"
                              className="bg-[#FF7F7F] hover:bg-[#FF6666] text-white"
                              onClick={() => handlePlanDowngrade(getDowngradePlanName().toLowerCase())}
                              disabled={isRefreshing}
                            >
                              {isRefreshing ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : null}
                              Downgrade to {getDowngradePlanName()}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            className="text-white bg-[#FF7F7F] hover:bg-[#FF6666]"
                            onClick={handleCancelSubscription}
                            disabled={!canCancel() || isRefreshing}
                          >
                            {isRefreshing ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : null}
                            Cancel Subscription
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className={cardBgStyle}>
                    <CardHeader className={cardHeaderStyle}>
                      <CardTitle className="text-gray-900">Billing History</CardTitle>
                      <CardDescription className="text-gray-600">Your past invoices and payments</CardDescription>
                    </CardHeader>
                    <CardContent className={cardContentStyle}>
                      <div className="text-center py-8 text-gray-500">
                        <CreditCard size={48} className="mx-auto mb-4 text-gray-300" />
                        <p>No billing history available</p>
                        <p className="text-sm">Your billing history will appear here once you have made payments</p>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )}

              {activeTab === 'settings' && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <Card className={cardBgStyle}>
                    <CardHeader className={cardHeaderStyle}>
                      <CardTitle className="text-gray-900">Account Settings</CardTitle>
                      <CardDescription className="text-gray-600">Manage your profile and preferences</CardDescription>
                    </CardHeader>
                    <CardContent className={cardContentStyle}>
                      <div className="space-y-6">
                        <div>
                          <h3 className={sectionHeadingStyle}>Profile Information</h3>
                          <div className="space-y-4">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                Name
                              </label>
                              <input
                                type="text"
                                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-900"
                                defaultValue={profile?.name}
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                Email Address
                              </label>
                              <input
                                type="email"
                                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-900"
                                defaultValue={profile?.email}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="pt-4 border-t border-gray-200">
                          <h3 className={sectionHeadingStyle}>Notification Settings</h3>
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="font-medium text-gray-900">Email Notifications</p>
                                <p className="text-sm text-gray-600">Receive updates about your account</p>
                              </div>
                              <div className="relative inline-block w-10 mr-2 align-middle">
                                <input 
                                  type="checkbox" 
                                  id="email-notifications" 
                                  defaultChecked 
                                  onChange={() => {
                                    // TODO: Add email notification logic
                                    console.log('Email notifications toggled');
                                  }}
                                  className="sr-only"
                                />
                                <label
                                  htmlFor="email-notifications"
                                  className="block overflow-hidden h-6 w-12 rounded-full bg-gray-300 cursor-pointer transition-colors duration-200 ease-in-out"
                                >
                                  <span className="dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform duration-300 ease-in-out" />
                                </label>
                              </div>
                            </div>
                            
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="font-medium text-gray-900">Usage Alerts</p>
                                <p className="text-sm text-gray-600">Get notified when you're close to your credit limit</p>
                              </div>
                              <div className="relative inline-block w-10 mr-2 align-middle">
                                <input 
                                  type="checkbox" 
                                  id="usage-alerts" 
                                  defaultChecked 
                                  className="sr-only"
                                  onChange={() => {
                                    // TODO: Add usage alert logic
                                    console.log('Usage alerts toggled');
                                  }}
                                />
                                <label
                                  htmlFor="usage-alerts"
                                  className="block overflow-hidden h-6 w-12 rounded-full bg-gray-300 cursor-pointer transition-colors duration-200 ease-in-out"
                                >
                                  <span className="dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform duration-300 ease-in-out" />
                                </label>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="pt-4 border-t border-gray-200">
                          <h3 className={sectionHeadingStyle}>Security</h3>
                          <div className="flex flex-wrap gap-3">
                            <Button
                              className="text-white bg-[#FF7F7F] hover:bg-[#FF6666]"
                              onClick={() => {
                                // TODO: Add change password logic
                                console.log('Change password clicked');
                              }}
                            >
                              Change Password
                            </Button>
                            <Button
                              variant="ghost"
                              className="text-white bg-[#FF7F7F] hover:bg-[#FF6666]"
                              onClick={() => {
                                // TODO: Add delete account logic
                                console.log('Delete account clicked');
                              }}
                            >
                              Delete Account
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                    <CardFooter className="flex justify-end bg-white border-t border-gray-100">
                      <Button
                        className="bg-[#FF7F7F] hover:bg-[#FF6666] text-white"
                      >
                        Save Changes
                      </Button>
                    </CardFooter>
                  </Card>
                </motion.div>
              )}
            </div>
          </div>

          {renderDebugInfo()}
        </div>

        {/* Add the downgrade confirmation dialog */}
        <AlertDialog open={confirmDowngradeOpen} onOpenChange={setConfirmDowngradeOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm Subscription Downgrade</AlertDialogTitle>
              <AlertDialogDescription>
                You are about to downgrade from {subscription?.plan || 'your current plan'} to {targetPlan === 'standard' ? 'Standard Plan' : 'Free Plan'}.
                {targetPlan === 'free' ? (
                  <p className="mt-2 text-red-600 font-medium">
                    This will cancel your paid subscription and reduce your available credits to 100.
                  </p>
                ) : (
                  <p className="mt-2">
                    Your credits will be adjusted to 500 and your monthly payment will be reduced.
                  </p>
                )}
                <p className="mt-2">
                  Are you sure you want to continue?
                </p>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isRefreshing}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={executeDowngrade}
                disabled={isRefreshing}
                className="bg-[#FF7F7F] hover:bg-[#FF6666] text-white"
              >
                {isRefreshing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Please wait...
                  </>
                ) : (
                  <>
                    Confirm Downgrade
                  </>
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Add confirmation dialog for cancellation */}
        <AlertDialog open={confirmCancelOpen} onOpenChange={setConfirmCancelOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel your subscription?</AlertDialogTitle>
              <AlertDialogDescription>
                Your subscription will remain active until the end of your current billing period.
                After that, your account will be downgraded to the Free plan with 100 credits per month.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>No, keep my subscription</AlertDialogCancel>
              <AlertDialogAction 
                onClick={executeCancellation}
                className="bg-[#FF7F7F] hover:bg-[#FF6666]"
              >
                Yes, cancel subscription
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Layout>
    </>
  )
} 