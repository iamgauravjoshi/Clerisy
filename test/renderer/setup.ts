// Fills in browser APIs that jsdom lacks, for renderer tests (main-process tests run in Node and skip this).
// Electron's Chromium has all of them; these stand-ins only model what the components rely on.

if (typeof window !== 'undefined') {
  const proto = Object.getPrototypeOf(document.createElement('dialog')) as HTMLDialogElement
  if (typeof proto.showModal !== 'function') {
    // showModal/close toggle `open` and fire `close`, like the real ones; Escape is simulated by firing `cancel`
    Object.assign(proto, {
      showModal(this: HTMLDialogElement) {
        this.setAttribute('open', '')
      },
      show(this: HTMLDialogElement) {
        this.setAttribute('open', '')
      },
      close(this: HTMLDialogElement) {
        if (!this.hasAttribute('open')) return
        this.removeAttribute('open')
        this.dispatchEvent(new Event('close'))
      }
    })
    Object.defineProperty(proto, 'open', {
      get(this: HTMLDialogElement) {
        return this.hasAttribute('open')
      },
      configurable: true
    })
  }

  // jsdom doesn't lay anything out, so scrolling an element into view is a no-op here; tests can spy on it
  if (typeof Element.prototype.scrollIntoView !== 'function') Element.prototype.scrollIntoView = () => {}

  // the app's default window width (BrowserWindow width: 1280); a test can shrink it to check the compact layout
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true })

  // evaluates min-width/max-width against window.innerWidth; other queries never match
  window.matchMedia = (query: string) => {
    const min = query.match(/min-width:\s*(\d+)px/)
    const max = query.match(/max-width:\s*(\d+)px/)
    const matches = (min || max) !== null && (!min || window.innerWidth >= Number(min[1])) && (!max || window.innerWidth <= Number(max[1]))
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false
    } as MediaQueryList
  }
}
