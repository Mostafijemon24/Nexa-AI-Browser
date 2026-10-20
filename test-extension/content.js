// Content script — runs in an ISOLATED world on https://example.com/*.
// It has no access to Node, window.nexa, or NEXA internals; only chrome.* and
// the page DOM. Used to prove content-script injection + storage round-trip.
;(() => {
  const marker = document.createElement('div')
  marker.id = 'nexa-test-extension-marker'
  marker.style.display = 'none'
  marker.textContent = 'NEXA test extension content script active'
  document.documentElement.appendChild(marker)

  chrome.runtime.sendMessage({ type: 'PING' }, (res) => {
    if (res && res.type === 'PONG') {
      marker.dataset.count = String(res.count)
    }
  })
})()
