import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ConflictError,
} from "../errors.mjs";
import { hashPassword, comparePassword, generateToken } from "../utils/auth.mjs";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const USERS_TABLE = process.env.USERS_TABLE || "Day2_Users";

// Admin credentials configured directly via Environment Variables
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "day2admin@example.com").trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Day2Admin@123";
const ADMIN_NAME = process.env.ADMIN_NAME || "Day-2 Administrator";
const ADMIN_DEPARTMENT = process.env.ADMIN_DEPARTMENT || "Cloud & DevOps Engineering";

const sanitize = (entity) => {
  if (!entity) return null;
  const { passwordHash, password, ...safe } = entity;
  return safe;
};

export class AdminService {
  /**
   * 1. POST /admin/auth/login - Admin Login (Credentials verified against Environment Variables)
   */
  async login(body = {}) {
    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";

    if (!email || !password) {
      throw new ValidationError("'email' and 'password' are required");
    }

    // Direct verification against environment variables
    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      throw new UnauthorizedError("Invalid admin credentials");
    }

    const token = generateToken({
      id: "admin-system",
      email: ADMIN_EMAIL,
      role: "admin", // Enforced admin role in JWT
    });

    return {
      statusCode: 200,
      message: "Admin login successful",
      data: {
        token,
        admin: {
          id: "admin-system",
          name: ADMIN_NAME,
          email: ADMIN_EMAIL,
          role: "admin",
          department: ADMIN_DEPARTMENT,
        },
      },
    };
  }

  /**
   * 2. GET /admin/users?page=1&limit=10&search= - List Users (Pagination + Search)
   */
  async listUsers(query = {}) {
    const result = await docClient.send(
      new ScanCommand({
        TableName: USERS_TABLE,
      })
    );

    let users = result.Items || [];

    // Filter out soft-deleted unless explicitly requested
    if (query.include_deleted !== "true") {
      users = users.filter((u) => !u.is_deleted);
    }

    // Search filter (name or email)
    const search = (query.search || "").trim().toLowerCase();
    if (search) {
      users = users.filter(
        (u) =>
          (u.name && u.name.toLowerCase().includes(search)) ||
          (u.email && u.email.toLowerCase().includes(search))
      );
    }

    // Sort by createdAt descending
    users.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    // Pagination
    const page = Math.max(1, parseInt(query.page || "1", 10));
    const limit = Math.max(1, Math.min(100, parseInt(query.limit || "10", 10)));
    const total = users.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const paginated = users.slice(startIndex, startIndex + limit);

    return {
      statusCode: 200,
      message: "Users fetched successfully",
      data: {
        users: paginated.map(sanitize),
        pagination: {
          total,
          page,
          limit,
          totalPages,
        },
      },
    };
  }

  /**
   * 3. GET /admin/users/:id - Single User Detail
   */
  async getUser(id) {
    if (!id) {
      throw new ValidationError("User ID is required");
    }

    const result = await docClient.send(
      new GetCommand({
        TableName: USERS_TABLE,
        Key: { id },
      })
    );

    if (!result.Item) {
      throw new NotFoundError(`User with id '${id}' not found`);
    }

    return {
      statusCode: 200,
      message: "User detail fetched successfully",
      data: sanitize(result.Item),
    };
  }

  /**
   * 4. POST /admin/users - Admin Creates User
   */
  async createUser(body = {}) {
    const name = (body.name || "").trim();
    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";
    const phone = body.phone ? body.phone.trim() : null;

    if (!name || !email || !password) {
      throw new ValidationError("'name', 'email', and 'password' are required fields");
    }

    if (password.length < 6) {
      throw new ValidationError("Password must be at least 6 characters long");
    }

    // Check email uniqueness
    const existing = await docClient.send(
      new ScanCommand({
        TableName: USERS_TABLE,
        FilterExpression: "email = :email AND is_deleted <> :delTrue",
        ExpressionAttributeValues: { ":email": email, ":delTrue": true },
      })
    );

    if (existing.Items && existing.Items.length > 0) {
      throw new ConflictError(`Email '${email}' is already registered`);
    }

    const now = new Date().toISOString();
    const passwordHash = await hashPassword(password);

    const user = {
      id: randomUUID(),
      name,
      email,
      phone,
      passwordHash,
      role: body.role || "user",
      status: body.status || "active",
      is_deleted: false,
      createdAt: now,
      updatedAt: now,
    };

    await docClient.send(
      new PutCommand({
        TableName: USERS_TABLE,
        Item: user,
      })
    );

    return {
      statusCode: 201,
      message: "User created successfully by admin",
      data: sanitize(user),
    };
  }

  /**
   * 5. PATCH /admin/users/:id - Admin Updates User
   */
  async updateUser(id, body = {}) {
    if (!id) {
      throw new ValidationError("User ID is required");
    }

    // Check user exists
    await this.getUser(id);

    // If updating email, verify uniqueness
    if (body.email) {
      const email = body.email.trim().toLowerCase();
      const existing = await docClient.send(
        new ScanCommand({
          TableName: USERS_TABLE,
          FilterExpression: "email = :email AND id <> :id AND is_deleted <> :delTrue",
          ExpressionAttributeValues: { ":email": email, ":id": id, ":delTrue": true },
        })
      );

      if (existing.Items && existing.Items.length > 0) {
        throw new ConflictError(`Email '${email}' is already in use by another user`);
      }
    }

    const allowed = ["name", "email", "phone", "role", "department", "bio"];
    const updates = [];
    const names = {};
    const values = {};

    for (const key of allowed) {
      if (body[key] !== undefined) {
        updates.push(`#${key} = :${key}`);
        names[`#${key}`] = key;
        values[`:${key}`] = typeof body[key] === "string" ? body[key].trim() : body[key];
      }
    }

    if (updates.length === 0) {
      throw new ValidationError("At least one editable field must be provided");
    }

    const result = await docClient.send(
      new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { id },
        UpdateExpression: `SET ${updates.join(", ")}, #updatedAt = :updatedAt`,
        ExpressionAttributeNames: { ...names, "#updatedAt": "updatedAt" },
        ExpressionAttributeValues: { ...values, ":updatedAt": new Date().toISOString() },
        ReturnValues: "ALL_NEW",
      })
    );

    return {
      statusCode: 200,
      message: "User updated successfully",
      data: sanitize(result.Attributes),
    };
  }

  /**
   * 6. PATCH /admin/users/:id/status - Block / Unblock User
   */
  async updateUserStatus(id, body = {}) {
    if (!id) {
      throw new ValidationError("User ID is required");
    }

    const status = (body.status || "").trim().toLowerCase();
    if (status !== "active" && status !== "blocked") {
      throw new ValidationError("Field 'status' must be either 'active' or 'blocked'");
    }

    // Check user exists
    await this.getUser(id);

    const now = new Date().toISOString();
    const result = await docClient.send(
      new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { id },
        UpdateExpression: "SET #status = :status, #updatedAt = :now",
        ExpressionAttributeNames: { "#status": "status", "#updatedAt": "updatedAt" },
        ExpressionAttributeValues: { ":status": status, ":now": now },
        ReturnValues: "ALL_NEW",
      })
    );

    return {
      statusCode: 200,
      message: `User status updated to '${status}' successfully`,
      data: sanitize(result.Attributes),
    };
  }

  /**
   * 7. DELETE /admin/users/:id - Soft Delete User
   */
  async deleteUser(id) {
    if (!id) {
      throw new ValidationError("User ID is required");
    }

    // Check user exists
    await this.getUser(id);

    const now = new Date().toISOString();
    await docClient.send(
      new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { id },
        UpdateExpression: "SET is_deleted = :delTrue, deleted_at = :now, #status = :deleted, #updatedAt = :now",
        ExpressionAttributeNames: { "#status": "status", "#updatedAt": "updatedAt" },
        ExpressionAttributeValues: {
          ":delTrue": true,
          ":deleted": "deleted",
          ":now": now,
        },
      })
    );

    return {
      statusCode: 200,
      message: `User with id '${id}' soft-deleted successfully`,
      data: { id, is_deleted: true },
    };
  }
}

export const adminService = new AdminService();
