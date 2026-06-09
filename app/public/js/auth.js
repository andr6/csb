import { state } from "./state.js";

// Simple DOM helper — duplicated here to avoid circular imports
function setDisplay(id, value) {
  var el = document.getElementById(id);
  if (el) el.style.display = value;
}

// ── Callback injection (avoid circular import with core.js) ──────────────────
var __continueInit = null;
export function setContinueInit(fn) { __continueInit = fn; }

// ═══════════════════════════════════════════════════════════════════════════════
//  Auth UI
// ═══════════════════════════════════════════════════════════════════════════════
export function updateAuthUI() {
  var userMenu = document.getElementById("userMenu");
  var userMenuName = document.getElementById("userMenuName");
  var adminAnalyticsBtn = document.getElementById("adminAnalyticsBtn");
  if (userMenu) userMenu.style.display = state.currentUser ? "block" : "none";
  if (userMenuName && state.currentUser) userMenuName.textContent = state.currentUser.fullName || state.currentUser.email || "user";
  if (adminAnalyticsBtn) adminAnalyticsBtn.style.display = (state.currentUser && state.currentUser.isAdmin) ? "inline-flex" : "none";
}

export function toggleUserMenu() {
  var dropdown = document.getElementById("userMenuDropdown");
  if (dropdown) dropdown.classList.toggle("open");
}

export function openAccountSettings() {
  var dropdown = document.getElementById("userMenuDropdown");
  if (dropdown) dropdown.classList.remove("open");
  if (!state.currentUser) return;
  document.getElementById("settingsNameInput").value = state.currentUser.fullName || "";
  document.getElementById("settingsEmailInput").value = state.currentUser.email || "";
  var cfg = state.lastConfig || {};
  if (cfg.user && cfg.user.phone) {
    document.getElementById("settingsPhoneInput").value = cfg.user.phone || "";
  }
  ["settingsNameMsg","settingsEmailMsg","settingsPhoneMsg","settingsPasswordMsg"].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) { el.textContent = ""; el.className = "settings-msg"; }
  });
  var overlay = document.getElementById("accountSettingsOverlay");
  if (overlay) overlay.classList.add("open");
}

export function closeAccountSettings() {
  var overlay = document.getElementById("accountSettingsOverlay");
  if (overlay) overlay.classList.remove("open");
}

function setSettingsMsg(id, text, ok) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = text || "";
  el.className = "settings-msg " + (ok ? "ok" : "err");
}

export function handleUpdateName() {
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
        if (state.currentUser) state.currentUser.fullName = name;
        updateAuthUI();
      } else {
        setSettingsMsg("settingsNameMsg", data.error || "Update failed.", false);
      }
    })
    .catch(function() { setSettingsMsg("settingsNameMsg", "Network error.", false); });
}

export function handleUpdateEmail() {
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
        if (state.currentUser) state.currentUser.email = email;
        state.currentUser.emailVerified = false;
        updateAuthUI();
      } else {
        setSettingsMsg("settingsEmailMsg", data.error || "Update failed.", false);
      }
    })
    .catch(function() { setSettingsMsg("settingsEmailMsg", "Network error.", false); });
}

export function handleUpdatePhone() {
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
        state.currentUser.phoneVerified = false;
        updateAuthUI();
      } else {
        setSettingsMsg("settingsPhoneMsg", data.error || "Update failed.", false);
      }
    })
    .catch(function() { setSettingsMsg("settingsPhoneMsg", "Network error.", false); });
}

