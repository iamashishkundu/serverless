import { Router } from "./src/router.mjs";
import { adminService } from "./src/services/adminService.mjs";

const router = new Router();

// =============================================================
// Admin CRUD v2 Endpoints (7 routes)
// =============================================================

// 1. POST /admin/auth/login - Admin Login
router.post("/admin/auth/login", (req) => adminService.login(req.body));

// 2. GET /admin/users - Users List (Pagination + Search)
router.get("/admin/users", (req) => adminService.listUsers(req.query), {
  authRequired: true,
  role: "admin",
});

// 3. GET /admin/users/:id - Single User Detail
router.get("/admin/users/:id", (req) => adminService.getUser(req.params.id), {
  authRequired: true,
  role: "admin",
});

// 4. POST /admin/users - Admin Creates User
router.post("/admin/users", (req) => adminService.createUser(req.body), {
  authRequired: true,
  role: "admin",
});

// 5. PATCH /admin/users/:id - Admin Updates User
router.patch("/admin/users/:id", (req) => adminService.updateUser(req.params.id, req.body), {
  authRequired: true,
  role: "admin",
});

// 6. PATCH /admin/users/:id/status - Block / Unblock User
router.patch("/admin/users/:id/status", (req) => adminService.updateUserStatus(req.params.id, req.body), {
  authRequired: true,
  role: "admin",
});

// 7. DELETE /admin/users/:id - Soft Delete User
router.delete("/admin/users/:id", (req) => adminService.deleteUser(req.params.id), {
  authRequired: true,
  role: "admin",
});

// =============================================================
// AWS Lambda Handler Entrypoint with Top-Level Error Safety
// =============================================================
export const handler = async (event) => {
  try {
    return await router.dispatch(event);
  } catch (fatalError) {
    console.error("FATAL ADMIN SERVICE ERROR:", fatalError);
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
