import json
import logging
import os
from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket
from fastapi.security import APIKeyHeader

from pydantic import BaseModel

from sqlalchemy import case, desc, func
from sqlalchemy.orm import Session

from src.db.init_db import get_db, get_session
from src.db.schemas.models import ModelUsage, CodeExecution, Message, MessageFeedback
from src.managers.chat_manager import ChatManager

from typing import Any, Dict, List, Optional
from src.utils.logger import Logger
from src.utils.model_registry import MODEL_TIERS, get_model_tier as get_model_tier_from_registry

# Initialize logger with console logging disabled
logger = Logger("analytics_routes", see_time=True, console_log=False)

# Initialize router
router = APIRouter(prefix="/analytics", tags=["analytics"])

# Disable logging
if os.getenv("ENVIRONMENT") == "production":
    logger.disable_logging()

# Initialize chat manager
chat_manager = ChatManager(db_url=os.getenv("DATABASE_URL"))

# API Key security
ADMIN_API_KEY = os.getenv("ADMIN_API_KEY", "default-admin-key-change-me")
api_key_header = APIKeyHeader(name="X-Admin-API-Key", auto_error=False)

# Dependency to check admin API key
async def verify_admin_api_key(
    api_key: str = Depends(api_key_header),
    request: Request = None
):
    # Check header first
    if api_key and api_key == ADMIN_API_KEY:
        logger.log_message("Admin API key successfully verified via header", logging.INFO)
        return True
        
    # If API key wasn't in header or didn't match, check query parameters
    if request:
        api_key_query = request.query_params.get("admin_api_key")
        if api_key_query and api_key_query == ADMIN_API_KEY:
            logger.log_message("Admin API key successfully verified via query parameter", logging.INFO)
            return True
    
    # If we got here, the API key is invalid
    logger.log_message("Invalid or missing admin API key attempt", level=logging.WARNING)
    raise HTTPException(
        status_code=403,
        detail="Invalid or missing admin API key"
    )

# Active WebSocket connections for real-time updates
active_dashboard_connections = set()
active_user_connections = set()

# Helper function to determine model tier
def get_model_tier(model_name):
    """Determine which tier a model belongs to based on its name"""
    return get_model_tier_from_registry(model_name)

# Helper function to parse period parameter
def get_date_range(period: str):
    today = datetime.utcnow()
    if period == '7d':
        start_date = today - timedelta(days=7)
    elif period == '30d':
        start_date = today - timedelta(days=30)
    elif period == '90d':
        start_date = today - timedelta(days=90)
    else:
        start_date = today - timedelta(days=30)  # Default to 30 days
    
    return start_date, today

# Dashboard endpoint - combines summary data for the main dashboard
@router.get("/dashboard")
async def get_dashboard_data(
    period: str = "30d", 
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_admin_api_key)
):
    logger.log_message(f"Dashboard data requested for period: {period}", logging.INFO)
    start_date, end_date = get_date_range(period)
    
    # Get total stats
    total_stats = db.query(
        func.sum(ModelUsage.total_tokens).label("total_tokens"),
        func.sum(ModelUsage.cost).label("total_cost"),
        func.count().label("total_requests"),
        func.count(func.distinct(ModelUsage.user_id)).label("total_users")
    ).filter(ModelUsage.timestamp >= start_date).first()
    
    # Get daily usage
    daily_query = db.query(
        func.date(ModelUsage.timestamp).label("date"),
        func.sum(ModelUsage.total_tokens).label("tokens"),
        func.sum(ModelUsage.cost).label("cost"),
        func.count().label("requests")
    ).filter(
        ModelUsage.timestamp >= start_date,
        ModelUsage.timestamp <= end_date
    ).group_by(
        func.date(ModelUsage.timestamp)
    ).order_by(
        func.date(ModelUsage.timestamp)
    )
    
    daily_usage = [
        {
            "date": str(day.date),
            "tokens": int(day.tokens or 0),
            "cost": float(day.cost or 0),
            "requests": int(day.requests or 0)
        }
        for day in daily_query
    ]
    
    # Get model usage
    model_query = db.query(
        ModelUsage.model_name,
        func.sum(ModelUsage.total_tokens).label("tokens"),
        func.sum(ModelUsage.cost).label("cost"),
        func.count().label("requests")
    ).filter(
        ModelUsage.timestamp >= start_date,
        ModelUsage.timestamp <= end_date
    ).group_by(
        ModelUsage.model_name
    ).order_by(
        desc(func.sum(ModelUsage.total_tokens))
    )
    
    model_usage = [
        {
            "model_name": model.model_name,
            "tokens": int(model.tokens or 0),
            "cost": float(model.cost or 0),
            "requests": int(model.requests or 0)
        }
        for model in model_query
    ]
    
    # Get top users
    user_query = db.query(
        ModelUsage.user_id,
        func.sum(ModelUsage.total_tokens).label("tokens"),
        func.sum(ModelUsage.cost).label("cost"),
        func.count().label("requests")
    ).filter(
        ModelUsage.timestamp >= start_date,
        ModelUsage.timestamp <= end_date,
        ModelUsage.user_id.isnot(None)
    ).group_by(
        ModelUsage.user_id
    ).order_by(
        desc(func.sum(ModelUsage.total_tokens))
    ).limit(10)
    
    top_users = [
        {
            "user_id": str(user.user_id),
            "tokens": int(user.tokens or 0),
            "cost": float(user.cost or 0),
            "requests": int(user.requests or 0)
        }
        for user in user_query
    ]
    
    result = {
        "total_tokens": int(total_stats.total_tokens or 0),
        "total_cost": float(total_stats.total_cost or 0),
        "total_requests": int(total_stats.total_requests or 0),
        "total_users": int(total_stats.total_users or 0),
        "daily_usage": daily_usage,
        "model_usage": model_usage,
        "top_users": top_users,
        "start_date": start_date.strftime('%Y-%m-%d'),
        "end_date": end_date.strftime('%Y-%m-%d'),
    }
    logger.log_message(f"Dashboard data retrieved: {len(daily_usage)} days, {len(model_usage)} models, {len(top_users)} top users", logging.INFO)
    return result

# WebSocket endpoint for real-time dashboard updates
@router.websocket("/dashboard/realtime")
async def dashboard_realtime(websocket: WebSocket):
    client_id = id(websocket)
    logger.log_message(f"New dashboard realtime connection: {client_id}", logging.INFO)
    await websocket.accept()
    active_dashboard_connections.add(websocket)
    
    try:
        while True:
            # Keep connection alive and wait for potential disconnection
            await websocket.receive_text()
    except Exception as e:
        # Remove connection when client disconnects
        logger.log_message(f"Dashboard realtime connection closed: {client_id}, reason: {str(e)}", logging.INFO)
        active_dashboard_connections.remove(websocket)
        await websocket.close()

