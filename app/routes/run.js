const express = require("express");
const path = require("path");
const fs = require("fs");

function createRunRouter(deps) {
  const router = express.Router();
  const getAnalysisRun = deps.getAnalysisRun;

  router.get("/run/:id", function(req, res, next) {
    const run = getAnalysisRun(req.params.id);
    if (!run) return next();
    const htmlPath = path.join(__dirname, "..", "public", "index.html");
    let html = fs.readFileSync(htmlPath, "utf8");
    const title = "CSB Run — " + (run.crownModelId || "unknown") + " took the crown";
    const desc = "Prompt: " + (run.prompt || "").slice(0, 160);
    html = html.replace("<title>CSB — Chat Shit Bob</title>", "<title>" + title + "</title>");
    html = html.replace(
      '<meta property="og:description" content="The AI benchmarking show nobody asked for. We rank which LLM gave the sh*ttest answer.">',
      '<meta property="og:description" content="' + desc + '">'
    );
    html = html.replace(
      '<meta property="og:title" content="CSB — Chat Shit Bob">',
      '<meta property="og:title" content="' + title + '">'
    );
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  });

  return router;
}

module.exports = { createRunRouter };
