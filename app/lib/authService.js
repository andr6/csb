const crypto = require("node:crypto");
const bcrypt = require("bcrypt");
const { parsePhoneNumberFromString } = require("libphonenumber-js");

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);
const OTP_PEPPER = String(process.env.OTP_PEPPER || "csb-default-pepper-change-me");
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);
const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES || 10);
const SESSION_EXPIRY_HOURS = Number(process.env.SESSION_EXPIRY_HOURS || 24);
const ACCOUNT_LOCKOUT_MINUTES = Number(process.env.ACCOUNT_LOCKOUT_MINUTES || 30);

// ── Password ────────────────────────────────────────────────────────────────

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function validatePasswordPolicy(password) {
  if (typeof password !== "string" || password.length < 8) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  if (!/[^A-Za-z0-9]/.test(password)) return false;
  return true;
}

function getPasswordPolicyError() {
  return "Password must contain at least 8 characters, including uppercase, lowercase, number, and special character.";
}

// ── Name ────────────────────────────────────────────────────────────────────

function validateName(name) {
  if (typeof name !== "string" || name.length < 4) return false;
  return /^[a-zA-Z0-9\s]+$/.test(name);
}

function getNamePolicyError() {
  return "Name or alias must be at least 4 characters and contain only letters, numbers, and spaces.";
}

// ── Email ───────────────────────────────────────────────────────────────────

function validateEmail(email) {
  if (typeof email !== "string" || email.length > 254) return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

function getEmailPolicyError() {
  return "Please enter a valid email address.";
}

// ── Phone ───────────────────────────────────────────────────────────────────

function validatePhone(phone) {
  if (typeof phone !== "string" || phone.length < 3) return false;
  const parsed = parsePhoneNumberFromString(phone);
  return parsed ? parsed.isValid() : false;
}

function getPhonePolicyError() {
  return "Please enter a valid phone number with country code (e.g. +1234567890).";
}

function normalizePhone(phone) {
  const parsed = parsePhoneNumberFromString(phone);
  return parsed ? parsed.format("E.164") : phone.trim();
}

// ── OTP ──────────────────────────────────────────────────────────────────────

function generateOtp() {
  return String(crypto.randomInt(100000, 999999));
}

function hashOtp(otp) {
  return crypto.createHmac("sha256", OTP_PEPPER).update(otp).digest("hex");
}

function verifyOtp(plainOtp, hash) {
  const expected = hashOtp(plainOtp);
  const eBuf = Buffer.from(expected, "hex");
  const aBuf = Buffer.from(hash, "hex");
  return eBuf.length === aBuf.length && crypto.timingSafeEqual(eBuf, aBuf);
}

function getOtpExpiryDate() {
  return new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();
}

function isOtpExpired(expiresAt) {
  return new Date() > new Date(expiresAt);
}

function getOtpMaxAttempts() {
  return OTP_MAX_ATTEMPTS;
}

// ── Session ─────────────────────────────────────────────────────────────────

function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function getSessionExpiryDate() {
  return new Date(Date.now() + SESSION_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();
}

function isSessionExpired(expiresAt) {
  return new Date() > new Date(expiresAt);
}

// ── Account lockout ─────────────────────────────────────────────────────────

function getLockoutUntil() {
  return new Date(Date.now() + ACCOUNT_LOCKOUT_MINUTES * 60 * 1000).toISOString();
}

function isAccountLocked(lockUntil) {
  if (!lockUntil) return false;
  return new Date() < new Date(lockUntil);
}

module.exports = {
  hashPassword,
  verifyPassword,
  validatePasswordPolicy,
  getPasswordPolicyError,
  validateName,
  getNamePolicyError,
  validateEmail,
  getEmailPolicyError,
  validatePhone,
  getPhonePolicyError,
  normalizePhone,
  generateOtp,
  hashOtp,
  verifyOtp,
  getOtpExpiryDate,
  isOtpExpired,
  getOtpMaxAttempts,
  generateSessionToken,
  hashToken,
  getSessionExpiryDate,
  isSessionExpired,
  getLockoutUntil,
  isAccountLocked,
};
