# Day-2: AWS Serverless User & Admin CRUD APIs

Fully isolated, production-grade serverless microservices running on **AWS Lambda (Node.js 20.x)**, **Amazon DynamoDB (Pay-Per-Request)**, and **Amazon API Gateway (HTTP API v2)** using the **Serverless Framework**.

---

## 📁 Project Structure

```
Day-2/
├── .env.example              # Environment variables template
├── README.md                 # Project architecture and reference guide
│
├── UserCrud/                 # Dedicated User Service (Stack: day2-serverless-api)
│   ├── index.mjs             # Lambda handler (index.handler)
│   ├── serverless.yml        # User service Serverless Framework config
│   ├── package.json          # Deployment scripts & dependencies
│   ├── src/
│   │   ├── errors.mjs        # Standardized HttpError classes
│   │   ├── router.mjs        # HTTP API router (with Base64 payload decoding)
│   │   ├── services/
│   │   │   └── userService.mjs # User CRUD logic with DynamoDB DocumentClient
│   │   └── utils/
│   │       ├── auth.mjs      # Lambda layer-aware bcryptjs & jwt authentication
│   │       └── response.mjs  # Standard response builder: { success, message, data }
│   ├── bcryptjs-layer/       # Dedicated bcryptjs Lambda layer package
│   ├── jsonwebtoken-layer/   # Dedicated jsonwebtoken Lambda layer package
│   └── Day2_User_API.postman_collection.json # 6 User CRUD automated Postman tests
│
└── AdminCrud/                # Dedicated Admin Service (Stack: day2-admin-api)
    ├── index.mjs             # Lambda handler (index.handler)
    ├── serverless.yml        # Admin service Serverless Framework config
    ├── package.json          # Deployment scripts & dependencies
    ├── src/
    │   ├── errors.mjs        # Standardized HttpError classes
    │   ├── router.mjs        # HTTP API router (with Base64 payload decoding)
    │   ├── services/
    │   │   └── adminService.mjs # Admin CRUD logic (List, Get, Create, Update, Block, Soft-delete)
    │   └── utils/
    │       ├── auth.mjs      # Lambda layer-aware bcryptjs & jwt authentication
    │       └── response.mjs  # Standard response builder: { success, message, data }
    ├── bcryptjs-layer/       # Dedicated bcryptjs Lambda layer package
    ├── jsonwebtoken-layer/   # Dedicated jsonwebtoken Lambda layer package
    └── Day2_Admin_API.postman_collection.json # 7 Admin CRUD automated Postman tests
```

---

## 🚀 Deployment Commands

### 1. User CRUD Service
```powershell
cd "C:\Users\gamer kumar\Downloads\AWS\Day-2\UserCrud"
npm run deploy
```

### 2. Admin CRUD Service
```powershell
cd "C:\Users\gamer kumar\Downloads\AWS\Day-2\AdminCrud"
npm run deploy
```

---

## 📡 API Endpoints Summary

### User Service (6 Endpoints)
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/auth/register` | Register new user account | No |
| `POST` | `/auth/login` | Login and receive user JWT | No |
| `GET` | `/users/me` | Retrieve own profile | Yes (`Bearer <token>`, role: user) |
| `PATCH` | `/users/me` | Update name, phone, bio | Yes (`Bearer <token>`, role: user) |
| `PATCH` | `/users/me/change-password` | Change account password | Yes (`Bearer <token>`, role: user) |
| `DELETE` | `/users/me` | Soft delete own account (`is_deleted: true`) | Yes (`Bearer <token>`, role: user) |

### Admin Service (7 Endpoints)
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/admin/auth/login` | Admin login with environment credentials | No |
| `GET` | `/admin/users` | List users with pagination and search | Yes (`Bearer <token>`, role: admin) |
| `GET` | `/admin/users/{id}` | Get single user details by ID | Yes (`Bearer <token>`, role: admin) |
| `POST` | `/admin/users` | Create user directly as administrator | Yes (`Bearer <token>`, role: admin) |
| `PATCH` | `/admin/users/{id}` | Update any user profile | Yes (`Bearer <token>`, role: admin) |
| `PATCH` | `/admin/users/{id}/status` | Block or unblock a user account | Yes (`Bearer <token>`, role: admin) |
| `DELETE` | `/admin/users/{id}` | Soft delete a user account (`is_deleted: true`) | Yes (`Bearer <token>`, role: admin) |

---

## 🔒 Security & Standards
- **Standardized Response Format**: Every request returns `{ "success": boolean, "message": string, "data": object | null }`.
- **Soft Deletion**: All delete operations toggle `is_deleted: true` with a `deleted_at` timestamp. User data is never purged.
- **Layers**: `bcryptjs` and `jsonwebtoken` stay isolated in Lambda Layers (`/opt/nodejs/node_modules`), keeping deployment packages minimal (< 10 KB).
- **Password Safety**: Passwords hashed with bcrypt (salt rounds: 10), never logged or returned in responses.
