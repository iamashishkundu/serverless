import { Router } from "./src/router.mjs";
import { userService } from "./src/services/userService.mjs";

const router = new Router();

// =============================================================
// User CRUD v2 Endpoints (6 routes)
// =============================================================

// 1. POST /auth/register - Signup
router.post("/auth/register", (req) => userService.register(req.body));

// 2. POST /auth/login - Login & JWT
router.post("/auth/login", (req) => userService.login(req.body));

// 3. GET /users/me - View Profile
router.get("/users/me", (req) => userService.getProfile(req.user.id), {
  authRequired: true,
  role: "user",
});

// 4. PATCH /users/me - Update Profile
router.patch("/users/me", (req) => userService.updateProfile(req.user.id, req.body), {
  authRequired: true,
  role: "user",
});

// 5. PATCH /users/me/change-password - Change Password
router.patch("/users/me/change-password", (req) => userService.changePassword(req.user.id, req.body), {
  authRequired: true,
  role: "user",
});

// 6. DELETE /users/me - Soft Delete Account
router.delete("/users/me", (req) => userService.deleteAccount(req.user.id), {
  authRequired: true,
  role: "user",
});

// =============================================================
// AWS Lambda Handler Entrypoint with Top-Level Error Safety
// =============================================================
export const handler = async (event) => {
  try {
    return await router.dispatch(event);
  } catch (fatalError) {
    console.error("FATAL USER SERVICE ERROR:", fatalError);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        success: false,
        message: fatalError.message || "Fatal Server Error",
        data: null,
      }),
    };
  }
};
