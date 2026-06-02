import {
  MODELS, _blindMode, _blindMapping, _blindReversed, _blindRevealed, _tournamentScores,
  MODES, CURATED, VOTE_LABELS, SYMPTOMS,
  _pageToken, _tokenRefreshPromise, _activePack, _packPersonas, isAnalyticsPage, _showAnalyticsOnIndex,
  runPagePath, modelProfilePath, isRunPage, isModelProfilePage,
  currentMode, votes, autoVotes, userVotes, history, responses, recentRuns, activeRunId, runsTotal, runsOffset,
  failureSummary, analyticsSummary, providerOptions, drilldownFilters, activeInspectModelId,
  SCORING_CRITERIA_KEYS, _userIsTyping, currentTournament,
  _authToken, _currentUser, _pendingEmail, _lastConfig, _originalFetch, _oauthPopup,
  modelColor, modelGlyph, modelName, modelMaker, createBlindMapping, swapKeys,
  getBlindLabel, getBlindGlyph, getBlindMaker,
  esc, setDisplay,
} from './state.js';

import {
  showError, updateCard, updateAuthUI, setSettingsMsg,
} from './ui.js';

import {
  hideAuthOverlay, showAuthEmailOtp, showAuthLogin, showAuthPhoneOtp, setFieldError,
} from './auth.js';
function refreshPageToken() {
  if (_tokenRefreshPromise) return _tokenRefreshPromise;
  _tokenRefreshPromise = fetch("/api/config")
    .then(function(r) { return r.json(); })
    .then(function(cfg) { if (cfg && cfg._token) _pageToken = cfg._token; })
    .catch(function() {})
    .finally(function() { _tokenRefreshPromise = null; });
  return _tokenRefreshPromise;
}

async function fireModel(prompt, modelId, _isRetry) {
  var started = performance.now();
  const res = await fetch("/api/fire", {
    method: "POST",
    headers: {"Content-Type":"application/json", "X-Page-Token": _pageToken},
    body: JSON.stringify({prompt, modelId, pack: _activePack}),
  });
  var data;
  try { data = await res.json(); } catch (_) {
    var err = new Error("Server returned a non-JSON response (gateway error?)");
    err.upstreamStatus = res.status;
    err.durationMs = Math.round(performance.now() - started);
    throw err;
  }
  if (res.status === 403 && !_isRetry) {
    await refreshPageToken();
    return fireModel(prompt, modelId, true);
  }
  if (!res.ok) {
    var error = new Error(data.error || "Server error");
    error.upstreamStatus = res.status;
    error.durationMs = Math.round(performance.now() - started);
    throw error;
  }
  return {
    text: data.response,
    timingMs: Math.round(performance.now() - started),
    upstreamStatus: res.status,
  };
}

