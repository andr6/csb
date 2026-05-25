function normalizeFilterOptions(opts, maxLimit) {
  const input = opts || {};
  const cap = (maxLimit != null) ? Math.max(1, Number(maxLimit)) : 500;
  return {
    limit: Math.max(1, Math.min(cap, Number(input.limit || 20))),
    offset: Math.max(0, Number(input.offset || 0)),
    crownModelId: input.crownModelId ? String(input.crownModelId) : "",
    query: String(input.query || "").trim().toLowerCase(),
    status: input.status ? String(input.status) : "",
    contestantProvider: input.contestantProvider ? String(input.contestantProvider) : "",
    judgeProvider: input.judgeProvider ? String(input.judgeProvider) : "",
    failedModelId: input.failedModelId ? String(input.failedModelId) : "",
    dateFrom: input.dateFrom ? String(input.dateFrom) : "",
    dateTo: input.dateTo ? String(input.dateTo) : "",
    phase: input.phase ? String(input.phase) : "",
    trendDays: Math.max(1, Math.min(90, Number(input.trendDays || 7))),
    scenarioRuns: Math.max(1, Math.min(10000, Number(input.scenarioRuns || 100))),
    analyticsLimit: Math.max(100, Math.min(10000, Number(input.analyticsLimit || 5000))),
    isChallenge: (input.isChallenge === "true" || input.isChallenge === true) ? 1 : null,
  };
}

module.exports = { normalizeFilterOptions: normalizeFilterOptions };
