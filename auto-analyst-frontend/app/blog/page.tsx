import { Metadata } from 'next'
import BlogPageComponent from '@/components/blog/BlogPage'

export const metadata: Metadata = {
  title: 'Blog - Auto-Analyst',
  description: 'Latest insights, tutorials, and updates from the Auto-Analyst team',
  openGraph: {
    title: 'Blog - Auto-Analyst',
    description: 'Latest insights, tutorials, and updates from the Auto-Analyst team',
  },
}

export default function Blog() {
  return <BlogPageComponent />
}