async function judgeResponses(prompt, allResponses, modelsOverride, _isRetry) {
  var activeList = Array.isArray(modelsOverride) && modelsOverride.length ? modelsOverride : MODELS;
  var responseTimings = {};
  var executionModels = {};
  activeList.forEach(function(model) {
    if (allResponses[model.id + "__timing"] !== undefined && allResponses[model.id + "__timing"] !== null) {
      responseTimings[model.id] = allResponses[model.id + "__timing"];
    }
    if (allResponses[model.id + "__exec"]) {
      executionModels[model.id] = allResponses[model.id + "__exec"];
    }
  });

  // Only judge models that returned real responses, not error strings
  var judgableList = activeList.filter(function(model) {
    var r = allResponses[model.id];
    return typeof r === "string" && r.trim().length > 0 && !r.startsWith("[Error:");
  });
  if (!judgableList.length) throw new Error("All models failed — nothing to judge.");

  // Blind mode: swap to anonymized keys for judging
  var anonResponses = judgableList.reduce(function(out, model) {
    var key = (_blindMode && _blindReversed) ? _blindReversed[model.id] : model.id;
    out[key || model.id] = allResponses[model.id];
    return out;
  }, {});
  var anonTimings = {};
  var anonExec = {};
  if (_blindMode && _blindReversed) {
    judgableList.forEach(function(model) {
      var key = _blindReversed[model.id];
      if (key) {
        if (responseTimings[model.id] !== undefined) anonTimings[key] = responseTimings[model.id];
        if (executionModels[model.id]) anonExec[key] = executionModels[model.id];
      }
    });
  } else {
    anonTimings = responseTimings;
    anonExec = executionModels;
  }

  var metaBase = {
    timings: { contestantMsByModel: anonTimings },
    execution: {
      summary: {
        overallStatus: Object.values(executionModels).every(function(item) { return item.status === "success"; })
          ? "success"
          : (Object.values(executionModels).some(function(item) { return item.status === "success"; }) ? "partial_failure" : "failure"),
      },
      models: anonExec,
      policy: { retry: "none", fallback: "none" },
    },
  };
  if (_blindMode && _blindMapping) metaBase.blindMapping = _blindMapping;

  const res = await fetch("/api/judge", {
    method: "POST",
    headers: {"Content-Type":"application/json", "X-Page-Token": _pageToken},
    body: JSON.stringify(Object.assign({
      prompt: prompt,
      responses: anonResponses,
      meta: metaBase,
    }, getActiveCriteria() ? {criteria: getActiveCriteria()} : {}, {pack: _activePack, mode: currentMode})),
  });
  var data;
  try { data = await res.json(); } catch (_) {
    throw new Error("Judge endpoint returned a non-JSON response");
  }
  if (res.status === 403 && !_isRetry) {
    await refreshPageToken();
    return judgeResponses(prompt, allResponses, modelsOverride, true);
  }
  if (!res.ok) throw new Error(data.error || "Judge error");

  // Blind mode: map results back to real model IDs
  if (_blindMode && _blindMapping && data) {
    if (data.scores) data.scores = swapKeys(data.scores, _blindMapping);
    if (data.verdicts) data.verdicts = swapKeys(data.verdicts, _blindMapping);
    if (data.crown) data.crown = _blindMapping[data.crown] || data.crown;
    if (data.judgeConfidence) data.judgeConfidence = swapKeys(data.judgeConfidence, _blindMapping);
  }
  return data;
}
function moderatePrompt(id, action) {
  if (!isAnalyticsPage) return;
  var list = document.getElementById("moderationList");
  var endpoint = "/api/prompts/" + id + "/" + action;
  fetch(endpoint, { method: "POST" })
    .then(function(r) {
      if (!r.ok) return Promise.reject(r.status);
      loadModerationPanel();
    })
    .catch(function(status) {
      if (!list) return;
      var err = document.createElement("div");
      err.className = "mod-error";
      err.textContent = action + " failed" + (status ? " (HTTP " + status + ")" : "");
      list.insertBefore(err, list.firstChild);
    });
}
function handleUpdateName() {
  var name = String(document.getElementById("settingsNameInput").value || "").trim();
  if (name.length < 4) {
    setSettingsMsg("settingsNameMsg", "Name must be at least 4 characters.", false);
    return;
  }
  fetch("/api/auth/update-name", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name }) })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.ok) {
        setSettingsMsg("settingsNameMsg", "Name updated.", true);
        if (_currentUser) _currentUser.fullName = name;
        updateAuthUI();
      } else {
        setSettingsMsg("settingsNameMsg", data.error || "Update failed.", false);
      }
    })
    .catch(function() { setSettingsMsg("settingsNameMsg", "Network error.", false); });
}

function handleUpdateEmail() {
  var email = String(document.getElementById("settingsEmailInput").value || "").trim().toLowerCase();
  if (!email || email.indexOf("@") === -1) {
    setSettingsMsg("settingsEmailMsg", "Please enter a valid email.", false);
    return;
  }
  fetch("/api/auth/update-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email }) })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.ok) {
        setSettingsMsg("settingsEmailMsg", data.message || "Email updated. Check your inbox for the verification code.", true);
        if (_currentUser) _currentUser.email = email;
        _currentUser.emailVerified = false;
        updateAuthUI();
      } else {
        setSettingsMsg("settingsEmailMsg", data.error || "Update failed.", false);
      }
    })
    .catch(function() { setSettingsMsg("settingsEmailMsg", "Network error.", false); });
}

function handleUpdatePhone() {
  var phone = String(document.getElementById("settingsPhoneInput").value || "").trim();
  if (!phone || phone.length < 3) {
    setSettingsMsg("settingsPhoneMsg", "Please enter a valid phone number with country code.", false);
    return;
  }
  fetch("/api/auth/update-phone", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: phone }) })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.ok) {
        setSettingsMsg("settingsPhoneMsg", data.message || "Phone updated. Check your SMS for the verification code.", true);
        _currentUser.phoneVerified = false;
        _currentUser.customModeEnabled = false;
        updateAuthUI();
      } else {
        setSettingsMsg("settingsPhoneMsg", data.error || "Update failed.", false);
      }
    })
    .catch(function() { setSettingsMsg("settingsPhoneMsg", "Network error.", false); });
}

