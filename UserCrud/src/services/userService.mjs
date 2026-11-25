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
  ForbiddenError,
  ConflictError,
} from "../errors.mjs";
import { hashPassword, comparePassword, generateToken } from "../utils/auth.mjs";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});
const TABLE_NAME = process.env.USERS_TABLE || "Day2_Users";

const sanitizeUser = (user) => {
  if (!user) return null;
  const { passwordHash, password, ...safeUser } = user;
  return safeUser;
};

export class UserService {
  /**
   * 1. POST /auth/register - User Signup
   */
  async register(body = {}) {
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

    // Check email uniqueness (excluding soft-deleted accounts)
    const existing = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
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
      role: "user", // Enforced user role
      status: "active",
      is_deleted: false,
      createdAt: now,
      updatedAt: now,
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: user,
      })
    );

    return {
      statusCode: 201,
      message: "User registered successfully",
      data: sanitizeUser(user),
    };
  }

  /**
   * 2. POST /auth/login - User Login & JWT Token
   */
  async login(body = {}) {
    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";

    if (!email || !password) {
      throw new ValidationError("'email' and 'password' are required");
    }

    // Find active user by email
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "email = :email AND is_deleted <> :delTrue",
        ExpressionAttributeValues: { ":email": email, ":delTrue": true },
      })
    );

    const user = result.Items?.[0];
    if (!user) {
      throw new UnauthorizedError("Invalid email or password");
    }

    if (user.status === "blocked") {
      throw new ForbiddenError("Your account has been blocked. Please contact support.");
    }

    const isMatch = await comparePassword(password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedError("Invalid email or password");
    }

    const token = generateToken({
      id: user.id,
      email: user.email,
      role: "user",
    });

    return {
      statusCode: 200,
      message: "Login successful",
      data: {
        token,
        user: sanitizeUser(user),
      },
    };
  }

  /**
   * 3. GET /users/me - View Profile
   */
  async getProfile(userId) {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { id: userId },
      })
    );

    const user = result.Item;
    if (!user || user.is_deleted) {
      throw new NotFoundError("User profile not found");
    }

    return {
      statusCode: 200,
      message: "Profile retrieved successfully",
      data: sanitizeUser(user),
    };
  }

  /**
   * 4. PATCH /users/me - Update Profile
   */
  async updateProfile(userId, body = {}) {
    // Check user exists and is active
    await this.getProfile(userId);

    const allowed = ["name", "phone", "bio"];
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
      throw new ValidationError("At least one editable field ('name', 'phone', 'bio') must be provided");
    }

    const result = await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id: userId },
        UpdateExpression: `SET ${updates.join(", ")}, #updatedAt = :updatedAt`,
        ExpressionAttributeNames: { ...names, "#updatedAt": "updatedAt" },
        ExpressionAttributeValues: { ...values, ":updatedAt": new Date().toISOString() },
        ReturnValues: "ALL_NEW",
      })
    );

    return {
      statusCode: 200,
      message: "Profile updated successfully",
      data: sanitizeUser(result.Attributes),
    };
  }

  /**
   * 5. PATCH /users/me/change-password - Change Password
   */
  async changePassword(userId, body = {}) {
    const { oldPassword, newPassword } = body;

    if (!oldPassword || !newPassword) {
      throw new ValidationError("'oldPassword' and 'newPassword' are required");
    }

    if (newPassword.length < 6) {
      throw new ValidationError("New password must be at least 6 characters long");
    }

    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { id: userId },
      })
    );

    const user = result.Item;
    if (!user || user.is_deleted) {
      throw new NotFoundError("User not found");
    }

    const isMatch = await comparePassword(oldPassword, user.passwordHash);
    if (!isMatch) {
      throw new ValidationError("Current password does not match");
    }

    const newPasswordHash = await hashPassword(newPassword);

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id: userId },
        UpdateExpression: "SET passwordHash = :pwd, #updatedAt = :updatedAt",
        ExpressionAttributeNames: { "#updatedAt": "updatedAt" },
        ExpressionAttributeValues: {
          ":pwd": newPasswordHash,
          ":updatedAt": new Date().toISOString(),
        },
      })
    );

    return {
      statusCode: 200,
      message: "Password changed successfully",
      data: null,
    };
  }

  /**
   * 6. DELETE /users/me - Soft Delete Account
   */
  async deleteAccount(userId) {
    await this.getProfile(userId);

    const now = new Date().toISOString();
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id: userId },
        UpdateExpression: "SET is_deleted = :delTrue, deleted_at = :now, #status = :deleted, #updatedAt = :now",
        ExpressionAttributeNames: {
          "#status": "status",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":delTrue": true,
          ":deleted": "deleted",
          ":now": now,
        },
      })
    );

    return {
      statusCode: 200,
      message: "Account deleted successfully",
      data: null,
    };
  }
}

export const userService = new UserService();
