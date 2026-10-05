// In-memory stand-in for the few Redis commands the leaderboard uses, so the local
// dev server and the tests run the exact same command sequences without a database.
export function memoryRedis() {
  const data = new Map(); // key -> { value, expiresAt }

  const get = (key) => {
    const item = data.get(key);
    if (item && item.expiresAt <= Date.now()) data.delete(key);
    return data.get(key)?.value;
  };
  const set = (key, value, ttl) => data.set(key, { value, expiresAt: ttl ? Date.now() + ttl * 1000 : Infinity });
  // Same order as Redis: by score, ties by name
  const sorted = (key) => [...(get(key) ?? new Map())]
    .sort(([a, x], [b, y]) => x - y || (a < b ? -1 : a > b ? 1 : 0));

  const commands = {
    ZADD(key, ...args) {
      const lt = args[0] === "LT";
      const [score, member] = lt ? args.slice(1) : args;
      const zset = get(key) ?? new Map();
      const old = zset.get(member);
      if (old === undefined || !lt || score < old) zset.set(member, Number(score));
      set(key, zset);
      return old === undefined ? 1 : 0;
    },
    ZREMRANGEBYRANK(key, start, stop) {
      const items = sorted(key);
      const end = stop < 0 ? items.length + stop : stop;
      const doomed = items.slice(start, end + 1);
      doomed.forEach(([member]) => get(key).delete(member));
      return doomed.length;
    },
    ZRANGE(key, start, stop, withScores) {
      const items = sorted(key).slice(start, stop + 1);
      return withScores ? items.flatMap(([m, s]) => [m, String(s)]) : items.map(([m]) => m);
    },
    SET(key, value, ex, ttl, nx) {
      if (nx === "NX" && get(key) !== undefined) return null;
      set(key, String(value), ex === "EX" ? ttl : 0);
      return "OK";
    },
    INCR(key) {
      const value = Number(get(key) ?? 0) + 1;
      data.set(key, { ...(data.get(key) ?? { expiresAt: Infinity }), value: String(value) });
      return value;
    },
  };

  const run = async (cmds) => cmds.map(([name, ...args]) => commands[name](...args));
  return { pipeline: run, transaction: run };
}