function handleChangePassword() {
  var current = document.getElementById("settingsCurrentPassword").value;
  var newPass = document.getElementById("settingsNewPassword").value;
  var confirm = document.getElementById("settingsConfirmPassword").value;
  if (!current || !newPass) {
    setSettingsMsg("settingsPasswordMsg", "All password fields are required.", false);
    return;
  }
  if (newPass !== confirm) {
    setSettingsMsg("settingsPasswordMsg", "New passwords do not match.", false);
    return;
  }
  if (newPass.length < 8 || !/[A-Z]/.test(newPass) || !/[a-z]/.test(newPass) || !/[0-9]/.test(newPass) || !/[^A-Za-z0-9]/.test(newPass)) {
    setSettingsMsg("settingsPasswordMsg", "Password must be 8+ chars with upper, lower, number, and special character.", false);
    return;
  }
  fetch("/api/auth/change-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: current, newPassword: newPass, confirmPassword: confirm }) })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.ok) {
        setSettingsMsg("settingsPasswordMsg", "Password updated successfully.", true);
        document.getElementById("settingsCurrentPassword").value = "";
        document.getElementById("settingsNewPassword").value = "";
        document.getElementById("settingsConfirmPassword").value = "";
      } else {
        setSettingsMsg("settingsPasswordMsg", data.error || "Password change failed.", false);
      }
    })
    .catch(function() { setSettingsMsg("settingsPasswordMsg", "Network error.", false); });
}

function toggleAdminAnalytics() {
  _showAnalyticsOnIndex = !_showAnalyticsOnIndex;
  var btn = document.getElementById("adminAnalyticsBtn");
  if (btn) btn.classList.toggle("header-link--active", _showAnalyticsOnIndex);
  if (_showAnalyticsOnIndex) {
    refreshAdminAnalytics();
    injectModerationPanel();
  } else {
    setDisplay("analyticsPanel", "none");
    setDisplay("runsPanel", "none");
    setDisplay("moderationPanel", "none");
  }
}

async function refreshAdminAnalytics() {
  if (!_showAnalyticsOnIndex && !isAnalyticsPage) return;
  try {
    var runsRes = await fetch("/api/runs?limit=10");
    var runsData = await runsRes.json();
    recentRuns = Array.isArray(runsData.items) ? runsData.items : [];
  } catch (e) { recentRuns = []; }
  try {
    var failRes = await fetch("/api/failures/summary");
    failureSummary = await failRes.json();
  } catch (e) { failureSummary = null; }
  try {
    var anRes = await fetch("/api/analytics");
    analyticsSummary = await anRes.json();
  } catch (e) { analyticsSummary = null; }
  renderAnalytics();
  renderFailureSummary();
  renderDrilldownBar();
  renderRunsPanel();
  if (recentRuns[0]) inspectRun(recentRuns[0].id);
  try {
    var driftRes = await fetch("/api/drift");
    var driftData = await driftRes.json();
    renderDrift(driftData);
  } catch (e) { console.warn("Drift refresh failed:", e.message); }
}

function initAuth() {
  if (!_authToken) return Promise.resolve(false);
  return fetch("/api/auth/me")
    .then(function(r) {
      if (!r.ok) { _authToken = ""; localStorage.removeItem("csb_session_token"); return false; }
      return r.json();
    })
    .then(function(data) {
      if (data && data.user) {
        _currentUser = data.user;
        updateAuthUI();
        return true;
      }
      _authToken = "";
      localStorage.removeItem("csb_session_token");
      return false;
    })
    .catch(function() {
      _authToken = "";
      localStorage.removeItem("csb_session_token");
      return false;
    });
}

// ── OAuth popup flow ──────────────────────────────────────────────────────────

function startOAuth(provider) {
  var w = 500, h = 600;
  var left = (window.screen.width - w) / 2;
  var top = (window.screen.height - h) / 2;
  _oauthPopup = window.open("/api/auth/oauth/" + provider + "/start", "oauth", "width=" + w + ",height=" + h + ",left=" + left + ",top=" + top);
}

function handleOAuthCallback(token, user) {
  _authToken = token;
  localStorage.setItem("csb_session_token", token);
  _currentUser = user;
  updateAuthUI();
  // If phone not verified, keep overlay visible and show phone OTP view
  if (_currentUser && !_currentUser.phoneVerified) {
    showAuthPhoneOtp();
  } else {
    hideAuthOverlay();
    window.location.reload();
  }
}