# User analytics endpoints
@router.get("/users")
async def get_users(
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_admin_api_key)
):
    logger.log_message(f"User analytics requested with limit: {limit}, offset: {offset}", logging.INFO)
    user_query = db.query(
        ModelUsage.user_id,
        func.sum(ModelUsage.total_tokens).label("tokens"),
        func.sum(ModelUsage.cost).label("cost"),
        func.count().label("requests"),
        func.min(ModelUsage.timestamp).label("first_seen"),
        func.max(ModelUsage.timestamp).label("last_seen")
    ).filter(
        ModelUsage.user_id.isnot(None)
    ).group_by(
        ModelUsage.user_id
    ).order_by(
        desc(func.sum(ModelUsage.total_tokens))
    ).offset(offset).limit(limit)
    
    users = [
        {
            "user_id": str(user.user_id),
            "tokens": int(user.tokens or 0),
            "cost": float(user.cost or 0),
            "requests": int(user.requests or 0),
            "first_seen": user.first_seen.isoformat() if user.first_seen else None,
            "last_seen": user.last_seen.isoformat() if user.last_seen else None,
        }
        for user in user_query
    ]
    
    # Get total users count for pagination
    total_users = db.query(func.count(func.distinct(ModelUsage.user_id)))\
        .filter(ModelUsage.user_id.isnot(None))\
        .scalar() or 0
    
    logger.log_message(f"Retrieved {len(users)} users, total users: {total_users}", logging.INFO)
    return {
        "users": users,
        "total": total_users,
        "limit": limit,
        "offset": offset
    }

@router.get("/users/activity")
async def get_user_activity(
    period: str = "30d",
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_admin_api_key)
):
    logger.log_message(f"User activity requested for period: {period}", logging.INFO)
    start_date, end_date = get_date_range(period)
    
    # First, get a subquery for the first date each user was seen
    first_seen_subquery = db.query(
        ModelUsage.user_id,
        func.date(func.min(ModelUsage.timestamp)).label("first_date")
    ).filter(
        ModelUsage.user_id.isnot(None)
    ).group_by(
        ModelUsage.user_id
    ).subquery()
    
    # Get daily activity with normal metrics
    daily_query = db.query(
        func.date(ModelUsage.timestamp).label("date"),
        func.count(func.distinct(ModelUsage.user_id)).label("active_users"),
        func.count(func.distinct(ModelUsage.chat_id)).label("sessions")
    ).filter(
        ModelUsage.timestamp >= start_date,
        ModelUsage.timestamp <= end_date,
        ModelUsage.user_id.isnot(None)
    ).group_by(
        func.date(ModelUsage.timestamp)
    ).order_by(
        func.date(ModelUsage.timestamp)
    )
    
    # Process results into expected format
    activity_data = []
    for day in daily_query:
        date_str = str(day.date)
        
        # Get new users count for this specific date
        new_users_count = db.query(func.count()).select_from(first_seen_subquery).filter(
            first_seen_subquery.c.first_date == day.date
        ).scalar() or 0
        
        activity_data.append({
            "date": date_str,
            "activeUsers": int(day.active_users or 0),
            "newUsers": int(new_users_count),
            "sessions": int(day.sessions or 0)
        })
    
    # Fill in any missing dates with zeros
    date_range = [(start_date + timedelta(days=i)).strftime('%Y-%m-%d') 
                  for i in range((end_date - start_date).days + 1)]
    
    activity_dict = {item["date"]: item for item in activity_data}
    
    filled_activity = []
    for date in date_range:
        if date in activity_dict:
            filled_activity.append(activity_dict[date])
        else:
            filled_activity.append({
                "date": date,
                "activeUsers": 0,
                "newUsers": 0,
                "sessions": 0
            })
    
    logger.log_message(f"Retrieved user activity data for {len(filled_activity)} days", logging.INFO)
    return {"user_activity": filled_activity}

@router.get("/users/sessions/stats")
async def get_session_stats(
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_admin_api_key)
):
    logger.log_message("Session statistics requested", logging.INFO)
    # Total users ever
    total_users = db.query(func.count(func.distinct(ModelUsage.user_id)))\
        .filter(ModelUsage.user_id.isnot(None))\
        .scalar() or 0
    
    # Active users today
    today = datetime.utcnow().date()
    active_today = db.query(func.count(func.distinct(ModelUsage.user_id)))\
        .filter(
            func.date(ModelUsage.timestamp) == today,
            ModelUsage.user_id.isnot(None)
        ).scalar() or 0
    
    # Average queries per session - rewritten without window functions
    # First, get count of messages per chat_id
    chat_message_counts = db.query(
        ModelUsage.chat_id,
        func.count().label("msg_count")
    ).filter(
        ModelUsage.chat_id.isnot(None)
    ).group_by(
        ModelUsage.chat_id
    ).subquery()
    
    # Then calculate the average
    avg_queries = db.query(
        func.avg(chat_message_counts.c.msg_count)
    ).scalar() or 0
    
    # Average session time (approximated based on first and last message in each chat)
    session_times = db.query(
        ModelUsage.chat_id,
        func.min(ModelUsage.timestamp).label("start_time"),
        func.max(ModelUsage.timestamp).label("end_time")
    ).filter(
        ModelUsage.chat_id.isnot(None)
    ).group_by(
        ModelUsage.chat_id
    ).all()
    
    total_seconds = 0
    session_count = 0
    
    for session in session_times:
        if session.start_time and session.end_time:
            duration = (session.end_time - session.start_time).total_seconds()
            if duration > 0:  # Filter out single-message sessions
                total_seconds += duration
                session_count += 1
    
    avg_session_time = int(total_seconds / session_count) if session_count > 0 else 0
    
    logger.log_message(f"Session stats retrieved: {total_users} total users, {active_today} active today", logging.INFO)
    return {
        "totalUsers": total_users,
        "activeToday": active_today,
        "avgQueriesPerSession": round(avg_queries, 1),
        "avgSessionTime": avg_session_time
    }

@router.websocket("/realtime")
async def user_realtime(websocket: WebSocket):
    client_id = id(websocket)
    logger.log_message(f"New user realtime connection: {client_id}", logging.INFO)
    await websocket.accept()
    active_user_connections.add(websocket)
    
    try:
        while True:
            # Keep connection alive
            await websocket.receive_text()
    except Exception as e:
        logger.log_message(f"User realtime connection closed: {client_id}, reason: {str(e)}", logging.INFO)
        active_user_connections.remove(websocket)
        await websocket.close()

