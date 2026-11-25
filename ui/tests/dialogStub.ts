/**
 * jsdom has no `HTMLDialogElement.showModal` / `close`: a minimal stand-in so
 * components built on `ModalShell` (native modal <dialog>) can be mounted.
 */
export function installDialogStub(): void {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { __lmStub?: boolean }
  if (proto.__lmStub) return
  proto.__lmStub = true
  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  proto.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
}
