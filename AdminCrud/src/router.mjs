import { HttpError, UnauthorizedError, ForbiddenError } from "./errors.mjs";
import { buildResponse } from "./utils/response.mjs";
import { verifyToken } from "./utils/auth.mjs";

export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pathPattern, handler, options = {}) {
    const paramNames = [];
    const regexPath = pathPattern
      .replace(/\/+$/, "")
      .replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
        paramNames.push(name);
        return "([^/]+)";
      });

    const regex = new RegExp(`^${regexPath || "/"}$`);
    this.routes.push({
      method: method.toUpperCase(),
      pathPattern,
      regex,
      paramNames,
      handler,
      authRequired: options.authRequired || false,
      role: options.role || null,
    });
    return this;
  }

  get(path, handler, options) { return this.add("GET", path, handler, options); }
  post(path, handler, options) { return this.add("POST", path, handler, options); }
  put(path, handler, options) { return this.add("PUT", path, handler, options); }
  patch(path, handler, options) { return this.add("PATCH", path, handler, options); }
  delete(path, handler, options) { return this.add("DELETE", path, handler, options); }

  parseBody(rawBody, isBase64Encoded = false) {
    if (!rawBody) return {};
    if (typeof rawBody === "object") return rawBody;
    try {
      const text = isBase64Encoded
        ? Buffer.from(rawBody, "base64").toString("utf-8")
        : rawBody;
      return JSON.parse(text);
    } catch {
      throw new HttpError(400, "Invalid JSON in request body");
    }
  }

  match(method, rawPath) {
    const normalizedPath = (rawPath || "/").replace(/\/+$/, "") || "/";
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = normalizedPath.match(route.regex);
      if (match) {
        const params = {};
        route.paramNames.forEach((name, idx) => {
          params[name] = match[idx + 1];
        });
        return { route, params };
      }
    }
    return null;
  }

  async dispatch(event) {
    const method = (
      event.requestContext?.http?.method ||
      event.httpMethod ||
      "GET"
    ).toUpperCase();

    // CORS preflight
    if (method === "OPTIONS") {
      return buildResponse(200, true, "OK");
    }

    let rawPath = (event.rawPath || event.path || "/").replace(/\/+$/, "") || "/";

    // Strip stage prefix if present (e.g. /default/admin/auth/login -> /admin/auth/login)
    const stage = event.requestContext?.stage;
    if (stage && stage !== "$default" && rawPath.startsWith(`/${stage}`)) {
      rawPath = rawPath.slice(stage.length + 1) || "/";
    }

    try {
      const matchResult = this.match(method, rawPath);
      if (!matchResult) {
        return buildResponse(
          404,
          false,
          `Unsupported route: ${method} ${rawPath}`,
          { availableRoutes: this.routes.map((r) => `${r.method.padEnd(6)} ${r.pathPattern}`) }
        );
      }

      const { route, params } = matchResult;
      const mergedParams = { ...params, ...(event.pathParameters || {}) };
      const body = this.parseBody(event.body, event.isBase64Encoded);

      // Authentication Middleware Check
      let authenticatedUser = null;
      if (route.authRequired) {
        const authHeader =
          event.headers?.authorization ||
          event.headers?.Authorization ||
          "";

        if (!authHeader.startsWith("Bearer ")) {
          throw new UnauthorizedError("Missing or malformed Authorization header. Expected 'Bearer <token>'");
        }

        const token = authHeader.slice(7).trim();
        try {
          authenticatedUser = verifyToken(token);
        } catch (err) {
          throw new UnauthorizedError(`Invalid token: ${err.message}`);
        }

        // Role-based Access Control
        if (route.role && authenticatedUser.role !== route.role) {
          throw new ForbiddenError(`Forbidden: '${route.role}' role required. Your role is '${authenticatedUser.role}'`);
        }
      }

      const req = {
        method,
        path: rawPath,
        params: mergedParams,
        query: event.queryStringParameters || {},
        body,
        headers: event.headers || {},
        user: authenticatedUser,
        event,
      };

      const result = await route.handler(req);

      const statusCode = result?.statusCode || (method === "POST" ? 201 : 200);
      const success = result?.success !== undefined ? result.success : true;
      const message = result?.message || "Operation successful";
      const data = result?.data !== undefined ? result.data : result;

      return buildResponse(statusCode, success, message, data);
    } catch (error) {
      if (error instanceof HttpError) {
        return buildResponse(error.statusCode, false, error.message, null);
      }

      console.error("Unhandled Error:", error);
      return buildResponse(500, false, error.message || "Internal Server Error", null);
    }
  }
}
