const rateLimit = require("express-rate-limit");
const { createRateLimitStore } = require("./rateLimitStore");

function tryCreateStore(name) {
  if (process.env.NODE_ENV === "test") return undefined;
  try { return createRateLimitStore(name); } catch (e) { return undefined; }
}

function createRateLimiters() {
  const fireLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    store: tryCreateStore("fire"),
    message: { error: "Too many requests. Slow down." },
  });

  const judgeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 6,
    store: tryCreateStore("judge"),
    message: { error: "Too many judge requests. Slow down." },
  });

  const configLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 20,
    store: tryCreateStore("config"),
    message: { error: "Too many requests." },
  });

  const publicLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    store: tryCreateStore("publicread"),
    message: { error: "Too many requests. Slow down." },
  });

  const authFailLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    skipSuccessfulRequests: true,
    store: tryCreateStore("authfail"),
    message: { error: "Too many failed login attempts. Try again in 15 minutes." },
  });

  const registerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    store: tryCreateStore("register"),
    message: { error: "Too many registration attempts. Try again in 15 minutes." },
  });

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    skipSuccessfulRequests: true,
    store: tryCreateStore("login"),
    message: { error: "Too many failed login attempts. Try again in 15 minutes." },
  });

  const otpVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    store: tryCreateStore("otpverify"),
    message: { error: "Too many verification attempts. Try again in 15 minutes." },
  });

  const otpResendLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    store: tryCreateStore("otpresend"),
    message: { error: "Too many resend attempts. Try again in 15 minutes." },
  });

  return {
    fireLimiter,
    judgeLimiter,
    configLimiter,
    publicLimiter,
    authFailLimiter,
    registerLimiter,
    loginLimiter,
    otpVerifyLimiter,
    otpResendLimiter,
  };
}

module.exports = { createRateLimiters, tryCreateStore };
