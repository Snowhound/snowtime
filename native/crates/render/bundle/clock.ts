const RealDate = Date

// Only the measurement harness supplies a clock. Preserve Date's call and constructor forms.
export function installClock(now?: number | null) {
  globalThis.Date =
    now == null
      ? RealDate
      : new Proxy(RealDate, {
          construct(target, args, newTarget) {
            return Reflect.construct(target, args.length ? args : [now], newTarget)
          },
          get(target, key, receiver) {
            return key === 'now' ? () => now : Reflect.get(target, key, receiver)
          },
        })
  RealDate.prototype.constructor = globalThis.Date
}