# Model analytics endpoints
@router.get("/usage/models")
async def get_model_usage(
    period: str = "30d",
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_admin_api_key)
):
    logger.log_message(f"Model usage requested for period: {period}", logging.INFO)
    start_date, end_date = get_date_range(period)
    
    # Get model usage breakdown
    model_query = db.query(
        ModelUsage.model_name,
        func.sum(ModelUsage.total_tokens).label("tokens"),
        func.sum(ModelUsage.cost).label("cost"),
        func.count().label("requests"),
        func.avg(ModelUsage.request_time_ms).label("avg_response_time")
    ).filter(
        ModelUsage.timestamp >= start_date,
        ModelUsage.timestamp <= end_date
    ).group_by(
        ModelUsage.model_name
    ).order_by(
        desc(func.sum(ModelUsage.total_tokens))
    )
    
    model_usage = [
        {
            "model_name": model.model_name,
            "tokens": int(model.tokens or 0),
            "cost": float(model.cost or 0),
            "requests": int(model.requests or 0),
            "avg_response_time": float(model.avg_response_time or 0) / 1000 if model.avg_response_time else 0
        }
        for model in model_query
    ]
    
    logger.log_message(f"Retrieved model usage for {len(model_usage)} models", logging.INFO)
    return {"model_usage": model_usage}

@router.get("/models/history")
async def get_model_history(
    period: str = "30d",
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_admin_api_key)
):
    logger.log_message(f"Model history requested for period: {period}", logging.INFO)
    start_date, end_date = get_date_range(period)
    
    # Get daily usage per model
    daily_model_query = db.query(
        func.date(ModelUsage.timestamp).label("date"),
        ModelUsage.model_name,
        func.sum(ModelUsage.total_tokens).label("tokens"),
        func.count().label("requests")
    ).filter(
        ModelUsage.timestamp >= start_date,
        ModelUsage.timestamp <= end_date
    ).group_by(
        func.date(ModelUsage.timestamp),
        ModelUsage.model_name
    ).order_by(
        func.date(ModelUsage.timestamp)
    )
    
    # Transform into the format expected by the frontend
    date_model_data = defaultdict(lambda: {"date": None, "models": []})
    model_names = set()
    
    for record in daily_model_query:
        date_str = str(record.date)
        date_model_data[date_str]["date"] = date_str
        date_model_data[date_str]["models"].append({
            "name": record.model_name,
            "tokens": int(record.tokens or 0),
            "requests": int(record.requests or 0)
        })
        model_names.add(record.model_name)
    
    # Fill in any missing dates with zeros for all models
    date_range = [(start_date + timedelta(days=i)).strftime('%Y-%m-%d') 
                  for i in range((end_date - start_date).days + 1)]
    
    model_history = []
    for date in date_range:
        if date in date_model_data:
            # Check if all models are represented
            existing_models = {m["name"] for m in date_model_data[date]["models"]}
            for model_name in model_names:
                if model_name not in existing_models:
                    date_model_data[date]["models"].append({
                        "name": model_name,
                        "tokens": 0,
                        "requests": 0
                    })
            model_history.append(date_model_data[date])
        else:
            # Create an entry with zeros for all models
            model_history.append({
                "date": date,
                "models": [{"name": model_name, "tokens": 0, "requests": 0} for model_name in model_names]
            })
    
    logger.log_message(f"Retrieved model history for {len(model_history)} days covering {len(model_names)} models", logging.INFO)
    return {"model_history": model_history}

@router.get("/models/metrics")
async def get_model_metrics(
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_admin_api_key)
):
    logger.log_message("Model metrics requested", logging.INFO)
    # Calculate performance metrics for each model
    metrics_query = db.query(
        ModelUsage.model_name.label("name"),
        func.avg(ModelUsage.total_tokens).label("avg_tokens"),
        func.avg(ModelUsage.request_time_ms).label("avg_response_time"),
        # Approximate success rate based on whether response has tokens
        (1 - func.sum(case((ModelUsage.completion_tokens < 1, 1), else_=0)) / func.count()).label("success_rate")
    ).group_by(
        ModelUsage.model_name
    ).order_by(
        desc(func.avg(ModelUsage.total_tokens))
    )
    
    model_metrics = [
        {
            "name": metrics.name,
            "avg_tokens": float(metrics.avg_tokens or 0),
            "avg_response_time": float(metrics.avg_response_time or 0) / 1000 if metrics.avg_response_time else 0,
            "success_rate": float(metrics.success_rate or 0.95)  # Default to 95% if undefined
        }
        for metrics in metrics_query.all()  # Fetch all results to avoid lazy loading!!!
    ]
    
    logger.log_message(f"Retrieved metrics for {len(model_metrics)} models", logging.INFO)
    return {"model_metrics": model_metrics}

# Cost analytics endpoints
@router.get("/costs/summary")
async def get_cost_summary(
    period: str = "30d",
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_admin_api_key)
):
    logger.log_message(f"Cost summary requested for period: {period}", logging.INFO)
    start_date, end_date = get_date_range(period)
    
    # Get cost summary
    summary = db.query(
        func.sum(ModelUsage.cost).label("total_cost"),
        func.sum(ModelUsage.total_tokens).label("total_tokens"),
        func.count().label("total_requests")
    ).filter(
        ModelUsage.timestamp >= start_date,
        ModelUsage.timestamp <= end_date
    ).first()
    
    # Calculate average daily costs
    days = (end_date - start_date).days or 1  # Avoid division by zero
    
    result = {
        "totalCost": float(summary.total_cost or 0),
        "totalTokens": int(summary.total_tokens or 0),
        "totalRequests": int(summary.total_requests or 0),
        "avgDailyCost": float(summary.total_cost or 0) / days,
        "costPerThousandTokens": float(summary.total_cost or 0) / (int(summary.total_tokens or 1) / 1000),
        "daysInPeriod": days,
        "startDate": start_date.strftime('%Y-%m-%d'),
        "endDate": end_date.strftime('%Y-%m-%d')
    }
    logger.log_message(f"Cost summary retrieved: ${result['totalCost']:.2f} over {days} days", logging.INFO)
    return result

@router.get("/costs/daily")
async def get_daily_costs(
    period: str = "30d",
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_admin_api_key)
):
    logger.log_message(f"Daily costs requested for period: {period}", logging.INFO)
    start_date, end_date = get_date_range(period)
    
    # Get daily costs
    daily_query = db.query(
        func.date(ModelUsage.timestamp).label("date"),
        func.sum(ModelUsage.cost).label("cost"),
        func.sum(ModelUsage.total_tokens).label("tokens")
    ).filter(
        ModelUsage.timestamp >= start_date,
        ModelUsage.timestamp <= end_date
    ).group_by(
        func.date(ModelUsage.timestamp)
    ).order_by(
        func.date(ModelUsage.timestamp)
    )
    
    daily_costs = [
        {
            "date": str(day.date),
            "cost": float(day.cost or 0),
            "tokens": int(day.tokens or 0)
        }
        for day in daily_costs
    ]
    
    # Fill in any missing dates with zeros
    date_range = [(start_date + timedelta(days=i)).strftime('%Y-%m-%d') 
                  for i in range((end_date - start_date).days + 1)]
    
    costs_dict = {item["date"]: item for item in daily_costs}
    
    filled_costs = []
    for date in date_range:
        if date in costs_dict:
            filled_costs.append(costs_dict[date])
        else:
            filled_costs.append({
                "date": date,
                "cost": 0.0,
                "tokens": 0
            })
    
    logger.log_message(f"Retrieved daily costs for {len(filled_costs)} days", logging.INFO)
    return {"daily_costs": filled_costs}

