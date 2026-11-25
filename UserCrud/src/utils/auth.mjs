import { createRequire } from "node:module";

let _bcrypt = null;
let _jwt = null;

const loadPackage = (packageName) => {
  // 1. AWS Lambda Layer standard path (/opt/nodejs/node_modules)
  try {
    const layerReq = createRequire("/opt/nodejs/index.js");
    return layerReq(packageName);
  } catch (err1) {
    // 2. Direct require from /opt/nodejs/node_modules/
    try {
      const directReq = createRequire("/opt/nodejs/node_modules/index.js");
      return directReq(packageName);
    } catch (err2) {
      // 3. Local development fallback
      try {
        const localReq = createRequire(import.meta.url);
        return localReq(packageName);
      } catch (err3) {
        throw new Error(
          `Unable to load dependency '${packageName}' from Lambda Layer (/opt/nodejs/node_modules) or local path. Details: [layer: ${err1.message}, direct: ${err2.message}, local: ${err3.message}]`
        );
      }
    }
  }
};

const getBcrypt = () => {
  if (!_bcrypt) {
    _bcrypt = loadPackage("bcryptjs");
    console.log("Successfully loaded bcryptjs from layer");
  }
  return _bcrypt;
};

const getJwt = () => {
  if (!_jwt) {
    _jwt = loadPackage("jsonwebtoken");
    console.log("Successfully loaded jsonwebtoken from layer");
  }
  return _jwt;
};

// Pre-warm on cold start without crashing module import
try {
  getBcrypt();
  getJwt();
  console.log("Auth modules pre-warmed successfully during cold start");
} catch (warmupErr) {
  console.warn("Deferred layer loading until invocation:", warmupErr.message);
}

const JWT_SECRET = process.env.JWT_SECRET || "day2_supersecret_jwt_key_2026";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

export const hashPassword = async (plainPassword) => {
  const bcryptInstance = getBcrypt();
  return bcryptInstance.hash(plainPassword, 10);
};

export const comparePassword = async (plainPassword, hashedPassword) => {
  const bcryptInstance = getBcrypt();
  return bcryptInstance.compare(plainPassword, hashedPassword);
};

export const generateToken = (payload) => {
  const jwtInstance = getJwt();
  return jwtInstance.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

export const verifyToken = (token) => {
  const jwtInstance = getJwt();
  return jwtInstance.verify(token, JWT_SECRET);
};
