// META: global=window,dedicatedworker,jsshell,shadowrealm
// META: script=/wasm/jsapi/assertions.js
// META: script=/wasm/jsapi/wasm-module-builder.js
// META: script=/wasm/jsapi/text-encoding/polyfill.js

// The list of builtins and their signatures.
let builtins;

// Generate two sets of exports, one from a polyfill implementation and another
// from the builtins provided by the host.
let polyfillExports;
let builtinExports;
setup(() => {
  // Compile a module that exports a function for each builtin that will call
  // it. We could just generate a module that re-exports the builtins, but that
  // would not catch any special codegen that could happen when direct calling
  // a known builtin function from wasm.
  const builder = new WasmModuleBuilder();
  builtins = [
    {
      name: "decodeStringFromUTF16Memory",
      params: [kWasmExternRef, kWasmI64, kWasmI64],
      results: [wasmRefType(kWasmExternRef)],
    },
    {
      name: "encodeStringIntoUTF16Memory",
      params: [kWasmExternRef, kWasmExternRef, kWasmI64, kWasmI64],
      results: [kWasmI64],
    },
  ];

  // Add a function type for each builtin
  for (let builtin of builtins) {
    builtin.type = builder.addType({
      params: builtin.params,
      results: builtin.results
    });
  }

  // Add an import for each builtin
  for (let builtin of builtins) {
    builtin.importFuncIndex = builder.addImport(
      "wasm:text-encoding",
      builtin.name,
      builtin.type);
  }

  // Generate an exported function to call the builtin
  for (let builtin of builtins) {
    let func = builder.addFunction(builtin.name + "Imp", builtin.type);
    let body = [];
    for (let i = 0; i < builtin.params.length; i++) {
      body.push(kExprLocalGet);
      body.push(...wasmSignedLeb(i));
    }
    body.push(kExprCallFunction);
    body.push(...wasmSignedLeb(builtin.importFuncIndex));
    func.addBody(body);
    func.exportAs(builtin.name);
  }

  const buffer = builder.toBuffer();

  // Instantiate this module using the builtins from the host
  const builtinModule = new WebAssembly.Module(buffer, {
    builtins: ["text-encoding"]
  });
  const builtinInstance = new WebAssembly.Instance(builtinModule, {});
  builtinExports = builtinInstance.exports;

  // Instantiate this module using the polyfill module
  const polyfillModule = new WebAssembly.Module(buffer);
  const polyfillInstance = new WebAssembly.Instance(polyfillModule, {
    "wasm:text-encoding": polyfillImports
  });
  polyfillExports = polyfillInstance.exports;
});

// A helper function to assert that the behavior of two functions are the
// same.
function assert_same_behavior(funcA, funcB, ...params) {
  let resultA;
  let errA = null;
  try {
    resultA = funcA(...params);
  } catch (err) {
    errA = err;
  }

  let resultB;
  let errB = null;
  try {
    resultB = funcB(...params);
  } catch (err) {
    errB = err;
  }

  if (errA || errB) {
    assert_equals(errA === null, errB === null, errA ? errA.message : errB.message);
    assert_equals(Object.getPrototypeOf(errA), Object.getPrototypeOf(errB));
  }
  assert_equals(resultA, resultB);

  if (errA) {
    throw errA;
  }
  return resultA;
}

function assert_throws_if(func, shouldThrow, constructor) {
  let error = null;
  try {
    func();
  } catch (e) {
    error = e;
  }
  assert_equals(error !== null, shouldThrow, "shouldThrow mismatch");
  if (shouldThrow && error !== null) {
    assert_true(error instanceof constructor);
  }
}

