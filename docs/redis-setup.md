# Redis (Upstash) Schema for Subscription Management  

This project uses **Redis (Upstash)** to store user subscription data, credits, and related metadata. The data is stored using **hash-based storage** for efficient retrieval.

## **Key Structure**  

The Redis keys follow a structured naming convention for organization:

- **User Subscription Data:** `user:{userId}:subscription`
- **User Credit Data:** `user:{userId}:credits`
- **User Profile Data:** `user:{userId}:profile`
---

## 📌 **Schema Details**  

### **1️⃣ User Subscription Data**  
Stored as a **hash** at `user:{userId}:subscription`  

| Field Name             | Type   | Description |
|------------------------|--------|-------------|
| `planType`            | String | Subscription tier (`FREE`, `STANDARD`, `PRO`) |
| `amount`              | String | Price of the subscription (e.g., `"15"`, `"29"`) |
| `purchaseDate`        | String | ISO date when the subscription was purchased |
| `interval`            | String | Billing cycle (`month` or `year`) |
| `status`              | String | Subscription status (`active`, `inactive`) |
| `renewalDate`         | String | ISO date for the next renewal |
| `stripeCustomerId`    | String | Stripe customer ID (if applicable) |
| `stripeSubscriptionId`| String | Stripe subscription ID (if applicable) |
| `nextMonthlyReset`    | String | (For yearly plans) Next monthly credit reset date |

✅ **Example Data:**  
```
HGETALL user:12345:subscription
{
  "planType": "PRO",
  "amount": "29",
  "purchaseDate": "2025-03-01T12:00:00Z",
  "interval": "month",
  "status": "active",
  "renewalDate": "2025-04-01",
  "stripeCustomerId": "cus_abc123",
  "stripeSubscriptionId": "sub_xyz789"
}
```

---

### **2️⃣ User Credit Data**  
Stored as a **hash** at `user:{userId}:credits`  

| Field Name   | Type   | Description |
|-------------|--------|-------------|
| `used`      | String | Number of credits used |
| `total`     | String | Total credits available |
| `resetDate` | String | Next credit reset date (ISO format) |
| `lastUpdate` | String | Last update timestamp (ISO format) |

✅ **Example Data:**  
```
HGETALL user:12345:credits
{
  "used": "150",
  "total": "500",
  "resetDate": "2025-04-01",
  "lastUpdate": "2025-03-20T14:30:00Z"
}
```

### **3️⃣ User Profile Data**  
Stored as a **hash** at `user:{userId}:profile`  

| Field Name   | Type   | Description |
|-------------|--------|-------------|
| `email`      | String | User's email address |
| `name`      | String | User's name |
| `image`      | String | User's image |
| `joinedDate`      | String | User's joined date |
| `role`      | String | User's role |



✅ **Example Data:**  
```
HGETALL user:12345:profile
{
  "email": "user@example.com",
  "name": "John Doe",
  "image": "https://example.com/image.jpg",
  "joinedDate": "2025-03-01",
  "role": "PRO"
}
```

---

## 🛠 **Operations Performed in API**  

1. **Fetching User Subscription Data:**  
   - Retrieves subscription details from `user:{userId}:subscription`  
   - Determines the **plan type** (`FREE`, `STANDARD`, `PRO`)  
   - Calculates **renewal date** based on `purchaseDate` & `interval`  
   - Manages **monthly resets** for yearly subscriptions  

2. **Fetching User Credits:**  
   - Retrieves credit usage from `user:{userId}:credits`  
   - Resets monthly credits if applicable  
   - Ensures correct handling of **yearly plans**  

3. **Handling Yearly Subscriptions:**  
   - Adds `nextMonthlyReset` for yearly plans  
   - Ensures credits reset monthly even in yearly billing cycles  

---

## **How to Access Data in Redis (Upstash)**  

Run the following commands to manually check data in Redis:

🔹 **Check Subscription Data for a User**  
```sh
HGETALL user:12345:subscription
```

🔹 **Check Credit Data for a User**  
```sh
HGETALL user:12345:credits
```

🔹 **Update Subscription Plan**  
```sh
HSET user:12345:subscription planType "STANDARD"
```

🔹 **Reset User Credits**  
```sh
HSET user:12345:credits used "0" total "500"
```

🔹 **Update User Profile**  
```sh
HSET user:12345:profile name "John Doe"
```

🔹 **Delete User Profile**  
```sh
DEL user:12345:profile
```

🔹 **Delete User Subscription**  
```sh
DEL user:12345:subscription
```

🔹 **Delete User Credits**  
```sh
DEL user:12345:credits
```

