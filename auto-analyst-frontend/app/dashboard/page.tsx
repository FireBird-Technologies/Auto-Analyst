import { Metadata } from 'next'
import DashboardPage from '@/components/dashboard/DashboardPage'

export const metadata: Metadata = {
  title: 'Dashboard - Auto-Analyst',
  description: 'AI-powered analytics dashboard for data visualization and analysis',
  openGraph: {
    title: 'Dashboard - Auto-Analyst',
    description: 'AI-powered analytics dashboard for data visualization and analysis',
  },
}

export default function Dashboard() {
  return <DashboardPage />
}

