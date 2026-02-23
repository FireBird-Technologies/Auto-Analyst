import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import redis, { KEYS, creditUtils } from '@/lib/redis'
import { CreditConfig } from '@/lib/credits-config'

export async function POST(request: NextRequest) {
  try {
    // Get the user token to verify authorization
    const token = await getToken({ req: request })
    if (!token?.sub) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = token.sub
    const body = await request.json()
    const { credits = 1, description = 'Chat usage' } = body
    
    // Get current credit data
    const creditsHash = await redis.hgetall(KEYS.USER_CREDITS(userId))
    
    if (!creditsHash || !creditsHash.total) {
      // Check if user is canceled but still in paid period
      const isCanceledButPaid = await creditUtils.isCanceledButStillPaid(userId)
      
      if (isCanceledButPaid) {
        // User is canceled but still in paid period - give them subscription credits
        const subscriptionHash = await redis.hgetall(KEYS.USER_SUBSCRIPTION(userId))
        const planName = (subscriptionHash && subscriptionHash.plan) ? subscriptionHash.plan as string : 'Standard Plan'
        const planCredits = CreditConfig.getCreditsForPlan(planName)
        
        await redis.hset(KEYS.USER_CREDITS(userId), {
          total: planCredits.total.toString(),
          used: '0',
          resetDate: subscriptionHash?.renewalDate || CreditConfig.getNextResetDate(),
          lastUpdate: new Date().toISOString(),
          canceledButPaid: 'true'
        })
        
        // Check if they have enough credits for this request
        if (planCredits.total < credits) {
          return NextResponse.json({
            success: false,
            error: 'INSUFFICIENT_CREDITS',
            message: 'Not enough credits remaining. Please upgrade your plan.',
            remaining: planCredits.total,
            required: credits,
            needsUpgrade: true
          }, { status: 402 })
        }
        
        // Deduct the credits
        await redis.hset(KEYS.USER_CREDITS(userId), {
          used: credits.toString(),
          lastUpdate: new Date().toISOString()
        })
        
        return NextResponse.json({
          success: true,
          remaining: planCredits.total - credits,
          deducted: credits,
          description
        })
      } else {
        // Check if user should get free credits
        const shouldGetFree = await creditUtils.shouldGetFreeCredits(userId)
        
        if (shouldGetFree) {
          // Check if they already received free credits this month
          const alreadyReceived = await creditUtils.hasReceivedFreeCreditsThisMonth(userId)
          
          if (alreadyReceived) {
            // Already got free credits this month - no more credits
            await redis.hset(KEYS.USER_CREDITS(userId), {
              total: '0',
              used: '0',
              resetDate: '',
              lastUpdate: new Date().toISOString(),
              freeUser: 'true',
              monthlyCreditsUsed: 'true'
            })
            
            return NextResponse.json({
              success: false,
              error: 'UPGRADE_REQUIRED',
              message: 'You have used your free credits for this month. Please upgrade your plan to continue.',
              remaining: 0,
              needsUpgrade: true
            }, { status: 402 })
          } else {
            // Give them 20 free credits for this month
            await redis.hset(KEYS.USER_CREDITS(userId), {
              total: '20',
              used: '0',
              resetDate: CreditConfig.getNextResetDate(),
              lastUpdate: new Date().toISOString(),
              freeUser: 'true',
              lastFreeCreditsDate: new Date().toISOString()
            })
            
            // Check if they have enough credits for this request
            if (20 < credits) {
              return NextResponse.json({
                success: false,
                error: 'INSUFFICIENT_CREDITS',
                message: 'Not enough credits remaining. Please upgrade your plan.',
                remaining: 20,
                required: credits,
                needsUpgrade: true
              }, { status: 402 })
            }
            
            // Deduct the credits
            await redis.hset(KEYS.USER_CREDITS(userId), {
              used: credits.toString(),
              lastUpdate: new Date().toISOString()
            })
            
            return NextResponse.json({
              success: true,
              remaining: 20 - credits,
              deducted: credits,
              description
            })
          }
        } else {
          // Active subscriber or other case - no free credits
          return NextResponse.json({
            success: false,
            error: 'UPGRADE_REQUIRED',
            message: 'Please start your trial or upgrade your plan to continue.',
            remaining: 0,
            needsUpgrade: true
          }, { status: 402 })
        }
      }
    }
   

    // Calculate new used amount
    const total = parseInt(creditsHash.total as string)
    const currentUsed = creditsHash.used ? parseInt(creditsHash.used as string) : 0
    const remaining = total - currentUsed
    
    // Check if user has enough credits
    if (remaining < credits) {
      return NextResponse.json({
        success: false,
        error: 'INSUFFICIENT_CREDITS',
        message: 'Not enough credits remaining. Please upgrade your plan.',
        remaining: remaining,
        required: credits,
        needsUpgrade: true
      }, { status: 402 }) // Payment Required status code
    }
    
    const newUsed = currentUsed + credits
    
    // Update the credits hash
    await redis.hset(KEYS.USER_CREDITS(userId), {
      used: newUsed.toString(),
      lastUpdate: new Date().toISOString()
    })
    
    console.log(`Deducted ${credits} credits for user ${userId}. Remaining: ${total - newUsed}`)
    
    // Return updated credit information
    return NextResponse.json({
      success: true,
      remaining: total - newUsed,
      deducted: credits,
      description
    })
  } catch (error: any) {
    console.error('Error deducting credits:', error)
    return NextResponse.json({ error: error.message || 'Failed to deduct credits' }, { status: 500 })
  }
} 
