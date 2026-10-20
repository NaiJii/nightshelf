export function throwIfAborted(signal?: AbortSignal): void {
  // React Native's AbortSignal does not expose the browser's throwIfAborted method.
  if (signal?.aborted) { const error = new Error("Operation cancelled."); error.name = "AbortError"; throw error; }
}

export function withAbort<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation();
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); const error = new Error("Operation cancelled."); error.name = "AbortError"; reject(error); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { throwIfAborted(signal); return operation(); }).then(value => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) abort(); else resolve(value);
    }, error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}