@router.get("/costs/models")
async def get_model_costs(
    period: str = "30d",
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_admin_api_key)
):
    logger.log_message(f"Model costs requested for period: {period}", logging.INFO)
    start_date, end_date = get_date_range(period)
    
    # Get costs by model
    model_query = db.query(
        ModelUsage.model_name,
        func.sum(ModelUsage.cost).label("cost"),
        func.sum(ModelUsage.total_tokens).label("tokens"),
        func.count().label("requests")
    ).filter(
        ModelUsage.timestamp >= start_date,
        ModelUsage.timestamp <= end_date
    ).group_by(
        ModelUsage.model_name
    ).order_by(
        desc(func.sum(ModelUsage.cost))
    )
    
    model_costs = [
        {
            "model_name": model.model_name,
            "cost": float(model.cost or 0),
            "tokens": int(model.tokens or 0),
            "requests": int(model.requests or 0)
        }
        for model in model_query
    ]
    
    logger.log_message(f"Retrieved cost data for {len(model_costs)} models", logging.INFO)
    return {"model_costs": model_costs}

@router.get("/costs/projections")
async def get_cost_projections(
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_admin_api_key)
):
    logger.log_message("Cost projections requested", logging.INFO)
    # Get last 30 days usage as baseline
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    
    baseline = db.query(
        func.sum(ModelUsage.cost).label("total_cost"),
        func.sum(ModelUsage.total_tokens).label("total_tokens"),
        func.count().label("days")
    ).filter(
        ModelUsage.timestamp >= thirty_days_ago
    ).first()
    
    # Calculate daily averages
    actual_days = db.query(func.count(func.distinct(func.date(ModelUsage.timestamp))))\
        .filter(ModelUsage.timestamp >= thirty_days_ago)\
        .scalar() or 1  # Avoid division by zero
    
    daily_cost = float(baseline.total_cost or 0) / actual_days
    daily_tokens = int(baseline.total_tokens or 0) / actual_days
    
    # Project future costs
    result = {
        "nextMonth": daily_cost * 30,
        "next3Months": daily_cost * 90,
        "nextYear": daily_cost * 365,
        "tokensNextMonth": daily_tokens * 30,
        "dailyCost": daily_cost,
        "dailyTokens": daily_tokens,
        "baselineDays": actual_days
    }
    logger.log_message(f"Cost projections calculated: ${result['nextMonth']:.2f}/month, ${result['nextYear']:.2f}/year", logging.INFO)
    return result

@router.get("/costs/today")
async def get_today_costs(
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_admin_api_key)
):
    logger.log_message("Today's costs requested", logging.INFO)
    today = datetime.utcnow().date()
    
    # Get today's costs
    today_data = db.query(
        func.sum(ModelUsage.cost).label("cost"),
        func.sum(ModelUsage.total_tokens).label("tokens"),
        func.count().label("requests")
    ).filter(
        func.date(ModelUsage.timestamp) == today
    ).first()
    
    result = {
        "date": today.strftime('%Y-%m-%d'),
        "cost": float(today_data.cost or 0),
        "tokens": int(today_data.tokens or 0),
        "requests": int(today_data.requests or 0)
    }
    logger.log_message(f"Today's costs retrieved: ${result['cost']:.2f}, {result['tokens']} tokens", logging.INFO)
    return result

# Debug endpoint for testing admin key
@router.get("/debug/model_usage")
async def debug_model_usage(api_key: str = Depends(verify_admin_api_key)):
    logger.log_message("Debug model usage endpoint accessed", logging.INFO)
    return {"status": "success", "message": "Admin API key validated successfully"}

# Function to broadcast real-time updates to all connected dashboard clients
async def broadcast_dashboard_update(update_data: Dict[str, Any]):
    if not active_dashboard_connections:
        return
    
    connection_count = len(active_dashboard_connections)
    logger.log_message(f"Broadcasting dashboard update to {connection_count} connections", logging.INFO)
    
    for connection in active_dashboard_connections.copy():
        try:
            await connection.send_text(json.dumps(update_data))
        except Exception as e:
            logger.log_message(f"Failed to send dashboard update: {str(e)}", logging.WARNING)
            active_dashboard_connections.remove(connection)

# Function to broadcast real-time updates to all connected user analytics clients
async def broadcast_user_update(update_data: Dict[str, Any]):
    if not active_user_connections:
        return
    
    connection_count = len(active_user_connections)
    logger.log_message(f"Broadcasting user update to {connection_count} connections", logging.INFO)
    
    for connection in active_user_connections.copy():
        try:
            await connection.send_text(json.dumps(update_data))
        except Exception as e:
            logger.log_message(f"Failed to send user update: {str(e)}", logging.WARNING)
            active_user_connections.remove(connection)

# Usage summary endpoint (to maintain backward compatibility)
@router.get("/usage/summary")
async def get_usage_summary(
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_admin_api_key)
):
    logger.log_message("Usage summary requested (legacy endpoint)", logging.INFO)
    # Call the dashboard endpoint with default period
    return await get_dashboard_data(period="30d", db=db, api_key=api_key)

# Event handler for new ModelUsage entries
async def handle_new_model_usage(model_usage: ModelUsage):
    """
    Process a new model usage event and broadcast updates to connected clients.
    This function should be called whenever a new model usage record is created.
    """
    # Ensure the model_usage instance is refreshed and bound to a session
    session = get_session()  # Assuming get_session() is a function that provides a new session
    try:
        # Refresh the instance to ensure it's bound to the session
        session.refresh(model_usage)

        model_usage = session.merge(model_usage)  # Reattach to session
        session.refresh(model_usage)  # Refresh attributes
        logger.log_message(f"Processing new model usage event: {model_usage.model_name}, user: {model_usage.user_id}", level=logging.INFO)
        
        
        date_str = model_usage.timestamp.strftime('%Y-%m-%d') if model_usage.timestamp else None
        
        # Create dashboard update
        dashboard_update = {
            "type": "usage_update",
            "date": date_str,
            "metrics": {
                "tokens_delta": model_usage.total_tokens,
                "cost_delta": model_usage.cost,
                "requests_delta": 1
            }
        }
        # Create model update
        model_update = {
            "type": "model_update",
            "model_name": model_usage.model_name,
            "metrics": {
                "tokens": model_usage.total_tokens,
                "cost": model_usage.cost,
                "requests": 1
            }
        }
        
        if model_usage.user_id:
            user_update = {
                "type": "user_activity",
                "date": date_str,
                "metrics": {
                    "activeUsers": 1,  # This will be merged with existing data
                    "sessions": 1 if model_usage.chat_id else 0
                }
            }
            await broadcast_user_update(user_update)
        
        # Broadcast updates
        await broadcast_dashboard_update(dashboard_update)
        await broadcast_dashboard_update(model_update)
        logger.log_message("Model usage updates broadcasted successfully", logging.INFO)
    except Exception as e:
        logger.log_message(f"Error processing model usage event: {str(e)}", logging.ERROR)
    finally:
        session.close()  # Ensure the session is closed after use

