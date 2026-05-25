const { runSqlParams, queryJson } = require("../sqlite");

function submitPrompt(prompt, mode) {
  const safePrompt = String(prompt || "").slice(0, 500);
  const safeMode = ["rage", "absurd", "truth"].includes(mode) ? mode : "absurd";
  runSqlParams(
    "INSERT INTO pending_prompts (prompt, mode, status, submitted_at) VALUES (?, ?, 'pending', ?)",
    [safePrompt, safeMode, new Date().toISOString()]
  );
}

function listPending() {
  return queryJson("SELECT * FROM pending_prompts WHERE status = 'pending' ORDER BY submitted_at DESC;");
}

function approvePrompt(id) {
  runSqlParams(
    "UPDATE pending_prompts SET status = 'approved', reviewed_at = ? WHERE id = ?",
    [new Date().toISOString(), Number(id)]
  );
}

function rejectPrompt(id) {
  runSqlParams(
    "UPDATE pending_prompts SET status = 'rejected', reviewed_at = ? WHERE id = ?",
    [new Date().toISOString(), Number(id)]
  );
}

function getCommunityPrompts() {
  return queryJson("SELECT prompt, mode FROM pending_prompts WHERE status = 'approved' ORDER BY reviewed_at DESC LIMIT 100;");
}

module.exports = {
  submitPrompt: submitPrompt,
  listPending: listPending,
  approvePrompt: approvePrompt,
  rejectPrompt: rejectPrompt,
  getCommunityPrompts: getCommunityPrompts,
};
