function throwIfNotMemory(memory) {
  if (!(memory instanceof WebAssembly.Memory)) {
    throw new WebAssembly.RuntimeError();
  }
}

function throwIfNotString(a) {
  if (typeof a !== "string") {
    throw new WebAssembly.RuntimeError();
  }
}

function checkUTF16MemoryRange(memory, start, end) {
  throwIfNotMemory(memory);
  if (start > end ||
      end > BigInt(memory.buffer.byteLength)) {
    throw new WebAssembly.RuntimeError();
  }
  if (start & 1n || end & 1n) {
    throw new WebAssembly.RuntimeError();
  }
}

this.polyfillImports = {
  decodeStringFromUTF16Memory: (memory, start, end) => {
    start = BigInt.asUintN(64, start);
    end = BigInt.asUintN(64, end);
    checkUTF16MemoryRange(memory, start, end);
    // Reference implementation of the WHATWG utf-16le decoder with
    // fatal: false, ignoreBOM: false.
    let view = new DataView(memory.buffer);
    let codeUnits = [];
    for (let i = Number(start); i < Number(end); i += 2) {
      codeUnits.push(view.getUint16(i, true));
    }
    if (codeUnits[0] === 0xFEFF) {
      codeUnits.shift();
    }
    let result = "";
    for (let i = 0; i < codeUnits.length; i++) {
      let codeUnit = codeUnits[i];
      if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF &&
          i + 1 < codeUnits.length &&
          codeUnits[i + 1] >= 0xDC00 && codeUnits[i + 1] <= 0xDFFF) {
        result += String.fromCharCode(codeUnit, codeUnits[++i]);
      } else if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) {
        result += "\uFFFD";
      } else {
        result += String.fromCharCode(codeUnit);
      }
    }
    return result;
  },
  encodeStringIntoUTF16Memory: (memory, string, start, end) => {
    start = BigInt.asUintN(64, start);
    end = BigInt.asUintN(64, end);
    throwIfNotMemory(memory);
    throwIfNotString(string);
    checkUTF16MemoryRange(memory, start, end);
    if (BigInt(string.length * 2) > end - start) {
      throw new WebAssembly.RuntimeError();
    }
    let view = new DataView(memory.buffer);
    let offset = Number(start);
    for (let i = 0; i < string.length; i++) {
      let codeUnit = string.charCodeAt(i);
      if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF &&
          string.charCodeAt(i + 1) >= 0xDC00 &&
          string.charCodeAt(i + 1) <= 0xDFFF) {
        // valid surrogate pair, write both code units
        view.setUint16(offset + 2 * i, codeUnit, true);
        i++;
        codeUnit = string.charCodeAt(i);
      } else if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) {
        // unpaired surrogate
        codeUnit = 0xFFFD;
      }
      view.setUint16(offset + 2 * i, codeUnit, true);
    }
    return BigInt(string.length * 2);
  },
};