@router.get("/tiers/usage")
async def get_tier_usage(
    period: str = "30d",
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_admin_api_key)
):
    logger.log_message(f"Tier usage requested for period: {period}", logging.INFO)
    start_date, end_date = get_date_range(period)
    
    # Get all model usage during the period
    model_query = db.query(
        ModelUsage.model_name,
        func.sum(ModelUsage.total_tokens).label("tokens"),
        func.count().label("requests"),
        func.sum(ModelUsage.cost).label("cost"),
        func.avg(ModelUsage.total_tokens).label("avg_tokens_per_query")
    ).filter(
        ModelUsage.timestamp >= start_date,
        ModelUsage.timestamp <= end_date
    ).group_by(
        ModelUsage.model_name
    ).all()
    
    # Initialize tier data
    tier_data = {
        tier_id: {
            "name": tier_info["name"],
            "credits": tier_info["credits"],
            "total_tokens": 0,
            "total_requests": 0,
            "total_cost": 0.0,
            "avg_tokens_per_query": 0,
            "cost_per_1k_tokens": 0.0,
            "models": []
        }
        for tier_id, tier_info in MODEL_TIERS.items()
    }
    
    # Aggregate data by tier
    for model in model_query:
        tier_id = get_model_tier(model.model_name)
        
        # Add model to the appropriate tier
        tier_data[tier_id]["models"].append({
            "name": model.model_name,
            "tokens": int(model.tokens or 0),
            "requests": int(model.requests or 0),
            "cost": float(model.cost or 0),
            "avg_tokens_per_query": float(model.avg_tokens_per_query or 0)
        })
        
        # Update tier totals
        tier_data[tier_id]["total_tokens"] += int(model.tokens or 0)
        tier_data[tier_id]["total_requests"] += int(model.requests or 0)
        tier_data[tier_id]["total_cost"] += float(model.cost or 0)
    
    # Calculate averages and costs per 1k tokens for each tier
    for tier_id, data in tier_data.items():
        if data["total_requests"] > 0:
            data["avg_tokens_per_query"] = data["total_tokens"] / data["total_requests"]
        
        if data["total_tokens"] > 0:
            data["cost_per_1k_tokens"] = (data["total_cost"] / data["total_tokens"]) * 1000
            
        # Calculate credit cost (what the user is paying in credits)
        data["total_credit_cost"] = data["total_requests"] * data["credits"]
        
        # Calculate effective cost per credit
        if data["total_credit_cost"] > 0:
            data["cost_per_credit"] = data["total_cost"] / data["total_credit_cost"]
        else:
            data["cost_per_credit"] = 0
    
    logger.log_message(f"Retrieved tier usage data for {len(tier_data)} tiers", logging.INFO)
    return {
        "tier_data": tier_data,
        "period": period,
        "start_date": start_date.strftime('%Y-%m-%d'),
        "end_date": end_date.strftime('%Y-%m-%d')
    }

@router.get("/tiers/projections")
async def get_tier_projections(
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_admin_api_key)
):
    logger.log_message("Tier projections requested", logging.INFO)
    # Get last 30 days usage for baseline
    tier_usage = await get_tier_usage(period="30d", db=db, api_key=api_key)
    tier_data = tier_usage["tier_data"]
    
    # Calculate daily averages by tier
    daily_tier_usage = {
        tier_id: {
            "name": data["name"],
            "daily_requests": data["total_requests"] / 30,
            "daily_tokens": data["total_tokens"] / 30,
            "daily_cost": data["total_cost"] / 30,
            "daily_credits": data["total_credit_cost"] / 30
        }
        for tier_id, data in tier_data.items()
    }
    
    # Calculate projections
    projections = {
        "monthly": {
            "requests": {},
            "tokens": {},
            "cost": {},
            "credits": {}
        },
        "quarterly": {
            "requests": {},
            "tokens": {},
            "cost": {},
            "credits": {}
        },
        "yearly": {
            "requests": {},
            "tokens": {},
            "cost": {},
            "credits": {}
        }
    }
    
    # Calculate for each tier
    for tier_id, data in daily_tier_usage.items():
        # Monthly projections (30 days)
        projections["monthly"]["requests"][tier_id] = data["daily_requests"] * 30
        projections["monthly"]["tokens"][tier_id] = data["daily_tokens"] * 30
        projections["monthly"]["cost"][tier_id] = data["daily_cost"] * 30
        projections["monthly"]["credits"][tier_id] = data["daily_credits"] * 30
        
        # Quarterly projections (90 days)
        projections["quarterly"]["requests"][tier_id] = data["daily_requests"] * 90
        projections["quarterly"]["tokens"][tier_id] = data["daily_tokens"] * 90
        projections["quarterly"]["cost"][tier_id] = data["daily_cost"] * 90
        projections["quarterly"]["credits"][tier_id] = data["daily_credits"] * 90
        
        # Yearly projections (365 days)
        projections["yearly"]["requests"][tier_id] = data["daily_requests"] * 365
        projections["yearly"]["tokens"][tier_id] = data["daily_tokens"] * 365
        projections["yearly"]["cost"][tier_id] = data["daily_cost"] * 365
        projections["yearly"]["credits"][tier_id] = data["daily_credits"] * 365
    
    # Add totals for each projection period
    for period in ["monthly", "quarterly", "yearly"]:
        for metric in ["requests", "tokens", "cost", "credits"]:
            projections[period][f"total_{metric}"] = sum(projections[period][metric].values())
    
    logger.log_message(f"Tier projections calculated for {len(daily_tier_usage)} tiers", logging.INFO)
    return {
        "daily_usage": daily_tier_usage,
        "projections": projections,
        "tier_definitions": MODEL_TIERS
    }