// Listen for OAuth popup message
window.addEventListener("message", function(event) {
  if (!event.data) return;
  var msg;
  try {
    msg = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
  } catch (e) { return; }
  if (msg && msg.type === "oauth_result" && msg.payload) {
    var payload = typeof msg.payload === "string" ? JSON.parse(msg.payload) : msg.payload;
    if (payload.error) {
      console.warn("OAuth failed:", payload.error);
      var loginGeneralError = document.getElementById("loginGeneralError");
      if (loginGeneralError) {
        loginGeneralError.textContent = payload.error;
        loginGeneralError.style.display = "block";
      }
    } else if (payload.token && payload.user) {
      handleOAuthCallback(payload.token, payload.user);
    }
  }
});

function updateOAuthButtonVisibility(oauthProviders) {
  if (!oauthProviders) return;
  var loginWrap = document.getElementById("authOAuthLogin");
  var regWrap = document.getElementById("authOAuthRegister");
  var hasAny = oauthProviders.google || oauthProviders.facebook || oauthProviders.instagram;
  if (loginWrap) loginWrap.style.display = hasAny ? "block" : "none";
  if (regWrap) regWrap.style.display = hasAny ? "block" : "none";
  ["google", "facebook", "instagram"].forEach(function(p) {
    var btns = document.querySelectorAll('.auth-oauth-btn[data-provider="' + p + '"]');
    btns.forEach(function(btn) {
      btn.style.display = oauthProviders[p] ? "block" : "none";
    });
  });
}

function handleRegister() {
  var fullName = document.getElementById("regName").value.trim();
  var email = document.getElementById("regEmail").value.trim();
  var phone = document.getElementById("regPhone").value.trim();
  var password = document.getElementById("regPassword").value;
  var confirmPassword = document.getElementById("regConfirmPassword").value;

  setFieldError("regNameError", fullName.length >= 4 && /^[a-zA-Z0-9\s]+$/.test(fullName) ? "" : "Name must be at least 4 characters, letters/numbers/spaces only.");
  setFieldError("regEmailError", /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "" : "Enter a valid email.");
  setFieldError("regPhoneError", phone.length >= 3 && phone.startsWith("+") ? "" : "Enter a valid phone with country code (e.g. +1234567890).");
  setFieldError("regPasswordError", password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password) ? "" : "Password must contain at least 8 characters, including uppercase, lowercase, number, and special character.");
  setFieldError("regConfirmError", password === confirmPassword ? "" : "Passwords do not match.");

  if (document.querySelectorAll(".auth-error").some(function(el) { return el.textContent; })) return;

  var btn = document.getElementById("regBtn");
  btn.disabled = true;

  fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fullName: fullName, email: email, phone: phone, password: password, confirmPassword: confirmPassword }),
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      btn.disabled = false;
      if (data.ok) {
        showAuthEmailOtp(email);
      } else {
        setFieldError("regEmailError", data.error || "Registration failed.");
      }
    })
    .catch(function() {
      btn.disabled = false;
      setFieldError("regEmailError", "Registration failed. Please try again.");
    });
}

function handleVerifyEmailOtp() {
  var otp = collectOtp("email");
  if (otp.length !== 6) {
    setFieldError("emailOtpError", "Enter the full 6-digit code.");
    return;
  }
  var btn = document.getElementById("emailOtpBtn");
  btn.disabled = true;

  fetch("/api/auth/verify-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: _pendingEmail, otp: otp }),
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      btn.disabled = false;
      if (data.ok && data.token) {
        _authToken = data.token;
        localStorage.setItem("csb_session_token", data.token);
        _currentUser = data.user;
        updateAuthUI();
        hideAuthOverlay();
        _continueInit();
        // If phone not verified, show phone OTP after a short delay
        if (!_currentUser.phoneVerified) {
          setTimeout(function() { showAuthPhoneOtp(); }, 500);
        }
      } else {
        setFieldError("emailOtpError", data.error || "Invalid or expired code.");
      }
    })
    .catch(function() {
      btn.disabled = false;
      setFieldError("emailOtpError", "Verification failed. Please try again.");
    });
}

