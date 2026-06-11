const test = require("node:test");
const assert = require("node:assert/strict");

const { createTtlCache } = require("../lib/cache");

test("createTtlCache get returns undefined for missing key", function() {
  var cache = createTtlCache(1000);
  assert.equal(cache.get("nope"), undefined);
});

test("createTtlCache set and get round-trip", function() {
  var cache = createTtlCache(1000);
  cache.set("key1", "value1");
  assert.equal(cache.get("key1"), "value1");
});

test("createTtlCache entries expire after TTL", async function() {
  var cache = createTtlCache(50);
  cache.set("key1", "value1");
  assert.equal(cache.get("key1"), "value1");
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  assert.equal(cache.get("key1"), undefined);
});

test("createTtlCache clear removes all entries", function() {
  var cache = createTtlCache(1000);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.clear();
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("b"), undefined);
});

test("createTtlCache keys are independent", function() {
  var cache = createTtlCache(1000);
  cache.set("a", 1);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), 1);
});

test("createTtlCache stores objects and arrays", function() {
  var cache = createTtlCache(1000);
  cache.set("obj", { nested: true });
  cache.set("arr", [1, 2, 3]);
  assert.deepEqual(cache.get("obj"), { nested: true });
  assert.deepEqual(cache.get("arr"), [1, 2, 3]);
});

test("createTtlCache expired entry is deleted on access", async function() {
  var cache = createTtlCache(10);
  cache.set("key", "val");
  await new Promise(function(resolve) { setTimeout(resolve, 30); });
  assert.equal(cache.get("key"), undefined);
});
