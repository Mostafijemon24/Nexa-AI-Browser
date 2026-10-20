// MV3 service worker. Proves background lifecycle + chrome.storage isolation.
// No Node, no NEXA privileged APIs — only the standard extension surface.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ nexaTestInstalledAt: Date.now() })
})

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'PING') {
    chrome.storage.local.get(['nexaTestCount'], (res) => {
      const count = (res.nexaTestCount || 0) + 1
      chrome.storage.local.set({ nexaTestCount: count })
      sendResponse({ type: 'PONG', count })
    })
    return true // async response
  }
  return false
})