// Encode a string with both the builtin and the polyfill into separate
// memories, asserting identical trap behavior, return values, and full
// memory contents.
function assert_same_encode_behavior(string, start, end) {
  const memoryA = new WebAssembly.Memory({ initial: 1 });
  const memoryB = new WebAssembly.Memory({ initial: 1 });

  let resultA;
  let errA = null;
  try {
    resultA = builtinExports['encodeStringIntoUTF16Memory'](memoryA, string, start, end);
  } catch (err) {
    errA = err;
  }

  let resultB;
  let errB = null;
  try {
    resultB = polyfillExports['encodeStringIntoUTF16Memory'](memoryB, string, start, end);
  } catch (err) {
    errB = err;
  }

  if (errA || errB) {
    assert_equals(errA === null, errB === null, errA ? errA.message : errB.message);
    assert_equals(Object.getPrototypeOf(errA), Object.getPrototypeOf(errB));
  }
  assert_equals(resultA, resultB);

  const bytesA = new Uint8Array(memoryA.buffer);
  const bytesB = new Uint8Array(memoryB.buffer);
  for (let i = 0; i < bytesA.length; i++) {
    if (bytesA[i] !== bytesB[i]) {
      assert_equals(bytesA[i], bytesB[i], `memory contents at byte ${i}`);
    }
  }

  if (errA) {
    throw errA;
  }
  return resultA;
}

// Write UTF-16LE code units into a memory and return the [start, end) range
// they occupy.
function writeCodeUnits(memory, start, codeUnits) {
  const view = new DataView(memory.buffer);
  for (let i = 0; i < codeUnits.length; i++) {
    view.setUint16(start + 2 * i, codeUnits[i], true);
  }
  return [BigInt(start), BigInt(start + 2 * codeUnits.length)];
}

// Read UTF-16LE code units back out of a memory range.
function readCodeUnits(memory, start, end) {
  const view = new DataView(memory.buffer);
  const codeUnits = [];
  for (let i = Number(start); i < Number(end); i += 2) {
    codeUnits.push(view.getUint16(i, true));
  }
  return codeUnits;
}

// Constant values used in the tests below
const testStrings = [
  "",
  "a",
  "1",
  "ab",
  "hello, world",
  "\n",
  "☺",
  "☺☺",
  String.fromCodePoint(0x10000, 0x10001)
];
const testExternRefValues = [
  null,
  undefined,
  true,
  false,
  {x:1337},
  ["abracadabra"],
  13.37,
  -0,
  0x7fffffff + 0.1,
  -0x7fffffff - 0.1,
  0x80000000 + 0.1,
  -0x80000000 - 0.1,
  0xffffffff + 0.1,
  -0xffffffff - 0.1,
  Number.EPSILON,
  Number.MAX_SAFE_INTEGER,
  Number.MIN_SAFE_INTEGER,
  Number.MIN_VALUE,
  Number.MAX_VALUE,
  Number.NaN,
  "hi",
  37n,
  new Number(42),
  new Boolean(true),
  Symbol("status"),
  () => 1337,
  new WebAssembly.Memory({ initial: 1 }),
];

// Decoding golden values, following the WHATWG utf-16le decoder with
// fatal: false, ignoreBOM: false.
const decodeCases = [
  { codeUnits: [], expected: "" },
  { codeUnits: [0x61], expected: "a" },
  { codeUnits: [0x61, 0x62], expected: "ab" },
  { codeUnits: [0x00], expected: "\0" },
  { codeUnits: [0x263A], expected: "☺" },
  // valid surrogate pairs
  { codeUnits: [0xD800, 0xDC00], expected: "\u{10000}" },
  { codeUnits: [0xD800, 0xDC01], expected: "\u{10001}" },
  { codeUnits: [0xDBFF, 0xDFFF], expected: "\u{10FFFF}" },
  // unpaired lead surrogate at end of input
  { codeUnits: [0x61, 0xD800], expected: "a\uFFFD" },
  // unpaired lead surrogate followed by a BMP code unit
  { codeUnits: [0xD800, 0x61], expected: "\uFFFDa" },
  // unpaired lead surrogate followed by another lead surrogate
  { codeUnits: [0xD800, 0xD800, 0xDC00], expected: "\uFFFD\u{10000}" },
  // unpaired trail surrogates
  { codeUnits: [0xDC00], expected: "\uFFFD" },
  { codeUnits: [0xDC00, 0xD800, 0xDC00], expected: "\uFFFD\u{10000}" },
  // replacement characters are decoded as-is
  { codeUnits: [0xFFFD], expected: "\uFFFD" },
  // a leading BOM is stripped
  { codeUnits: [0xFEFF, 0x61], expected: "a" },
  { codeUnits: [0xFEFF], expected: "" },
  { codeUnits: [0xFEFF, 0xFEFF], expected: "\uFEFF" },
  // a non-leading BOM code unit is kept
  { codeUnits: [0x61, 0xFEFF], expected: "a\uFEFF" },
  // U+FFFE is not a BOM for utf-16le
  { codeUnits: [0xFFFE, 0x61], expected: "\uFFFEa" },
];

