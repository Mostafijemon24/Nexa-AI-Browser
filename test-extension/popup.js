// Sandboxed popup script. Only chrome.storage — no Node, no NEXA IPC.
chrome.storage.local.get(['nexaTestCount'], (res) => {
  const el = document.getElementById('count')
  if (el) el.textContent = String(res.nexaTestCount || 0)
})
