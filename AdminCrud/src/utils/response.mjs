/**
 * Standardized API Response Builder: { success, message, data }
 */
export const buildResponse = (statusCode, success, message, data = null, headers = {}) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    ...headers,
  },
  body: JSON.stringify({
    success,
    message,
    data,
  }),
});
