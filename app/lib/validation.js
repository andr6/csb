function validatePrompt(prompt) {
  if (!prompt || typeof prompt !== "string") return "Prompt is required.";
  if (prompt.trim().length < 3) return "Prompt too short.";
  if (prompt.length > 1500) return "Prompt too long (max 1500 chars).";
  return null;
}

function clampScore(value) {
  var n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// Check whether a contestant response looks like a real LLM text answer
// rather than an HTML error page, rate-limit message, or provider boilerplate.
function validateContestantResponse(text) {
  if (!text || typeof text !== "string") {
    return { ok: false, reason: "Empty or non-string response." };
  }
  var t = text.trim();
  if (!t) {
    return { ok: false, reason: "Empty response." };
  }
  // HTML error pages
  if (/^\s*<\!DOCTYPE\s/i.test(t) || /^\s*<html\b/i.test(t)) {
    return { ok: false, reason: "Response appears to be an HTML error page." };
  }
  // Known provider error boilerplate
  var errorPatterns = [
    /rate limit/i, /too many requests/i, /server error/i, /bad gateway/i,
    /gateway timeout/i, /service unavailable/i, /overloaded/i, /maintenance/i,
    /\[error:/i, /\{\"error\":/i, /<\?xml\s+version/i,
  ];
  for (var i = 0; i < errorPatterns.length; i++) {
    if (errorPatterns[i].test(t)) {
      return { ok: false, reason: "Response matches provider error pattern." };
    }
  }
  // If the text is >50% HTML tags, reject it
  var tagMatches = t.match(/<[\w\/][^>]*>/g);
  if (tagMatches && tagMatches.length > 5 && (tagMatches.length / t.split(/\s+/).length) > 0.5) {
    return { ok: false, reason: "Response appears to be mostly HTML markup." };
  }
  return { ok: true };
}

module.exports = {
  validatePrompt: validatePrompt,
  clampScore: clampScore,
  validateContestantResponse: validateContestantResponse,
};