@router.get("/tiers/efficiency")
async def get_tier_efficiency(
    period: str = "30d",
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_admin_api_key)
):
    logger.log_message(f"Tier efficiency requested for period: {period}", logging.INFO)
    # Get tier usage data
    tier_usage = await get_tier_usage(period=period, db=db, api_key=api_key)
    tier_data = tier_usage["tier_data"]
    
    # Calculate efficiency metrics
    efficiency_data = {}
    
    for tier_id, data in tier_data.items():
        tokens_per_credit = data["total_tokens"] / data["total_credit_cost"] if data["total_credit_cost"] > 0 else 0
        cost_per_credit = data["total_cost"] / data["total_credit_cost"] if data["total_credit_cost"] > 0 else 0
        
        efficiency_data[tier_id] = {
            "name": data["name"],
            "tokens_per_credit": tokens_per_credit,
            "cost_per_credit": cost_per_credit,
            "credit_cost": data["credits"],
            "cost_per_1k_tokens": data["cost_per_1k_tokens"],
            "avg_tokens_per_query": data["avg_tokens_per_query"],
            "total_requests": data["total_requests"],
            "total_tokens": data["total_tokens"],
            "total_cost": data["total_cost"]
        }
    
    # Determine most efficient tier based on tokens per credit
    most_efficient_tier = max(
        efficiency_data.items(),
        key=lambda x: x[1]["tokens_per_credit"] if x[1]["tokens_per_credit"] > 0 else 0,
        default=(None, {})
    )[0]
    
    # Determine best value tier based on cost per credit
    best_value_tier = min(
        efficiency_data.items(),
        key=lambda x: x[1]["cost_per_credit"] if x[1]["cost_per_credit"] > 0 else float('inf'),
        default=(None, {})
    )[0]
    
    logger.log_message(f"Tier efficiency calculated for {len(efficiency_data)} tiers", logging.INFO)
    return {
        "efficiency_data": efficiency_data,
        "most_efficient_tier": most_efficient_tier,
        "best_value_tier": best_value_tier,
        "period": period,
        "start_date": tier_usage["start_date"],
        "end_date": tier_usage["end_date"]
    }

@router.get("/code-executions/summary")
async def get_code_execution_summary(
    period: str = "30d",
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_admin_api_key)
):
    """
    Get a summary of code execution analytics including success rates, 
    common errors, and model performance.
    """
    logger.log_message(f"Code execution summary requested for period: {period}", logging.INFO)
    start_date, end_date = get_date_range(period)
    
    # Get overall code execution statistics
    overall_stats = db.query(
        func.count(CodeExecution.execution_id).label("total_executions"),
        func.sum(case((CodeExecution.is_successful == True, 1), else_=0)).label("successful_executions"),
        func.count(func.distinct(CodeExecution.user_id)).filter(CodeExecution.user_id.isnot(None)).label("total_users"),
        func.count(func.distinct(CodeExecution.chat_id)).filter(CodeExecution.chat_id.isnot(None)).label("total_chats")
    ).filter(
        CodeExecution.created_at.between(start_date, end_date)
    ).first()
    
    # Calculate success rate
    total_executions = overall_stats.total_executions or 0
    successful_executions = overall_stats.successful_executions or 0
    success_rate = (successful_executions / total_executions) if total_executions > 0 else 0
    
    # Get model performance stats
    model_stats = db.query(
        CodeExecution.model_name,
        func.count(CodeExecution.execution_id).label("total_executions"),
        func.sum(case((CodeExecution.is_successful == True, 1), else_=0)).label("successful_executions"),
        func.count(func.distinct(CodeExecution.user_id)).filter(CodeExecution.user_id.isnot(None)).label("user_count")
    ).filter(
        CodeExecution.created_at.between(start_date, end_date),
        CodeExecution.model_name.isnot(None)
    ).group_by(
        CodeExecution.model_name
    ).order_by(
        desc(func.count(CodeExecution.execution_id))
    ).all()
    
    # Process model stats
    model_performance = []
    for model in model_stats:
        model_executions = model.total_executions or 0
        model_success_rate = (model.successful_executions / model.total_executions) if model.total_executions > 0 else 0
        model_performance.append({
            "model_name": model.model_name,
            "total_executions": model_executions,
            "successful_executions": model.successful_executions or 0,
            "success_rate": model_success_rate,
            "user_count": model.user_count or 0
        })
    
    # Get failed agent statistics
    failed_agent_data = []
    failed_executions = db.query(CodeExecution).filter(
        CodeExecution.created_at.between(start_date, end_date),
        CodeExecution.is_successful == False,
        CodeExecution.failed_agents.isnot(None)
    ).all()
    
    # Count agent failures
    agent_failure_counts = {}
    for execution in failed_executions:
        try:
            if execution.failed_agents:
                failed_agents = json.loads(execution.failed_agents)
                for agent in failed_agents:
                    agent_failure_counts[agent] = agent_failure_counts.get(agent, 0) + 1
        except (json.JSONDecodeError, TypeError):
            logger.log_message(f"Error parsing failed_agents JSON: {execution.failed_agents}", logging.ERROR)
    
    # Convert to list for response
    failed_agent_data = [
        {"agent_name": agent, "failure_count": count}
        for agent, count in sorted(agent_failure_counts.items(), key=lambda x: x[1], reverse=True)
    ]
    
    # Return the compiled data
    result = {
        "period": period,
        "start_date": start_date.strftime('%Y-%m-%d'),
        "end_date": end_date.strftime('%Y-%m-%d'),
        "overall_stats": {
            "total_executions": total_executions,
            "successful_executions": successful_executions,
            "failed_executions": total_executions - successful_executions,
            "success_rate": success_rate,
            "total_users": overall_stats.total_users or 0,
            "total_chats": overall_stats.total_chats or 0
        },
        "model_performance": model_performance,
        "failed_agents": failed_agent_data
    }
    
    logger.log_message(f"Code execution summary retrieved with {total_executions} executions", logging.INFO)
    return result