export function handleChangePassword() {
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

// ═══════════════════════════════════════════════════════════════════════════════
//  Auth flow
// ═══════════════════════════════════════════════════════════════════════════════
export function initAuth() {
  if (!state.authToken) return Promise.resolve(false);
  return fetch("/api/auth/me")
    .then(function(r) {
      if (!r.ok) { state.authToken = ""; localStorage.removeItem("csb_session_token"); return false; }
      return r.json();
    })
    .then(function(data) {
      if (data && data.user) {
        state.currentUser = data.user;
        updateAuthUI();
        return true;
      }
      state.authToken = "";
      localStorage.removeItem("csb_session_token");
      return false;
    })
    .catch(function() {
      state.authToken = "";
      localStorage.removeItem("csb_session_token");
      return false;
    });
}

var _oauthPopup = null;
export function startOAuth(provider) {
  var w = 500, h = 600;
  var left = (window.screen.width - w) / 2;
  var top = (window.screen.height - h) / 2;
  _oauthPopup = window.open("/api/auth/oauth/" + provider + "/start", "oauth", "width=" + w + ",height=" + h + ",left=" + left + ",top=" + top);
}

export function handleOAuthCallback(token, user) {
  state.authToken = token;
  localStorage.setItem("csb_session_token", token);
  state.currentUser = user;
  updateAuthUI();
  if (state.currentUser && !state.currentUser.phoneVerified) {
    showAuthPhoneOtp();
  } else {
    hideAuthOverlay();
    window.location.reload();
  }
}

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

export function updateOAuthButtonVisibility(oauthProviders) {
  if (!oauthProviders) return;
  var loginWrap = document.getElementById("authOAuthLogin");
  var regWrap = document.getElementById("authOAuthRegister");
  var hasAny = oauthProviders.google || oauthProviders.facebook;
  if (loginWrap) loginWrap.style.display = hasAny ? "block" : "none";
  if (regWrap) regWrap.style.display = hasAny ? "block" : "none";
  ["google", "facebook"].forEach(function(p) {
    var btns = document.querySelectorAll('.auth-oauth-btn[data-provider="' + p + '"]');
    btns.forEach(function(btn) {
      btn.style.display = oauthProviders[p] ? "block" : "none";
    });
  });
}

export function showAuthRegister() {
  setDisplay("authRegisterView", "block");
  setDisplay("authEmailOtpView", "none");
  setDisplay("authLoginView", "none");
  setDisplay("authPhoneOtpView", "none");
  setDisplay("authForgotPasswordView", "none");
}
export function showAuthLogin() {
  setDisplay("authRegisterView", "none");
  setDisplay("authEmailOtpView", "none");
  setDisplay("authLoginView", "block");
  setDisplay("authPhoneOtpView", "none");
  setDisplay("authForgotPasswordView", "none");
}
export function showAuthEmailOtp(email) {
  state.pendingEmail = email || "";
  document.getElementById("emailOtpTarget").textContent = state.pendingEmail;
  setDisplay("authRegisterView", "none");
  setDisplay("authEmailOtpView", "block");
  setDisplay("authLoginView", "none");
  setDisplay("authPhoneOtpView", "none");
  setDisplay("authForgotPasswordView", "none");
  clearOtpInputs("email");
}
export function showAuthPhoneOtp() {
  setDisplay("authRegisterView", "none");
  setDisplay("authEmailOtpView", "none");
  setDisplay("authLoginView", "none");
  setDisplay("authForgotPasswordView", "none");
  setDisplay("authPhoneOtpView", "block");
  clearOtpInputs("phone");
}
export function showAuthForgotPassword() {
  setDisplay("authRegisterView", "none");
  setDisplay("authEmailOtpView", "none");
  setDisplay("authLoginView", "none");
  setDisplay("authPhoneOtpView", "none");
  setDisplay("authForgotPasswordView", "block");
}
export function hideAuthOverlay() {
  setDisplay("authOverlay", "none");
}

export function clearOtpInputs(prefix) {
  for (var i = 1; i <= 6; i++) {
    var el = document.getElementById(prefix + "Otp" + i);
    if (el) el.value = "";
  }
}
export function otpAutoAdvance(current, nextId) {
  if (current.value.length >= 1) {
    var next = document.getElementById(nextId);
    if (next) next.focus();
  }
}
export function otpFinish(prefix) {
  // Auto-submit could go here; for now just collect
}
export function collectOtp(prefix) {
  var code = "";
  for (var i = 1; i <= 6; i++) {
    var el = document.getElementById(prefix + "Otp" + i);
    code += el ? (el.value || "") : "";
  }
  return code;
}

export function setFieldError(id, msg) {
  var el = document.getElementById(id);
  if (el) el.textContent = msg || "";
}

export function handleRegister() {
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

export function handleVerifyEmailOtp() {
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
    body: JSON.stringify({ email: state.pendingEmail, otp: otp }),
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      btn.disabled = false;
      if (data.ok && data.token) {
        state.authToken = data.token;
        localStorage.setItem("csb_session_token", data.token);
        state.currentUser = data.user;
        updateAuthUI();
        hideAuthOverlay();
        if (__continueInit) __continueInit();
        if (!state.currentUser.phoneVerified) {
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

export function handleResendEmailOtp() {
  if (!state.pendingEmail) return;
  fetch("/api/auth/resend-email-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: state.pendingEmail }),
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

export function handleLogin() {
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
        state.authToken = data.token;
        localStorage.setItem("csb_session_token", data.token);
        state.currentUser = data.user;
        updateAuthUI();
        hideAuthOverlay();
        if (__continueInit) __continueInit();
        if (!state.currentUser.phoneVerified && !state.currentUser.firstLoginCompleted) {
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

export function handleVerifyPhoneOtp() {
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
        if (state.currentUser) state.currentUser.phoneVerified = true;
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

export function handleForgotPassword() {
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

export function handleResendPhoneOtp() {
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

export function logout() {
  fetch("/api/auth/logout", { method: "POST" })
    .then(function() {
      state.authToken = "";
      state.currentUser = null;
      localStorage.removeItem("csb_session_token");
      window.location.reload();
    })
    .catch(function() {
      state.authToken = "";
      state.currentUser = null;
      localStorage.removeItem("csb_session_token");
      window.location.reload();
    });
}
