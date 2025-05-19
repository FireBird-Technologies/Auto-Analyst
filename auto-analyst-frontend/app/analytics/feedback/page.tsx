"use client"

import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import FeedbackAnalytics from '@/components/analytics/FeedbackAnalytics'
import AnalyticsLayout from '@/components/analytics/AnalyticsLayout'


export default function FeedbackAnalyticsPage() {
  return (
    <AnalyticsLayout>
      <Suspense fallback={
        <div className="flex items-center justify-center w-full h-64">
          <Loader2 className="h-8 w-8 animate-spin text-[#FF7F7F]" />
        </div>
      }>
        <FeedbackAnalytics />
      </Suspense>
    </AnalyticsLayout>
  )
} 