@router.get("/code-executions/detailed")
async def get_detailed_code_executions(
    period: str = "30d",
    success_filter: Optional[bool] = None,
    user_id: Optional[int] = None,
    model_name: Optional[str] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_admin_api_key)
):
    """
    Get detailed information about individual code executions
    with filtering options.
    """
    logger.log_message(f"Detailed code executions requested for period: {period}", logging.INFO)
    start_date, end_date = get_date_range(period)
    
    # Build the query with filters
    query = db.query(CodeExecution).filter(
        CodeExecution.created_at.between(start_date, end_date)
    )
    
    # Apply optional filters
    if success_filter is not None:
        query = query.filter(CodeExecution.is_successful == success_filter)
    
    if user_id:
        query = query.filter(CodeExecution.user_id == user_id)
    
    if model_name:
        query = query.filter(CodeExecution.model_name == model_name)
    
    # Order by most recent first and limit results
    query = query.order_by(desc(CodeExecution.created_at)).limit(limit)
    
    # Execute query
    executions = query.all()
    
    # Process results
    detailed_executions = []
    for execution in executions:
        # Parse failed agents and error messages if available
        failed_agents_list = []
        error_messages_dict = {}
        
        try:
            if execution.failed_agents:
                failed_agents_list = json.loads(execution.failed_agents)
            
            if execution.error_messages:
                error_messages_dict = json.loads(execution.error_messages)
        except (json.JSONDecodeError, TypeError):
            logger.log_message(f"Error parsing JSON data for execution {execution.execution_id}", logging.ERROR)
        
        # Format the execution data
        detailed_executions.append({
            "execution_id": execution.execution_id,
            "message_id": execution.message_id,
            "chat_id": execution.chat_id,
            "user_id": execution.user_id,
            "created_at": execution.created_at.isoformat(),
            "updated_at": execution.updated_at.isoformat() if execution.updated_at else None,
            "is_successful": execution.is_successful,
            "model_info": {
                "provider": execution.model_provider,
                "name": execution.model_name,
                "temperature": execution.model_temperature,
                "max_tokens": execution.model_max_tokens
            },
            "failed_agents": failed_agents_list,
            "error_messages": error_messages_dict,
            # Include trimmed code snippets
            "initial_code_preview": execution.initial_code[:500] + "..." if execution.initial_code and len(execution.initial_code) > 500 else execution.initial_code,
            "latest_code_preview": execution.latest_code[:500] + "..." if execution.latest_code and len(execution.latest_code) > 500 else execution.latest_code,
        })
    
    logger.log_message(f"Retrieved {len(detailed_executions)} detailed code executions", logging.INFO)
    return {
        "period": period,
        "start_date": start_date.strftime('%Y-%m-%d'),
        "end_date": end_date.strftime('%Y-%m-%d'),
        "count": len(detailed_executions),
        "executions": detailed_executions
    }

@router.get("/code-executions/users")
async def get_user_code_execution_stats(
    period: str = "30d",
    limit: int = 50,
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_admin_api_key)
):
    """
    Get statistics about code executions grouped by user
    """
    logger.log_message(f"User code execution stats requested for period: {period}", logging.INFO)
    start_date, end_date = get_date_range(period)
    
    # Get user statistics for code executions
    user_stats = db.query(
        CodeExecution.user_id,
        func.count(CodeExecution.execution_id).label("total_executions"),
        func.sum(case((CodeExecution.is_successful == True, 1), else_=0)).label("successful_executions"),
        func.min(CodeExecution.created_at).label("first_execution"),
        func.max(CodeExecution.created_at).label("latest_execution")
    ).filter(
        CodeExecution.created_at.between(start_date, end_date),
        CodeExecution.user_id.isnot(None)
    ).group_by(
        CodeExecution.user_id
    ).order_by(
        desc(func.count(CodeExecution.execution_id))
    ).limit(limit).all()
    
    # Process user statistics
    users_data = []
    for user in user_stats:
        success_rate = (user.successful_executions / user.total_executions) if user.total_executions > 0 else 0
        users_data.append({
            "user_id": user.user_id,
            "total_executions": user.total_executions,
            "successful_executions": user.successful_executions,
            "failed_executions": user.total_executions - user.successful_executions,
            "success_rate": success_rate,
            "first_execution": user.first_execution.isoformat() if user.first_execution else None,
            "latest_execution": user.latest_execution.isoformat() if user.latest_execution else None
        })
    
    logger.log_message(f"Retrieved code execution stats for {len(users_data)} users", logging.INFO)
    return {
        "period": period,
        "start_date": start_date.strftime('%Y-%m-%d'),
        "end_date": end_date.strftime('%Y-%m-%d'),
        "users": users_data
    }

@router.get("/code-executions/error-analysis")
async def get_error_analysis(
    period: str = "30d",
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_admin_api_key)
):
    """
    Analyze common error patterns in failed code executions
    """
    logger.log_message(f"Code execution error analysis requested for period: {period}", logging.INFO)
    start_date, end_date = get_date_range(period)
    
    # Get failed executions
    failed_executions = db.query(CodeExecution).filter(
        CodeExecution.created_at.between(start_date, end_date),
        CodeExecution.is_successful == False,
        CodeExecution.error_messages.isnot(None)
    ).all()
    
    # Analyze error messages and categorize them
    error_types = {}
    error_by_agent = {}
    
    for execution in failed_executions:
        try:
            if execution.error_messages:
                error_messages = json.loads(execution.error_messages)
                for agent, error in error_messages.items():
                    # Add to agent-specific counts
                    if agent not in error_by_agent:
                        error_by_agent[agent] = {
                            "count": 0,
                            "common_errors": {}
                        }
                    error_by_agent[agent]["count"] += 1
                    
                    # Categorize the error
                    error_category = categorize_error(error)
                    error_by_agent[agent]["common_errors"][error_category] = error_by_agent[agent]["common_errors"].get(error_category, 0) + 1
                    
                    # Add to overall error type counts
                    error_types[error_category] = error_types.get(error_category, 0) + 1
        except (json.JSONDecodeError, TypeError):
            logger.log_message(f"Error parsing error_messages JSON: {execution.error_messages}", logging.ERROR)
    
    # Convert to lists for response
    error_types_list = [
        {"error_type": error_type, "count": count}
        for error_type, count in sorted(error_types.items(), key=lambda x: x[1], reverse=True)
    ]
    
    error_by_agent_list = [
        {
            "agent_name": agent,
            "error_count": data["count"],
            "common_errors": [
                {"error_type": error_type, "count": count}
                for error_type, count in sorted(data["common_errors"].items(), key=lambda x: x[1], reverse=True)
            ]
        }
        for agent, data in sorted(error_by_agent.items(), key=lambda x: x[1]["count"], reverse=True)
    ]
    
    logger.log_message(f"Analyzed errors from {len(failed_executions)} failed executions", logging.INFO)
    return {
        "period": period,
        "start_date": start_date.strftime('%Y-%m-%d'),
        "end_date": end_date.strftime('%Y-%m-%d'),
        "total_failed_executions": len(failed_executions),
        "error_types": error_types_list,
        "error_by_agent": error_by_agent_list
    }

# Helper function to categorize error messages
def categorize_error(error_message):
    """
    Categorize an error message into common types
    """
    error_message = str(error_message).lower()
    
    if "nameerror" in error_message or "name '" in error_message:
        return "NameError"
    elif "syntaxerror" in error_message:
        return "SyntaxError"
    elif "typeerror" in error_message:
        return "TypeError"
    elif "attributeerror" in error_message:
        return "AttributeError"
    elif "indexerror" in error_message or "keyerror" in error_message:
        return "IndexError/KeyError"
    elif "importerror" in error_message or "modulenotfounderror" in error_message:
        return "ImportError"
    elif "valueerror" in error_message:
        return "ValueError"
    elif "unsupported operand" in error_message:
        return "OperationError"
    elif "indent" in error_message:
        return "IndentationError"
    elif "permission" in error_message:
        return "PermissionError"
    elif "filenotfound" in error_message:
        return "FileNotFoundError"
    elif "memory" in error_message:
        return "MemoryError"
    elif "timeout" in error_message or "timed out" in error_message:
        return "TimeoutError"
    else:
        return "OtherError"

