// Keep progress ticks out of the app context so list rows are not rerendered.
const listeners = new Set<() => void>();
let progress: number | "pending" | null = null;

export const refreshProgress = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  snapshot: () => progress,
  set(value: typeof progress) {
    if (value === progress) return;
    progress = value;
    listeners.forEach(listener => listener());
  },
};
