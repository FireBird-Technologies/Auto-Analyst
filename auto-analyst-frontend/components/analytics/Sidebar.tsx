"use client"

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { getSessionId } from '@/lib/api/auth';
import { 
  BarChart3,
  Users,
  CreditCard,
  Code2,
  Server,
  Activity,
  Home,
  Star,
  LucideIcon
} from 'lucide-react'

// Define the NavItem interface
interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  color: string;
}

export default function Sidebar() {
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState(true);
  const [sessionId, setSessionId] = useState<string>('');
  
  useEffect(() => {
    setSessionId(getSessionId());
  }, []);

  // Check if the current path is active
  const isActive = (path: string) => {
    return pathname === path || pathname.startsWith(`${path}/`);
  };

  const activeClass = "bg-[#FFF0F0] text-[#FF7F7F] font-medium";
  const inactiveClass = "text-gray-600 hover:bg-gray-50";
  
  // Navigation items with links
  const mainNavItems: NavItem[] = [
    {
      title: "Dashboard",
      href: "/analytics",
      icon: Home,
      color: "text-gray-500"
    },
    {
      title: "User Analytics",
      href: "/analytics/users",
      icon: Users,
      color: "text-blue-500"
    },
    {
      title: "Model Usage",
      href: "/analytics/models",
      icon: Server,
      color: "text-purple-500"
    },
    {
      title: "Costs & Billing",
      href: "/analytics/costs",
      icon: CreditCard,
      color: "text-green-500"
    },
    {
      title: "Tier Analysis",
      href: "/analytics/tiers",
      icon: BarChart3,
      color: "text-orange-500"
    },
    {
      title: "Code Execution",
      href: "/analytics/code-executions",
      icon: Code2,
      color: "text-indigo-500"
    },
    {
      title: "Code Errors",
      href: "/analytics/code-errors",
      icon: Activity,
      color: "text-red-500"
    },
    {
      title: "Feedback",
      href: "/analytics/feedback",
      icon: Star,
      color: "text-yellow-500"
    }
  ]
  
  return (
    <div className="flex flex-col border-r h-full bg-white">
      <div className="p-4">
        <h2 className="text-xl font-semibold text-[#FF7F7F]">Analytics Dashboard</h2>
        <p className="text-sm text-gray-500">Admin analytics and metrics</p>
      </div>
      
      <nav className="px-2 flex-1 overflow-y-auto">
        <div className="space-y-1">
          {mainNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center px-3 py-2 rounded-md text-sm ${
                isActive(item.href) ? activeClass : inactiveClass
              }`}
            >
              <item.icon className={`h-5 w-5 mr-2 ${item.color}`} />
              {item.title}
            </Link>
          ))}
        </div>
      </nav>
      
      <div className="p-4 border-t">
        <div className="text-xs text-gray-500">
          Session ID: {sessionId || 'Not available'}
        </div>
      </div>
    </div>
  );
} 