// Encoding golden values, matching WebIDL USVString conversion /
// String.prototype.toWellFormed().
const encodeCases = [
  { string: "", codeUnits: [] },
  { string: "a", codeUnits: [0x61] },
  { string: "hello, world", codeUnits: [...Array(12)].map((_, i) => "hello, world".charCodeAt(i)) },
  { string: "☺", codeUnits: [0x263A] },
  // valid surrogate pairs are preserved
  { string: "\u{10000}", codeUnits: [0xD800, 0xDC00] },
  { string: "\u{10FFFF}", codeUnits: [0xDBFF, 0xDFFF] },
  // unpaired surrogates are replaced with U+FFFD
  { string: "\uD800", codeUnits: [0xFFFD] },
  { string: "a\uDC00b", codeUnits: [0x61, 0xFFFD, 0x62] },
  { string: "\uDC00\uD800", codeUnits: [0xFFFD, 0xFFFD] },
  { string: "\uD800\uD800\uDC00", codeUnits: [0xFFFD, 0xD800, 0xDC00] },
  // a BOM is neither added nor stripped on encode
  { string: "\uFEFF", codeUnits: [0xFEFF] },
];

// Test that non-memory and non-string values trap for both builtins.
test(() => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  for (let a of testExternRefValues) {
    let isMemory = a instanceof WebAssembly.Memory;
    let isString = typeof a === "string";

    assert_throws_if(() => assert_same_behavior(
        builtinExports['decodeStringFromUTF16Memory'],
        polyfillExports['decodeStringFromUTF16Memory'],
        a, 0n, 0n
      ), !isMemory, WebAssembly.RuntimeError);

    assert_throws_if(() => assert_same_behavior(
        builtinExports['encodeStringIntoUTF16Memory'],
        polyfillExports['encodeStringIntoUTF16Memory'],
        a, "", 0n, 0n
      ), !isMemory, WebAssembly.RuntimeError);

    assert_throws_if(() => assert_same_behavior(
        builtinExports['encodeStringIntoUTF16Memory'],
        polyfillExports['encodeStringIntoUTF16Memory'],
        memory, a, 0n, 8n
      ), !isString, WebAssembly.RuntimeError);
  }
});

// Test decoding of golden UTF-16LE code unit sequences, at the start of the
// memory and at an interior offset.
test(() => {
  for (let { codeUnits, expected } of decodeCases) {
    for (let offset of [0, 0x100]) {
      const memory = new WebAssembly.Memory({ initial: 1 });
      const [start, end] = writeCodeUnits(memory, offset, codeUnits);
      const result = assert_same_behavior(
        builtinExports['decodeStringFromUTF16Memory'],
        polyfillExports['decodeStringFromUTF16Memory'],
        memory, start, end
      );
      assert_equals(result, expected);
    }
  }
});

// Test encoding of golden strings, checking the written code units, the
// returned byte count, and that memory outside the range is untouched.
test(() => {
  for (let { string, codeUnits } of encodeCases) {
    for (let offset of [0, 0x100]) {
      const written = assert_same_encode_behavior(
        string, BigInt(offset), BigInt(offset + 2 * string.length));
      assert_equals(written, BigInt(2 * string.length));

      const memory = new WebAssembly.Memory({ initial: 1 });
      builtinExports['encodeStringIntoUTF16Memory'](
        memory, string, BigInt(offset), BigInt(offset + 2 * string.length));
      const writtenUnits = readCodeUnits(
        memory, offset, offset + 2 * string.length);
      assert_equals(writtenUnits.length, codeUnits.length);
      for (let i = 0; i < codeUnits.length; i++) {
        assert_equals(writtenUnits[i], codeUnits[i], `code unit ${i}`);
      }

      const bytes = new Uint8Array(memory.buffer);
      for (let i = 0; i < bytes.length; i++) {
        if (i < offset || i >= offset + 2 * string.length) {
          assert_equals(bytes[i], 0, `memory untouched at byte ${i}`);
        }
      }
    }
  }
});

