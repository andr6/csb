function createTtlCache(ttlMs) {
  var store = new Map();
  return {
    get: function(key) {
      var entry = store.get(key);
      if (!entry) return undefined;
      if (Date.now() - entry.at > ttlMs) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set: function(key, value) {
      store.set(key, { value: value, at: Date.now() });
    },
    clear: function() {
      store.clear();
    },
  };
}

module.exports = { createTtlCache: createTtlCache };
