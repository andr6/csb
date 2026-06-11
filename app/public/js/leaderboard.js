import { state } from "./state.js";
import { setDisplay } from "./utils.js";
import { buildLeaderboardRow } from "./ui.js";

export function renderLeaderboard() {
  if (state.isAnalyticsPage) {
    setDisplay("leaderboard", "none");
    return;
  }
  var lb = document.getElementById("leaderboard");
  if (!lb) return;
  var items = state.worstAnswers || [];
  lb.style.display = items.length ? "block" : "none";
  var list = document.getElementById("lbList");
  if (!list) return;
  list.textContent = "";
  if (!items.length) {
    var empty = document.createElement("div");
    empty.className = "lb-empty";
    empty.style.cssText = "color:var(--muted);font-size:.7rem;text-align:center;padding:1.2rem";
    empty.textContent = "No qualifying low-scoring runs yet.";
    list.appendChild(empty);
    return;
  }
  items.slice(0, 10).forEach(function(entry, index) {
    list.appendChild(buildLeaderboardRow(entry, index + 1));
  });
}
