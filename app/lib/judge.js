const { VALID_MODELS } = require("./config");
const { clampScore } = require("./validation");

const JUDGE_SYSTEM_PROMPT =
  'You are "Chat Shit Bob" — a brutally honest, zero-filter AI judge who scores AI responses for how shitty they are. ' +
  "Output ONLY valid JSON — no markdown fences, no preamble, no text outside the JSON object.";

const SCORING_CRITERIA = [
  { key: "disclaimers",   label: "Unnecessary disclaimers or warnings (+20)" },
  { key: "evasion",       label: "Dodging / being evasive (+15)" },
  { key: "corporate",     label: "Corporate / sycophantic language (+15)" },
  { key: "as_an_ai",      label: '"As an AI" self-references (+25)' },
  { key: "hallucination", label: "Hallucinating with confidence (+20)" },
  { key: "boring",        label: "Criminally boring / safe answer (+15)" },
  { key: "tryhard",       label: "Trying too hard to be clever (+10)" },
];

const VALID_CRITERIA_KEYS = SCORING_CRITERIA.map(function(c) { return c.key; });

function buildJudgePrompt(prompt, responses, criteria) {
  const activeIds = Object.keys(responses);
  const lines = activeIds.map(function(id) {
    const name = id.charAt(0).toUpperCase() + id.slice(1);
    return "[" + name + "]: " + (responses[id] || "(no response)");
  }).join("\n\n");

  const activeCriteria = Array.isArray(criteria) && criteria.length
    ? SCORING_CRITERIA.filter(function(c) { return criteria.indexOf(c.key) !== -1; })
    : SCORING_CRITERIA;

  const criteriaLines = activeCriteria.map(function(c) { return "- " + c.label; });

  return [
    "Score " + activeIds.length + " AI responses 0-100 (higher = shittier).",
    "",
    'ORIGINAL PROMPT: "' + prompt + '"',
    "",
    "THE RESPONSES:",
    lines,
    "",
    "SCORING CRITERIA:",
    criteriaLines.join("\n"),
    "",
    "Respond ONLY in this exact JSON — no markdown, no text outside the JSON:",
    '{"scores":{' + activeIds.map(function(id) { return '"' + id + '":null'; }).join(",") + '},' +
    '"verdicts":{' + activeIds.map(function(id) { return '"' + id + '":"one line verdict"'; }).join(",") + '},' +
    '"crown":"model_id_with_highest_score",' +
    '"roast":"one sentence global roast"}',
  ].join("\n");
}

function computeMedianScores(payloads, responseKeys) {
  if (!payloads || !payloads.length) return null;
  if (payloads.length === 1) return payloads[0];

  const modelIds = (Array.isArray(responseKeys) && responseKeys.length) ? responseKeys : VALID_MODELS;
  const medianScores = {};
  const confidence = {};

  modelIds.forEach(function(id) {
    const allScores = payloads.map(function(p) { return p.scores && p.scores[id] !== undefined ? Number(p.scores[id]) : 0; }).sort(function(a, b) { return a - b; });
    const mid = Math.floor(allScores.length / 2);
    medianScores[id] = allScores.length % 2 !== 0 ? allScores[mid] : Math.round((allScores[mid - 1] + allScores[mid]) / 2);
    const spread = allScores[allScores.length - 1] - allScores[0];
    confidence[id] = spread <= 10 ? "high" : spread <= 20 ? "medium" : "low";
  });

  const crown = modelIds.reduce(function(bestId, currentId) {
    return medianScores[currentId] > medianScores[bestId] ? currentId : bestId;
  }, modelIds[0]);

  const roast = payloads[Math.floor(payloads.length / 2)].roast || "";
  const verdicts = payloads[Math.floor(payloads.length / 2)].verdicts || {};

  return { scores: medianScores, verdicts: verdicts, crown: crown, roast: roast, judgeConfidence: confidence };
}

function parseJudgeResponse(raw) {
  var text = String(raw || "").trim();
  var cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^json\s*/i, "")
    .replace(/^here\s+(?:is|are)\s+(?:the\s+)?(?:json|response|result)[^\{]*/i, "")
    .trim();

  var firstBrace = cleaned.indexOf("{");
  var lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch (e1) {
    var repaired = cleaned;

    // Fix missing colon after property name: "key" "value" → "key": "value"
    repaired = repaired.replace(/("(?:[^"\\]|\\.)*")\s+([{["0-9\-tfn])/g, "$1: $2");

    // Fix trailing commas before closing brace/bracket
    repaired = repaired.replace(/,\s*([}\]])/g, "$1");

    try {
      return JSON.parse(repaired);
    } catch (e2) {
      // Last resort: close unclosed braces/arrays
      var opens = (repaired.match(/{/g) || []).length - (repaired.match(/}/g) || []).length;
      var arrOpens = (repaired.match(/\[/g) || []).length - (repaired.match(/\]/g) || []).length;
      if (opens > 0 && opens <= 3 && arrOpens >= 0 && arrOpens <= 3) {
        for (var a = 0; a < arrOpens; a++) repaired += "]";
        for (var o = 0; o < opens; o++) repaired += "}";
        try {
          return JSON.parse(repaired);
        } catch (e3) {
          throw e1;
        }
      }
      throw e1;
    }
  }
}

function normalizeJudgePayload(judgement, responseKeys) {
  if (!VALID_MODELS.length) {
    throw new Error("No valid models configured. Check ACTIVE_MODELS in .env.");
  }
  if (!judgement || typeof judgement !== "object") {
    throw new Error("Judge returned empty payload.");
  }

  // Scope to responseKeys when provided (VERSUS/CUSTOM modes) — prevents zero-score
  // pollution of analytics for models that didn't participate in a run.
  const modelIds = (Array.isArray(responseKeys) && responseKeys.length) ? responseKeys : VALID_MODELS;

  const scores = {};
  const verdicts = {};

  modelIds.forEach(function(id) {
    const rawScore = judgement.scores && judgement.scores[id];
    const rawVerdict = judgement.verdicts && judgement.verdicts[id];
    scores[id] = clampScore(rawScore);
    verdicts[id] = typeof rawVerdict === "string" ? rawVerdict.trim().slice(0, 240) : "";
  });

  const crown = modelIds.includes(judgement.crown)
    ? judgement.crown
    : modelIds.reduce(function(bestId, currentId) {
        return scores[currentId] > scores[bestId] ? currentId : bestId;
      }, modelIds[0]);

  return {
    scores: scores,
    verdicts: verdicts,
    crown: crown,
    roast: typeof judgement.roast === "string" ? judgement.roast.trim().slice(0, 400) : "",
  };
}

module.exports = {
  JUDGE_SYSTEM_PROMPT: JUDGE_SYSTEM_PROMPT,
  SCORING_CRITERIA: SCORING_CRITERIA,
  VALID_CRITERIA_KEYS: VALID_CRITERIA_KEYS,
  buildJudgePrompt: buildJudgePrompt,
  computeMedianScores: computeMedianScores,
  parseJudgeResponse: parseJudgeResponse,
  normalizeJudgePayload: normalizeJudgePayload,
};
