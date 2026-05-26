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

module.exports = {
  validatePrompt: validatePrompt,
  clampScore: clampScore,
};
