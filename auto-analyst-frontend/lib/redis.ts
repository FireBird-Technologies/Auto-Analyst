import { Redis } from '@upstash/redis'
import logger from '@/lib/utils/logger'
import { CreditConfig, CREDIT_THRESHOLDS } from './credits-config'
// Initialize Redis client with Upstash credentials
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || '',
  token: process.env.UPSTASH_REDIS_REST_TOKEN || '',
})

// Test connection and log status - but only when explicitly called
const testConnection = async () => {
  try {
    await redis.ping();
    logger.log('✅ Redis connection successful');
    return true;
  } catch (error) {
    console.error('⚠️ Redis connection failed:', error);
    return false;
  }
};

// Don't automatically run the test on import
// This prevents build-time errors and unnecessary connections
// testConnection();

export default redis

// Export test connection function for explicit use in runtime contexts
export { testConnection }

// Consolidated hash-based key schema - ONLY use these keys
export const KEYS = {
  USER_PROFILE: (userId: string) => `user:${userId}:profile`,
  USER_SUBSCRIPTION: (userId: string) => `user:${userId}:subscription`,
  USER_CREDITS: (userId: string) => `user:${userId}:credits`,
};



// Credits management utilities with consolidated hash-based storage
export const creditUtils = {
  // Check if user's subscription period has ended (for canceled users)
  async hasSubscriptionPeriodEnded(userId: string): Promise<boolean> {
    try {
      const subscriptionHash = await redis.hgetall(KEYS.USER_SUBSCRIPTION(userId))
      
      if (!subscriptionHash || !subscriptionHash.renewalDate) {
        return true // No subscription data means period has ended
      }
      
      const renewalDate = new Date(subscriptionHash.renewalDate as string)
      const now = new Date()
      
      return now > renewalDate
    } catch (error) {
      console.error('Error checking subscription period:', error)
      return true // Default to period ended on error
    }
  },

  // Check if user is canceled but still in their paid period
  async isCanceledButStillPaid(userId: string): Promise<boolean> {
    try {
      const subscriptionHash = await redis.hgetall(KEYS.USER_SUBSCRIPTION(userId))
      
      if (!subscriptionHash || !subscriptionHash.status) {
        return false
      }
      
      const status = subscriptionHash.status as string
      // Simplified: only 'cancel_at_period_end' means canceled but still paid
      const isCanceledButPaid = status === 'cancel_at_period_end'
      
      if (!isCanceledButPaid) {
        return false
      }
      
      // Double-check if subscription period has ended
      const periodEnded = await this.hasSubscriptionPeriodEnded(userId)
      return !periodEnded // Canceled but period hasn't ended yet
    } catch (error) {
      console.error('Error checking canceled but paid status:', error)
      return false
    }
  },

  // Check if user should get free credits (canceled and period ended, or truly new user)
  async shouldGetFreeCredits(userId: string): Promise<boolean> {
    try {
      const subscriptionHash = await redis.hgetall(KEYS.USER_SUBSCRIPTION(userId))
      
      // If no subscription data, they're a new user
      if (!subscriptionHash || Object.keys(subscriptionHash).length === 0) {
        return true
      }
      
      const status = subscriptionHash.status as string
      
      // Simplified logic: only 'canceled' users (after period ended) get free credits
      if (status === 'canceled') {
        return true
      }
      
      return false // Active, canceling, or other statuses don't get free credits
    } catch (error) {
      console.error('Error checking if should get free credits:', error)
      return false
    }
  },

  // Check if user has already received free credits this month
  async hasReceivedFreeCreditsThisMonth(userId: string): Promise<boolean> {
    try {
      const creditsHash = await redis.hgetall(KEYS.USER_CREDITS(userId))
      
      if (!creditsHash || !creditsHash.lastFreeCreditsDate) {
        return false
      }
      
      const lastFreeCreditsDate = new Date(creditsHash.lastFreeCreditsDate as string)
      const now = new Date()
      
      // Check if it's the same month and year
      return lastFreeCreditsDate.getMonth() === now.getMonth() && 
             lastFreeCreditsDate.getFullYear() === now.getFullYear()
    } catch (error) {
      console.error('Error checking free credits this month:', error)
      return false
    }
  },

  // Get remaining credits for a user
  async getRemainingCredits(userId: string): Promise<number> {
    try {
      const creditsHash = await redis.hgetall(KEYS.USER_CREDITS(userId))
      if (!creditsHash || !creditsHash.total || !creditsHash.used) {
        // Check if user should get free credits
        const shouldGetFree = await this.shouldGetFreeCredits(userId)
        if (shouldGetFree) {
          // Check if they already got free credits this month
          const alreadyReceived = await this.hasReceivedFreeCreditsThisMonth(userId)
          return alreadyReceived ? 0 : 20 // 20 credits once per month
        }
        return 0 // Active subscribers or canceled users still in paid period get 0
      }
      
      const total = parseInt(creditsHash.total as string)
      const used = creditsHash.used ? parseInt(creditsHash.used as string) : 0
      
      // Use centralized config to check if unlimited
      if (CreditConfig.isUnlimitedTotal(total)) {
        return Number.MAX_SAFE_INTEGER
      }
      
      return Math.max(0, total - used)
    } catch (error) {
      console.error('Error getting remaining credits:', error)
      return 0
    }
  },
  async initializeCredits(userId: string, credits: number = parseInt(process.env.NEXT_PUBLIC_CREDITS_INITIAL_AMOUNT || '20')): Promise<void> {
    try {
      // Only use hash-based approach
      await redis.hset(KEYS.USER_CREDITS(userId), {
        total: credits.toString(),
        used: '0',
        lastUpdate: new Date().toISOString(),
        resetDate: this.getNextMonthFirstDay()
      });
      
      logger.log(`Credits initialized successfully for ${userId}: ${credits}`);
    } catch (error) {
      console.error('Error initializing credits:', error);
    }
  },

  // Initialize credits for a trial user (500 credits)
  async initializeTrialCredits(userId: string, paymentIntentId: string, trialEndDate: string): Promise<void> {
    try {
      const trialCredits = 0 // Remove trial functionality
      
      await redis.hset(KEYS.USER_CREDITS(userId), {
        total: trialCredits.toString(),
        used: '0',
        resetDate: trialEndDate,
        lastUpdate: new Date().toISOString(),
        isTrialCredits: 'true',
        paymentIntentId: paymentIntentId
      })
    } catch (error) {
      console.error('Error initializing trial credits:', error)
    }
  },

  // Set credits to 0 for downgraded users
  async setZeroCredits(userId: string): Promise<void> {
    try {
      await redis.hset(KEYS.USER_CREDITS(userId), {
        total: '0',
        used: '0',
        resetDate: '',
        lastUpdate: new Date().toISOString(),
        downgradedAt: new Date().toISOString()
      })
    } catch (error) {
      console.error('Error setting zero credits:', error)
    }
  },

  // Deduct credits when a user makes an API call
  async deductCredits(userId: string, amount: number): Promise<boolean> {
    try {
      // Only use hash-based approach
      const creditsHash = await redis.hgetall<{
        total?: string;
        used?: string;
      }>(KEYS.USER_CREDITS(userId));
      
      if (creditsHash && creditsHash.total) {
        const total = parseInt(creditsHash.total);
        const used = creditsHash.used ? parseInt(creditsHash.used) : 0;
        const remaining = total - used;
        
        // Check if user has enough credits
        if (remaining < amount) {
          return false;
        }
        
        // Update used credits in hash
        const newUsed = used + amount;
        await redis.hset(KEYS.USER_CREDITS(userId), {
          used: newUsed.toString(),
          lastUpdate: new Date().toISOString()
        });
        
        return true;
      }
      
      // No credits to initialize for users without subscription
      return false;
    } catch (error) {
      console.error('Error deducting credits:', error);
      return true; // Failsafe
    }
  },



  // Check if a user has enough credits
  async hasEnoughCredits(userId: string, amount: number): Promise<boolean> {
    const remainingCredits = await this.getRemainingCredits(userId);
    return remainingCredits >= amount;
  },
  
  // Helper to get one month from today (same day next month)
  getOneMonthFromToday(): string {
    const today = new Date();
    const nextMonth = new Date(today);
    nextMonth.setMonth(today.getMonth() + 1);
    return nextMonth.toISOString().split('T')[0];
  },
  
  // Helper to get one year from today (same day next year)
  getOneYearFromToday(): string {
    const today = new Date();
    const nextYear = new Date(today);
    nextYear.setFullYear(today.getFullYear() + 1);
    return nextYear.toISOString().split('T')[0];
  },
  
  // Legacy function for backwards compatibility - now delegates to new function
  getNextMonthFirstDay(): string {
    return this.getOneMonthFromToday();
  },
  
  // Legacy function for backwards compatibility - now delegates to new function
  getNextYearFirstDay(): string {
    return this.getOneYearFromToday();
  },
  
  // Reset user credits based on their plan
  async resetUserCredits(userId: string): Promise<boolean> {
    try {
      // Get subscription to determine plan
      const sub = await redis.hgetall(KEYS.USER_SUBSCRIPTION(userId));
      
      if (!sub || !sub.plan) {
        // No subscription found, fallback to basic
        return false;
      }
      
      // Determine credit amount based on plan using centralized config
      const planCredits = CreditConfig.getCreditsForPlan(sub.plan as string);
      const creditAmount = planCredits.total;
      
      // Update credits hash - use one month/year from today instead of first day of next period
      await redis.hset(KEYS.USER_CREDITS(userId), {
        total: creditAmount.toString(),
        used: '0',
        lastUpdate: new Date().toISOString(),
        resetDate: sub.interval === 'year' ? this.getOneYearFromToday() : this.getOneMonthFromToday()
      });
      
      return true;
    } catch (error) {
      console.error('Error resetting user credits:', error);
      return false;
    }
  }
};

