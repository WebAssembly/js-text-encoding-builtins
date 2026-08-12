# JS Text Encoding Builtins

## Overview

Building on top of the [JS String Builtins proposal](https://github.com/WebAssembly/js-string-builtins) this proposal adds builtins for encoding and decoding UTF-8 strings in linear memory to and from JavaScript strings, as well as builtins for copying JavaScript strings to and from linear memory as well-formed UTF-16.

## Goals

This proposal intends to serve Wasm toolchains that store strings in UTF-8. The provided functions should not require additional memory copies on the users side nor should the user have to account for engine-specific optimizations.

A good example is [Emscripten's implementation](https://github.com/emscripten-core/emscripten/blob/2760f83517e969fc31e19c3f11b973bfad5f6951/src/lib/libstrings.js#L33-L93), which specifically optimizes string decoding for short strings. Optimizations like these should be handled by the implementer, not the user.

When encoding JS strings to linear memory, memory has to be pre-allocated on the users side. This often is implemented with various optimizations strategies to avoid the overhead of measuring the resulting UTF-8 string size. Addressing this is a non-goal of this proposal.

## API

### "wasm:text-encoding" "decodeStringFromUTF8Array"

```js
/// Decode the specified GC `array` range using UTF-8 into a JS string.
///
/// This function traps if `array` is `null`.
///
/// The range is given by [start, end). This function traps if the range is
/// outside the bounds of `array`.
func decodeStringFromUTF8Array(
  array: ref null (array (mut i8)),
  start: i32,
  end: i32
) -> (ref extern)
{
  start >>>= 0;
  end >>>= 0;

  if (array === null)
    trap();

  if (start > end ||
      end > array.length)
    trap();

  let decoder = new TextDecoder("utf-8", {
    fatal: false,
    ignoreBOM: false,
  });
  let bytesLength = end - start;
  let view = new Uint8Array(array, start, bytesLength);

  return decoder.decode(view);
}
```

### "wasm:text-encoding" "decodeStringFromUTF8Memory"

```js
/// Decode the specified `WebAssembly.Memory` range using UTF-8 into a JS string.
///
/// This function traps if `memory` is not a `WebAssembly.Memory`.
///
/// The range is given by [start, end). This function traps if the range is
/// outside the bounds of the memory.
func decodeStringFromUTF8Memory(
  memory: externref,
  start: i64,
  end: i64
) -> (ref extern)
{
  start >>>= 0;
  end >>>= 0;

  if (!(memory instanceof WebAssembly.Memory))
    trap();

  if (start > end ||
      end > memory.buffer.length)
    trap();

  let decoder = new TextDecoder("utf-8", {
    fatal: false,
    ignoreBOM: false,
  });
  let bytesLength = end - start;
  let view = new Uint8Array(memory, start, bytesLength);

  return decoder.decode(view);
}
```

### "wasm:text-encoding" "measureStringAsUTF8"

```js
/// Returns the number of bytes a JS string would occupy when encoded as UTF-8.
///
/// This function traps if `string` is not a JS string.
func measureStringAsUTF8(
  string: externref
) -> i64
{
  if (typeof string !== "string")
    trap();

  let encoder = new TextEncoder();
  let bytes = encoder.encode(string);

  return bytes.length;
}
```

### "wasm:text-encoding" "encodeStringIntoUTF8Array"

```js
/// Encode a JS string into a GC `array` using
/// the UTF-8 encoding. This uses the replacement character for unpaired
/// surrogates and so it doesn't support lossless round-tripping with
/// `decodeStringFromUTF8Array`.
///
/// Returns the number of bytes read and written.
///
/// This function traps if `array` or `string` are not a GC `array` and `string` respectively.
///
/// The memory range is given by [start, end). This function traps if the range is
/// outside the bounds of the `array`.
func encodeStringIntoUTF8Array(
  array: ref null (array (mut i8))
  string: externref,
  start: i32,
  end: i32
) -> (i32, i32)
{
  start >>>= 0;
  end >>>= 0;

  if (array === null)
    trap();

  if (typeof string !== "string")
    trap();
    
  if (start > end ||
      end > array.length)
    trap();

  let encoder = new TextEncoder();
  let bytesLength = end - start;
  let view = new Uint8Array(array, start, bytesLength);

  let { read, written } = encoder.encodeInto(view);
  return [read, written];
}
```

### "wasm:text-encoding" "encodeStringIntoUTF8Memory"

```js
/// Encode a JS string into `WebAssembly.Memory` using
/// the UTF-8 encoding. This uses the replacement character for unpaired
/// surrogates and so it doesn't support lossless round-tripping with
/// `decodeStringFromUTF8Memory`.
///
/// Returns the number of bytes read and written.
///
/// This function traps if `memory` or `string` are not `WebAssembly.Memory` and `string` respectively.
///
/// The memory range is given by [start, end). This function traps if the range is
/// outside the bounds of the memory.
func encodeStringIntoUTF8Memory(
  memory: externref
  string: externref,
  start: i64,
  end: i64
) -> (i64, i64)
{
  start >>>= 0;
  end >>>= 0;

  if (!(memory instanceof WebAssembly.Memory))
    trap();

  if (typeof string !== "string")
    trap();
    
  if (start > end ||
      end > memory.buffer.length)
    trap();

  let encoder = new TextEncoder();
  let bytesLength = end - start;
  let view = new Uint8Array(memory, start, bytesLength);

  let { read, written } = encoder.encodeInto(view);
  return [read, written];
}
```

### "wasm:text-encoding" "decodeStringFromUTF16Memory"

```js
/// Decode the specified `WebAssembly.Memory` range using UTF-16LE into a JS
/// string. Following the WHATWG `utf-16le` decoder, unpaired surrogates are
/// replaced with the replacement character (U+FFFD), so the result is always
/// well-formed.
///
/// This function traps if `memory` is not a `WebAssembly.Memory`.
///
/// The range is given by [start, end) in bytes. This function traps if the
/// range is outside the bounds of the memory, or if `start` or `end` are not
/// 2-byte aligned.
func decodeStringFromUTF16Memory(
  memory: externref,
  start: i64,
  end: i64
) -> (ref extern)
{
  start >>>= 0;
  end >>>= 0;

  if (!(memory instanceof WebAssembly.Memory))
    trap();

  if (start > end ||
      end > memory.buffer.length)
    trap();

  if (start & 1 || end & 1)
    trap();

  let decoder = new TextDecoder("utf-16le", {
    fatal: false,
    ignoreBOM: false,
  });
  let bytesLength = end - start;
  let view = new Uint8Array(memory, start, bytesLength);

  return decoder.decode(view);
}
```

### "wasm:text-encoding" "encodeStringIntoUTF16Memory"

```js
/// Encode a JS string into `WebAssembly.Memory` using the UTF-16LE encoding.
/// The string is converted to well-formed UTF-16 with the same semantics as
/// WebIDL `USVString` conversion and `String.prototype.toWellFormed()`:
/// unpaired surrogates are replaced with the replacement character (U+FFFD).
/// It therefore doesn't support lossless round-tripping of arbitrary JS
/// strings.
///
/// Returns the number of bytes written, which is equal to twice the length
/// of the string, since the replacement is size-preserving.
///
/// This function traps if `memory` or `string` are not `WebAssembly.Memory` and `string` respectively.
///
/// The destination range is given by [start, end) in bytes. This function
/// traps if the range is outside the bounds of the memory, if `start` or
/// `end` are not 2-byte aligned, or if the string doesn't fit into the range.
func encodeStringIntoUTF16Memory(
  memory: externref,
  string: externref,
  start: i64,
  end: i64
) -> i64
{
  start >>>= 0;
  end >>>= 0;

  if (!(memory instanceof WebAssembly.Memory))
    trap();

  if (typeof string !== "string")
    trap();

  if (start > end ||
      end > memory.buffer.length)
    trap();

  if (start & 1 || end & 1)
    trap();

  if (string.length * 2 > end - start)
    trap();

  let view = new DataView(memory.buffer);
  for (let i = 0; i < string.length; i++) {
    let codeUnit = string.charCodeAt(i);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF &&
        string.charCodeAt(i + 1) >= 0xDC00 && string.charCodeAt(i + 1) <= 0xDFFF) {
      // valid surrogate pair, write both code units
      view.setUint16(start + 2 * i, codeUnit, true);
      i++;
      codeUnit = string.charCodeAt(i);
    } else if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) {
      // unpaired surrogate
      codeUnit = 0xFFFD;
    }
    view.setUint16(start + 2 * i, codeUnit, true);
  }
  return string.length * 2;
}
```

## FAQ

### What about WTF-16 user strings?

A more appropriate proposal already exists: [Reference-Typed Strings](https://github.com/WebAssembly/stringref). Notably it does not work with linear memory to facilitate zero-copy handling of WTF-16 host strings.

The UTF-16 memory builtins in this proposal deliberately do not preserve WTF-16: unpaired surrogates are always replaced with U+FFFD, so only well-formed UTF-16 is ever written or produced, consistent with the UTF-8 builtins. On encoding this substitution is exactly WebIDL `USVString` conversion / `String.prototype.toWellFormed()`, and on decoding it follows the WHATWG `utf-16le` decoder. For lossless WTF-16 copying between JS strings and GC arrays, js-string-builtins already provides [`"wasm:js-string" "fromCharCodeArray"` and `"wasm:js-string" "intoCharCodeArray"`](https://github.com/WebAssembly/js-string-builtins/blob/main/proposals/js-string-builtins/Overview.md#function-builtins); lossless WTF-16 memory variants could be added as a follow-up if a round-tripping use case is presented.

### Why is there no `measureStringAsUTF16`?

UTF-16 encoding with surrogate replacement is size-preserving (U+FFFD is a single code unit), so the encoded size in code units is exactly the string length, already available via [`"wasm:js-string" "length"`](https://github.com/WebAssembly/js-string-builtins/blob/main/proposals/js-string-builtins/Overview.md#wasmjs-string-length).

### How is an `externref` for `WebAssembly.Memory` retrieved?

This is left to toolchains to figure out. Currently this is already possible by initializing `WebAssembly.Memory` in JS and importing it to Wasm. Alternatively the memory can be exported and then retrieved via an import function through `WebAssembly.Instance.exports`.

### What about worklets?

While according to the WHATWG Encoding Standard the Text Encoding API should be exposed in worklets, this is [still an unclear edge-case](https://github.com/WebAudio/web-audio-api/issues/2499). However, most of the discussion is [centered around allocating APIs](https://github.com/whatwg/encoding/issues/356) like `TextEncode.encode()`, which we don't use here.

### What about substring de/encoding?

The JS String Builtins proposal already exposes [`"wasm:js-string" "substring"`](https://github.com/WebAssembly/js-string-builtins/blob/81bfc5fb7b8277c6b7d1b0a8f6e57cb31a7bf080/proposals/js-string-builtins/Overview.md#wasmjs-string-substring). So instead of making the API more complex, we can let users extract a desirable substring.

### `"wasm:text-encoding"` vs `"wasm:js/text-encoding"`.

There is an [ongoing discussion](https://github.com/WebAssembly/esm-integration/issues/118) to change the mapping for JS builtins. Either convention works for us in this proposal.

### Why do the provided functions take `i64` instead of `i32`?

This enables support for the Memory64 proposal.
