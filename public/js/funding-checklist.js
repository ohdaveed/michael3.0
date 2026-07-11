// Trust funding checklist (localStorage-persisted)
(function () {
  var list = document.getElementById("fundingChecklistList");
  if (!list) return;

  // Checkbox state is keyed by each item's data-funding-id (see below), so
  // renaming or removing an id just orphans its old localStorage entry
  // rather than corrupting others — no migration needed for item changes.
  var STORAGE_KEY = "lehr-law-funding-checklist";
  var track = document.getElementById("fundingProgress");
  var fill = document.getElementById("fundingProgressFill");
  var label = document.getElementById("fundingProgressLabel");
  var checkboxes = Array.prototype.slice.call(
    list.querySelectorAll('input[type="checkbox"]'),
  );
  var total = checkboxes.length;

  function loadState() {
    try {
      return JSON.parse(window.localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function saveState(state) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // localStorage unavailable (private browsing, quota) - degrade to session-only state
    }
  }

  function updateProgress() {
    var checked = checkboxes.filter(function (cb) {
      return cb.checked;
    }).length;
    var pct = total ? Math.round((checked / total) * 100) : 0;
    fill.style.width = pct + "%";
    if (track) track.setAttribute("aria-valuenow", String(pct));
    label.textContent = checked + " of " + total + " assets retitled";
  }

  var state = loadState();
  checkboxes.forEach(function (cb) {
    var id = cb.getAttribute("data-funding-id");
    if (state[id]) cb.checked = true;
    cb.addEventListener("change", function () {
      var current = loadState();
      current[id] = cb.checked;
      saveState(current);
      updateProgress();
    });
  });

  updateProgress();
})();