// Subscription utilities for efficiently accessing user plan data
export const subscriptionUtils = {
  // Get user subscription data with formatted credits
  async getUserSubscriptionData(userId: string): Promise<{
    plan: string;
    credits: {
      used: number;
      total: number | 'Unlimited';
      remaining: number | 'Unlimited';
    };
    isPro: boolean;
  }> {
    try {
      // Get subscription and credits from hash
      const subData = await redis.hgetall(KEYS.USER_SUBSCRIPTION(userId));
      const creditsData = await redis.hgetall(KEYS.USER_CREDITS(userId));
      
      // Default values using centralized config
      const defaultCredits = CreditConfig.getCreditsByType('STANDARD')
      let plan = defaultCredits.displayName;
      let isPro = false;
      let creditsTotal = 0; // No more free credits
      let creditsUsed = 0;
      
      // Parse subscription data if found
      if (subData && subData.plan) {
        plan = subData.plan as string;
        const planCredits = CreditConfig.getCreditsForPlan(plan);
        isPro = planCredits.type === 'PRO';
      }
      
      // Parse credits data if found with centralized config fallback
      if (creditsData) {
        creditsTotal = parseInt(creditsData.total as string || defaultCredits.total.toString());
        creditsUsed = parseInt(creditsData.used as string || '0');
      } 
      
      // Use centralized config for unlimited check and formatting
      const isUnlimited = CreditConfig.isUnlimitedTotal(creditsTotal);
      const formattedTotal = isUnlimited ? 'Unlimited' : creditsTotal;
      const remaining = isUnlimited ? 'Unlimited' : Math.max(0, creditsTotal - creditsUsed);
      
      return {
        plan,
        credits: {
          used: creditsUsed,
          total: formattedTotal,
          remaining
        },
        isPro
      };
    } catch (error) {
      console.error('Error getting user subscription data:', error);
      // Return fallback defaults using centralized config
      return {
        plan: 'No Plan',
        credits: {
          used: 0,
          total: 0, 
          remaining: 0
        },
        isPro: false
      };
    }
  },
  
  // Check if a user has an active subscription
  async isSubscriptionActive(userId: string): Promise<boolean> {
    try {
      const subscriptionData = await redis.hgetall(KEYS.USER_SUBSCRIPTION(userId));
      
      // No free plans anymore - users without valid subscription are inactive
      if (!subscriptionData || !subscriptionData.planType || !subscriptionData.status) {
        return false;
      }
      
      // For paid plans, check status and expiration
      if (!subscriptionData.status) {
        return false;
      }
      
      // Check if subscription is active and not expired
      if (subscriptionData.status === 'active') {
        // Check if subscription has expired
        if (subscriptionData.renewalDate) {
          const renewalDate = new Date(subscriptionData.renewalDate as string);
          const now = new Date();
          if (renewalDate < now) {
            // Subscription has expired, downgrade to free plan
            logger.log(`Subscription expired for user ${userId}. Downgrading to Free plan.`);
            await this.downgradeToFreePlan(userId);
            return false;
          }
        }
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error checking subscription status:', error);
      return false;
    }
  },
  
  // Check if a user can use credits based on their subscription
  async canUseCredits(userId: string): Promise<boolean> {
    try {
      // Always check if credits need to be refreshed first, regardless of plan type
      await this.refreshCreditsIfNeeded(userId);
      
      // Then check if subscription is active
      const isActive = await this.isSubscriptionActive(userId);
      
      // Check remaining credits - applies to both free and paid plans
      const remainingCredits = await creditUtils.getRemainingCredits(userId);
      
      return remainingCredits > 0;
    } catch (error) {
      console.error('Error checking if user can use credits:', error);
      return false;
    }
  },
  
  // Refresh credits if needed (for yearly subscriptions)
  async refreshCreditsIfNeeded(userId: string): Promise<boolean> {
    try {
      const subscriptionData = await redis.hgetall(KEYS.USER_SUBSCRIPTION(userId));
      const creditsData = await redis.hgetall(KEYS.USER_CREDITS(userId));
      
      if (!creditsData) {
        return false;
      }
      
      // Check if the subscription is pending cancellation/downgrade or inactive
      const isPendingDowngrade = 
        (subscriptionData && (
          subscriptionData.pendingDowngrade === 'true' ||
          subscriptionData.status === 'inactive'
        )) ||
        (creditsData && creditsData.pendingDowngrade === 'true');
      
      // Check if subscription is canceled (including trial cancellations)
      // IMPORTANT: Only zero out credits if user actually canceled, not during successful transitions
      const isCanceled = subscriptionData && (
        subscriptionData.status === 'canceled' ||
        subscriptionData.status === 'canceling'
      );
      
      // Process active subscriptions, trials, and pending downgrades/cancellations
      const shouldProcess = subscriptionData && (
                           subscriptionData.status === 'active' || 
        subscriptionData.status === 'trialing' || 
                           subscriptionData.status === 'canceling' ||
        subscriptionData.status === 'inactive' ||
        isPendingDowngrade
      );
      
      // Simplified handling for canceled subscriptions
      if (isCanceled) {
        // Only users with 'canceled' status (final cancellation) get zero credits
        if (subscriptionData.status === 'canceled') {
          await creditUtils.setZeroCredits(userId);
          console.log(`[Credits] Set zero credits for canceled user ${userId}`);
          return true;
        }
        // Users with 'cancel_at_period_end' keep their credits until period ends
      }
      
      // Treat all plans (including Free) similarly for credit refreshes
      if (shouldProcess) {
        const now = new Date();
        
        // Parse the reset date - handle both YYYY-MM-DD and ISO string formats
        let resetDate = null;
        if (creditsData.resetDate) {
          try {
            // Try to parse the date, accounting for different formats
            const resetStr = creditsData.resetDate as string;
            resetDate = resetStr.includes('T') 
              ? new Date(resetStr) 
              : new Date(`${resetStr}T00:00:00Z`);
          } catch (e) {
            resetDate = null;
          }
        }
        
        // Determine credit amount using centralized config
        let creditAmount = 0; // Default to 0 (no more free plan)
        
        if (isPendingDowngrade || (subscriptionData && subscriptionData.status === 'inactive')) {
          // Check if there's a specific next credit amount set
          if (creditsData.nextTotalCredits) {
            creditAmount = parseInt(creditsData.nextTotalCredits as string);
          } else {
            // Default to 0 for cancelled/inactive subscriptions
            creditAmount = 0;
          }
        } else if (subscriptionData && subscriptionData.status === 'active') {
          // Use centralized config for active plan type lookup
          const planType = subscriptionData.planType as string;
          const planCredits = CreditConfig.getCreditsByType(planType as any);
          creditAmount = planCredits.total;
        } else if (subscriptionData && subscriptionData.status === 'trialing') {
          // Use centralized config for trialing subscriptions (should get trial credits)
          const planType = subscriptionData.planType as string;
          const planCredits = CreditConfig.getCreditsByType(planType as any);
          creditAmount = planCredits.total;
        }
        
        // If we've passed the reset date, refresh credits
        // This applies to both free and paid plans
        if (!resetDate || now >= resetDate) {
          // Calculate next reset date - preserve individual user's reset schedule
          let nextResetDate;
          if (resetDate) {
            // If user has existing reset date, advance it by one month
            const nextReset = new Date(resetDate);
            nextReset.setMonth(nextReset.getMonth() + 1);
            nextResetDate = nextReset.toISOString().split('T')[0];
          } else {
            // For new users or corrupted data, use checkout-based reset (1 month from now)
            nextResetDate = CreditConfig.getNextResetDate();
          }
          
          // Prepare credit data - remove pendingDowngrade and nextTotalCredits if present
          const newCreditData: any = {
            total: creditAmount.toString(),
            used: '0',
            resetDate: nextResetDate,
            lastUpdate: now.toISOString()
          };
          
          // If this was a pending downgrade or an inactive subscription, complete the downgrade
          if (isPendingDowngrade) {
            // Remove the pending flags
            delete newCreditData.pendingDowngrade;
            delete newCreditData.nextTotalCredits;
            
            // If subscription is in canceling state or inactive, complete the downgrade
            if (subscriptionData && (
                subscriptionData.status === 'canceling' || 
                subscriptionData.status === 'inactive'
            )) {
              await this.downgradeToFreePlan(userId);
            }
          }
          
          // Save to Redis (only update credit data if not fully downgraded)
          if (!subscriptionData || (
              subscriptionData.status !== 'canceling' && 
              subscriptionData.status !== 'inactive' &&
              subscriptionData.status !== 'canceled' // Don't refresh credits for canceled users
          )) {
            await redis.hset(KEYS.USER_CREDITS(userId), newCreditData);
          }
          
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.error('Error refreshing credits:', error);
      return false;
    }
  },
  
  // Helper to check if two dates are at least one month apart
  isMonthDifference(date1: Date, date2: Date): boolean {
    // Get difference in months
    const months = (date2.getFullYear() - date1.getFullYear()) * 12 + 
                 (date2.getMonth() - date1.getMonth());
    
    // If months difference is at least 1
    if (months >= 1) {
      return true;
    }
    
    // If same month but day is same or later in the next period
    if (months === 0 && date2.getDate() >= date1.getDate()) {
      return true;
    }
    
    return false;
  },
  
  // Downgrade user to free plan
  async downgradeToFreePlan(userId: string): Promise<boolean> {
    try {
      const now = new Date();
      
      // Since we removed the free plan, downgraded users get 0 credits
      await redis.hset(KEYS.USER_SUBSCRIPTION(userId), {
        plan: 'No Active Plan',
        planType: 'DOWNGRADED',
        status: 'canceled',
        amount: '0',
        interval: 'month',
        renewalDate: '',
        lastUpdated: now.toISOString(),
        stripeCustomerId: '',
        stripeSubscriptionId: '',
        downgraded: 'true'
      });
      
      // Set credits to 0 for downgraded users (no free plan anymore)
      await redis.hset(KEYS.USER_CREDITS(userId), {
        total: '0',
        used: '0',
        resetDate: '',
        lastUpdate: now.toISOString(),
        downgraded: 'true'
      });
      
      logger.log(`User ${userId} downgraded to 0 credits (no free plan)`);
      return true;
    } catch (error) {
      console.error('Error downgrading to free plan:', error);
      return false;
    }
  },
  
  // Scheduled task to check for expired subscriptions
  // This should be called periodically (via a cron job or similar)
  async checkExpiredSubscriptions(): Promise<void> {
    try {
      // Get all subscription keys
      const subscriptionKeys = await redis.keys('user:*:subscription');
      
      // Check each subscription
      for (const key of subscriptionKeys) {
        // Extract user ID from the key
        const userId = key.split(':')[1];
        
        // Check if subscription is active
        await this.isSubscriptionActive(userId);
      }
    } catch (error) {
      console.error('Error checking expired subscriptions:', error);
    }
  }
};

export const profileUtils = {
  // Save user profile info (at least email)
  async saveUserProfile(userId: string, profile: { email: string, name?: string, image?: string, joinedDate?: string, role?: string }): Promise<void> {
    try {
      await redis.hset(KEYS.USER_PROFILE(userId), {
        email: profile.email,
        name: profile.name || '',
        image: profile.image || '',
        joinedDate: profile.joinedDate || '',
        role: profile.role || '',
      });
      logger.log(`User profile saved for ${userId}`);
    } catch (error) {
      console.error('Error saving user profile:', error);
    }
  },

  // Optionally, get user profile info
  async getUserProfile(userId: string): Promise<any> {
    try {
      return await redis.hgetall(KEYS.USER_PROFILE(userId));
    } catch (error) {
      console.error('Error fetching user profile:', error);
      return null;
    }
  }
};