function handleResendEmailOtp() {
  if (!_pendingEmail) return;
  fetch("/api/auth/resend-email-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: _pendingEmail }),
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.ok) {
        setFieldError("emailOtpError", "A new code has been sent.");
      } else {
        setFieldError("emailOtpError", data.error || "Unable to resend.");
      }
    })
    .catch(function() {
      setFieldError("emailOtpError", "Unable to resend.");
    });
}

function handleLogin() {
  var email = document.getElementById("loginEmail").value.trim();
  var password = document.getElementById("loginPassword").value;

  setFieldError("loginEmailError", /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "" : "Enter a valid email.");
  setFieldError("loginPasswordError", password ? "" : "Enter your password.");
  if (document.getElementById("loginEmailError").textContent || document.getElementById("loginPasswordError").textContent) return;

  var btn = document.getElementById("loginBtn");
  btn.disabled = true;

  fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email, password: password }),
  })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(d) { throw d; });
      return r.json();
    })
    .then(function(data) {
      btn.disabled = false;
      if (data.ok && data.token) {
        _authToken = data.token;
        localStorage.setItem("csb_session_token", data.token);
        _currentUser = data.user;
        updateAuthUI();
        hideAuthOverlay();
        _continueInit();
        // If phone not verified and first login not completed, prompt for phone verification
        if (!_currentUser.phoneVerified && !_currentUser.firstLoginCompleted) {
          setTimeout(function() { showAuthPhoneOtp(); }, 500);
        }
      } else {
        setFieldError("loginGeneralError", data.error || "Login failed.");
      }
    })
    .catch(function(data) {
      btn.disabled = false;
      setFieldError("loginGeneralError", (data && data.error) ? data.error : "Login failed.");
    });
}

function handleVerifyPhoneOtp() {
  var otp = collectOtp("phone");
  if (otp.length !== 6) {
    setFieldError("phoneOtpError", "Enter the full 6-digit code.");
    return;
  }
  var btn = document.getElementById("phoneOtpBtn");
  btn.disabled = true;

  fetch("/api/auth/verify-phone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ otp: otp }),
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      btn.disabled = false;
      if (data.ok) {
        if (_currentUser) _currentUser.phoneVerified = true;
        hideAuthOverlay();
        window.location.reload();
      } else {
        setFieldError("phoneOtpError", data.error || "Invalid or expired code.");
      }
    })
    .catch(function() {
      btn.disabled = false;
      setFieldError("phoneOtpError", "Verification failed. Please try again.");
    });
}

function handleForgotPassword() {
  var email = document.getElementById("forgotEmail").value.trim();
  setFieldError("forgotEmailError", /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "" : "Enter a valid email.");
  if (document.getElementById("forgotEmailError").textContent) return;

  var btn = document.getElementById("forgotBtn");
  btn.disabled = true;

  fetch("/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email }),
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      btn.disabled = false;
      if (data.ok) {
        setFieldError("forgotEmailError", "If this account exists, a reset link has been sent.");
      } else {
        setFieldError("forgotEmailError", data.error || "Request failed.");
      }
    })
    .catch(function() {
      btn.disabled = false;
      setFieldError("forgotEmailError", "Request failed. Please try again.");
    });
}

function handleResendPhoneOtp() {
  fetch("/api/auth/resend-phone-otp", { method: "POST", headers: { "Content-Type": "application/json" } })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.ok) {
        setFieldError("phoneOtpError", "A new code has been sent.");
      } else {
        setFieldError("phoneOtpError", data.error || "Unable to resend.");
      }
    })
    .catch(function() {
      setFieldError("phoneOtpError", "Unable to resend.");
    });
}

function logout() {
  fetch("/api/auth/logout", { method: "POST" })
    .then(function() {
      _authToken = "";
      _currentUser = null;
      localStorage.removeItem("csb_session_token");
      window.location.reload();
    })
    .catch(function() {
      _authToken = "";
      _currentUser = null;
      localStorage.removeItem("csb_session_token");
      window.location.reload();
    });
}

// Gate Custom Mode behind phone verification

export {
  refreshPageToken,
  fireModel, judgeResponses,
  moderatePrompt,
  handleUpdateName, handleUpdateEmail, handleUpdatePhone, handleChangePassword,
  refreshAdminAnalytics,
  initAuth, startOAuth, handleOAuthCallback, updateOAuthButtonVisibility,
  logout, handleRegister, handleVerifyEmailOtp, handleResendEmailOtp,
  handleLogin, handleVerifyPhoneOtp, handleForgotPassword, handleResendPhoneOtp,
};
