import {
  _authToken, _currentUser, _pendingEmail, _lastConfig,
  setDisplay,
} from './state.js';
function showAuthRegister() {
  setDisplay("authRegisterView", "block");
  setDisplay("authEmailOtpView", "none");
  setDisplay("authLoginView", "none");
  setDisplay("authPhoneOtpView", "none");
  setDisplay("authForgotPasswordView", "none");
}
function showAuthLogin() {
  setDisplay("authRegisterView", "none");
  setDisplay("authEmailOtpView", "none");
  setDisplay("authLoginView", "block");
  setDisplay("authPhoneOtpView", "none");
  setDisplay("authForgotPasswordView", "none");
}
function showAuthEmailOtp(email) {
  _pendingEmail = email || "";
  document.getElementById("emailOtpTarget").textContent = _pendingEmail;
  setDisplay("authRegisterView", "none");
  setDisplay("authEmailOtpView", "block");
  setDisplay("authLoginView", "none");
  setDisplay("authPhoneOtpView", "none");
  setDisplay("authForgotPasswordView", "none");
  clearOtpInputs("email");
}
function showAuthPhoneOtp() {
  setDisplay("authRegisterView", "none");
  setDisplay("authEmailOtpView", "none");
  setDisplay("authLoginView", "none");
  setDisplay("authForgotPasswordView", "none");
  setDisplay("authPhoneOtpView", "block");
  clearOtpInputs("phone");
}
function showAuthForgotPassword() {
  setDisplay("authRegisterView", "none");
  setDisplay("authEmailOtpView", "none");
  setDisplay("authLoginView", "none");
  setDisplay("authPhoneOtpView", "none");
  setDisplay("authForgotPasswordView", "block");
}
function hideAuthOverlay() {
  setDisplay("authOverlay", "none");
}

function clearOtpInputs(prefix) {
  for (var i = 1; i <= 6; i++) {
    var el = document.getElementById(prefix + "Otp" + i);
    if (el) el.value = "";
  }
}
function otpAutoAdvance(current, nextId) {
  if (current.value.length >= 1) {
    var next = document.getElementById(nextId);
    if (next) next.focus();
  }
}
function otpFinish(prefix) {
  // Auto-submit could go here; for now just collect
}
function collectOtp(prefix) {
  var code = "";
  for (var i = 1; i <= 6; i++) {
    var el = document.getElementById(prefix + "Otp" + i);
    code += el ? (el.value || "") : "";
  }
  return code;
}

function setFieldError(id, msg) {
  var el = document.getElementById(id);
  if (el) el.textContent = msg || "";
}


export {
  showAuthRegister, showAuthLogin, showAuthEmailOtp, showAuthPhoneOtp, showAuthForgotPassword,
  hideAuthOverlay, clearOtpInputs, otpAutoAdvance, otpFinish, collectOtp, setFieldError,
};
