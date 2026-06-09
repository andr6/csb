import { state } from "./state.js";

export function loadModerationPanel() {
  if (!state.isAnalyticsPage) return;
  var panel = document.getElementById("moderationPanel");
  var list = document.getElementById("moderationList");
  if (!panel || !list) return;
  panel.style.display = "block";
  list.innerHTML = '<div class="mod-empty">loading&hellip;</div>';

  fetch("/api/prompts/pending")
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function(data) {
      var items = (data && Array.isArray(data.items)) ? data.items : [];
      list.innerHTML = "";
      if (!items.length) {
        var empty = document.createElement("div");
        empty.className = "mod-empty";
        empty.textContent = "no pending prompts — queue is empty";
        list.appendChild(empty);
        return;
      }
      items.forEach(function(item) {
        var id = Number(item.id);
        var div = document.createElement("div");
        div.className = "mod-item";

        var info = document.createElement("div");
        info.className = "mod-info";

        var promptEl = document.createElement("div");
        promptEl.className = "mod-prompt";
        promptEl.textContent = String(item.prompt || "");

        var metaEl = document.createElement("div");
        metaEl.className = "mod-meta";
        metaEl.textContent = "submitted " + (item.submittedAt ? String(item.submittedAt).slice(0, 10) : "unknown");

        info.appendChild(promptEl);
        info.appendChild(metaEl);

        var actions = document.createElement("div");
        actions.className = "mod-actions";

        var approveBtn = document.createElement("button");
        approveBtn.className = "mod-btn approve";
        approveBtn.textContent = "✓ approve";
        approveBtn.addEventListener("click", function() { moderatePrompt(id, "approve"); });

        var rejectBtn = document.createElement("button");
        rejectBtn.className = "mod-btn reject";
        rejectBtn.textContent = "✗ reject";
        rejectBtn.addEventListener("click", function() { moderatePrompt(id, "reject"); });

        actions.appendChild(approveBtn);
        actions.appendChild(rejectBtn);
        div.appendChild(info);
        div.appendChild(actions);
        list.appendChild(div);
      });
    })
    .catch(function(status) {
      list.innerHTML = "";
      var err = document.createElement("div");
      err.className = "mod-error";
      err.textContent = "failed to load pending prompts" + (status ? " (HTTP " + status + ")" : "");
      list.appendChild(err);
    });
}

export function moderatePrompt(id, action) {
  if (!state.isAnalyticsPage) return;
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
