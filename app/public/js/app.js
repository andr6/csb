// ═══════════════════════════════════════════════════════════════════════════════
//  Entry point — MUST import api.js first so the fetch interceptor is applied
//  before any module performs a fetch().
// ═══════════════════════════════════════════════════════════════════════════════
import "./api.js";

import { state } from "./state.js";
import { updateChar } from "./utils.js";
import { setGetActiveCriteria } from "./api.js";
import {
  init, _continueInit, setMode, buildPackSelector, buildCriteriaGrid, getActiveCriteria,
  handleTyping, randomPrompt, reset, revealBlind, softReset, updateResultsHeader,
  loadCommunityPrompts, toggleAdminAnalytics,
} from "./core.js";
import { fire } from "./arena.js";
import { createTournament } from "./tournament.js";
import { exportRuns, changeRunsPage, inspectRun, applyDrilldown, handleRunFilter } from "./analytics.js";
import { setInspectRun, setApplyDrilldown } from "./ui.js";
import {
  openAccountSettings, closeAccountSettings, handleUpdateName, handleUpdateEmail,
  handleUpdatePhone, handleChangePassword, toggleUserMenu, logout,
  showAuthRegister, showAuthLogin, showAuthEmailOtp, showAuthForgotPassword,
  handleRegister, handleVerifyEmailOtp, handleResendEmailOtp,
  handleLogin, handleVerifyPhoneOtp, handleResendPhoneOtp, handleForgotPassword,
  setContinueInit, startOAuth,
} from "./auth.js";

// Wire forward declarations to break circular imports
setGetActiveCriteria(getActiveCriteria);
setContinueInit(_continueInit);
setInspectRun(inspectRun);
setApplyDrilldown(applyDrilldown);

// ═══════════════════════════════════════════════════════════════════════════════
//  Event listeners (replaces inline onclick handlers from index.html)
// ═══════════════════════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", function() {
  // Prompt input
  var promptInput = document.getElementById("promptInput");
  if (promptInput) {
    promptInput.addEventListener("input", handleTyping);
    promptInput.addEventListener("keydown", function(e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); fire(); }
    });
  }

  // Main action buttons
  var fireBtn = document.getElementById("fireBtn");
  if (fireBtn) fireBtn.addEventListener("click", fire);

  var resetBtn = document.getElementById("resetBtn");
  if (resetBtn) resetBtn.addEventListener("click", reset);

  var revealBtn = document.getElementById("revealBtn");
  if (revealBtn) revealBtn.addEventListener("click", revealBlind);

  var randomBtn = document.querySelector(".btn-random");
  if (randomBtn) randomBtn.addEventListener("click", randomPrompt);

  // Header / auth
  var userMenuBtn = document.getElementById("userMenuToggle");
  if (userMenuBtn) userMenuBtn.addEventListener("click", toggleUserMenu);

  var logoutBtn = document.querySelectorAll(".user-menu-item");
  logoutBtn.forEach(function(btn) {
    if (btn.textContent.includes("Account")) btn.addEventListener("click", openAccountSettings);
    if (btn.textContent.includes("Log Out")) btn.addEventListener("click", logout);
  });

  var adminAnalyticsBtn = document.getElementById("adminAnalyticsBtn");
  if (adminAnalyticsBtn) adminAnalyticsBtn.addEventListener("click", toggleAdminAnalytics);

  // Account settings overlay
  var closeSettingsBtn = document.querySelector(".settings-close");
  if (closeSettingsBtn) closeSettingsBtn.addEventListener("click", closeAccountSettings);

  // Settings buttons have no IDs — bind by section context
  document.querySelectorAll(".settings-btn").forEach(function(btn) {
    var section = btn.closest(".settings-section");
    if (!section) return;
    if (section.querySelector("#settingsNameInput")) btn.addEventListener("click", handleUpdateName);
    else if (section.querySelector("#settingsEmailInput")) btn.addEventListener("click", handleUpdateEmail);
    else if (section.querySelector("#settingsPhoneInput")) btn.addEventListener("click", handleUpdatePhone);
    else if (section.querySelector("#settingsCurrentPassword")) btn.addEventListener("click", handleChangePassword);
  });

  // Auth overlay links (data-action)
  document.querySelectorAll("#authOverlay a[data-action]").forEach(function(link) {
    link.addEventListener("click", function(e) {
      e.preventDefault();
      var action = link.dataset.action;
      if (action === "showAuthLogin") showAuthLogin();
      else if (action === "showAuthRegister") showAuthRegister();
      else if (action === "showAuthForgotPassword") showAuthForgotPassword();
    });
  });

  // Auth actions
  var regBtn = document.getElementById("regBtn");
  if (regBtn) regBtn.addEventListener("click", handleRegister);

  var emailOtpBtn = document.getElementById("emailOtpBtn");
  if (emailOtpBtn) emailOtpBtn.addEventListener("click", handleVerifyEmailOtp);

  var resendEmailOtpLink = document.getElementById("resendEmailOtpLink");
  if (resendEmailOtpLink) resendEmailOtpLink.addEventListener("click", function(e) { e.preventDefault(); handleResendEmailOtp(); });

  var loginBtn = document.getElementById("loginBtn");
  if (loginBtn) loginBtn.addEventListener("click", handleLogin);

  var forgotBtn = document.getElementById("forgotBtn");
  if (forgotBtn) forgotBtn.addEventListener("click", handleForgotPassword);

  var phoneOtpBtn = document.getElementById("phoneOtpBtn");
  if (phoneOtpBtn) phoneOtpBtn.addEventListener("click", handleVerifyPhoneOtp);

  var resendPhoneOtpLink = document.getElementById("resendPhoneOtpLink");
  if (resendPhoneOtpLink) resendPhoneOtpLink.addEventListener("click", function(e) { e.preventDefault(); handleResendPhoneOtp(); });

  // OAuth buttons
  document.querySelectorAll(".auth-oauth-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      var provider = btn.dataset.provider;
      if (provider) startOAuth(provider);
    });
  });

  // Runs panel pagination
  var runsPrevBtn = document.getElementById("runsPrevBtn");
  if (runsPrevBtn) runsPrevBtn.addEventListener("click", function() { changeRunsPage(-1); });

  var runsNextBtn = document.getElementById("runsNextBtn");
  if (runsNextBtn) runsNextBtn.addEventListener("click", function() { changeRunsPage(1); });

  // Export buttons (no IDs — match by text)
  document.querySelectorAll(".runs-export").forEach(function(btn) {
    var text = btn.textContent.trim().toLowerCase();
    if (text.includes("json")) btn.addEventListener("click", function() { exportRuns("json"); });
    else if (text.includes("csv")) btn.addEventListener("click", function() { exportRuns("csv"); });
  });

  // Run filter changes
  ["runsSearch","runsCrownFilter","runsStatusFilter","runsContestantProviderFilter","runsJudgeProviderFilter","runsFailModelFilter","runsDateFrom","runsDateTo"].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener("change", function() { handleRunFilter(); });
  });

  // Init
  init();
});
