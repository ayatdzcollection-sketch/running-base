import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

// ── Service-worker update flow ──────────────────────────────
// The app precaches its shell so it opens offline. The cost of that is a stale
// cache: the plugin's DEFAULT injected registration only called
// navigator.serviceWorker.register(), with no update check and no reload — so a
// new deploy first appeared on the SECOND reload, and on an installed iOS PWA
// (which rarely re-checks on its own) often not at all.
//
// registerType is 'autoUpdate', so this virtual-module registration applies a
// waiting worker and reloads the page once it takes control. That makes "reload
// and you're on the new version" actually true, which is the behaviour we want.
//
// Build-only: no service worker exists in dev, where Vite serves fresh modules.
const UPDATE_CHECK_MS = 60 * 60 * 1000 // hourly re-check while the app stays open

// sw.js is generated with skipWaiting + clientsClaim, so a new worker activates
// and takes over the page as soon as it installs. That alone is NOT enough: the
// page you are looking at already loaded the OLD html/js/css, so without a
// reload the update is invisible and you have to refresh a second time. Reload
// once when control actually changes hands.
//
// `hadController` guards the very first install, where control passes from
// nobody to the new worker — there is nothing stale on screen then, so reloading
// would just be a pointless flash. `reloading` guards against a reload loop.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return
    reloading = true
    window.location.reload()
  })
}

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return
    // An installed PWA can sit open for days, so poll for a new deploy, and
    // check again whenever it returns to the foreground — the moment a phone
    // user is most likely to be staring at stale content.
    const check = () => { void registration.update() }
    setInterval(check, UPDATE_CHECK_MS)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check()
    })
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