@router.get("/feedback/summary")
async def get_feedback_summary(
    period: str = "30d",
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_admin_api_key)
):
    """
    Get summary statistics about user feedback ratings.
    """
    logger.log_message(f"Feedback summary requested for period: {period}", logging.INFO)
    start_date, end_date = get_date_range(period)
    
    # Get overall feedback statistics
    overall_stats = db.query(
        func.count().label("total_feedback"),
        func.avg(MessageFeedback.rating).label("avg_rating"),
        func.count(func.distinct(Message.chat_id)).label("chats_with_feedback")
    ).join(
        Message, MessageFeedback.message_id == Message.message_id
    ).filter(
        MessageFeedback.created_at.between(start_date, end_date),
        MessageFeedback.rating.isnot(None)
    ).first()

    # Get feedback counts by rating
    rating_counts = db.query(
        MessageFeedback.rating,
        func.count().label("count")
    ).filter(
        MessageFeedback.created_at.between(start_date, end_date),
        MessageFeedback.rating.isnot(None)
    ).group_by(
        MessageFeedback.rating
    ).all()
    
    # Convert to dictionary for easier access
    ratings_dict = {rating.rating: rating.count for rating in rating_counts}
    
    # Ensure all ratings (1-5) are represented
    ratings_distribution = [
        {"rating": i, "count": ratings_dict.get(i, 0)} 
        for i in range(1, 6)
    ]
    
    # Get feedback by model
    model_feedback = db.query(
        MessageFeedback.model_name,
        func.count().label("total_feedback"),
        func.avg(MessageFeedback.rating).label("avg_rating")
    ).filter(
        MessageFeedback.created_at.between(start_date, end_date),
        MessageFeedback.rating.isnot(None),
        MessageFeedback.model_name.isnot(None)
    ).group_by(
        MessageFeedback.model_name
    ).order_by(
        desc(func.avg(MessageFeedback.rating))
    ).all()
    
    # Process model feedback
    models_data = [
        {
            "model_name": model.model_name,
            "total_feedback": model.total_feedback,
            "avg_rating": float(model.avg_rating) if model.avg_rating else 0
        }
        for model in model_feedback
    ]
    
    # Get feedback trend over time
    daily_feedback = db.query(
        func.date(MessageFeedback.created_at).label("date"),
        func.avg(MessageFeedback.rating).label("avg_rating"),
        func.count().label("count")
    ).filter(
        MessageFeedback.created_at.between(start_date, end_date),
        MessageFeedback.rating.isnot(None)
    ).group_by(
        func.date(MessageFeedback.created_at)
    ).order_by(
        func.date(MessageFeedback.created_at)
    ).all()
    
    # Process daily feedback
    feedback_trend = [
        {
            "date": str(day.date),
            "avg_rating": float(day.avg_rating) if day.avg_rating else 0,
            "count": day.count
        }
        for day in daily_feedback
    ]
    
    # Fill in any missing dates with null values
    date_range = [(start_date + timedelta(days=i)).strftime('%Y-%m-%d') 
                 for i in range((end_date - start_date).days + 1)]
    
    feedback_dict = {item["date"]: item for item in feedback_trend}
    
    filled_trend = []
    for date in date_range:
        if date in feedback_dict:
            filled_trend.append(feedback_dict[date])
        else:
            filled_trend.append({
                "date": date,
                "avg_rating": None,
                "count": 0
            })
    
    logger.log_message(f"Feedback summary retrieved with {overall_stats.total_feedback or 0} ratings", logging.INFO)
    return {
        "period": period,
        "start_date": start_date.strftime('%Y-%m-%d'),
        "end_date": end_date.strftime('%Y-%m-%d'),
        "total_feedback": overall_stats.total_feedback or 0,
        "avg_rating": float(overall_stats.avg_rating) if overall_stats.avg_rating else 0,
        "chats_with_feedback": overall_stats.chats_with_feedback or 0,
        "ratings_distribution": ratings_distribution,
        "models_data": models_data,
        "feedback_trend": filled_trend
    }

@router.get("/feedback/detailed")
async def get_detailed_feedback(
    period: str = "30d",
    min_rating: Optional[int] = None,
    max_rating: Optional[int] = None,
    model_name: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_admin_api_key)
):
    """
    Get detailed feedback records with filtering options
    """
    logger.log_message(f"Detailed feedback requested for period: {period}", logging.INFO)
    start_date, end_date = get_date_range(period)
    
    # Build query with joins to get message content
    query = db.query(
        MessageFeedback,
        Message.content.label("message_content"),
        Message.sender.label("message_sender"),
        Message.chat_id.label("chat_id")
    ).join(
        Message, MessageFeedback.message_id == Message.message_id
    ).filter(
        MessageFeedback.created_at.between(start_date, end_date),
        MessageFeedback.rating.isnot(None)
    )
    
    # Apply optional filters
    if min_rating is not None:
        query = query.filter(MessageFeedback.rating >= min_rating)
    
    if max_rating is not None:
        query = query.filter(MessageFeedback.rating <= max_rating)
    
    if model_name:
        query = query.filter(MessageFeedback.model_name == model_name)
    
    # Get count for pagination before adding limit/offset
    total_count = query.count()
    
    # Apply pagination
    query = query.order_by(desc(MessageFeedback.created_at)).offset(offset).limit(limit)
    
    # Execute query
    results = query.all()
    
    # Process results
    detailed_feedback = []
    for result in results:
        feedback = result.MessageFeedback
        
        detailed_feedback.append({
            "feedback_id": feedback.feedback_id,
            "message_id": feedback.message_id,
            "chat_id": result.chat_id,
            "rating": feedback.rating,
            "model_name": feedback.model_name,
            "model_provider": feedback.model_provider,
            "temperature": feedback.temperature,
            "max_tokens": feedback.max_tokens,
            "created_at": feedback.created_at.isoformat() if feedback.created_at else None,
            "message_preview": result.message_content[:200] + "..." if len(result.message_content) > 200 else result.message_content,
            "message_sender": result.message_sender
        })
    
    logger.log_message(f"Retrieved {len(detailed_feedback)} detailed feedback records", logging.INFO)
    return {
        "period": period,
        "start_date": start_date.strftime('%Y-%m-%d'),
        "end_date": end_date.strftime('%Y-%m-%d'),
        "total": total_count,
        "count": len(detailed_feedback),
        "offset": offset,
        "limit": limit,
        "feedback": detailed_feedback
    }