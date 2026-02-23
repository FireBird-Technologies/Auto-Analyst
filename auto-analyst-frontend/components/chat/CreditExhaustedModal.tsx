'use client'

import React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Lock, Crown, CreditCard } from 'lucide-react'
import Link from 'next/link'
// import config

interface CreditExhaustedModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function CreditExhaustedModal({
  isOpen,
  onClose
}: CreditExhaustedModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Crown className="w-6 h-6 text-yellow-500" />
            Credits Required
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-red-50 to-orange-50 rounded-lg border border-[#FF7F7F]/20">
            <Lock className="w-6 h-6 text-[#FF7F7F]" />
            <div>
              <h4 className="font-semibold text-gray-900 text-base">Upgrade Required</h4>
              <p className="text-base text-gray-700 mt-1">
                You need credits to continue using Auto-Analyst. Choose a plan that fits your needs.
              </p>
            </div>
          </div>
          
          <div className="space-y-3">
            <h5 className="font-semibold text-gray-900 text-base">Available options:</h5>
            <ul className="text-base text-gray-700 space-y-2 ml-4">
              <li>• Upgrade to a paid plan for more credits</li>
              <li>• Upgrade to Standard plan for 500 credits/month</li>
              <li>• Contact us for enterprise plans</li>
            </ul>
          </div>
          <div className="flex gap-3 pt-4">
            <Link href="/pricing" className="flex-1">
              <Button className="w-full bg-gradient-to-r from-[#FF7F7F] to-[#FF6666] hover:from-[#FF6666] hover:to-[#E55555] text-white">
                <Crown className="w-4 h-4 mr-2" />
                View Plans
              </Button>
            </Link>
            <Button 
              variant="outline" 
              onClick={onClose}
              className="px-6"
            >
              Maybe Later
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
} 