// Test that encoding then decoding round-trips as well-formed UTF-16.
test(() => {
  for (let string of testStrings) {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const written = assert_same_behavior(
      builtinExports['encodeStringIntoUTF16Memory'],
      polyfillExports['encodeStringIntoUTF16Memory'],
      memory, string, 0n, BigInt(2 * string.length)
    );
    assert_equals(written, BigInt(2 * string.length));

    const result = assert_same_behavior(
      builtinExports['decodeStringFromUTF16Memory'],
      polyfillExports['decodeStringFromUTF16Memory'],
      memory, 0n, written
    );
    assert_equals(result, string);
  }
});

// Test range and alignment trap conditions.
test(() => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const decode = (start, end) => assert_same_behavior(
    builtinExports['decodeStringFromUTF16Memory'],
    polyfillExports['decodeStringFromUTF16Memory'],
    memory, start, end
  );
  const encode = (string, start, end) => assert_same_behavior(
    builtinExports['encodeStringIntoUTF16Memory'],
    polyfillExports['encodeStringIntoUTF16Memory'],
    memory, string, start, end
  );
  const kPageEnd = BigInt(kPageSize);

  // unaligned start or end traps
  assert_throws_if(() => decode(1n, 4n), true, WebAssembly.RuntimeError);
  assert_throws_if(() => decode(0n, 3n), true, WebAssembly.RuntimeError);
  assert_throws_if(() => encode("a", 1n, 4n), true, WebAssembly.RuntimeError);
  assert_throws_if(() => encode("a", 0n, 3n), true, WebAssembly.RuntimeError);

  // start > end traps
  assert_throws_if(() => decode(4n, 2n), true, WebAssembly.RuntimeError);
  assert_throws_if(() => encode("", 4n, 2n), true, WebAssembly.RuntimeError);

  // end out of bounds traps
  assert_throws_if(() => decode(0n, kPageEnd + 2n), true, WebAssembly.RuntimeError);
  assert_throws_if(() => decode(kPageEnd + 2n, kPageEnd + 4n), true, WebAssembly.RuntimeError);
  assert_throws_if(() => encode("a", kPageEnd, kPageEnd + 2n), true, WebAssembly.RuntimeError);

  // i64 range values beyond 32 bits trap as out of bounds
  assert_throws_if(() => decode(0n, 1n << 33n), true, WebAssembly.RuntimeError);
  assert_throws_if(() => decode(1n << 33n, (1n << 33n) + 2n), true, WebAssembly.RuntimeError);
  // negative i64 values are interpreted as unsigned and trap as out of bounds
  assert_throws_if(() => decode(-2n, -2n), true, WebAssembly.RuntimeError);
  assert_throws_if(() => encode("", -2n, -2n), true, WebAssembly.RuntimeError);

  // a string that doesn't fit into the destination range traps
  assert_throws_if(() => encode("abc", 0n, 4n), true, WebAssembly.RuntimeError);
  assert_throws_if(() => encode("a", 0n, 0n), true, WebAssembly.RuntimeError);

  // ranges up to the end of the memory succeed
  assert_equals(encode("abc", kPageEnd - 6n, kPageEnd), 6n);
  assert_equals(decode(kPageEnd - 6n, kPageEnd), "abc");
  assert_equals(decode(kPageEnd, kPageEnd), "");

  // an oversized destination range only writes the string
  assert_equals(encode("hi", 0n, 8n), 4n);
  assert_equals(decode(0n, 4n), "hi");
});

// Test that incorrect import types are rejected, even if they have correct
// signatures.
test(() => {
  for (let builtin of builtins) {
    const builder = new WasmModuleBuilder();
    // The type is wrong because it is in a nontrivial rec group.
    const typeIndex = builder.nextTypeIndex();
    builder.startRecGroup();
    builder.addType({
      params: builtin.params,
      results: builtin.results
    });
    builder.addStruct([]);
    builder.endRecGroup();

    builder.addImport(
      "wasm:text-encoding",
      builtin.name,
      typeIndex);

    const buffer = builder.toBuffer();

    // Validation should fail.
    assert_false(WebAssembly.validate(buffer, { builtins: ["text-encoding"] }));

    // Compilation should fail.
    assert_throws_js(WebAssembly.CompileError, () => {
      new WebAssembly.Module(buffer, { builtins: ["text-encoding"] });
    });
  }
}, "Incorrect types");
