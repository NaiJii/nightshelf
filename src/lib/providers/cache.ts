export class PageCache<Key, Value> {
  private entries = new Map<Key, { at: number; value: Value }>();
  get(key: Key, refresh = false): Value | undefined {
    const entry = this.entries.get(key);
    return !refresh && entry && Date.now() - entry.at <= 10 * 60_000 ? entry.value : undefined;
  }
  set(key: Key, value: Value): Value {
    this.entries.set(key, { at: Date.now(), value });
    if (this.entries.size > 30) this.entries.delete(this.entries.keys().next().value!);
    return value;
  }
}
