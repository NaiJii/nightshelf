export function throwIfAborted(signal?: AbortSignal): void {
  // React Native's AbortSignal does not expose the browser's throwIfAborted method.
  if (signal?.aborted) { const error = new Error("Operation cancelled."); error.name = "AbortError"; throw error; }
}

let foreground = 0;
export async function withForeground<T>(operation: () => Promise<T>): Promise<T> {
  foreground++;
  try { return await operation(); } finally { foreground--; }
}
export async function yieldToForeground(signal?: AbortSignal): Promise<void> {
  while (foreground > 0) { throwIfAborted(signal); await new Promise(resolve => setTimeout(resolve, 50)); }
  throwIfAborted(signal);
}

export async function withLinkedAbort<T>(signals: AbortSignal[], operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of signals) { if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true }); }
  try { return await withAbort(() => operation(controller.signal), controller.signal); }
  catch (error) { controller.abort(); throw error; }
  finally { for (const signal of signals) signal.removeEventListener("abort", abort); }
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
