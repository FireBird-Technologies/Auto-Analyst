export interface BlogPost {
  id: string
  title: string
  excerpt: string
  content: string
  author: string
  publishedAt: string
  tags: string[]
  featured: boolean
  readTime: string
}

export interface BlogPostFormData {
  title: string
  excerpt: string
  content: string
  author: string
  tags: string[]
  featured: boolean
}
