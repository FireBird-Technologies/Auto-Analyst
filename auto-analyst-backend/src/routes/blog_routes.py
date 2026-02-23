import os
import json
from fastapi import APIRouter, HTTPException
from typing import List
from pydantic import BaseModel

router = APIRouter()

class BlogPost(BaseModel):
    id: str
    title: str
    excerpt: str
    content: str
    author: str
    publishedAt: str
    tags: List[str]
    featured: bool
    readTime: str

@router.get("/api/blog/posts", response_model=List[BlogPost])
async def get_blog_posts():
    """Get all blog posts"""
    try:
        # Get the path to the utils/data directory
        current_dir = os.path.dirname(os.path.abspath(__file__))
        utils_dir = os.path.join(current_dir, '..', 'utils', 'data')
        json_path = os.path.join(utils_dir, 'sample-posts.json')
        
        # Normalize the path
        json_path = os.path.normpath(json_path)
        
        if not os.path.exists(json_path):
            raise HTTPException(status_code=404, detail=f"Blog posts data file not found at: {json_path}")
        
        with open(json_path, 'r', encoding='utf-8') as f:
            posts = json.load(f)
        
        return posts
        
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Blog posts data file not found at: {json_path}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Invalid JSON format in blog posts data")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading blog posts: {str(e)}")

@router.get("/api/blog/posts/{post_id}", response_model=BlogPost)
async def get_blog_post(post_id: str):
    """Get a specific blog post by ID"""
    try:
        posts = await get_blog_posts()
        
        for post in posts:
            if post['id'] == post_id:
                return post
        
        raise HTTPException(status_code=404, detail="Blog post not found")
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading blog post: {str(e)}")

@router.get("/api/blog/posts/featured", response_model=BlogPost)
async def get_featured_post():
    """Get the featured blog post"""
    try:
        posts = await get_blog_posts()
        
        for post in posts:
            if post.get('featured', False):
                return post
        
        raise HTTPException(status_code=404, detail="No featured post found")
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading featured post: {str(e)}")

@router.get("/api/blog/tags")
async def get_blog_tags():
    """Get all unique tags from blog posts"""
    try:
        posts = await get_blog_posts()
        
        all_tags = set()
        for post in posts:
            all_tags.update(post.get('tags', []))
        
        return list(all_tags)
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading blog tags: {str(e)}")
