import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import redis, { KEYS, creditUtils } from '@/lib/redis'
import { CreditConfig } from '@/lib/credits-config'

export async function GET(request: NextRequest) {
  try {
    // Get the user token
    const token = await getToken({ req: request })
    if (!token?.sub) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = token.sub
    
    // Get credits from hash
    const creditsHash = await redis.hgetall(KEYS.USER_CREDITS(userId))
    const subscriptionHash = await redis.hgetall(KEYS.USER_SUBSCRIPTION(userId))
    
    let planName, creditsUsed, creditsTotal, resetDate, lastUpdate
    
    if (creditsHash && creditsHash.total) {
      // Use hash data
      creditsTotal = parseInt(creditsHash.total as string)
      creditsUsed = parseInt(creditsHash.used as string || '0')
      resetDate = creditsHash.resetDate || CreditConfig.getNextResetDate()
      lastUpdate = creditsHash.lastUpdate || new Date().toISOString()
      planName = subscriptionHash?.plan || 'No Active Plan'
    } else {
      // Check if user is canceled but still in paid period
      const isCanceledButPaid = await creditUtils.isCanceledButStillPaid(userId)
      
      if (isCanceledButPaid) {
        // User is canceled but still in paid period - keep their subscription credits
        const subscriptionHash = await redis.hgetall(KEYS.USER_SUBSCRIPTION(userId))
        const currentPlanName = (subscriptionHash && subscriptionHash.plan) ? subscriptionHash.plan as string : 'Standard Plan'
        const planCredits = CreditConfig.getCreditsForPlan(currentPlanName)
        
        creditsTotal = planCredits.total
        creditsUsed = 0
        resetDate = subscriptionHash?.renewalDate || CreditConfig.getNextResetDate()
        lastUpdate = new Date().toISOString()
        planName = currentPlanName
        
        // Create hash entry with subscription credits
        await redis.hset(KEYS.USER_CREDITS(userId), {
          total: creditsTotal.toString(),
          used: '0',
          resetDate,
          lastUpdate,
          canceledButPaid: 'true'
        })
      } else {
        // Check if user should get free credits
        const shouldGetFree = await creditUtils.shouldGetFreeCredits(userId)
        
        if (shouldGetFree) {
          // Check if they already received free credits this month
          const alreadyReceived = await creditUtils.hasReceivedFreeCreditsThisMonth(userId)
          
          if (alreadyReceived) {
            // Already got free credits this month - they get 0
            creditsTotal = 0
            creditsUsed = 0
            resetDate = ''
            lastUpdate = new Date().toISOString()
            planName = 'Free Plan'
            
            await redis.hset(KEYS.USER_CREDITS(userId), {
              total: '0',
              used: '0',
              resetDate: '',
              lastUpdate,
              freeUser: 'true',
              monthlyCreditsUsed: 'true'
            })
          } else {
            // Give them 20 free credits for this month
            creditsTotal = 20
            creditsUsed = 0
            resetDate = CreditConfig.getNextResetDate()
            lastUpdate = new Date().toISOString()
            planName = 'Free Plan'
            
            await redis.hset(KEYS.USER_CREDITS(userId), {
              total: '20',
              used: '0',
              resetDate,
              lastUpdate,
              freeUser: 'true',
              lastFreeCreditsDate: new Date().toISOString()
            })
          }
        } else {
          // Active subscriber or other case - they get 0 free credits
          creditsTotal = 0
          creditsUsed = 0
          resetDate = ''
          lastUpdate = new Date().toISOString()
          planName = 'No Active Plan'
          
          await redis.hset(KEYS.USER_CREDITS(userId), {
            total: '0',
            used: '0',
            resetDate: '',
            lastUpdate
          })
        }
      }
    }
    
    // Update the last update timestamp
    const currentTime = new Date().toISOString()
    
    await redis.hset(KEYS.USER_CREDITS(userId), {
      lastUpdate: currentTime
    })
    
    // Return the credit data - use centralized config for unlimited check
    return NextResponse.json({
      used: creditsUsed,
      total: CreditConfig.isUnlimitedTotal(creditsTotal) ? Infinity : creditsTotal,
      resetDate,
      lastUpdate: currentTime,
    })
  } catch (error: any) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to refresh credit data' }, 
      { status: 500 }
    )
  }
} 