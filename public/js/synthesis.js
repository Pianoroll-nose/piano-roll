// Copyright 2010 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

// The Module object: Our interface to the outside world. We import
// and export values on it. There are various ways Module can be used:
// 1. Not defined. We create it here
// 2. A function parameter, function(Module) { ..generated code.. }
// 3. pre-run appended it, var Module = {}; ..generated code..
// 4. External script tag defines var Module.
// We need to check if Module already exists (e.g. case 3 above).
// Substitution will be replaced with actual code on later stage of the build,
// this way Closure Compiler will not mangle it (e.g. case 4. above).
// Note that if you want to run closure, and also to use Module
// after the generated code, you will need to define   var Module = {};
// before the code. Then that object will be used in the code, and you
// can continue to use Module afterwards as well.
var Module = typeof Module !== 'undefined' ? Module : {};

// --pre-jses are emitted after the Module integration code, so that they can
// refer to Module (if they choose; they can also define Module)


// Sometimes an existing Module object exists with properties
// meant to overwrite the default module functionality. Here
// we collect those properties and reapply _after_ we configure
// the current environment's defaults to avoid having to be so
// defensive during initialization.
var moduleOverrides = {};
var key;
for (key in Module) {
  if (Module.hasOwnProperty(key)) {
    moduleOverrides[key] = Module[key];
  }
}

Module['arguments'] = [];
Module['thisProgram'] = './this.program';
Module['quit'] = function(status, toThrow) {
  throw toThrow;
};
Module['preRun'] = [];
Module['postRun'] = [];

// Determine the runtime environment we are in. You can customize this by
// setting the ENVIRONMENT setting at compile time (see settings.js).

var ENVIRONMENT_IS_WEB = false;
var ENVIRONMENT_IS_WORKER = false;
var ENVIRONMENT_IS_NODE = false;
var ENVIRONMENT_IS_SHELL = false;
ENVIRONMENT_IS_WEB = typeof window === 'object';
ENVIRONMENT_IS_WORKER = typeof importScripts === 'function';
ENVIRONMENT_IS_NODE = typeof process === 'object' && typeof require === 'function' && !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_WORKER;
ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;


// Three configurations we can be running in:
// 1) We could be the application main() thread running in the main JS UI thread. (ENVIRONMENT_IS_WORKER == false and ENVIRONMENT_IS_PTHREAD == false)
// 2) We could be the application main() thread proxied to worker. (with Emscripten -s PROXY_TO_WORKER=1) (ENVIRONMENT_IS_WORKER == true, ENVIRONMENT_IS_PTHREAD == false)
// 3) We could be an application pthread running in a worker. (ENVIRONMENT_IS_WORKER == true and ENVIRONMENT_IS_PTHREAD == true)

// `/` should be present at the end if `scriptDirectory` is not empty
var scriptDirectory = '';
function locateFile(path) {
  if (Module['locateFile']) {
    return Module['locateFile'](path, scriptDirectory);
  } else {
    return scriptDirectory + path;
  }
}

if (ENVIRONMENT_IS_NODE) {
  scriptDirectory = __dirname + '/';

  // Expose functionality in the same simple way that the shells work
  // Note that we pollute the global namespace here, otherwise we break in node
  var nodeFS;
  var nodePath;

  Module['read'] = function shell_read(filename, binary) {
    var ret;
    ret = tryParseAsDataURI(filename);
    if (!ret) {
      if (!nodeFS) nodeFS = require('fs');
      if (!nodePath) nodePath = require('path');
      filename = nodePath['normalize'](filename);
      ret = nodeFS['readFileSync'](filename);
    }
    return binary ? ret : ret.toString();
  };

  Module['readBinary'] = function readBinary(filename) {
    var ret = Module['read'](filename, true);
    if (!ret.buffer) {
      ret = new Uint8Array(ret);
    }
    assert(ret.buffer);
    return ret;
  };

  if (process['argv'].length > 1) {
    Module['thisProgram'] = process['argv'][1].replace(/\\/g, '/');
  }

  Module['arguments'] = process['argv'].slice(2);

  if (typeof module !== 'undefined') {
    module['exports'] = Module;
  }

  process['on']('uncaughtException', function(ex) {
    // suppress ExitStatus exceptions from showing an error
    if (!(ex instanceof ExitStatus)) {
      throw ex;
    }
  });
  // Currently node will swallow unhandled rejections, but this behavior is
  // deprecated, and in the future it will exit with error status.
  process['on']('unhandledRejection', abort);

  Module['quit'] = function(status) {
    process['exit'](status);
  };

  Module['inspect'] = function () { return '[Emscripten Module object]'; };
} else
if (ENVIRONMENT_IS_SHELL) {


  if (typeof read != 'undefined') {
    Module['read'] = function shell_read(f) {
      var data = tryParseAsDataURI(f);
      if (data) {
        return intArrayToString(data);
      }
      return read(f);
    };
  }

  Module['readBinary'] = function readBinary(f) {
    var data;
    data = tryParseAsDataURI(f);
    if (data) {
      return data;
    }
    if (typeof readbuffer === 'function') {
      return new Uint8Array(readbuffer(f));
    }
    data = read(f, 'binary');
    assert(typeof data === 'object');
    return data;
  };

  if (typeof scriptArgs != 'undefined') {
    Module['arguments'] = scriptArgs;
  } else if (typeof arguments != 'undefined') {
    Module['arguments'] = arguments;
  }

  if (typeof quit === 'function') {
    Module['quit'] = function(status) {
      quit(status);
    }
  }
} else
if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
  if (ENVIRONMENT_IS_WORKER) { // Check worker, not web, since window could be polyfilled
    scriptDirectory = self.location.href;
  } else if (document.currentScript) { // web
    scriptDirectory = document.currentScript.src;
  }
  // blob urls look like blob:http://site.com/etc/etc and we cannot infer anything from them.
  // otherwise, slice off the final part of the url to find the script directory.
  // if scriptDirectory does not contain a slash, lastIndexOf will return -1,
  // and scriptDirectory will correctly be replaced with an empty string.
  if (scriptDirectory.indexOf('blob:') !== 0) {
    scriptDirectory = scriptDirectory.substr(0, scriptDirectory.lastIndexOf('/')+1);
  } else {
    scriptDirectory = '';
  }


  Module['read'] = function shell_read(url) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.send(null);
      return xhr.responseText;
    } catch (err) {
      var data = tryParseAsDataURI(url);
      if (data) {
        return intArrayToString(data);
      }
      throw err;
    }
  };

  if (ENVIRONMENT_IS_WORKER) {
    Module['readBinary'] = function readBinary(url) {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, false);
        xhr.responseType = 'arraybuffer';
        xhr.send(null);
        return new Uint8Array(xhr.response);
      } catch (err) {
        var data = tryParseAsDataURI(url);
        if (data) {
          return data;
        }
        throw err;
      }
    };
  }

  Module['readAsync'] = function readAsync(url, onload, onerror) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = function xhr_onload() {
      if (xhr.status == 200 || (xhr.status == 0 && xhr.response)) { // file URLs can return 0
        onload(xhr.response);
        return;
      }
      var data = tryParseAsDataURI(url);
      if (data) {
        onload(data.buffer);
        return;
      }
      onerror();
    };
    xhr.onerror = onerror;
    xhr.send(null);
  };

  Module['setWindowTitle'] = function(title) { document.title = title };
} else
{
}

// Set up the out() and err() hooks, which are how we can print to stdout or
// stderr, respectively.
// If the user provided Module.print or printErr, use that. Otherwise,
// console.log is checked first, as 'print' on the web will open a print dialogue
// printErr is preferable to console.warn (works better in shells)
// bind(console) is necessary to fix IE/Edge closed dev tools panel behavior.
var out = Module['print'] || (typeof console !== 'undefined' ? console.log.bind(console) : (typeof print !== 'undefined' ? print : null));
var err = Module['printErr'] || (typeof printErr !== 'undefined' ? printErr : ((typeof console !== 'undefined' && console.warn.bind(console)) || out));

// Merge back in the overrides
for (key in moduleOverrides) {
  if (moduleOverrides.hasOwnProperty(key)) {
    Module[key] = moduleOverrides[key];
  }
}
// Free the object hierarchy contained in the overrides, this lets the GC
// reclaim data used e.g. in memoryInitializerRequest, which is a large typed array.
moduleOverrides = undefined;

// perform assertions in shell.js after we set up out() and err(), as otherwise if an assertion fails it cannot print the message



// Copyright 2017 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

// {{PREAMBLE_ADDITIONS}}

var STACK_ALIGN = 16;


function dynamicAlloc(size) {
  var ret = HEAP32[DYNAMICTOP_PTR>>2];
  var end = (ret + size + 15) & -16;
  if (end <= _emscripten_get_heap_size()) {
    HEAP32[DYNAMICTOP_PTR>>2] = end;
  } else {
    var success = _emscripten_resize_heap(end);
    if (!success) return 0;
  }
  return ret;
}

function alignMemory(size, factor) {
  if (!factor) factor = STACK_ALIGN; // stack alignment (16-byte) by default
  return Math.ceil(size / factor) * factor;
}

function getNativeTypeSize(type) {
  switch (type) {
    case 'i1': case 'i8': return 1;
    case 'i16': return 2;
    case 'i32': return 4;
    case 'i64': return 8;
    case 'float': return 4;
    case 'double': return 8;
    default: {
      if (type[type.length-1] === '*') {
        return 4; // A pointer
      } else if (type[0] === 'i') {
        var bits = parseInt(type.substr(1));
        assert(bits % 8 === 0, 'getNativeTypeSize invalid bits ' + bits + ', type ' + type);
        return bits / 8;
      } else {
        return 0;
      }
    }
  }
}

function warnOnce(text) {
  if (!warnOnce.shown) warnOnce.shown = {};
  if (!warnOnce.shown[text]) {
    warnOnce.shown[text] = 1;
    err(text);
  }
}

var asm2wasmImports = { // special asm2wasm imports
    "f64-rem": function(x, y) {
        return x % y;
    },
    "debugger": function() {
        debugger;
    }
};



var jsCallStartIndex = 1;
var functionPointers = new Array(0);

// Add a wasm function to the table.
// Attempting to call this with JS function will cause of table.set() to fail
function addWasmFunction(func) {
  var table = Module['wasmTable'];
  var ret = table.length;
  table.grow(1);
  table.set(ret, func);
  return ret;
}

// 'sig' parameter is currently only used for LLVM backend under certain
// circumstance: RESERVED_FUNCTION_POINTERS=1, EMULATED_FUNCTION_POINTERS=0.
function addFunction(func, sig) {

  var base = 0;
  for (var i = base; i < base + 0; i++) {
    if (!functionPointers[i]) {
      functionPointers[i] = func;
      return jsCallStartIndex + i;
    }
  }
  throw 'Finished up all reserved function pointers. Use a higher value for RESERVED_FUNCTION_POINTERS.';

}

function removeFunction(index) {
  functionPointers[index-jsCallStartIndex] = null;
}

var funcWrappers = {};

function getFuncWrapper(func, sig) {
  if (!func) return; // on null pointer, return undefined
  assert(sig);
  if (!funcWrappers[sig]) {
    funcWrappers[sig] = {};
  }
  var sigCache = funcWrappers[sig];
  if (!sigCache[func]) {
    // optimize away arguments usage in common cases
    if (sig.length === 1) {
      sigCache[func] = function dynCall_wrapper() {
        return dynCall(sig, func);
      };
    } else if (sig.length === 2) {
      sigCache[func] = function dynCall_wrapper(arg) {
        return dynCall(sig, func, [arg]);
      };
    } else {
      // general case
      sigCache[func] = function dynCall_wrapper() {
        return dynCall(sig, func, Array.prototype.slice.call(arguments));
      };
    }
  }
  return sigCache[func];
}


function makeBigInt(low, high, unsigned) {
  return unsigned ? ((+((low>>>0)))+((+((high>>>0)))*4294967296.0)) : ((+((low>>>0)))+((+((high|0)))*4294967296.0));
}

function dynCall(sig, ptr, args) {
  if (args && args.length) {
    return Module['dynCall_' + sig].apply(null, [ptr].concat(args));
  } else {
    return Module['dynCall_' + sig].call(null, ptr);
  }
}

var tempRet0 = 0;

var setTempRet0 = function(value) {
  tempRet0 = value;
}

var getTempRet0 = function() {
  return tempRet0;
}


var Runtime = {
  // FIXME backwards compatibility layer for ports. Support some Runtime.*
  //       for now, fix it there, then remove it from here. That way we
  //       can minimize any period of breakage.
  dynCall: dynCall, // for SDL2 port
};

// The address globals begin at. Very low in memory, for code size and optimization opportunities.
// Above 0 is static memory, starting with globals.
// Then the stack.
// Then 'dynamic' memory for sbrk.
var GLOBAL_BASE = 1024;


// === Preamble library stuff ===

// Documentation for the public APIs defined in this file must be updated in:
//    site/source/docs/api_reference/preamble.js.rst
// A prebuilt local version of the documentation is available at:
//    site/build/text/docs/api_reference/preamble.js.txt
// You can also build docs locally as HTML or other formats in site/
// An online HTML version (which may be of a different version of Emscripten)
//    is up at http://kripken.github.io/emscripten-site/docs/api_reference/preamble.js.html



//========================================
// Runtime essentials
//========================================

// whether we are quitting the application. no code should run after this.
// set in exit() and abort()
var ABORT = false;

// set by exit() and abort().  Passed to 'onExit' handler.
// NOTE: This is also used as the process return code code in shell environments
// but only when noExitRuntime is false.
var EXITSTATUS = 0;

/** @type {function(*, string=)} */
function assert(condition, text) {
  if (!condition) {
    abort('Assertion failed: ' + text);
  }
}

var globalScope = this;

// Returns the C function with a specified identifier (for C++, you need to do manual name mangling)
function getCFunc(ident) {
  var func = Module['_' + ident]; // closure exported function
  assert(func, 'Cannot call unknown function ' + ident + ', make sure it is exported');
  return func;
}

var JSfuncs = {
  // Helpers for cwrap -- it can't refer to Runtime directly because it might
  // be renamed by closure, instead it calls JSfuncs['stackSave'].body to find
  // out what the minified function name is.
  'stackSave': function() {
    stackSave()
  },
  'stackRestore': function() {
    stackRestore()
  },
  // type conversion from js to c
  'arrayToC' : function(arr) {
    var ret = stackAlloc(arr.length);
    writeArrayToMemory(arr, ret);
    return ret;
  },
  'stringToC' : function(str) {
    var ret = 0;
    if (str !== null && str !== undefined && str !== 0) { // null string
      // at most 4 bytes per UTF-8 code point, +1 for the trailing '\0'
      var len = (str.length << 2) + 1;
      ret = stackAlloc(len);
      stringToUTF8(str, ret, len);
    }
    return ret;
  }
};

// For fast lookup of conversion functions
var toC = {
  'string': JSfuncs['stringToC'], 'array': JSfuncs['arrayToC']
};


// C calling interface.
function ccall(ident, returnType, argTypes, args, opts) {
  function convertReturnValue(ret) {
    if (returnType === 'string') return Pointer_stringify(ret);
    if (returnType === 'boolean') return Boolean(ret);
    return ret;
  }

  var func = getCFunc(ident);
  var cArgs = [];
  var stack = 0;
  if (args) {
    for (var i = 0; i < args.length; i++) {
      var converter = toC[argTypes[i]];
      if (converter) {
        if (stack === 0) stack = stackSave();
        cArgs[i] = converter(args[i]);
      } else {
        cArgs[i] = args[i];
      }
    }
  }
  var ret = func.apply(null, cArgs);
  ret = convertReturnValue(ret);
  if (stack !== 0) stackRestore(stack);
  return ret;
}

function cwrap(ident, returnType, argTypes, opts) {
  argTypes = argTypes || [];
  // When the function takes numbers and returns a number, we can just return
  // the original function
  var numericArgs = argTypes.every(function(type){ return type === 'number'});
  var numericRet = returnType !== 'string';
  if (numericRet && numericArgs && !opts) {
    return getCFunc(ident);
  }
  return function() {
    return ccall(ident, returnType, argTypes, arguments, opts);
  }
}

/** @type {function(number, number, string, boolean=)} */
function setValue(ptr, value, type, noSafe) {
  type = type || 'i8';
  if (type.charAt(type.length-1) === '*') type = 'i32'; // pointers are 32-bit
    switch(type) {
      case 'i1': HEAP8[((ptr)>>0)]=value; break;
      case 'i8': HEAP8[((ptr)>>0)]=value; break;
      case 'i16': HEAP16[((ptr)>>1)]=value; break;
      case 'i32': HEAP32[((ptr)>>2)]=value; break;
      case 'i64': (tempI64 = [value>>>0,(tempDouble=value,(+(Math_abs(tempDouble))) >= 1.0 ? (tempDouble > 0.0 ? ((Math_min((+(Math_floor((tempDouble)/4294967296.0))), 4294967295.0))|0)>>>0 : (~~((+(Math_ceil((tempDouble - +(((~~(tempDouble)))>>>0))/4294967296.0)))))>>>0) : 0)],HEAP32[((ptr)>>2)]=tempI64[0],HEAP32[(((ptr)+(4))>>2)]=tempI64[1]); break;
      case 'float': HEAPF32[((ptr)>>2)]=value; break;
      case 'double': HEAPF64[((ptr)>>3)]=value; break;
      default: abort('invalid type for setValue: ' + type);
    }
}

/** @type {function(number, string, boolean=)} */
function getValue(ptr, type, noSafe) {
  type = type || 'i8';
  if (type.charAt(type.length-1) === '*') type = 'i32'; // pointers are 32-bit
    switch(type) {
      case 'i1': return HEAP8[((ptr)>>0)];
      case 'i8': return HEAP8[((ptr)>>0)];
      case 'i16': return HEAP16[((ptr)>>1)];
      case 'i32': return HEAP32[((ptr)>>2)];
      case 'i64': return HEAP32[((ptr)>>2)];
      case 'float': return HEAPF32[((ptr)>>2)];
      case 'double': return HEAPF64[((ptr)>>3)];
      default: abort('invalid type for getValue: ' + type);
    }
  return null;
}

var ALLOC_NORMAL = 0; // Tries to use _malloc()
var ALLOC_STACK = 1; // Lives for the duration of the current function call
var ALLOC_DYNAMIC = 2; // Cannot be freed except through sbrk
var ALLOC_NONE = 3; // Do not allocate

// allocate(): This is for internal use. You can use it yourself as well, but the interface
//             is a little tricky (see docs right below). The reason is that it is optimized
//             for multiple syntaxes to save space in generated code. So you should
//             normally not use allocate(), and instead allocate memory using _malloc(),
//             initialize it with setValue(), and so forth.
// @slab: An array of data, or a number. If a number, then the size of the block to allocate,
//        in *bytes* (note that this is sometimes confusing: the next parameter does not
//        affect this!)
// @types: Either an array of types, one for each byte (or 0 if no type at that position),
//         or a single type which is used for the entire block. This only matters if there
//         is initial data - if @slab is a number, then this does not matter at all and is
//         ignored.
// @allocator: How to allocate memory, see ALLOC_*
/** @type {function((TypedArray|Array<number>|number), string, number, number=)} */
function allocate(slab, types, allocator, ptr) {
  var zeroinit, size;
  if (typeof slab === 'number') {
    zeroinit = true;
    size = slab;
  } else {
    zeroinit = false;
    size = slab.length;
  }

  var singleType = typeof types === 'string' ? types : null;

  var ret;
  if (allocator == ALLOC_NONE) {
    ret = ptr;
  } else {
    ret = [_malloc, stackAlloc, dynamicAlloc][allocator](Math.max(size, singleType ? 1 : types.length));
  }

  if (zeroinit) {
    var stop;
    ptr = ret;
    assert((ret & 3) == 0);
    stop = ret + (size & ~3);
    for (; ptr < stop; ptr += 4) {
      HEAP32[((ptr)>>2)]=0;
    }
    stop = ret + size;
    while (ptr < stop) {
      HEAP8[((ptr++)>>0)]=0;
    }
    return ret;
  }

  if (singleType === 'i8') {
    if (slab.subarray || slab.slice) {
      HEAPU8.set(/** @type {!Uint8Array} */ (slab), ret);
    } else {
      HEAPU8.set(new Uint8Array(slab), ret);
    }
    return ret;
  }

  var i = 0, type, typeSize, previousType;
  while (i < size) {
    var curr = slab[i];

    type = singleType || types[i];
    if (type === 0) {
      i++;
      continue;
    }

    if (type == 'i64') type = 'i32'; // special case: we have one i32 here, and one i32 later

    setValue(ret+i, curr, type);

    // no need to look up size unless type changes, so cache it
    if (previousType !== type) {
      typeSize = getNativeTypeSize(type);
      previousType = type;
    }
    i += typeSize;
  }

  return ret;
}

// Allocate memory during any stage of startup - static memory early on, dynamic memory later, malloc when ready
function getMemory(size) {
  if (!runtimeInitialized) return dynamicAlloc(size);
  return _malloc(size);
}

/** @type {function(number, number=)} */
function Pointer_stringify(ptr, length) {
  if (length === 0 || !ptr) return '';
  // Find the length, and check for UTF while doing so
  var hasUtf = 0;
  var t;
  var i = 0;
  while (1) {
    t = HEAPU8[(((ptr)+(i))>>0)];
    hasUtf |= t;
    if (t == 0 && !length) break;
    i++;
    if (length && i == length) break;
  }
  if (!length) length = i;

  var ret = '';

  if (hasUtf < 128) {
    var MAX_CHUNK = 1024; // split up into chunks, because .apply on a huge string can overflow the stack
    var curr;
    while (length > 0) {
      curr = String.fromCharCode.apply(String, HEAPU8.subarray(ptr, ptr + Math.min(length, MAX_CHUNK)));
      ret = ret ? ret + curr : curr;
      ptr += MAX_CHUNK;
      length -= MAX_CHUNK;
    }
    return ret;
  }
  return UTF8ToString(ptr);
}

// Given a pointer 'ptr' to a null-terminated ASCII-encoded string in the emscripten HEAP, returns
// a copy of that string as a Javascript String object.

function AsciiToString(ptr) {
  var str = '';
  while (1) {
    var ch = HEAP8[((ptr++)>>0)];
    if (!ch) return str;
    str += String.fromCharCode(ch);
  }
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in ASCII form. The copy will require at most str.length+1 bytes of space in the HEAP.

function stringToAscii(str, outPtr) {
  return writeAsciiToMemory(str, outPtr, false);
}

// Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the given array that contains uint8 values, returns
// a copy of that string as a Javascript String object.

var UTF8Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf8') : undefined;

function UTF8ArrayToString(u8Array, idx) {
  var endPtr = idx;
  // TextDecoder needs to know the byte length in advance, it doesn't stop on null terminator by itself.
  // Also, use the length info to avoid running tiny strings through TextDecoder, since .subarray() allocates garbage.
  while (u8Array[endPtr]) ++endPtr;

  if (endPtr - idx > 16 && u8Array.subarray && UTF8Decoder) {
    return UTF8Decoder.decode(u8Array.subarray(idx, endPtr));
  } else {
    var str = '';
    while (1) {
      // For UTF8 byte structure, see:
      // http://en.wikipedia.org/wiki/UTF-8#Description
      // https://www.ietf.org/rfc/rfc2279.txt
      // https://tools.ietf.org/html/rfc3629
      var u0 = u8Array[idx++];
      if (!u0) return str;
      if (!(u0 & 0x80)) { str += String.fromCharCode(u0); continue; }
      var u1 = u8Array[idx++] & 63;
      if ((u0 & 0xE0) == 0xC0) { str += String.fromCharCode(((u0 & 31) << 6) | u1); continue; }
      var u2 = u8Array[idx++] & 63;
      if ((u0 & 0xF0) == 0xE0) {
        u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
      } else {
        u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (u8Array[idx++] & 63);
      }

      if (u0 < 0x10000) {
        str += String.fromCharCode(u0);
      } else {
        var ch = u0 - 0x10000;
        str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
      }
    }
  }
}

// Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the emscripten HEAP, returns
// a copy of that string as a Javascript String object.

function UTF8ToString(ptr) {
  return UTF8ArrayToString(HEAPU8,ptr);
}

// Copies the given Javascript String object 'str' to the given byte array at address 'outIdx',
// encoded in UTF8 form and null-terminated. The copy will require at most str.length*4+1 bytes of space in the HEAP.
// Use the function lengthBytesUTF8 to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outU8Array: the array to copy to. Each index in this array is assumed to be one 8-byte element.
//   outIdx: The starting offset in the array to begin the copying.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array.
//                    This count should include the null terminator,
//                    i.e. if maxBytesToWrite=1, only the null terminator will be written and nothing else.
//                    maxBytesToWrite=0 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF8Array(str, outU8Array, outIdx, maxBytesToWrite) {
  if (!(maxBytesToWrite > 0)) // Parameter maxBytesToWrite is not optional. Negative values, 0, null, undefined and false each don't write out any bytes.
    return 0;

  var startIdx = outIdx;
  var endIdx = outIdx + maxBytesToWrite - 1; // -1 for string null terminator.
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! So decode UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    // For UTF8 byte structure, see http://en.wikipedia.org/wiki/UTF-8#Description and https://www.ietf.org/rfc/rfc2279.txt and https://tools.ietf.org/html/rfc3629
    var u = str.charCodeAt(i); // possibly a lead surrogate
    if (u >= 0xD800 && u <= 0xDFFF) {
      var u1 = str.charCodeAt(++i);
      u = 0x10000 + ((u & 0x3FF) << 10) | (u1 & 0x3FF);
    }
    if (u <= 0x7F) {
      if (outIdx >= endIdx) break;
      outU8Array[outIdx++] = u;
    } else if (u <= 0x7FF) {
      if (outIdx + 1 >= endIdx) break;
      outU8Array[outIdx++] = 0xC0 | (u >> 6);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else if (u <= 0xFFFF) {
      if (outIdx + 2 >= endIdx) break;
      outU8Array[outIdx++] = 0xE0 | (u >> 12);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else {
      if (outIdx + 3 >= endIdx) break;
      outU8Array[outIdx++] = 0xF0 | (u >> 18);
      outU8Array[outIdx++] = 0x80 | ((u >> 12) & 63);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    }
  }
  // Null-terminate the pointer to the buffer.
  outU8Array[outIdx] = 0;
  return outIdx - startIdx;
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF8 form. The copy will require at most str.length*4+1 bytes of space in the HEAP.
// Use the function lengthBytesUTF8 to compute the exact number of bytes (excluding null terminator) that this function will write.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF8(str, outPtr, maxBytesToWrite) {
  return stringToUTF8Array(str, HEAPU8,outPtr, maxBytesToWrite);
}

// Returns the number of bytes the given Javascript string takes if encoded as a UTF8 byte array, EXCLUDING the null terminator byte.
function lengthBytesUTF8(str) {
  var len = 0;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! So decode UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var u = str.charCodeAt(i); // possibly a lead surrogate
    if (u >= 0xD800 && u <= 0xDFFF) u = 0x10000 + ((u & 0x3FF) << 10) | (str.charCodeAt(++i) & 0x3FF);
    if (u <= 0x7F) {
      ++len;
    } else if (u <= 0x7FF) {
      len += 2;
    } else if (u <= 0xFFFF) {
      len += 3;
    } else if (u <= 0x1FFFFF) {
      len += 4;
    } else if (u <= 0x3FFFFFF) {
      len += 5;
    } else {
      len += 6;
    }
  }
  return len;
}

// Given a pointer 'ptr' to a null-terminated UTF16LE-encoded string in the emscripten HEAP, returns
// a copy of that string as a Javascript String object.

var UTF16Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-16le') : undefined;
function UTF16ToString(ptr) {
  var endPtr = ptr;
  // TextDecoder needs to know the byte length in advance, it doesn't stop on null terminator by itself.
  // Also, use the length info to avoid running tiny strings through TextDecoder, since .subarray() allocates garbage.
  var idx = endPtr >> 1;
  while (HEAP16[idx]) ++idx;
  endPtr = idx << 1;

  if (endPtr - ptr > 32 && UTF16Decoder) {
    return UTF16Decoder.decode(HEAPU8.subarray(ptr, endPtr));
  } else {
    var i = 0;

    var str = '';
    while (1) {
      var codeUnit = HEAP16[(((ptr)+(i*2))>>1)];
      if (codeUnit == 0) return str;
      ++i;
      // fromCharCode constructs a character from a UTF-16 code unit, so we can pass the UTF16 string right through.
      str += String.fromCharCode(codeUnit);
    }
  }
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF16 form. The copy will require at most str.length*4+2 bytes of space in the HEAP.
// Use the function lengthBytesUTF16() to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outPtr: Byte address in Emscripten HEAP where to write the string to.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array. This count should include the null
//                    terminator, i.e. if maxBytesToWrite=2, only the null terminator will be written and nothing else.
//                    maxBytesToWrite<2 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF16(str, outPtr, maxBytesToWrite) {
  // Backwards compatibility: if max bytes is not specified, assume unsafe unbounded write is allowed.
  if (maxBytesToWrite === undefined) {
    maxBytesToWrite = 0x7FFFFFFF;
  }
  if (maxBytesToWrite < 2) return 0;
  maxBytesToWrite -= 2; // Null terminator.
  var startPtr = outPtr;
  var numCharsToWrite = (maxBytesToWrite < str.length*2) ? (maxBytesToWrite / 2) : str.length;
  for (var i = 0; i < numCharsToWrite; ++i) {
    // charCodeAt returns a UTF-16 encoded code unit, so it can be directly written to the HEAP.
    var codeUnit = str.charCodeAt(i); // possibly a lead surrogate
    HEAP16[((outPtr)>>1)]=codeUnit;
    outPtr += 2;
  }
  // Null-terminate the pointer to the HEAP.
  HEAP16[((outPtr)>>1)]=0;
  return outPtr - startPtr;
}

// Returns the number of bytes the given Javascript string takes if encoded as a UTF16 byte array, EXCLUDING the null terminator byte.

function lengthBytesUTF16(str) {
  return str.length*2;
}

function UTF32ToString(ptr) {
  var i = 0;

  var str = '';
  while (1) {
    var utf32 = HEAP32[(((ptr)+(i*4))>>2)];
    if (utf32 == 0)
      return str;
    ++i;
    // Gotcha: fromCharCode constructs a character from a UTF-16 encoded code (pair), not from a Unicode code point! So encode the code point to UTF-16 for constructing.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    if (utf32 >= 0x10000) {
      var ch = utf32 - 0x10000;
      str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
    } else {
      str += String.fromCharCode(utf32);
    }
  }
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF32 form. The copy will require at most str.length*4+4 bytes of space in the HEAP.
// Use the function lengthBytesUTF32() to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outPtr: Byte address in Emscripten HEAP where to write the string to.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array. This count should include the null
//                    terminator, i.e. if maxBytesToWrite=4, only the null terminator will be written and nothing else.
//                    maxBytesToWrite<4 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF32(str, outPtr, maxBytesToWrite) {
  // Backwards compatibility: if max bytes is not specified, assume unsafe unbounded write is allowed.
  if (maxBytesToWrite === undefined) {
    maxBytesToWrite = 0x7FFFFFFF;
  }
  if (maxBytesToWrite < 4) return 0;
  var startPtr = outPtr;
  var endPtr = startPtr + maxBytesToWrite - 4;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! We must decode the string to UTF-32 to the heap.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var codeUnit = str.charCodeAt(i); // possibly a lead surrogate
    if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) {
      var trailSurrogate = str.charCodeAt(++i);
      codeUnit = 0x10000 + ((codeUnit & 0x3FF) << 10) | (trailSurrogate & 0x3FF);
    }
    HEAP32[((outPtr)>>2)]=codeUnit;
    outPtr += 4;
    if (outPtr + 4 > endPtr) break;
  }
  // Null-terminate the pointer to the HEAP.
  HEAP32[((outPtr)>>2)]=0;
  return outPtr - startPtr;
}

// Returns the number of bytes the given Javascript string takes if encoded as a UTF16 byte array, EXCLUDING the null terminator byte.

function lengthBytesUTF32(str) {
  var len = 0;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! We must decode the string to UTF-32 to the heap.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var codeUnit = str.charCodeAt(i);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) ++i; // possibly a lead surrogate, so skip over the tail surrogate.
    len += 4;
  }

  return len;
}

// Allocate heap space for a JS string, and write it there.
// It is the responsibility of the caller to free() that memory.
function allocateUTF8(str) {
  var size = lengthBytesUTF8(str) + 1;
  var ret = _malloc(size);
  if (ret) stringToUTF8Array(str, HEAP8, ret, size);
  return ret;
}

// Allocate stack space for a JS string, and write it there.
function allocateUTF8OnStack(str) {
  var size = lengthBytesUTF8(str) + 1;
  var ret = stackAlloc(size);
  stringToUTF8Array(str, HEAP8, ret, size);
  return ret;
}

function demangle(func) {
  return func;
}

function demangleAll(text) {
  var regex =
    /__Z[\w\d_]+/g;
  return text.replace(regex,
    function(x) {
      var y = demangle(x);
      return x === y ? x : (y + ' [' + x + ']');
    });
}

function jsStackTrace() {
  var err = new Error();
  if (!err.stack) {
    // IE10+ special cases: It does have callstack info, but it is only populated if an Error object is thrown,
    // so try that as a special-case.
    try {
      throw new Error(0);
    } catch(e) {
      err = e;
    }
    if (!err.stack) {
      return '(no stack trace available)';
    }
  }
  return err.stack.toString();
}

function stackTrace() {
  var js = jsStackTrace();
  if (Module['extraStackTrace']) js += '\n' + Module['extraStackTrace']();
  return demangleAll(js);
}

// Memory management

var PAGE_SIZE = 16384;
var WASM_PAGE_SIZE = 65536;
var ASMJS_PAGE_SIZE = 16777216;

function alignUp(x, multiple) {
  if (x % multiple > 0) {
    x += multiple - (x % multiple);
  }
  return x;
}

var HEAP,
/** @type {ArrayBuffer} */
  buffer,
/** @type {Int8Array} */
  HEAP8,
/** @type {Uint8Array} */
  HEAPU8,
/** @type {Int16Array} */
  HEAP16,
/** @type {Uint16Array} */
  HEAPU16,
/** @type {Int32Array} */
  HEAP32,
/** @type {Uint32Array} */
  HEAPU32,
/** @type {Float32Array} */
  HEAPF32,
/** @type {Float64Array} */
  HEAPF64;

function updateGlobalBuffer(buf) {
  Module['buffer'] = buffer = buf;
}

function updateGlobalBufferViews() {
  Module['HEAP8'] = HEAP8 = new Int8Array(buffer);
  Module['HEAP16'] = HEAP16 = new Int16Array(buffer);
  Module['HEAP32'] = HEAP32 = new Int32Array(buffer);
  Module['HEAPU8'] = HEAPU8 = new Uint8Array(buffer);
  Module['HEAPU16'] = HEAPU16 = new Uint16Array(buffer);
  Module['HEAPU32'] = HEAPU32 = new Uint32Array(buffer);
  Module['HEAPF32'] = HEAPF32 = new Float32Array(buffer);
  Module['HEAPF64'] = HEAPF64 = new Float64Array(buffer);
}


var STATIC_BASE = 1024,
    STACK_BASE = 24880,
    STACKTOP = STACK_BASE,
    STACK_MAX = 5267760,
    DYNAMIC_BASE = 5267760,
    DYNAMICTOP_PTR = 24624;






function abortOnCannotGrowMemory() {
  abort('Cannot enlarge memory arrays. Either (1) compile with  -s TOTAL_MEMORY=X  with X higher than the current value ' + TOTAL_MEMORY + ', (2) compile with  -s ALLOW_MEMORY_GROWTH=1  which allows increasing the size at runtime, or (3) if you want malloc to return NULL (0) instead of this abort, compile with  -s ABORTING_MALLOC=0 ');
}


var byteLength;
try {
  byteLength = Function.prototype.call.bind(Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get);
  byteLength(new ArrayBuffer(4)); // can fail on older ie
} catch(e) { // can fail on older node/v8
  byteLength = function(buffer) { return buffer.byteLength; };
}

var TOTAL_STACK = 5242880;

var TOTAL_MEMORY = Module['TOTAL_MEMORY'] || 16777216;
if (TOTAL_MEMORY < TOTAL_STACK) err('TOTAL_MEMORY should be larger than TOTAL_STACK, was ' + TOTAL_MEMORY + '! (TOTAL_STACK=' + TOTAL_STACK + ')');

// Initialize the runtime's memory



// Use a provided buffer, if there is one, or else allocate a new one
if (Module['buffer']) {
  buffer = Module['buffer'];
} else {
  // Use a WebAssembly memory where available
  if (typeof WebAssembly === 'object' && typeof WebAssembly.Memory === 'function') {
    Module['wasmMemory'] = new WebAssembly.Memory({ 'initial': TOTAL_MEMORY / WASM_PAGE_SIZE });
    buffer = Module['wasmMemory'].buffer;
  } else
  {
    buffer = new ArrayBuffer(TOTAL_MEMORY);
  }
  Module['buffer'] = buffer;
}
updateGlobalBufferViews();


HEAP32[DYNAMICTOP_PTR>>2] = DYNAMIC_BASE;

// Endianness check (note: assumes compiler arch was little-endian)

function callRuntimeCallbacks(callbacks) {
  while(callbacks.length > 0) {
    var callback = callbacks.shift();
    if (typeof callback == 'function') {
      callback();
      continue;
    }
    var func = callback.func;
    if (typeof func === 'number') {
      if (callback.arg === undefined) {
        Module['dynCall_v'](func);
      } else {
        Module['dynCall_vi'](func, callback.arg);
      }
    } else {
      func(callback.arg === undefined ? null : callback.arg);
    }
  }
}

var __ATPRERUN__  = []; // functions called before the runtime is initialized
var __ATINIT__    = []; // functions called during startup
var __ATMAIN__    = []; // functions called when main() is to be run
var __ATEXIT__    = []; // functions called during shutdown
var __ATPOSTRUN__ = []; // functions called after the main() is called

var runtimeInitialized = false;
var runtimeExited = false;


function preRun() {
  // compatibility - merge in anything from Module['preRun'] at this time
  if (Module['preRun']) {
    if (typeof Module['preRun'] == 'function') Module['preRun'] = [Module['preRun']];
    while (Module['preRun'].length) {
      addOnPreRun(Module['preRun'].shift());
    }
  }
  callRuntimeCallbacks(__ATPRERUN__);
}

function ensureInitRuntime() {
  if (runtimeInitialized) return;
  runtimeInitialized = true;
  callRuntimeCallbacks(__ATINIT__);
}

function preMain() {
  callRuntimeCallbacks(__ATMAIN__);
}

function exitRuntime() {
  callRuntimeCallbacks(__ATEXIT__);
  runtimeExited = true;
}

function postRun() {
  // compatibility - merge in anything from Module['postRun'] at this time
  if (Module['postRun']) {
    if (typeof Module['postRun'] == 'function') Module['postRun'] = [Module['postRun']];
    while (Module['postRun'].length) {
      addOnPostRun(Module['postRun'].shift());
    }
  }
  callRuntimeCallbacks(__ATPOSTRUN__);
}

function addOnPreRun(cb) {
  __ATPRERUN__.unshift(cb);
}

function addOnInit(cb) {
  __ATINIT__.unshift(cb);
}

function addOnPreMain(cb) {
  __ATMAIN__.unshift(cb);
}

function addOnExit(cb) {
  __ATEXIT__.unshift(cb);
}

function addOnPostRun(cb) {
  __ATPOSTRUN__.unshift(cb);
}

// Deprecated: This function should not be called because it is unsafe and does not provide
// a maximum length limit of how many bytes it is allowed to write. Prefer calling the
// function stringToUTF8Array() instead, which takes in a maximum length that can be used
// to be secure from out of bounds writes.
/** @deprecated */
function writeStringToMemory(string, buffer, dontAddNull) {
  warnOnce('writeStringToMemory is deprecated and should not be called! Use stringToUTF8() instead!');

  var /** @type {number} */ lastChar, /** @type {number} */ end;
  if (dontAddNull) {
    // stringToUTF8Array always appends null. If we don't want to do that, remember the
    // character that existed at the location where the null will be placed, and restore
    // that after the write (below).
    end = buffer + lengthBytesUTF8(string);
    lastChar = HEAP8[end];
  }
  stringToUTF8(string, buffer, Infinity);
  if (dontAddNull) HEAP8[end] = lastChar; // Restore the value under the null character.
}

function writeArrayToMemory(array, buffer) {
  HEAP8.set(array, buffer);
}

function writeAsciiToMemory(str, buffer, dontAddNull) {
  for (var i = 0; i < str.length; ++i) {
    HEAP8[((buffer++)>>0)]=str.charCodeAt(i);
  }
  // Null-terminate the pointer to the HEAP.
  if (!dontAddNull) HEAP8[((buffer)>>0)]=0;
}

function unSign(value, bits, ignore) {
  if (value >= 0) {
    return value;
  }
  return bits <= 32 ? 2*Math.abs(1 << (bits-1)) + value // Need some trickery, since if bits == 32, we are right at the limit of the bits JS uses in bitshifts
                    : Math.pow(2, bits)         + value;
}
function reSign(value, bits, ignore) {
  if (value <= 0) {
    return value;
  }
  var half = bits <= 32 ? Math.abs(1 << (bits-1)) // abs is needed if bits == 32
                        : Math.pow(2, bits-1);
  if (value >= half && (bits <= 32 || value > half)) { // for huge values, we can hit the precision limit and always get true here. so don't do that
                                                       // but, in general there is no perfect solution here. With 64-bit ints, we get rounding and errors
                                                       // TODO: In i64 mode 1, resign the two parts separately and safely
    value = -2*half + value; // Cannot bitshift half, as it may be at the limit of the bits JS uses in bitshifts
  }
  return value;
}


var Math_abs = Math.abs;
var Math_cos = Math.cos;
var Math_sin = Math.sin;
var Math_tan = Math.tan;
var Math_acos = Math.acos;
var Math_asin = Math.asin;
var Math_atan = Math.atan;
var Math_atan2 = Math.atan2;
var Math_exp = Math.exp;
var Math_log = Math.log;
var Math_sqrt = Math.sqrt;
var Math_ceil = Math.ceil;
var Math_floor = Math.floor;
var Math_pow = Math.pow;
var Math_imul = Math.imul;
var Math_fround = Math.fround;
var Math_round = Math.round;
var Math_min = Math.min;
var Math_max = Math.max;
var Math_clz32 = Math.clz32;
var Math_trunc = Math.trunc;

// A counter of dependencies for calling run(). If we need to
// do asynchronous work before running, increment this and
// decrement it. Incrementing must happen in a place like
// Module.preRun (used by emcc to add file preloading).
// Note that you can add dependencies in preRun, even though
// it happens right before run - run will be postponed until
// the dependencies are met.
var runDependencies = 0;
var runDependencyWatcher = null;
var dependenciesFulfilled = null; // overridden to take different actions when all run dependencies are fulfilled

function getUniqueRunDependency(id) {
  return id;
}

function addRunDependency(id) {
  runDependencies++;
  if (Module['monitorRunDependencies']) {
    Module['monitorRunDependencies'](runDependencies);
  }
}

function removeRunDependency(id) {
  runDependencies--;
  if (Module['monitorRunDependencies']) {
    Module['monitorRunDependencies'](runDependencies);
  }
  if (runDependencies == 0) {
    if (runDependencyWatcher !== null) {
      clearInterval(runDependencyWatcher);
      runDependencyWatcher = null;
    }
    if (dependenciesFulfilled) {
      var callback = dependenciesFulfilled;
      dependenciesFulfilled = null;
      callback(); // can add another dependenciesFulfilled
    }
  }
}

Module["preloadedImages"] = {}; // maps url to image data
Module["preloadedAudios"] = {}; // maps url to audio data



var memoryInitializer = null;






// Copyright 2017 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

// Prefix of data URIs emitted by SINGLE_FILE and related options.
var dataURIPrefix = 'data:application/octet-stream;base64,';

// Indicates whether filename is a base64 data URI.
function isDataURI(filename) {
  return String.prototype.startsWith ?
      filename.startsWith(dataURIPrefix) :
      filename.indexOf(dataURIPrefix) === 0;
}




var wasmBinaryFile = 'data:application/octet-stream;base64,AGFzbQEAAAAB2QM3YAN/f38Bf2ADf39/AGABfwF/YAJ/fwF/YAJ/fwBgBX9/f39/AX9gCH9/f39/f39/AX9gAX8AYAZ/f39/f38Bf2AEf39/fwF/YAAAYAR/f39/AGAGf39/f39/AGAFf39/f38AYAV/f39/fAF/YAZ/f39/f3wBf2AHf39/f39/fwF/YAV/f39/fgF/YAV/f35/fwBgAXwBfGAAAX9gB39/f39/f38AYA5/f39/f3x/f39/f39/fwBgBH9/f3wAYAZ8f398f38BfGAFfH98f38BfGAFfH9/fH8BfGABfwF8YAN/f34AYAR/f39+AX5gA39/fwF8YAV/f39/fwF8YAZ/f39/f38BfGACf38BfmACfH8BfGACfHwBfGABfAF+YAN+f38Bf2ACfn8Bf2AGf3x/f39/AX9gA39/fwF+YAR/f39/AX5gAn9/AX1gAn9/AXxgA39/fwF9YAp/f39/f39/f39/AX9gDH9/f39/f39/f39/fwF/YAt/f39/f39/f39/fwF/YAp/f39/f39/f39/AGAPf39/f39/f39/f39/f39/AGAIf39/f39/f38AYAd/f39/f398AX9gCX9/f39/f39/fwF/YAZ/f39/f34Bf2AGf39/fn9/AALMBB4LZ2xvYmFsLk1hdGgDZXhwABMLZ2xvYmFsLk1hdGgDbG9nABMDZW52BWFib3J0AAcDZW52F2Fib3J0T25DYW5ub3RHcm93TWVtb3J5ABQDZW52B19fX2xvY2sABwNlbnYLX19fbWFwX2ZpbGUAAwNlbnYLX19fc2V0RXJyTm8ABwNlbnYNX19fc3lzY2FsbDE0MAADA2Vudg1fX19zeXNjYWxsMTQ1AAMDZW52DV9fX3N5c2NhbGwxNDYAAwNlbnYMX19fc3lzY2FsbDU0AAMDZW52C19fX3N5c2NhbGw2AAMDZW52DF9fX3N5c2NhbGw5MQADA2VudglfX191bmxvY2sABwNlbnYGX2Fib3J0AAoDZW52GV9lbXNjcmlwdGVuX2dldF9oZWFwX3NpemUAFANlbnYWX2Vtc2NyaXB0ZW5fbWVtY3B5X2JpZwAAA2VudhdfZW1zY3JpcHRlbl9yZXNpemVfaGVhcAACA2VudgVfZXhpdAAHA2VudgdfZ2V0ZW52AAIDZW52El9sbHZtX3N0YWNrcmVzdG9yZQAHA2Vudg9fbGx2bV9zdGFja3NhdmUAFANlbnYSX3B0aHJlYWRfY29uZF93YWl0AAMDZW52C19zdHJmdGltZV9sAAUDZW52DF9fdGFibGVfYmFzZQN/AANlbnYORFlOQU1JQ1RPUF9QVFIDfwAGZ2xvYmFsA05hTgN8AAZnbG9iYWwISW5maW5pdHkDfAADZW52Bm1lbW9yeQIAgAIDZW52BXRhYmxlAXAB3gPeAwO2BbQFAgIUBwQEDRQDAgICAggVFgMCFBcYGRgaGBgaAhsbAgAAAhQCAAAUAgIUFBQCFAMCFAIACQcCAgADAAMUCgMCAgAAAAAEAgMcCQIdHh8gISIjIyIjJCMCAgAAAAAFAQIBJSYmAg0DJyIiAAMDCQkABwIDAAMDCh0JAgADAwICKAkpKSgDAwAJBSoeKyssHh4AAAAFAgcDAwMEBwcEBwcHBAASCwACAgMAAAcHAAICAwAABwcHBwcHBwcHBwcHBwcHBwQEAwcHCgoHAQEBAQQCAAMCBAADBAICAwMEAgIDAwcHBwULAAEEBwULAAEEBwgICAgICAgICAgIAwctFAkCAwcBBwcIDS4eCwgeCCwIAgABKQAICQgICQgpCAkQCAgICAgICAgICAgtCA0uCAgIAAEACAgICAgQBQURBREODgUFAAAJFQsVBQURBREODgUIFRUCCAgICAgGAgICAgICAgoKCgwMBgwMDAwMDA0MDAwMDA0FCAgICAgGAgICAgICAgIKCgoMDAYMDAwMDAwNDAwMDAwNBQcHEAwDBxAMAwcCBAQEAgQQEC8AADABARAQLwAwDwgwMQ8IMDEADAwGBgUFAgUGBgYFBgYFAgUCBwcGBgUFBgYHBwcHBwMAAwADCQAFFBQUBwcCAgQEBAcHAgIEBAQACQkJAwADAAMJAAUHBwsEBAoECgQKBAoECgQKBAoECgQKBAoECgQKBAoECgQKBAoECgQKBAoECgQKBAoECgQKBAoECgQKBAoEAQQEBAILBAQHBAQEBBQUChQEFAcBCgIHBwQBAQAHAAAyBAMBABUABAEBAAAAMgQDFQAEBwAMDQsACwsNCQwNCwwNCwsMDQIUAAICAAAAAgMACQUPCDMQBjQ1BwQBCw0MFTYCAwAJDgUPCBAGEQoHBAELDQwSEBUGKQd/ASMBC38BQQALfwFBAAt8ASMCC3wBIwMLfwFBsMIBC38BQbDCwQILB8QFKRBfX2dyb3dXYXNtTWVtb3J5ABgSX19HTE9CQUxfX0lfMDAwMTAxAN4BHF9fR0xPQkFMX19zdWJfSV9pb3N0cmVhbV9jcHAAjQEQX19fY3hhX2Nhbl9jYXRjaACdBRZfX19jeGFfaXNfcG9pbnRlcl90eXBlAJ4FEV9fX2Vycm5vX2xvY2F0aW9uADoFX2ZyZWUArAEPX2xsdm1fYnN3YXBfaTMyAJ8FB19tYWxsb2MAqwEHX21lbWNweQCgBQhfbWVtbW92ZQChBQdfbWVtc2V0AKIFF19wdGhyZWFkX2NvbmRfYnJvYWRjYXN0AJABE19wdGhyZWFkX211dGV4X2xvY2sAkAEVX3B0aHJlYWRfbXV0ZXhfdW5sb2NrAJABBV9zYnJrAKMFCl9zeW50aGVzaXMAHgpkeW5DYWxsX2lpAKQFC2R5bkNhbGxfaWlpAKUFDGR5bkNhbGxfaWlpaQCmBQ1keW5DYWxsX2lpaWlpAKcFDmR5bkNhbGxfaWlpaWlkAKgFDmR5bkNhbGxfaWlpaWlpAKkFD2R5bkNhbGxfaWlpaWlpZACqBQ9keW5DYWxsX2lpaWlpaWkAqwUQZHluQ2FsbF9paWlpaWlpaQCsBRFkeW5DYWxsX2lpaWlpaWlpaQCtBQ5keW5DYWxsX2lpaWlpagDKBQlkeW5DYWxsX3YArwUKZHluQ2FsbF92aQCwBQtkeW5DYWxsX3ZpaQCxBQxkeW5DYWxsX3ZpaWkAsgUNZHluQ2FsbF92aWlpaQCzBQ5keW5DYWxsX3ZpaWlpaQC0BQ9keW5DYWxsX3ZpaWlpaWkAtQUOZHluQ2FsbF92aWlqaWkAywUTZXN0YWJsaXNoU3RhY2tTcGFjZQAcCHNldFRocmV3AB0Kc3RhY2tBbGxvYwAZDHN0YWNrUmVzdG9yZQAbCXN0YWNrU2F2ZQAaCbUHAQAjAAveA7cFNpABkAG8Ab0BkAGQAcQBxQHmAeYB7gHvAfMB9AHqAvEC8gLzAvQC9QL2AvcC6gKSA5MDlAOVA5YDlwOYA7gDuAOQAbgDuAOQAbwDvAOQAbwDvAOQAZABkAHaA+MDkAHlA4AEgQSHBIgETU1NkAGQAdoDtwW3BbcFtwW4Bb4BvgHGAcYB6AHsAfAB9QHzA/UD9wOQBJIElAS4BbkFNzg8PYYBuAG7Ab8BuAHDAccB5wHrAfwBggLTA9MD9AP2A/kDjASRBJMElgSJBVq5BbkFuQW5BbkFugX4A40EjgSPBJUEugW6BbsF1QLWAuQC5QK7BbsFuwW8BfoBgALQAtEC0wLXAt8C4ALiAuYC2APZA+ID5AP6A5cE2APfA9gD6gO8BbwFvAW8BbwFvAW8BbwFvAW8BbwFvQXLA88DvQW+BYYChwKIAokCigKLAowCjQKOAo8CkAK1ArYCtwK4ArkCugK7ArwCvQK+Ar8C6wLsAu0C7gLvAowDjQOOA48DkAPMA9ADvgW+Bb4FvgW+Bb4FvgW+Bb4FvgW+Bb4FvgW+Bb4FvgW+Bb4FvgW+Bb4FvgW+Bb4FvgW+Bb4FvgW+Bb8FsAO0A74DvwPGA8cDvwXABfACkQPWA9cD4APhA94D3gPoA+kDwAXABcAFwAXABcEF0gLUAuEC4wLBBcEFwQXCBcMFsgG0AbUBtgHBAcIByQHKAcsBzAHNAc4BzwHQAdEB0gHTAdQB1QHWAdcB2AHCAbYBwgG2AfcB+AH5AfcB/wH3AYUC9wGFAvcBhQL3AYUC9wGFAvcBhQKuA68DrgOvA/cBhQL3AYUC9wGFAvcBhQL3AYUC9wGFAvcBhQL3AYUC9wGFAvcBhQJMhQKFAuYD5wPuA+8D8QPyA/4D/wOFBIYEhQKFAoUChQKFAkyIBUxMiAWIBZgCmgJMrAHDBcMFwwXDBcMFwwXDBcMFwwXDBcMFwwXDBcMFwwXDBcMFwwXDBcMFwwXDBcMFwwXDBcMFwwXDBcMFwwXDBcMFxAW3AbcB5QHqAe0B8gG5A7kDuQO6A7sDuwO5A7kDuQO6A7sDuwO5A7kDuQO9A7sDuwO5A7kDuQO9A7sDuwO3AbcBggSDBIQEiQSKBIsExAXEBcQFxAXEBcQFxAXEBcQFxAXEBcQFxAXEBcQFxAXEBcQFxAXEBcQFxAXEBcQFxAXFBcYFugG6AfsBgQKMBZQFlwXHBYsFkwWWBcgF1APVA4oFkgWVBcgFyAXJBbkBuQHJBQqT1gm0BQYAIABAAAsbAQF/IwkhASAAIwlqJAkjCUEPakFwcSQJIAELBAAjCQsGACAAJAkLCgAgACQJIAEkCgsQACMFRQRAIAAkBSABJAYLC8kCAQV/IwkhBSMJQSBqJAkgBSEIIAVBGGoiBiAANgIAIAVBFGoiCSAB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AEkEfyAAIAFBEnZB8AFyOgAAIAAgAUEMdkE/cUGAAXI6AAEgACABQQZ2QT9xQYABcjoAAiAAIAFBP3FBgAFyOgADQQQFEDpB1AA2AgBBfwsLBUEBCwt2AQJ/QQAhAgJAAkADQCACQaAwai0AACAARwRAIAJBAWoiAkHXAEcNAUHXACECDAILCyACDQBBgDEhAAwBC0GAMSEAA0AgACEDA0AgA0EBaiEAIAMsAAAEQCAAIQMMAQsLIAJBf2oiAg0ACwsgACABKAIUEIMBCwgAIAAgARBQCykBAX8jCSEEIwlBEGokCSAEIAM2AgAgACABIAIgBBCFASEAIAQkCSAAC4ADAQR/IwkhBiMJQYABaiQJIAZB/ABqIQUgBiIEQczSACkCADcCACAEQdTSACkCADcCCCAEQdzSACkCADcCECAEQeTSACkCADcCGCAEQezSACkCADcCICAEQfTSACkCADcCKCAEQfzSACkCADcCMCAEQYTTACkCADcCOCAEQUBrQYzTACkCADcCACAEQZTTACkCADcCSCAEQZzTACkCADcCUCAEQaTTACkCADcCWCAEQazTACkCADcCYCAEQbTTACkCADcCaCAEQbzTACkCADcCcCAEQcTTACgCADYCeAJAAkAgAUF/akH+////B00NACABBH8QOkHLADYCAEF/BSAFIQBBASEBDAELIQAMAQsgBEF+IABrIgUgASABIAVLGyIHNgIwIARBFGoiASAANgIAIAQgADYCLCAEQRBqIgUgACAHaiIANgIAIAQgADYCHCAEIAIgAxBzIQAgBwRAIAEoAgAiASABIAUoAgBGQR90QR91akEAOgAACwsgBiQJIAALOwECfyACIAAoAhAgAEEUaiIAKAIAIgRrIgMgAyACSxshAyAEIAEgAxCgBRogACAAKAIAIANqNgIAIAILDwAgABCIAQRAIAAQrAELCxcAIABBAEcgAEHwpwFHcSAAQajNAEdxCwYAIAAQPwvnAQEGfyMJIQYjCUEgaiQJIAYhByACEIgBBEBBACEDA0AgAEEBIAN0cQRAIANBAnQgAmogAyABEIsBNgIACyADQQFqIgNBBkcNAAsFAkAgAkEARyEIQQAhBEEAIQMDQCAEIAggAEEBIAN0cSIFRXEEfyADQQJ0IAJqKAIABSADIAFBrLgBIAUbEIsBCyIFQQBHaiEEIANB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AANAAkAgAkECdiIKIAZPIgwgAkGDAUtyRQ0CIAIgBiAKIAwbIgVrIQIgAyAHIAUgBBCXASIFQX9GDQAgBkEAIAUgAyAIRiIKG2shBiADIAVBAnQgA2ogChshAyAAIAVqIQAgBygCACIFQQBHIAZBAEdxDQEMAgsLQX8hAEEAIQYgBygCACEFCwVBACEACyAFBEAgBkEARyACQQBHcQRAAkADQCADIAUgAiAEEGAiCEECakEDTwRAIAcgCCAHKAIAaiIFNgIAIANBBGohAyAAQQFqIQAgBkF/aiIGQQBHIAIgCGsiAkEAR3ENAQwCCwsCQAJAAkAgCEF/aw4CAAECCyAIIQAMAgsgB0EANgIADAELIARBADYCAAsLCyALBEAgASAHKAIANgIACyAJJAkgAAsMACAAIAFBABChAbYL6gECBH8BfCMJIQQjCUGAAWokCSAEIgNCADcCACADQgA3AgggA0IANwIQIANCADcCGCADQgA3AiAgA0IANwIoIANCADcCMCADQgA3AjggA0FAa0IANwIAIANCADcCSCADQgA3AlAgA0IANwJYIANCADcCYCADQgA3AmggA0IANwJwIANBADYCeCADQQRqIgUgADYCACADQQhqIgZBfzYCACADIAA2AiwgA0F/NgJMIANBABBcIAMgAkEBEGMhByADKAJsIAUoAgAgBigCAGtqIQIgAQRAIAEgACACaiAAIAIbNgIACyAEJAkgBwsLACAAIAFBARChAQsLACAAIAFBAhChAQsJACAAIAEQoAELCQAgACABEKIBCwkAIAAgARCjAQswAQJ/IAIEQCAAIQMDQCADQQRqIQQgAyABNgIAIAJBf2oiAgRAIAQhAwwBCwsLIAALbwEDfyAAIAFrQQJ1IAJJBEADQCACQX9qIgJBAnQgAGogAkECdCABaigCADYCACACDQALBSACBEAgACEDA0AgAUEEaiEEIANBBGohBSADIAEoAgA2AgAgAkF/aiICBEAgBCEBIAUhAwwBCwsLCyAACxMAQQAgACABIAJB6KgBIAIbEGAL3wIBBn8jCSEIIwlBkAJqJAkgCEGAAmoiBiABKAIAIgU2AgAgA0GAAiAAQQBHIgobIQQgACAIIgcgChshAyAEQQBHIAVBAEdxBEACQEEAIQADQAJAIAIgBE8iCSACQSBLckUNAiACIAQgAiAJGyIF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aiQJIAYhByACIAEiA2siBEFvSwRAIAAQtwMLIARBC0kEQCAAIAQ6AAsFIAAgBEEQakFwcSIIEOsEIgU2AgAgACAIQYCAgIB4cjYCCCAAIAQ2AgQgBSEACyACIANrIQUgACEDA0AgASACRwRAIAMgARD+ASABQQFqIQEgA0EBaiEDDAELCyAHQQA6AAAgACAFaiAHEP4BIAYkCQsMACAAIAEsAAA6AAALDAAgABD3ASAAEOwEC1cBAX8CfwJAA38CfyADIARGDQJBfyABIAJGDQAaQX8gASgCACIAIAMoAgAiBUgNABogBSAASAR/QQEFIANBBGohAyABQQRqIQEMAgsLCwwBCyABIAJHCwsZACAAQgA3AgAgAEEANgIIIAAgAiADEIMCC0EBAX9BACEAA0AgASACRwRAIAEoAgAgAEEEdGoiA0GAgICAf3EhACADIAAgAEEYdnJzIQAgAUEEaiEBDAELCyAAC68BAQV/IwkhBSMJQRBqJAkgBSEGIAIgAWtBAnUiBEHv////A0sEQCAAELcDCyAEQQJJBEAgACAEOgALIAAhAwUgBEEEakF8cSIHQf////8DSwRAEA4FIAAgB0ECdBDrBCIDNgIAIAAgB0GAgICAeHI2AgggACAENgIECwsDQCABIAJHBEAgAyABEIQCIAFBBGohASADQQRqIQMMAQsLIAZBADYCACADIAYQhAIgBSQJCwwAIAAgASgCADYCAAsLACAAEEwgABDsBAuLAwEIfyMJIQgjCUEwaiQJIAhBKGohByAIIgZBIGohCSAGQSRqIQsgBkEcaiEMIAZBGGohDSADKAIEQQFxBEAgByADENoBIAdB9LQBEJECIQogBxCSAiAHIAMQ2gEgB0GEtQEQkQIhAyAHEJICIAMoAgAoAhghACAGIAMgAEE/cUGFA2oRBAAgAygCACgCHCEAIAZBDGogAyAAQT9xQYUDahEEACANIAIoAgA2AgAgByANKAIANgIAIAUgASAHIAYgBkEYaiIAIAogBEEBELQCIAZGOgAAIAEoAgAhAQNAIABBdGoiABDyBCAAIAZHDQALBSAJQX82AgAgACgCACgCECEKIAsgASgCADYCACAMIAIoAgA2AgAgBiALKAIANgIAIAcgDCgCADYCACABIAAgBiAHIAMgBCAJIApBP3FBpAFqEQgANgIAAkACQAJAAkAg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IAYgChDbAgUgDiAEOQMAIAcgACAGIA4Q2wILIQYgBygCACIABEAgBiEMIAAhFSAAIQkFEOoECwUgACEMQQAhFSAHKAIAIQkLIAkgCSAMaiIGIAIQ2QIhByAJIAtGBEAgFyENQQAhFgUgDEEBdBCrASIABEAgACINIRYFEOoECwsgCCACENoBIAkgByAGIA0gECARIAgQ3AIgCBCSAiASIAEoAgA2AgAgECgCACEAIBEoAgAhASAIIBIoAgA2AgAgCCANIAAgASACIAMQJSEAIBYQrAEgFRCsASAFJAkgAAvdAQEGfyMJIQAjCUHgAGokCSAAQdAAaiIFQdH1ACgAADYAACAFQdX1AC4AADsABBCUAiEHIABByABqIgYgBDYCACAAQTBqIgRBFCAHIAUgBhDYAiIJIARqIQUgBCAFIAIQ2QIhByAGIAIQ2gEgBkH0tAEQkQIhCCAGEJICIAgoAgAoAiAhCiAIIAQgBSAAIApBB3FB8ABqEQkAGiAAQcwAaiIIIAEoAgA2AgAgBiAIKAIANgIAIAYgACAAIAlqIgEgByAEayAAaiAFIAdGGyABIAIgAxAlIQEgACQJIAELOwEBfyMJIQUjCUEQaiQJIAUgBDYCACACEJQBIQIgACABIAMgBRCFASEAIAIEQCACEJQBGgsgBSQJIAALoAEAAkACQAJAIAIoAgRBsAFxQRh0QRh1QRBrDhEAAgICAgICAgICAgICAgICAQILAkACQCAALAAAIgJBK2sOAwABAAELIABBAWohAAwCCyACQTBGIAEgAGtBAUpxRQ0BAkAgACwAAUHYAGsOIQACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAAILIABBAmohAAwBCyABIQALIAAL4QEBBH8gAkGAEHEEQCAAQSs6AAAgAEEBaiEACyACQYAIcQRAIABBIzoAACAAQQFqIQALIAJBgIABcSEDIAJBhAJxIgRBhAJGIgUEf0EABSAAQS46AAAgAEEqOgABIABBAmohAEEBCyECA0AgASwAACIGBEAgACAGOgAAIAFBAWohASAAQQFqIQAMAQsLIAACfwJAAkAgBEEEayIBBEAgAUH8AUYEQAwCBQwDCwALIANBCXZB5gBzDAILIANBCXZB5QBzDAELIANBCXYhASABQeEAcyABQecAcyAFGws6AAAgAgs5AQF/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IAEgCCAEIAkQ+wIMFwsgDSACKAIANgIAIAggDSgCADYCACAAIAVBEGogASAIIAQgCRD8AgwWCyAAQQhqIgYoAgAoAgwhCyAGIAtBP3ERAgAhBiAOIAEoAgA2AgAgDyACKAIANgIAIAYoAgAgBiAGLAALIgJBAEgiCxsiCSAGKAIEIAJB/wFxIAsbaiECIAogDigCADYCACAIIA8oAgA2AgAgASAAIAogCCADIAQgBSAJIAIQ/QI2AgAMFQsgECACKAIANgIAIAggECgCADYCACAAIAVBDGogASAIIAQgCRD+AgwUCyARIAEoAgA2AgAgEiACKAIANgIAIAogESgCADYCACAIIBIoAgA2AgAgASAAIAogCCADIAQgBUHB+QBByfkAEP0CNgIADBMLIBMgASgCADYCACAUIAIoAgA2AgAgCiATKAIANgIAIAggFCgCADYCACABIAAgCiAIIAMgBCAFQcn5AEHR+QAQ/QI2AgAMEgsgFSACKAIANgIAIAggFSgCADYCACAAIAVBCGogASAIIAQgCRD/AgwRCyAWIAIoAgA2AgAgCCAWKAIANgIAIAAgBUEIaiABIAggBCAJEIADDBALIBcgAigCADYCACAIIBcoAgA2AgAgACAFQRxqIAEgCCAEIAkQgQMMDwsgGCACKAIANgIAIAggGCgCADYCACAAIAVBEGogASAIIAQgCRCCAwwOCyAZIAIoAgA2AgAgCCAZKAIANgIAIAAgBUEEaiABIAggBCAJEIMDDA0LIBogAigCADYCACAIIBooAgA2AgAgACABIAggBCAJEIQDDAwLIBsgAigCADYCACAIIBsoAgA2AgAgACAFQQhqIAEgCCAEIAkQhQMMCwsgHCABKAIANgIAIB0gAigCADYCACAKIBwoAgA2AgAgCCAdKAIANgIAIAEgACAKIAggAyAEIAVB0fkAQdz5ABD9AjYCAAwKCyAeIAEoAgA2AgAgHyACKAIANgIAIAogHigCADYCACAIIB8oAgA2AgAgASAAIAogCCADIAQgBUHc+QBB4fkAEP0CNgIADAkLICAgAigCADYCACAIICAoAgA2AgAgACAFIAEgCCAEIAkQhgMMCAsgISABKAIANgIAICIgAigCADYCACAKICEoAgA2AgAgCCAiKAIANgIAIAEgACAKIAggAyAEIAVB4fkAQen5ABD9AjYC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ASAIIAQgCRCkAwwOCyAZIAIoAgA2AgAgCCAZKAIANgIAIAAgBUEEaiABIAggBCAJEKUDDA0LIBogAigCADYCACAIIBooAgA2AgAgACABIAggBCAJEKYDDAwLIBsgAigCADYCACAIIBsoAgA2AgAgACAFQQhqIAEgCCAEIAkQpwMMCwsgHCABKAIANgIAIB0gAigCADYCACAKIBwoAgA2AgAgCCAdKAIANgIAIAEgACAKIAggAyAEIAVB0MAAQfzAABCfAzYCAAwKCyAeIAEoAgA2AgAgHyACKAIANgIAIAogHigCADYCACAIIB8oAgA2AgAgASAAIAogCCADIAQgBUGAwQBBlMEAEJ8DNgIADAkLICAgAigCADYCACAIICAoAgA2AgAgACAFIAEgCCAEIAkQqAMMCAsgISABKAIANgIAICIgAigCADYCACAKICEoAgA2AgAgCCAiKAIANgIAIAEgACAKIAggAyAEIAVBoMEAQcDBABCfAzYCAAwHCyAjIAIoAgA2AgAgCCAjKAIANgIAIAAgBUEYaiABIAggBCAJEKkDDAYLIAAoAgAoAhQhBiAkIAEoAgA2AgAgJSACKAIANgIAIAogJCgCADYCACAIICUoAgA2AgAgACAKIAggAyAEIAUgBkE/cUGkAWoRCAAMBgsgAEEIaiIGKAIAKAIYIQsgBiALQT9xEQIAIQYgJiABKAIANgIAICcgAigCADYCACAGKAIAIAYgBiwACyILQQBIIgkbIQIgBigCBCALQf8BcSAJG0ECdCACaiEGIAogJigCADYCACAIICcoAgA2AgAgASAAIAogCCADIAQgBSACIAYQnwM2AgAMBAsgKCACKAIANgIAIAggKCgCADYCACAAIAVBFGogASAIIAQgCRCqAwwDCyApIAIoAgA2AgAgCCApKAIANgIAIAAgBUEUaiABIAggBCAJEKsDDAILIAsgAigCADYCACAIIAsoAgA2AgAgACABIAggBCAJEKwDDAELIAQgBCgCAEEEcjYCAAsgASgCAAshACAHJAkgAAssAEHwowEsAABFBEBB8KMBEJsFBEAQnANBuLYBQZChATYCAAsLQbi2ASgCAAssAEHgowEsAABFBEBB4KMBEJsFBEAQmwNBtLYBQfCeATYCAAsLQbS2ASgCAAssAEHQowEsAABFBEBB0KMBEJsFBEAQmgNB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OgAAIAggCxD+ASAAQQA6AAAgCAshACAIQQAQ9gQgACAKKQIANwIAIAAgCigCCDYCCEEAIQADQCAAQQNHBEAgAEECdCAKakEANgIAIABBAWohAAwBCwsgChDyBCABKAIAKAIcIQAgCiABIABBP3FBhQNqEQQAIAdBC2oiACwAAEEASAR/IAcoAgAhACALQQA6AAAgACALEP4BIAdBADYCBCAHBSALQQA6AAAgByALEP4BIABBADoAACAHCyEAIAdBABD2BCAAIAopAgA3AgAgACAKKAIINgIIQQAhAANAIABBA0cEQCAAQQJ0IApqQQA2AgAgAEEBaiEADAELCyAKEPIEIAEoAgAoAgwhACADIAEgAEE/cRECADoAACABKAIAKAIQIQAgBCABIABBP3ERAgA6AAAgASgCACgCFCEAIAogASAAQT9xQYUDahEEACAFQQtqIgAsAABBAEgEfyAFKAIAIQAgC0EAOgAAIAAgCxD+ASAFQQA2AgQgBQUgC0EAOgAAIAUgCxD+ASAAQQA6AAAgBQshACAFQQAQ9gQgACAKKQIANwIAIAAgCigCCDYCCEEAIQADQCAAQQNHBEAgAEECdCAKakEANgIAIABBAWohAAwBCwsgChDyBCABKAIAKAIYIQAgCiABIABBP3FBhQNqEQQAIAZBC2oiACwAAEEASAR/IAYoAgAhACALQQA6AAAgACALEP4BIAZBADYCBCAGBSALQQA6AAAgBiALEP4BIABBADoAACAGCyEAIAZBABD2BCAAIAopAgA3AgAgACAKKAIINgIIQQAhAANAIABBA0cEQCAAQQJ0IApqQQA2AgAgAEEBaiEADAELCyAKEPIEIAEoAgAoAiQhACABIABBP3ERAgAFIAFB1LYBEJECIgEoAgAoAiwhACALIAEgAEE/cUGFA2oRBAAgAiALKAIANgAAIAEoAgAoAiAhACAKIAEgAEE/cUGFA2oRBAAgCEELaiIALAAAQQBIBH8gCCgCACEAIAtBADoAACAAIAsQ/gEgCEEANgIEIAgFIAtBADoAACAIIAsQ/gEgAEEAOgAAIAgLIQAgCEEAEPYEIAAgCikCADcCACAAIAooAgg2AghBACEAA0AgAEEDRwRAIABBAnQgCmpBADYCACAAQQFqIQAMAQsLIAoQ8gQgASgCACgCHCEAIAogASAAQT9xQYUDahEE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CCADIAEgAhCDAiAAIAMoAgAgAyADLAALIgFBAEgiAhsgAygCBCABQf8BcSACGxCGBRogAxDyBAwBCyAHIAVrIAlJBEAgACAHIAUgCWogB2sgBSAFQQBBABCFBQsgCCwAAEEASAR/IAAoAgAFIAALIAVBAnRqIQQDQCABIAJHBEAgBCABEIQCIARBBGohBCABQQRqIQEMAQsLIANBADYCACAEIAMQhAIgBSAJaiEBIAgsAABBAEgEQCAAIAE2AgQFIAggAToAAAsLCyAKJAkgAAujDAEDfyMJIQwjCUEQaiQJIAxBDGohCyAMIQogCSAABH8gAUHstgEQkQIiASgCACgCLCEAIAsgASAAQT9xQYUDahEEACACIAsoAgA2AAAgASgCACgCICEAIAogASAAQT9xQYUDahEEACAIQQtqIgAsAABBAEgEQCAIKAIAIQAgC0EANgIAIAAgCxCEAiAIQQA2AgQFIAtBADYCACAIIAsQhAIgAEEAOgAACyAIQQAQgwUgCCAKKQIANwIAIAggCigCCDYCCEEAIQADQCAAQQNHBEAgAEECdCAKakEANgIAIABBAWohAAwBCwsgChDyBCABKAIAKAIcIQAgCiABIABBP3FBhQNqEQQAIAdBC2oiACwAAEEASARAIAcoAgAhACALQQA2AgAgACALEIQCIAdBADYCBAUgC0EANgIAIAcgCxCEAiAAQQA6AAALIAdBABCDBSAHIAopAgA3AgAgByAKKAIINgIIQQAhAANAIABBA0cEQCAAQQJ0IApqQQA2AgAgAEEBaiEADAELCyAKEPIEIAEoAgAoAgwhACADIAEgAEE/cRECADYCACABKAIAKAIQIQAgBCABIABBP3ERAgA2AgAgASgCACgCFCEAIAogASAAQT9xQYUDahEEACAFQQtqIgAsAABBAEgEfyAFKAIAIQAgC0EAOgAAIAAgCxD+ASAFQQA2AgQgBQUgC0EAOgAAIAUgCxD+ASAAQQA6AAAgBQshACAFQQAQ9gQgACAKKQIANwIAIAAgCigCCDYCCEEAIQADQCAAQQNHBEAgAEECdCAKakEANgIAIABBAWohAAwBCwsgChDyBCABKAIAKAIYIQAgCiABIABBP3FBhQNqEQQAIAZBC2oiACwAAEEASARAIAYoAgAhACALQQA2AgAgACALEIQCIAZBADYCBAUgC0EA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CxDyBAUgAigCACgCKCEAIAogAiAAQT9xQYUDahEEACADIAooAgA2AAAgAigCACgCHCEAIAsgAiAAQT9xQYUDahEEACAIQQtqIgAsAABBAEgEQCAIKAIAIQAgCkEANgIAIAAgChCEAiAIQQA2AgQFIApBADYCACAIIAoQhAIgAEEAOgAACyAIQQAQgwUgCCALKQIANwIAIAggCygCCDYCCEEAIQADQCAAQQNHBEAgAEECdCALakEANgIAIABBAWohAAwBCwsgCxDyBAsgAigCACgCDCEAIAQgAiAAQT9xEQIANgIAIAIoAgAoAhAhACAFIAIgAEE/cRECADYCACACKAIAKAIUIQAgCyACIABBP3FBhQNqEQQAIAZBC2oiACwAAEEASAR/IAYoAgAhACAKQQA6AAAgACAKEP4BIAZBADYCBCAGBSAKQQA6AAAgBiAKEP4BIABBADoAACAGCyEAIAZBABD2BCAAIAspAgA3AgAgACALKAIINgIIQQAhAANAIABBA0cEQCAAQQJ0IAtqQQA2AgAgAEEBaiEADAELCyALEPIEIAIoAgAoAhghACALIAIgAEE/cUGFA2oRBAAgB0ELaiIALAAAQQBIBEAgBygCACEAIApBADYCACAAIAoQhAIgB0EANgIEBSAKQQA2AgAgByAKEIQCIABBADoAAAsgB0EAEIMFIAcgCykCADcCACAHIAsoAgg2AghBACEAA0AgAEEDRwRAIABBAnQgC2pBADYCACAAQQFqIQAMAQsLIAsQ8gQgAigCACgCJCEAIAIgAEE/cRECAAUgAkHktgEQkQIhAiABBEAgAigCACgCLCEAIAogAiAAQT9xQYUDahEEACADIAooAgA2AAAgAigCACgCICEAIAsgAiAAQT9xQYUDahEEACAIQQtqIgAsAABBAEgEQCAIKAIAIQAgCkEANgIAIAAgChCEAiAIQQA2AgQFIApBADYCACAIIAoQhAIgAEEAOgAACyAIQQAQgwUgCCALKQIANwIAIAggCygCCDYCCEEAIQADQCAAQQNHBEAgAEECdCALakEANgIAIABBAWohAAwBCwsgCxDyBAUgAigCACgCKCEAIAogAiAAQT9xQYUDahEEACADIAooAgA2AAAgAigCACgCHCEAIAsgAiAAQT9xQYUDahEEACAIQQtqIgAsAABBAEgEQCAIKAIAIQAgCkEANgIAIAAgChCEAiAIQQA2AgQFIApBADYCACAIIAoQhAIgAEEAOgAACyAIQQAQgwUgCCALKQIANwIAIAggCygCCDYCCEEAIQADQCAAQQNHBEAgAEECdCALakEANgIAIABBAWohAAwBCwsgCxDyBAsgAigCACgCDCEAIAQgAiAAQT9xEQIANgIAIAIoAgAoAhAhACAFIAIgAEE/cRECADYCACACKAIAKAIUIQAgCyACIABBP3FBhQNqEQQAIAZBC2oiACwAAEEASAR/IAYoAgAhACAKQQA6AAAgACAKEP4BIAZBADYCBCAGBSAKQQA6AAAgBiAKEP4BIABBADoAACAGCyEAIAZBABD2BCAAIAspAgA3AgAgACALKAIINgIIQQAhAANAIABBA0cEQCAAQQJ0IAtqQQA2AgAgAEEBaiEADAELCyALEPIEIAIoAgAoAhghACALIAIgAEE/cUGFA2oRBAAgB0ELaiIALAAAQQBIBEAgBygCACEAIApBADYCACAAIAoQhAIgB0EANgIEBSAKQQA2AgAgByAKEIQCIABBADoAAAsgB0EAEIMFIAcgCykCADcCACAHIAsoAgg2AghBACEAA0AgAEEDRwRAIABBAnQgC2pBADYCACAAQQFqIQAMAQsLIAsQ8gQgAigCACgCJCEAIAIgAEE/cRECAAs2AgAgDCQJC7UJARF/IAIgADYCACANQQtqIRkgDUEEaiEYIAxBC2ohHCAMQQRqIR0gA0GABHFFIR4gDkEASiEfIAtBC2ohGiALQQRqIRtBACEXA0AgF0EERwRAAkACQAJAAkACQAJAIAggF2osAAAOBQABAwIEBQsgASACKAIANgIADAQLIAEgAigCADYCACAGKAIAKAIsIQ8gBkEgIA9BD3FBQGsRAwAhECACIAIoAgAiD0EEajYCACAPIBA2AgAMAwsgGSwAACIPQQBIIRAgGCgCACAPQf8BcSAQGwRAIA0oAgAgDSAQGygCACEQIAIgAigCACIPQQRqNgIAIA8gEDYCAAsMAgsgHCwAACIPQQBIIRAgHiAdKAIAIA9B/wFxIBAbIhNFckUEQCAMKAIAIAwgEBsiDyATQQJ0aiERIAIoAgAiECESA0AgDyARRwRAIBIgDygCADYCACASQQRqIRIgD0EEaiEPDAELCyACIBNBAnQgEGo2AgALDAELIAIoAgAh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CyAAIABCADcCACAAQQA2AgggAEGQ6gBBkOoAEJkDEP0ECyUAIAJBgAFJBH8gARD9AyACQQF0ai4BAHFB//8DcUEARwVBAAsLRgADQCABIAJHBEAgAyABKAIAQYABSQR/EP0DIQAgASgCAEEBdCAAai8BAAVBAAs7AQAgA0ECaiEDIAFBBGohAQwBCwsgAgtKAANAAkAgAiADRgRAIAMhAgwBCyACKAIAQYABSQRAEP0DIQAgASACKAIAQQF0IABqLgEAcUH//wNxDQELIAJBBGohAgwBCwsgAgtKAANAAkAgAiADRgRAIAMhAgwBCyACKAIAQYABTw0AEP0DIQAgASACKAIAQQF0IABqLgEAcUH//wNxBEAgAkEEaiECDAILCwsgAgsaACABQYABSQR/EPwDIAFBAnRqKAIABSABCwtCAANAIAEgAkcEQCABKAIAIgBBgAFJBEAQ/AMhACABKAIAQQJ0IABqKAIAIQALIAEgADYCACABQQRqIQEMAQsLIAILGgAgAUGAAUkEfxD7AyABQQJ0aigCAAUgAQsLQgADQCABIAJHBEAgASgCACIAQYABSQRAEPsDIQAgASgCAEECdCAAaigCACEACyABIAA2AgAgAUEEaiEBDAELCyACCwoAIAFBGHRBGHULKQADQCABIAJHBEAgAyABLAAANgIAIANBBGohAyABQQFqIQEMAQsLIAILEQAgAUH/AXEgAiABQYABSRsLTgECfyACIAFrQQJ2IQUgASEAA0AgACACRwRAIAQgACgCACIGQf8BcSADIAZBgAFJGzoAACAEQQFqIQQgAEEEaiEADAELCyAFQQJ0IAFqCwsAIABBrOwANgIACwsAIABB0OwANgIACzsBAX8gACADQX9qNgIEIABBlOkANgIAIABBCGoiBCABNgIAIAAgAkEBcToADCABRQRAIAQQ/QM2AgALC6ADAQF/IAAgAUF/ajYCBCAAQYDpADYCACAAQQhqIgJBHBCcBCAAQZABaiIBQgA3AgAgAUEANgIIIAFBgvQAQYL0ABAkEO8EIAAgAigCADYCDBCdBCAAQYCkARCeBBCfBCAAQYikARCgBBChBCAAQZCkARCiBBCjBCAAQaCkARCkBBClBCAAQaikARCmBBCnBCAAQbCkARCoBBCpBCAAQcCkARCqBBCrBCAAQcikARCsBBCtBCAAQdCk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AQsgCSAEOgAACwsLDgAgACABIAEQmQMQgAUL6AEBBH9B7////wMgAWsgAkkEQCAAELcDCyAAQQhqIgksAANBAEgEfyAAKAIABSAACyEHIAFB5////wFJBEBBAiABQQF0IgogASACaiICIAIgCkkbIgJBBGpBfHEgAkECSRsiAkH/////A0sEQBAOBSACIQgLBUHv////AyEICyAIQQJ0EOsEIQIgBARAIAIgByAEEMgBGgsgAyAFayAEayIDBEAgBEECdCACaiAGQQJ0aiAEQQJ0IAdqIAVBAnRqIAMQyAEaCyABQQFHBEAgBxDsBAsgACACNgIAIAkgCEGAgICAeHI2AgALzwEBBn8jCSEFIwlBEGokCSAFIQYgAEEIaiIEQQNqIgcsAAAiA0EASCIIBH8gACgCBCEDIAQoAgBB/////wdxQX9qBSADQf8BcSEDQQELIgQgA2sgAkkEQCAAIAQgAiADaiAEayADIANBACACIAEQggUFIAIEQCAIBH8gACgCAAUgAAsiBCADQQJ0aiABIAIQyAEaIAIgA2ohASAHLAAAQQBIBEAgACABNgIEBSAHIAE6AAALIAZBADYCACABQQJ0IARqIAYQhAILCyAFJAkgAAvOAQEGfyMJIQMjCUEQaiQJIANBBGohBCADIgYgATYCACAAQQhqIgFBA2oiBSwAACICQQBIIgcEfyAAKAIEIQIgASgCAEH/////B3FBf2oFIAJB/wFxIQJBAQshAQJAAkAgASACRgRAIAAgAUEBIAEgAUEAQQAQhQUgBSwAAEEASA0BBSAHDQELIAUgAkEBajoAAAwBCyAAKAIAIQEgACACQQFqNgIEIAEhAAsgAkECdCAAaiIAIAYQhAIgBEEANgIAIABBBGogBBCEAiADJAkLCwAgABBMIAAQ7AQL1gEBA38jCSEFIwlBQGskCSAFIQMgACABQQAQjQUEf0EBBSABBH8gAUGwzABBoMwAQQAQkQUiAQR/IANBBGoiBEIANwIAIARCADcCCCAEQgA3AhAgBEIANwIYIARCADcCICAEQgA3AiggBEEANgIwIAMgATYCACADIAA2AgggA0F/NgIMIANBATYCMCABKAIAKAIcIQAgASADIAIoAgBBASAAQQdxQcYDahELACADKAIYQQFGBH8gAiADKAIQNgIAQQEFQQALBUEACwVBAAsLIQAg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ACADNgIQIAAgAzYCFCAAIAM2AhggACADNgIcIAAgAzYCICAAIAM2AiQgACADNgIoIAAgAzYCLCAAIAM2AjAgACADNgI0IAAgAzYCOCAAIAM2AjwgAEFAayEADAELCwNAIAAgBUgEQCAAIAM2AgAgAEEEaiEADAELCwsDQCAAIARIBEAgACABOgAAIABBAWohAAwBCwsgBCACawtNAQJ/IAAjBCgCACICaiIBIAJIIABBAEpxIAFBAEhyBEAQAxpBDBAGQX8PCyABEA9MBEAjBCABNgIABSABEBFFBEBBDBAGQX8PCwsgAgsMACABIABBP3ERAgALEQAgASACIABBD3FBQGsRAwALFAAgASACIAMgAEEfcUHQAGoRAAALFgAgASACIAMgBCAAQQdxQfAAahEJAAsYACABIAIgAyAEIAUgAEEHcUH4AGoRDgALGAAgASACIAMgBCAFIABBH3FBgAFqEQUACxoAIAEgAiADIAQgBSAGIABBA3FBoAFqEQ8ACxoAIAEgAiADIAQgBSAGIABBP3FBpAFqEQgACxwAIAEgAiADIAQgBSAGIAcgAEEHcUHkAWoREAALHgAgASACIAMgBCAFIAYgByAIIABBD3FB7AFqEQYACxgAIAEgAiADIAQgBSAAQQdxQfwBahERAAsIAEGEAhEKAAsRACABIABB/wBxQYUCahEHAAsSACABIAIgAEE/cUGFA2oRBAALDgAgASACIANBxQMRAQALFgAgASACIAMgBCAAQQdxQcYDahELAAsYACABIAIgAyAEIAUgAEEDcUHOA2oRDQALGgAgASACIAMgBCAFIAYgAEEHcUHSA2oRDAALGAAgASACIAMgBCAFIABBA3FB2gNqERIACwgAQQAQAkEACwgAQQEQAkEACwgAQQIQAkEACwgAQQMQAkEACwgAQQQQAkEACwgAQQUQAkEACwgAQQYQAkEACwgAQQcQAkEACwgAQQgQAkEACwgAQQkQAkEACwgAQQoQAkEACwYAQQsQAgsGAEEMEAILBgBBDRACCwYAQQ4QAgsGAEEPEAILBgBBEBACCwYAQREQAgsGAEESEAILGQAgACABIAIgAyAEIAWtIAatQiCGhBCuBQsZACAAIAEgAiADrSAErUIghoQgBSAGELYFCwuWZDMAQYYICwrwPwAAAAAAAPA/AEGeCAsC8D8AQbYICwLwPwBB1ggL3gHwP0kq+BLP/t8/WoP3VblQuz+lae0JVPeHP9myharUiEI/AAAAAAAA8D+Vdx+RAP/fP2LBWDp6V7w/tV0VZqkOjD/bypKKlFdPP2+mRcEO5f8+AAAAAAAA8D/Yp7xUAADgP0ELf6HlFL0/Sqw4Qz7+jj8OW4nPip9UPyDMTiLSbxA/7CYjPa3cuD4AAAAAAADwP4vqX0LF/N8/kfWwCaaCvT+6ehiLrWGQP4+bbbbQzFc/iZXNLv/OFj8uvpGy7vXKPuxdd0Zyrm4+3hIElQAAAAD///////////////8AQcAKC8wBAgAAwAMAAMAEAADABQAAwAYAAMAHAADACAAAwAkAAMAKAADACwAAwAwAAMANAADADgAAwA8AAMAQAADAEQAAwBIAAMATAADAFAAAwBUAAMAWAADAFwAAwBgAAMAZAADAGgAAwBsAAMAcAADAHQAAwB4AAMAfAADAAAAAswEAAMMCAADDAwAAwwQAAMMFAADDBgAAwwcAAMMIAADDCQAAwwoAAMMLAADDDAAAww0AANMOAADDDwAAwwAADLsBAAzDAgAMwwMADMMEAAzTAEGUEAv5AwEAAAACAAAAAwAAAAQAAAAFAAAABgAAAAcAAAAIAAAACQAAAAoAAAALAAAADAAAAA0AAAAOAAAADwAAABAAAAARAAAAEgAAABMAAAAUAAAAFQAAABYAAAAXAAAAGAAAABkAAAAaAAAAGwAAABwAAAAdAAAAHgAAAB8AAAAgAAAAIQAAACIAAAAjAAAAJAAAACUAAAAmAAAAJwAAACgAAAApAAAAKgAAACsAAAAsAAAALQAAAC4AAAAvAAAAMAAAADEAAAAyAAAAMwAAADQAAAA1AAAANgAAADcAAAA4AAAAOQAAADoAAAA7AAAAPAAAAD0AAAA+AAAAPwAAAEAAAABhAAAAYgAAAGMAAABkAAAAZQAAAGYAAABnAAAAaAAAAGkAAABqAAAAawAAAGwAAABtAAAAbgAAAG8AAABwAAAAcQAAAHIAAABzAAAAdAAAAHUAAAB2AAAAdwAAAHgAAAB5AAAAegAAAFsAAABcAAAAXQAAAF4AAABfAAAAYAAAAGEAAABiAAAAYwAAAGQAAABlAAAAZgAAAGcAAABoAAAAaQAAAGoAAABrAAAAbAAAAG0AAABuAAAAbwAAAHAAAABxAAAAcgAAAHMAAAB0AAAAdQAAAHYAAAB3AAAAeAAAAHkAAAB6AAAAewAAAHwAAAB9AAAAfgAAAH8AQZAaC/8BAgACAAIAAgACAAIAAgACAAIAAyACIAIgAiACIAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAFgBMAEwATABMAEwATABMAEwATABMAEwATABMAEwATACNgI2AjYCNgI2AjYCNgI2AjYCNgEwATABMAEwATABMAEwAjVCNUI1QjVCNUI1QjFCMUIxQjFCMUIxQjFCMUIxQjFCMUIxQjFCMUIxQjFCMUIxQjFCMUEwATABMAEwATABMAI1gjWCNYI1gjWCNYIxgjGCMYIxgjGCMYIxgjGCMYIxgjGCMYIxgjGCMYIxgjGCMYIxgjGBMAEwATABMACAEGUIgv5AwEAAAACAAAAAwAAAAQAAAAFAAAABgAAAAcAAAAIAAAACQAAAAoAAAALAAAADAAAAA0AAAAOAAAADwAAABAAAAARAAAAEgAAABMAAAAUAAAAFQAAABYAAAAXAAAAGAAAABkAAAAaAAAAGwAAABwAAAAdAAAAHgAAAB8AAAAgAAAAIQAAACIAAAAjAAAAJAAAACUAAAAmAAAAJwAAACgAAAApAAAAKgAAACsAAAAsAAAALQAAAC4AAAAvAAAAMAAAADEAAAAyAAAAMwAAADQAAAA1AAAANgAAADcAAAA4AAAAOQAAADoAAAA7AAAAPAAAAD0AAAA+AAAAPwAAAEAAAABBAAAAQgAAAEMAAABEAAAARQAAAEYAAABHAAAASAAAAEkAAABKAAAASwAAAEwAAABNAAAATgAAAE8AAABQAAAAUQAAAFIAAABTAAAAVAAAAFUAAABWAAAAVwAAAFgAAABZAAAAWgAAAFsAAABcAAAAXQAAAF4AAABfAAAAYAAAAEEAAABCAAAAQwAAAEQAAABFAAAARgAAAEcAAABIAAAASQAAAEoAAABLAAAATAAAAE0AAABOAAAATwAAAFAAAABRAAAAUgAAAFMAAABUAAAAVQAAAFYAAABXAAAAWAAAAFkAAABaAAAAewAAAHwAAAB9AAAAfgAAAH8AQZAqC6ECCgAAAGQAAADoAwAAECcAAKCGAQBAQg8AgJaYAADh9QX/////////////////////////////////////////////////////////////////AAECAwQFBgcICf////////8KCwwNDg8QERITFBUWFxgZGhscHR4fICEiI////////woLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIj/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////wBBwCwLGBEACgAREREAAAAABQAAAAAAAAkAAAAACwBB4CwLIREADwoREREDCgcAARMJCwsAAAkGCwAACwAGEQAAABEREQBBkS0LAQsAQZotCxgRAAoKERERAAoAAAIACQsAAAAJAAsAAAsAQcstCwEMAEHXLQsVDAAAAAAMAAAAAAkMAAAAAAAMAAAMAEGFLgsBDgBBkS4LFQ0AAAAEDQAAAAAJDgAAAAAADgAADgBBvy4LARAAQcsuCx4PAAAAAA8AAAAACRAAAAAAABAAABAAABIAAAASEhIAQYIvCw4SAAAAEhISAAAAAAAACQBBsy8LAQsAQb8vCxUKAAAAAAoAAAAACQsAAAAAAAsAAAsAQe0vCwEMAEH5Lwt+DAAAAAAMAAAAAAkMAAAAAAAMAAAMAAAwMTIzNDU2Nzg5QUJDREVGVCEiGQ0BAgMRSxwMEAQLHRIeJ2hub3BxYiAFBg8TFBUaCBYHKCQXGAkKDhsfJSODgn0mKis8PT4/Q0dKTVhZWltcXV5fYGFjZGVmZ2lqa2xyc3R5ent8AEGAMQvXDklsbGVnYWwgYnl0ZSBzZXF1ZW5jZQBEb21haW4gZXJyb3IAUmVzdWx0IG5vdCByZXByZXNlbnRhYmxlAE5vdCBhIHR0eQBQZXJtaXNzaW9uIGRlbmllZABPcGVyYXRpb24gbm90IHBlcm1pdHRlZABObyBzdWNoIGZpbGUgb3IgZGlyZWN0b3J5AE5vIHN1Y2ggcHJvY2VzcwBGaWxlIGV4aXN0cwBWYWx1ZSB0b28gbGFyZ2UgZm9yIGRhdGEgdHlwZQBObyBzcGFjZSBsZWZ0IG9uIGRldmljZQBPdXQgb2YgbWVtb3J5AFJlc291cmNlIGJ1c3kASW50ZXJydXB0ZWQgc3lzdGVtIGNhbGwAUmVzb3VyY2UgdGVtcG9yYXJpbHkgdW5hdmFpbGFibGUASW52YWxpZCBzZWVrAENyb3NzLWRldmljZSBsaW5rAFJlYWQtb25seSBmaWxlIHN5c3RlbQBEaXJlY3Rvcnkgbm90IGVtcHR5AENvbm5lY3Rpb24gcmVzZXQgYnkgcGVlcgBPcGVyYXRpb24gdGltZWQgb3V0AENvbm5lY3Rpb24gcmVmdXNlZABIb3N0IGlzIGRvd24ASG9zdCBpcyB1bnJlYWNoYWJsZQBBZGRyZXNzIGluIHVzZQBCcm9rZW4gcGlwZQBJL08gZXJyb3IATm8gc3VjaCBkZXZpY2Ugb3IgYWRkcmVzcwBCbG9jayBkZXZpY2UgcmVxdWlyZWQATm8gc3VjaCBkZXZpY2UATm90IGEgZGlyZWN0b3J5AElzIGEgZGlyZWN0b3J5AFRleHQgZmlsZSBidXN5AEV4ZWMgZm9ybWF0IGVycm9yAEludmFsaWQgYXJndW1lbnQAQXJndW1lbnQgbGlzdCB0b28gbG9uZwBTeW1ib2xpYyBsaW5rIGxvb3AARmlsZW5hbWUgdG9vIGxvbmcAVG9vIG1hbnkgb3BlbiBmaWxlcyBpbiBzeXN0ZW0ATm8gZmlsZSBkZXNjcmlwdG9ycyBhdmFpbGFibGUAQmFkIGZpbGUgZGVzY3JpcHRvcgBObyBjaGlsZCBwcm9jZXNzAEJhZCBhZGRyZXNzAEZpbGUgdG9vIGxhcmdlAFRvbyBtYW55IGxpbmtzAE5vIGxvY2tzIGF2YWlsYWJsZQBSZXNvdXJjZSBkZWFkbG9jayB3b3VsZCBvY2N1cgBTdGF0ZSBub3QgcmVjb3ZlcmFibGUAUHJldmlvdXMgb3duZXIgZGllZABPcGVyYXRpb24gY2FuY2VsZWQARnVuY3Rpb24gbm90IGltcGxlbWVudGVkAE5vIG1lc3NhZ2Ugb2YgZGVzaXJlZCB0eXBlAElkZW50aWZpZXIgcmVtb3ZlZABEZXZpY2Ugbm90IGEgc3RyZWFtAE5vIGRhdGEgYXZhaWxhYmxlAERldmljZSB0aW1lb3V0AE91dCBvZiBzdHJlYW1zIHJlc291cmNlcwBMaW5rIGhhcyBiZWVuIHNldmVyZWQAUHJvdG9jb2wgZXJyb3IAQmFkIG1lc3NhZ2UARmlsZSBkZXNjcmlwdG9yIGluIGJhZCBzdGF0ZQBOb3QgYSBzb2NrZXQARGVzdGluYXRpb24gYWRkcmVzcyByZXF1aXJlZABNZXNzYWdlIHRvbyBsYXJnZQBQcm90b2NvbCB3cm9uZyB0eXBlIGZvciBzb2NrZXQAUHJvdG9jb2wgbm90IGF2YWlsYWJsZQBQcm90b2NvbCBub3Qgc3VwcG9ydGVkAFNvY2tldCB0eXBlIG5vdCBzdXBwb3J0ZWQATm90IHN1cHBvcnRlZABQcm90b2NvbCBmYW1pbHkgbm90IHN1cHBvcnRlZABBZGRyZXNzIGZhbWlseSBub3Qgc3VwcG9ydGVkIGJ5IHByb3RvY29sAEFkZHJlc3Mgbm90IGF2YWlsYWJsZQBOZXR3b3JrIGlzIGRvd24ATmV0d29yayB1bnJlYWNoYWJsZQBDb25uZWN0aW9uIHJlc2V0IGJ5IG5ldHdvcmsAQ29ubmVjdGlvbiBhYm9ydGVkAE5vIGJ1ZmZlciBzcGFjZSBhdmFpbGFibGUAU29ja2V0IGlzIGNvbm5lY3RlZABTb2NrZXQgbm90IGNvbm5lY3RlZABDYW5ub3Qgc2VuZCBhZnRlciBzb2NrZXQgc2h1dGRvd24AT3BlcmF0aW9uIGFscmVhZHkgaW4gcHJvZ3Jlc3MAT3BlcmF0aW9uIGluIHByb2dyZXNzAFN0YWxlIGZpbGUgaGFuZGxlAFJlbW90ZSBJL08gZXJyb3IAUXVvdGEgZXhjZWVkZWQATm8gbWVkaXVtIGZvdW5kAFdyb25nIG1lZGl1bSB0eXBlAE5vIGVycm9yIGluZm9ybWF0aW9uAAAAAAAATENfQ1RZUEUAAAAATENfTlVNRVJJQwAATENfVElNRQAAAAAATENfQ09MTEFURQAATENfTU9ORVRBUlkATENfTUVTU0FHRVMAQeA/CyAwMTIzNDU2Nzg5YWJjZGVmQUJDREVGeFgrLXBQaUluTgBBkMAAC4EBJQAAAG0AAAAvAAAAJQAAAGQAAAAvAAAAJQAAAHkAAAAlAAAAWQAAAC0AAAAlAAAAbQAAAC0AAAAlAAAAZAAAACUAAABJAAAAOgAAACUAAABNAAAAOgAAACUAAABTAAAAIAAAACUAAABwAAAAAAAAACUAAABIAAAAOgAAACUAAABNAEGgwQAL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RUVFAE5TdDNfXzI5YmFzaWNfaW9zSXdOU18xMWNoYXJfdHJhaXRzSXdFRUVFAE5TdDNfXzIxNWJhc2ljX3N0cmVhbWJ1ZkljTlNfMTFjaGFyX3RyYWl0c0ljRUVFRQBOU3QzX18yMTViYXNpY19zdHJlYW1idWZJd05TXzExY2hhcl90cmFpdHNJd0VFRUUATlN0M19fMjEzYmFzaWNfaXN0cmVhbUljTlNfMTFjaGFyX3RyYWl0c0ljRUVFRQBOU3QzX18yMTNiYXNpY19pc3RyZWFtSXdOU18xMWNoYXJfdHJhaXRzSXdFRUVFAE5TdDNfXzIxM2Jhc2ljX29zdHJlYW1JY05TXzExY2hhcl90cmFpdHNJY0VFRUUATlN0M19fMjEzYmFzaWNfb3N0cmVhbUl3TlNfMTFjaGFyX3RyYWl0c0l3RUVFRQBOU3QzX18yMTFfX3N0ZG91dGJ1Zkl3RUUATlN0M19fMjExX19zdGRvdXRidWZJY0VFAHVuc3VwcG9ydGVkIGxvY2FsZSBmb3Igc3RhbmRhcmQgaW5wdXQATlN0M19fMjEwX19zdGRpbmJ1Zkl3RUUATlN0M19fMjEwX19zdGRpbmJ1ZkljRUUATlN0M19fMjdjb2xsYXRlSWNFRQBOU3QzX18yNmxvY2FsZTVmYWNldEUATlN0M19fMjdjb2xsYXRlSXdFRQAlcABDAE5TdDNfXzI3bnVtX2dldEljTlNfMTlpc3RyZWFtYnVmX2l0ZXJhdG9ySWNOU18xMWNoYXJfdHJhaXRzSWNFRUVFRUUATlN0M19fMjlfX251bV9nZXRJY0VFAE5TdDNfXzIxNF9fbnVtX2dldF9iYXNlRQBOU3QzX18yN251bV9nZXRJd05TXzE5aXN0cmVhbWJ1Zl9pdGVyYXRvckl3TlNfMTFjaGFyX3RyYWl0c0l3RUVFRUVFAE5TdDNfXzI5X19udW1fZ2V0SXdFRQAlcAAAAABMAGxsACUAAAAAAGwATlN0M19fMjdudW1fcHV0SWNOU18xOW9zdHJlYW1idWZfaXRlcmF0b3JJY05TXzExY2hhcl90cmFpdHNJY0VFRUVFRQBOU3QzX18yOV9fbnVtX3B1dEljRUUATlN0M19fMjE0X19udW1fcHV0X2Jhc2VFAE5TdDNfXzI3bnVtX3B1dEl3TlNfMTlvc3RyZWFtYnVmX2l0ZXJhdG9ySXdOU18xMWNoYXJfdHJhaXRzSXdFRUVFRUUATlN0M19fMjlfX251bV9wdXRJd0VFACVIOiVNOiVTACVtLyVkLyV5ACVJOiVNOiVTICVwACVhICViICVkICVIOiVNOiVTICVZAEFNAFBNAEphbnVhcnkARmVicnVhcnkATWFyY2gAQXByaWwATWF5AEp1bmUASnVseQBBdWd1c3QAU2VwdGVtYmVyAE9jdG9iZXIATm92ZW1iZXIARGVjZW1iZXIASmFuAEZlYgBNYXIAQXByAEp1bgBKdWwAQXVnAFNlcABPY3QATm92AERlYwBTdW5kYXkATW9uZGF5AFR1ZXNkYXkAV2VkbmVzZGF5AFRodXJzZGF5AEZyaWRheQBTYXR1cmRheQBTdW4ATW9uAFR1ZQBXZWQAVGh1AEZyaQBTYXQAJW0vJWQvJXklWS0lbS0lZCVJOiVNOiVTICVwJUg6JU0lSDolTTolUyVIOiVNOiVTTlN0M19fMjh0aW1lX2dldEljTlNfMTlpc3RyZWFtYnVmX2l0ZXJhdG9ySWNOU18xMWNoYXJfdHJhaXRzSWNFRUVFRUUATlN0M19fMjIwX190aW1lX2dldF9jX3N0b3JhZ2VJY0VFAE5TdDNfXzI5dGltZV9iYXNlRQBOU3QzX18yOHRpbWVfZ2V0SXdOU18xOWlzdHJlYW1idWZfaXRlcmF0b3JJd05TXzExY2hhcl90cmFpdHNJd0VFRUVFRQBOU3QzX18yMjBfX3RpbWVfZ2V0X2Nfc3RvcmFnZUl3RUUATlN0M19fMjh0aW1lX3B1dEljTlNfMTlvc3RyZWFtYnVmX2l0ZXJhdG9ySWNOU18xMWNoYXJfdHJhaXRzSWNFRUVFRUUATlN0M19fMjEwX190aW1lX3B1dEUATlN0M19fMjh0aW1lX3B1dEl3TlNfMTlvc3RyZWFtYnVmX2l0ZXJhdG9ySXdOU18xMWNoYXJfdHJhaXRzSXdFRUVFRUUATlN0M19fMjEwbW9uZXlwdW5jdEljTGIwRUVFAE5TdDNfXzIxMG1vbmV5X2Jhc2VFAE5TdDNfXzIxMG1vbmV5cHVuY3RJY0xiMUVFRQBOU3QzX18yMTBtb25leXB1bmN0SXdMYjBFRUUATlN0M19fMjEwbW9uZXlwdW5jdEl3TGIxRUVFADAxMjM0NTY3ODkAJUxmAE5TdDNfXzI5bW9uZXlfZ2V0SWNOU18xOWlzdHJlYW1idWZfaXRlcmF0b3JJY05TXzExY2hhcl90cmFpdHNJY0VFRUVFRQBOU3QzX18yMTFfX21vbmV5X2dldEljRUUAMDEyMzQ1Njc4OQBOU3QzX18yOW1vbmV5X2dldEl3TlNfMTlpc3RyZWFtYnVmX2l0ZXJhdG9ySXdOU18xMWNoYXJfdHJhaXRzSXdFRUVFRUUATlN0M19fMjExX19tb25leV9nZXRJd0VFACUuMExmAE5TdDNfXzI5bW9uZXlfcHV0SWNOU18xOW9zdHJlYW1idWZfaXRlcmF0b3JJY05TXzExY2hhcl90cmFpdHNJY0VFRUVFRQBOU3QzX18yMTFfX21vbmV5X3B1dEljRUUATlN0M19fMjltb25leV9wdXRJd05TXzE5b3N0cmVhbWJ1Zl9pdGVyYXRvckl3TlNfMTFjaGFyX3RyYWl0c0l3RUVFRUVFAE5TdDNfXzIxMV9fbW9uZXlfcHV0SXdFRQBOU3QzX18yOG1lc3NhZ2VzSWNFRQBOU3QzX18yMTNtZXNzYWdlc19iYXNlRQBOU3QzX18yMTdfX3dpZGVuX2Zyb21fdXRmOElMbTMyRUVFAE5TdDNfXzI3Y29kZWN2dElEaWMxMV9fbWJzdGF0ZV90RUUATlN0M19fMjEyY29kZWN2dF9iYXNlRQBOU3QzX18yMTZfX25hcnJvd190b191dGY4SUxtMzJFRUUATlN0M19fMjhtZXNzYWdlc0l3RUUATlN0M19fMjdjb2RlY3Z0SWNjMTFfX21ic3RhdGVfdEVFAE5TdDNfXzI3Y29kZWN2dEl3YzExX19tYnN0YXRlX3RFRQBOU3QzX18yN2NvZGVjdnRJRHNjMTFfX21ic3RhdGVfdEVFAE5TdDNfXzI2bG9jYWxlNV9faW1wRQBOU3QzX18yNWN0eXBlSWNFRQBOU3QzX18yMTBjdHlwZV9iYXNlRQBOU3QzX18yNWN0eXBlSXdFRQBmYWxzZQB0cnVlAE5TdDNfXzI4bnVtcHVuY3RJY0VFAE5TdDNfXzI4bnVtcHVuY3RJd0VFAE5TdDNfXzIxNF9fc2hhcmVkX2NvdW50RQBOMTBfX2N4eGFiaXYxMTZfX3NoaW1fdHlwZV9pbmZvRQBTdDl0eXBlX2luZm8ATjEwX19jeHhhYml2MTIwX19zaV9jbGFzc190eXBlX2luZm9FAE4xMF9fY3h4YWJpdjExN19fY2xhc3NfdHlwZV9pbmZvRQBOMTBfX2N4eGFiaXYxMTlfX3BvaW50ZXJfdHlwZV9pbmZvRQBOMTBfX2N4eGFiaXYxMTdfX3BiYXNlX3R5cGVfaW5mb0UATjEwX19jeHhhYml2MTIxX192bWlfY2xhc3NfdHlwZV9pbmZvRQ==';
if (!isDataURI(wasmBinaryFile)) {
  wasmBinaryFile = locateFile(wasmBinaryFile);
}

function mergeMemory(newBuffer) {
  // The wasm instance creates its memory. But static init code might have written to
  // buffer already, including the mem init file, and we must copy it over in a proper merge.
  // TODO: avoid this copy, by avoiding such static init writes
  // TODO: in shorter term, just copy up to the last static init write
  var oldBuffer = Module['buffer'];
  if (newBuffer.byteLength < oldBuffer.byteLength) {
    err('the new buffer in mergeMemory is smaller than the previous one. in native wasm, we should grow memory here');
  }
  var oldView = new Int8Array(oldBuffer);
  var newView = new Int8Array(newBuffer);


  newView.set(oldView);
  updateGlobalBuffer(newBuffer);
  updateGlobalBufferViews();
}

function getBinary() {
  try {
    if (Module['wasmBinary']) {
      return new Uint8Array(Module['wasmBinary']);
    }
    var binary = tryParseAsDataURI(wasmBinaryFile);
    if (binary) {
      return binary;
    }
    if (Module['readBinary']) {
      return Module['readBinary'](wasmBinaryFile);
    } else {
      throw "both async and sync fetching of the wasm failed";
    }
  }
  catch (err) {
    abort(err);
  }
}

function getBinaryPromise() {
  // if we don't have the binary yet, and have the Fetch api, use that
  // in some environments, like Electron's render process, Fetch api may be present, but have a different context than expected, let's only use it on the Web
  if (!Module['wasmBinary'] && (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) && typeof fetch === 'function') {
    return fetch(wasmBinaryFile, { credentials: 'same-origin' }).then(function(response) {
      if (!response['ok']) {
        throw "failed to load wasm binary file at '" + wasmBinaryFile + "'";
      }
      return response['arrayBuffer']();
    }).catch(function () {
      return getBinary();
    });
  }
  // Otherwise, getBinary should be able to get it synchronously
  return new Promise(function(resolve, reject) {
    resolve(getBinary());
  });
}

// Create the wasm instance.
// Receives the wasm imports, returns the exports.
function createWasm(env) {
  if (typeof WebAssembly !== 'object') {
    err('no native wasm support detected');
    return false;
  }
  // prepare imports
  if (!(Module['wasmMemory'] instanceof WebAssembly.Memory)) {
    err('no native wasm Memory in use');
    return false;
  }
  env['memory'] = Module['wasmMemory'];
  var info = {
    'global': {
      'NaN': NaN,
      'Infinity': Infinity
    },
    'global.Math': Math,
    'env': env,
    'asm2wasm': asm2wasmImports,
    'parent': Module // Module inside wasm-js.cpp refers to wasm-js.cpp; this allows access to the outside program.
  };
  // Load the wasm module and create an instance of using native support in the JS engine.
  // handle a generated wasm instance, receiving its exports and
  // performing other necessary setup
  function receiveInstance(instance, module) {
    var exports = instance.exports;
    if (exports.memory) mergeMemory(exports.memory);
    Module['asm'] = exports;
    removeRunDependency('wasm-instantiate');
  }
  addRunDependency('wasm-instantiate');

  // User shell pages can write their own Module.instantiateWasm = function(imports, successCallback) callback
  // to manually instantiate the Wasm module themselves. This allows pages to run the instantiation parallel
  // to any other async startup actions they are performing.
  if (Module['instantiateWasm']) {
    try {
      return Module['instantiateWasm'](info, receiveInstance);
    } catch(e) {
      err('Module.instantiateWasm callback failed with error: ' + e);
      return false;
    }
  }

  function receiveInstantiatedSource(output) {
    // 'output' is a WebAssemblyInstantiatedSource object which has both the module and instance.
    // receiveInstance() will swap in the exports (to Module.asm) so they can be called
      // TODO: Due to Closure regression https://github.com/google/closure-compiler/issues/3193, the above line no longer optimizes out down to the following line.
      // When the regression is fixed, can restore the above USE_PTHREADS-enabled path.
    receiveInstance(output['instance']);
  }
  function instantiateArrayBuffer(receiver) {
    getBinaryPromise().then(function(binary) {
      return WebAssembly.instantiate(binary, info);
    }).then(receiver, function(reason) {
      err('failed to asynchronously prepare wasm: ' + reason);
      abort(reason);
    });
  }
  // Prefer streaming instantiation if available.
  if (!Module['wasmBinary'] &&
      typeof WebAssembly.instantiateStreaming === 'function' &&
      !isDataURI(wasmBinaryFile) &&
      typeof fetch === 'function') {
    WebAssembly.instantiateStreaming(fetch(wasmBinaryFile, { credentials: 'same-origin' }), info)
      .then(receiveInstantiatedSource, function(reason) {
        // We expect the most common failure cause to be a bad MIME type for the binary,
        // in which case falling back to ArrayBuffer instantiation should work.
        err('wasm streaming compile failed: ' + reason);
        err('falling back to ArrayBuffer instantiation');
        instantiateArrayBuffer(receiveInstantiatedSource);
      });
  } else {
    instantiateArrayBuffer(receiveInstantiatedSource);
  }
  return {}; // no exports yet; we'll fill them in later
}

// Memory growth integration code

var wasmReallocBuffer = function(size) {
  var PAGE_MULTIPLE = 65536;
  size = alignUp(size, PAGE_MULTIPLE); // round up to wasm page size
  var old = Module['buffer'];
  var oldSize = old.byteLength;
  // native wasm support
  try {
    var result = Module['wasmMemory'].grow((size - oldSize) / 65536); // .grow() takes a delta compared to the previous size
    if (result !== (-1 | 0)) {
      // success in native wasm memory growth, get the buffer from the memory
      return Module['buffer'] = Module['wasmMemory'].buffer;
    } else {
      return null;
    }
  } catch(e) {
    return null;
  }
};

Module['reallocBuffer'] = function(size) {
  return wasmReallocBuffer(size);
};

// Provide an "asm.js function" for the application, called to "link" the asm.js module. We instantiate
// the wasm module at that time, and it receives imports and provides exports and so forth, the app
// doesn't need to care that it is wasm or asm.js.

Module['asm'] = function(global, env, providedBuffer) {
  // import table
  if (!env['table']) {
    var TABLE_SIZE = Module['wasmTableSize'];
    var MAX_TABLE_SIZE = Module['wasmMaxTableSize'];
    if (typeof WebAssembly === 'object' && typeof WebAssembly.Table === 'function') {
      if (MAX_TABLE_SIZE !== undefined) {
        env['table'] = new WebAssembly.Table({ 'initial': TABLE_SIZE, 'maximum': MAX_TABLE_SIZE, 'element': 'anyfunc' });
      } else {
        env['table'] = new WebAssembly.Table({ 'initial': TABLE_SIZE, element: 'anyfunc' });
      }
    } else {
      env['table'] = new Array(TABLE_SIZE); // works in binaryen interpreter at least
    }
    Module['wasmTable'] = env['table'];
  }

  if (!env['__memory_base']) {
    env['__memory_base'] = Module['STATIC_BASE']; // tell the memory segments where to place themselves
  }
  if (!env['__table_base']) {
    env['__table_base'] = 0; // table starts at 0 by default, in dynamic linking this will change
  }

  var exports = createWasm(env);


  return exports;
};

// === Body ===

var ASM_CONSTS = [];





STATIC_BASE = GLOBAL_BASE;

// STATICTOP = STATIC_BASE + 23856;
/* global initializers */  __ATINIT__.push({ func: function() { __GLOBAL__I_000101() } }, { func: function() { __GLOBAL__sub_I_iostream_cpp() } });







var STATIC_BUMP = 23856;
Module["STATIC_BASE"] = STATIC_BASE;
Module["STATIC_BUMP"] = STATIC_BUMP;

/* no memory initializer */
var tempDoublePtr = 24864

function copyTempFloat(ptr) { // functions, because inlining this code increases code size too much
  HEAP8[tempDoublePtr] = HEAP8[ptr];
  HEAP8[tempDoublePtr+1] = HEAP8[ptr+1];
  HEAP8[tempDoublePtr+2] = HEAP8[ptr+2];
  HEAP8[tempDoublePtr+3] = HEAP8[ptr+3];
}

function copyTempDouble(ptr) {
  HEAP8[tempDoublePtr] = HEAP8[ptr];
  HEAP8[tempDoublePtr+1] = HEAP8[ptr+1];
  HEAP8[tempDoublePtr+2] = HEAP8[ptr+2];
  HEAP8[tempDoublePtr+3] = HEAP8[ptr+3];
  HEAP8[tempDoublePtr+4] = HEAP8[ptr+4];
  HEAP8[tempDoublePtr+5] = HEAP8[ptr+5];
  HEAP8[tempDoublePtr+6] = HEAP8[ptr+6];
  HEAP8[tempDoublePtr+7] = HEAP8[ptr+7];
}

// {{PRE_LIBRARY}}


  
  function __ZSt18uncaught_exceptionv() { // std::uncaught_exception()
      return !!__ZSt18uncaught_exceptionv.uncaught_exception;
    }
  
  
  
  
  function ___cxa_free_exception(ptr) {
      try {
        return _free(ptr);
      } catch(e) { // XXX FIXME
      }
    }var EXCEPTIONS={last:0,caught:[],infos:{},deAdjust:function(adjusted) {
        if (!adjusted || EXCEPTIONS.infos[adjusted]) return adjusted;
        for (var key in EXCEPTIONS.infos) {
          var ptr = +key; // the iteration key is a string, and if we throw this, it must be an integer as that is what we look for
          var adj = EXCEPTIONS.infos[ptr].adjusted;
          var len = adj.length;
          for (var i = 0; i < len; i++) {
            if (adj[i] === adjusted) {
              return ptr;
            }
          }
        }
        return adjusted;
      },addRef:function(ptr) {
        if (!ptr) return;
        var info = EXCEPTIONS.infos[ptr];
        info.refcount++;
      },decRef:function(ptr) {
        if (!ptr) return;
        var info = EXCEPTIONS.infos[ptr];
        assert(info.refcount > 0);
        info.refcount--;
        // A rethrown exception can reach refcount 0; it must not be discarded
        // Its next handler will clear the rethrown flag and addRef it, prior to
        // final decRef and destruction here
        if (info.refcount === 0 && !info.rethrown) {
          if (info.destructor) {
            Module['dynCall_vi'](info.destructor, ptr);
          }
          delete EXCEPTIONS.infos[ptr];
          ___cxa_free_exception(ptr);
        }
      },clearRef:function(ptr) {
        if (!ptr) return;
        var info = EXCEPTIONS.infos[ptr];
        info.refcount = 0;
      }};
  function ___resumeException(ptr) {
      if (!EXCEPTIONS.last) { EXCEPTIONS.last = ptr; }
      throw ptr + " - Exception catching is disabled, this exception cannot be caught. Compile with -s DISABLE_EXCEPTION_CATCHING=0 or DISABLE_EXCEPTION_CATCHING=2 to catch.";
    }function ___cxa_find_matching_catch() {
      var thrown = EXCEPTIONS.last;
      if (!thrown) {
        // just pass through the null ptr
        return ((setTempRet0(0),0)|0);
      }
      var info = EXCEPTIONS.infos[thrown];
      var throwntype = info.type;
      if (!throwntype) {
        // just pass through the thrown ptr
        return ((setTempRet0(0),thrown)|0);
      }
      var typeArray = Array.prototype.slice.call(arguments);
  
      var pointer = Module['___cxa_is_pointer_type'](throwntype);
      // can_catch receives a **, add indirection
      if (!___cxa_find_matching_catch.buffer) ___cxa_find_matching_catch.buffer = _malloc(4);
      HEAP32[((___cxa_find_matching_catch.buffer)>>2)]=thrown;
      thrown = ___cxa_find_matching_catch.buffer;
      // The different catch blocks are denoted by different types.
      // Due to inheritance, those types may not precisely match the
      // type of the thrown object. Find one which matches, and
      // return the type of the catch block which should be called.
      for (var i = 0; i < typeArray.length; i++) {
        if (typeArray[i] && Module['___cxa_can_catch'](typeArray[i], throwntype, thrown)) {
          thrown = HEAP32[((thrown)>>2)]; // undo indirection
          info.adjusted.push(thrown);
          return ((setTempRet0(typeArray[i]),thrown)|0);
        }
      }
      // Shouldn't happen unless we have bogus data in typeArray
      // or encounter a type for which emscripten doesn't have suitable
      // typeinfo defined. Best-efforts match just in case.
      thrown = HEAP32[((thrown)>>2)]; // undo indirection
      return ((setTempRet0(throwntype),thrown)|0);
    }function ___gxx_personality_v0() {
    }

  function ___lock() {}

  
  function ___setErrNo(value) {
      if (Module['___errno_location']) HEAP32[((Module['___errno_location']())>>2)]=value;
      return value;
    }function ___map_file(pathname, size) {
      ___setErrNo(1);
      return -1;
    }

  
  
  
  var PATH={splitPath:function(filename) {
        var splitPathRe = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
        return splitPathRe.exec(filename).slice(1);
      },normalizeArray:function(parts, allowAboveRoot) {
        // if the path tries to go above the root, `up` ends up > 0
        var up = 0;
        for (var i = parts.length - 1; i >= 0; i--) {
          var last = parts[i];
          if (last === '.') {
            parts.splice(i, 1);
          } else if (last === '..') {
            parts.splice(i, 1);
            up++;
          } else if (up) {
            parts.splice(i, 1);
            up--;
          }
        }
        // if the path is allowed to go above the root, restore leading ..s
        if (allowAboveRoot) {
          for (; up; up--) {
            parts.unshift('..');
          }
        }
        return parts;
      },normalize:function(path) {
        var isAbsolute = path.charAt(0) === '/',
            trailingSlash = path.substr(-1) === '/';
        // Normalize the path
        path = PATH.normalizeArray(path.split('/').filter(function(p) {
          return !!p;
        }), !isAbsolute).join('/');
        if (!path && !isAbsolute) {
          path = '.';
        }
        if (path && trailingSlash) {
          path += '/';
        }
        return (isAbsolute ? '/' : '') + path;
      },dirname:function(path) {
        var result = PATH.splitPath(path),
            root = result[0],
            dir = result[1];
        if (!root && !dir) {
          // No dirname whatsoever
          return '.';
        }
        if (dir) {
          // It has a dirname, strip trailing slash
          dir = dir.substr(0, dir.length - 1);
        }
        return root + dir;
      },basename:function(path) {
        // EMSCRIPTEN return '/'' for '/', not an empty string
        if (path === '/') return '/';
        var lastSlash = path.lastIndexOf('/');
        if (lastSlash === -1) return path;
        return path.substr(lastSlash+1);
      },extname:function(path) {
        return PATH.splitPath(path)[3];
      },join:function() {
        var paths = Array.prototype.slice.call(arguments, 0);
        return PATH.normalize(paths.join('/'));
      },join2:function(l, r) {
        return PATH.normalize(l + '/' + r);
      },resolve:function() {
        var resolvedPath = '',
          resolvedAbsolute = false;
        for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
          var path = (i >= 0) ? arguments[i] : FS.cwd();
          // Skip empty and invalid entries
          if (typeof path !== 'string') {
            throw new TypeError('Arguments to path.resolve must be strings');
          } else if (!path) {
            return ''; // an invalid portion invalidates the whole thing
          }
          resolvedPath = path + '/' + resolvedPath;
          resolvedAbsolute = path.charAt(0) === '/';
        }
        // At this point the path should be resolved to a full absolute path, but
        // handle relative paths to be safe (might happen when process.cwd() fails)
        resolvedPath = PATH.normalizeArray(resolvedPath.split('/').filter(function(p) {
          return !!p;
        }), !resolvedAbsolute).join('/');
        return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
      },relative:function(from, to) {
        from = PATH.resolve(from).substr(1);
        to = PATH.resolve(to).substr(1);
        function trim(arr) {
          var start = 0;
          for (; start < arr.length; start++) {
            if (arr[start] !== '') break;
          }
          var end = arr.length - 1;
          for (; end >= 0; end--) {
            if (arr[end] !== '') break;
          }
          if (start > end) return [];
          return arr.slice(start, end - start + 1);
        }
        var fromParts = trim(from.split('/'));
        var toParts = trim(to.split('/'));
        var length = Math.min(fromParts.length, toParts.length);
        var samePartsLength = length;
        for (var i = 0; i < length; i++) {
          if (fromParts[i] !== toParts[i]) {
            samePartsLength = i;
            break;
          }
        }
        var outputParts = [];
        for (var i = samePartsLength; i < fromParts.length; i++) {
          outputParts.push('..');
        }
        outputParts = outputParts.concat(toParts.slice(samePartsLength));
        return outputParts.join('/');
      }};
  
  var TTY={ttys:[],init:function () {
        // https://github.com/emscripten-core/emscripten/pull/1555
        // if (ENVIRONMENT_IS_NODE) {
        //   // currently, FS.init does not distinguish if process.stdin is a file or TTY
        //   // device, it always assumes it's a TTY device. because of this, we're forcing
        //   // process.stdin to UTF8 encoding to at least make stdin reading compatible
        //   // with text files until FS.init can be refactored.
        //   process['stdin']['setEncoding']('utf8');
        // }
      },shutdown:function() {
        // https://github.com/emscripten-core/emscripten/pull/1555
        // if (ENVIRONMENT_IS_NODE) {
        //   // inolen: any idea as to why node -e 'process.stdin.read()' wouldn't exit immediately (with process.stdin being a tty)?
        //   // isaacs: because now it's reading from the stream, you've expressed interest in it, so that read() kicks off a _read() which creates a ReadReq operation
        //   // inolen: I thought read() in that case was a synchronous operation that just grabbed some amount of buffered data if it exists?
        //   // isaacs: it is. but it also triggers a _read() call, which calls readStart() on the handle
        //   // isaacs: do process.stdin.pause() and i'd think it'd probably close the pending call
        //   process['stdin']['pause']();
        // }
      },register:function(dev, ops) {
        TTY.ttys[dev] = { input: [], output: [], ops: ops };
        FS.registerDevice(dev, TTY.stream_ops);
      },stream_ops:{open:function(stream) {
          var tty = TTY.ttys[stream.node.rdev];
          if (!tty) {
            throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
          }
          stream.tty = tty;
          stream.seekable = false;
        },close:function(stream) {
          // flush any pending line data
          stream.tty.ops.flush(stream.tty);
        },flush:function(stream) {
          stream.tty.ops.flush(stream.tty);
        },read:function(stream, buffer, offset, length, pos /* ignored */) {
          if (!stream.tty || !stream.tty.ops.get_char) {
            throw new FS.ErrnoError(ERRNO_CODES.ENXIO);
          }
          var bytesRead = 0;
          for (var i = 0; i < length; i++) {
            var result;
            try {
              result = stream.tty.ops.get_char(stream.tty);
            } catch (e) {
              throw new FS.ErrnoError(ERRNO_CODES.EIO);
            }
            if (result === undefined && bytesRead === 0) {
              throw new FS.ErrnoError(ERRNO_CODES.EAGAIN);
            }
            if (result === null || result === undefined) break;
            bytesRead++;
            buffer[offset+i] = result;
          }
          if (bytesRead) {
            stream.node.timestamp = Date.now();
          }
          return bytesRead;
        },write:function(stream, buffer, offset, length, pos) {
          if (!stream.tty || !stream.tty.ops.put_char) {
            throw new FS.ErrnoError(ERRNO_CODES.ENXIO);
          }
          try {
            for (var i = 0; i < length; i++) {
              stream.tty.ops.put_char(stream.tty, buffer[offset+i]);
            }
          } catch (e) {
            throw new FS.ErrnoError(ERRNO_CODES.EIO);
          }
          if (length) {
            stream.node.timestamp = Date.now();
          }
          return i;
        }},default_tty_ops:{get_char:function(tty) {
          if (!tty.input.length) {
            var result = null;
            if (ENVIRONMENT_IS_NODE) {
              // we will read data by chunks of BUFSIZE
              var BUFSIZE = 256;
              var buf = new Buffer(BUFSIZE);
              var bytesRead = 0;
  
              var isPosixPlatform = (process.platform != 'win32'); // Node doesn't offer a direct check, so test by exclusion
  
              var fd = process.stdin.fd;
              if (isPosixPlatform) {
                // Linux and Mac cannot use process.stdin.fd (which isn't set up as sync)
                var usingDevice = false;
                try {
                  fd = fs.openSync('/dev/stdin', 'r');
                  usingDevice = true;
                } catch (e) {}
              }
  
              try {
                bytesRead = fs.readSync(fd, buf, 0, BUFSIZE, null);
              } catch(e) {
                // Cross-platform differences: on Windows, reading EOF throws an exception, but on other OSes,
                // reading EOF returns 0. Uniformize behavior by treating the EOF exception to return 0.
                if (e.toString().indexOf('EOF') != -1) bytesRead = 0;
                else throw e;
              }
  
              if (usingDevice) { fs.closeSync(fd); }
              if (bytesRead > 0) {
                result = buf.slice(0, bytesRead).toString('utf-8');
              } else {
                result = null;
              }
  
            } else if (typeof window != 'undefined' &&
              typeof window.prompt == 'function') {
              // Browser.
              result = window.prompt('Input: ');  // returns null on cancel
              if (result !== null) {
                result += '\n';
              }
            } else if (typeof readline == 'function') {
              // Command line.
              result = readline();
              if (result !== null) {
                result += '\n';
              }
            }
            if (!result) {
              return null;
            }
            tty.input = intArrayFromString(result, true);
          }
          return tty.input.shift();
        },put_char:function(tty, val) {
          if (val === null || val === 10) {
            out(UTF8ArrayToString(tty.output, 0));
            tty.output = [];
          } else {
            if (val != 0) tty.output.push(val); // val == 0 would cut text output off in the middle.
          }
        },flush:function(tty) {
          if (tty.output && tty.output.length > 0) {
            out(UTF8ArrayToString(tty.output, 0));
            tty.output = [];
          }
        }},default_tty1_ops:{put_char:function(tty, val) {
          if (val === null || val === 10) {
            err(UTF8ArrayToString(tty.output, 0));
            tty.output = [];
          } else {
            if (val != 0) tty.output.push(val);
          }
        },flush:function(tty) {
          if (tty.output && tty.output.length > 0) {
            err(UTF8ArrayToString(tty.output, 0));
            tty.output = [];
          }
        }}};
  
  var MEMFS={ops_table:null,mount:function(mount) {
        return MEMFS.createNode(null, '/', 16384 | 511 /* 0777 */, 0);
      },createNode:function(parent, name, mode, dev) {
        if (FS.isBlkdev(mode) || FS.isFIFO(mode)) {
          // no supported
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        if (!MEMFS.ops_table) {
          MEMFS.ops_table = {
            dir: {
              node: {
                getattr: MEMFS.node_ops.getattr,
                setattr: MEMFS.node_ops.setattr,
                lookup: MEMFS.node_ops.lookup,
                mknod: MEMFS.node_ops.mknod,
                rename: MEMFS.node_ops.rename,
                unlink: MEMFS.node_ops.unlink,
                rmdir: MEMFS.node_ops.rmdir,
                readdir: MEMFS.node_ops.readdir,
                symlink: MEMFS.node_ops.symlink
              },
              stream: {
                llseek: MEMFS.stream_ops.llseek
              }
            },
            file: {
              node: {
                getattr: MEMFS.node_ops.getattr,
                setattr: MEMFS.node_ops.setattr
              },
              stream: {
                llseek: MEMFS.stream_ops.llseek,
                read: MEMFS.stream_ops.read,
                write: MEMFS.stream_ops.write,
                allocate: MEMFS.stream_ops.allocate,
                mmap: MEMFS.stream_ops.mmap,
                msync: MEMFS.stream_ops.msync
              }
            },
            link: {
              node: {
                getattr: MEMFS.node_ops.getattr,
                setattr: MEMFS.node_ops.setattr,
                readlink: MEMFS.node_ops.readlink
              },
              stream: {}
            },
            chrdev: {
              node: {
                getattr: MEMFS.node_ops.getattr,
                setattr: MEMFS.node_ops.setattr
              },
              stream: FS.chrdev_stream_ops
            }
          };
        }
        var node = FS.createNode(parent, name, mode, dev);
        if (FS.isDir(node.mode)) {
          node.node_ops = MEMFS.ops_table.dir.node;
          node.stream_ops = MEMFS.ops_table.dir.stream;
          node.contents = {};
        } else if (FS.isFile(node.mode)) {
          node.node_ops = MEMFS.ops_table.file.node;
          node.stream_ops = MEMFS.ops_table.file.stream;
          node.usedBytes = 0; // The actual number of bytes used in the typed array, as opposed to contents.length which gives the whole capacity.
          // When the byte data of the file is populated, this will point to either a typed array, or a normal JS array. Typed arrays are preferred
          // for performance, and used by default. However, typed arrays are not resizable like normal JS arrays are, so there is a small disk size
          // penalty involved for appending file writes that continuously grow a file similar to std::vector capacity vs used -scheme.
          node.contents = null; 
        } else if (FS.isLink(node.mode)) {
          node.node_ops = MEMFS.ops_table.link.node;
          node.stream_ops = MEMFS.ops_table.link.stream;
        } else if (FS.isChrdev(node.mode)) {
          node.node_ops = MEMFS.ops_table.chrdev.node;
          node.stream_ops = MEMFS.ops_table.chrdev.stream;
        }
        node.timestamp = Date.now();
        // add the new node to the parent
        if (parent) {
          parent.contents[name] = node;
        }
        return node;
      },getFileDataAsRegularArray:function(node) {
        if (node.contents && node.contents.subarray) {
          var arr = [];
          for (var i = 0; i < node.usedBytes; ++i) arr.push(node.contents[i]);
          return arr; // Returns a copy of the original data.
        }
        return node.contents; // No-op, the file contents are already in a JS array. Return as-is.
      },getFileDataAsTypedArray:function(node) {
        if (!node.contents) return new Uint8Array;
        if (node.contents.subarray) return node.contents.subarray(0, node.usedBytes); // Make sure to not return excess unused bytes.
        return new Uint8Array(node.contents);
      },expandFileStorage:function(node, newCapacity) {
        // If we are asked to expand the size of a file that already exists, revert to using a standard JS array to store the file
        // instead of a typed array. This makes resizing the array more flexible because we can just .push() elements at the back to
        // increase the size.
        if (node.contents && node.contents.subarray && newCapacity > node.contents.length) {
          node.contents = MEMFS.getFileDataAsRegularArray(node);
          node.usedBytes = node.contents.length; // We might be writing to a lazy-loaded file which had overridden this property, so force-reset it.
        }
  
        if (!node.contents || node.contents.subarray) { // Keep using a typed array if creating a new storage, or if old one was a typed array as well.
          var prevCapacity = node.contents ? node.contents.length : 0;
          if (prevCapacity >= newCapacity) return; // No need to expand, the storage was already large enough.
          // Don't expand strictly to the given requested limit if it's only a very small increase, but instead geometrically grow capacity.
          // For small filesizes (<1MB), perform size*2 geometric increase, but for large sizes, do a much more conservative size*1.125 increase to
          // avoid overshooting the allocation cap by a very large margin.
          var CAPACITY_DOUBLING_MAX = 1024 * 1024;
          newCapacity = Math.max(newCapacity, (prevCapacity * (prevCapacity < CAPACITY_DOUBLING_MAX ? 2.0 : 1.125)) | 0);
          if (prevCapacity != 0) newCapacity = Math.max(newCapacity, 256); // At minimum allocate 256b for each file when expanding.
          var oldContents = node.contents;
          node.contents = new Uint8Array(newCapacity); // Allocate new storage.
          if (node.usedBytes > 0) node.contents.set(oldContents.subarray(0, node.usedBytes), 0); // Copy old data over to the new storage.
          return;
        }
        // Not using a typed array to back the file storage. Use a standard JS array instead.
        if (!node.contents && newCapacity > 0) node.contents = [];
        while (node.contents.length < newCapacity) node.contents.push(0);
      },resizeFileStorage:function(node, newSize) {
        if (node.usedBytes == newSize) return;
        if (newSize == 0) {
          node.contents = null; // Fully decommit when requesting a resize to zero.
          node.usedBytes = 0;
          return;
        }
        if (!node.contents || node.contents.subarray) { // Resize a typed array if that is being used as the backing store.
          var oldContents = node.contents;
          node.contents = new Uint8Array(new ArrayBuffer(newSize)); // Allocate new storage.
          if (oldContents) {
            node.contents.set(oldContents.subarray(0, Math.min(newSize, node.usedBytes))); // Copy old data over to the new storage.
          }
          node.usedBytes = newSize;
          return;
        }
        // Backing with a JS array.
        if (!node.contents) node.contents = [];
        if (node.contents.length > newSize) node.contents.length = newSize;
        else while (node.contents.length < newSize) node.contents.push(0);
        node.usedBytes = newSize;
      },node_ops:{getattr:function(node) {
          var attr = {};
          // device numbers reuse inode numbers.
          attr.dev = FS.isChrdev(node.mode) ? node.id : 1;
          attr.ino = node.id;
          attr.mode = node.mode;
          attr.nlink = 1;
          attr.uid = 0;
          attr.gid = 0;
          attr.rdev = node.rdev;
          if (FS.isDir(node.mode)) {
            attr.size = 4096;
          } else if (FS.isFile(node.mode)) {
            attr.size = node.usedBytes;
          } else if (FS.isLink(node.mode)) {
            attr.size = node.link.length;
          } else {
            attr.size = 0;
          }
          attr.atime = new Date(node.timestamp);
          attr.mtime = new Date(node.timestamp);
          attr.ctime = new Date(node.timestamp);
          // NOTE: In our implementation, st_blocks = Math.ceil(st_size/st_blksize),
          //       but this is not required by the standard.
          attr.blksize = 4096;
          attr.blocks = Math.ceil(attr.size / attr.blksize);
          return attr;
        },setattr:function(node, attr) {
          if (attr.mode !== undefined) {
            node.mode = attr.mode;
          }
          if (attr.timestamp !== undefined) {
            node.timestamp = attr.timestamp;
          }
          if (attr.size !== undefined) {
            MEMFS.resizeFileStorage(node, attr.size);
          }
        },lookup:function(parent, name) {
          throw FS.genericErrors[ERRNO_CODES.ENOENT];
        },mknod:function(parent, name, mode, dev) {
          return MEMFS.createNode(parent, name, mode, dev);
        },rename:function(old_node, new_dir, new_name) {
          // if we're overwriting a directory at new_name, make sure it's empty.
          if (FS.isDir(old_node.mode)) {
            var new_node;
            try {
              new_node = FS.lookupNode(new_dir, new_name);
            } catch (e) {
            }
            if (new_node) {
              for (var i in new_node.contents) {
                throw new FS.ErrnoError(ERRNO_CODES.ENOTEMPTY);
              }
            }
          }
          // do the internal rewiring
          delete old_node.parent.contents[old_node.name];
          old_node.name = new_name;
          new_dir.contents[new_name] = old_node;
          old_node.parent = new_dir;
        },unlink:function(parent, name) {
          delete parent.contents[name];
        },rmdir:function(parent, name) {
          var node = FS.lookupNode(parent, name);
          for (var i in node.contents) {
            throw new FS.ErrnoError(ERRNO_CODES.ENOTEMPTY);
          }
          delete parent.contents[name];
        },readdir:function(node) {
          var entries = ['.', '..']
          for (var key in node.contents) {
            if (!node.contents.hasOwnProperty(key)) {
              continue;
            }
            entries.push(key);
          }
          return entries;
        },symlink:function(parent, newname, oldpath) {
          var node = MEMFS.createNode(parent, newname, 511 /* 0777 */ | 40960, 0);
          node.link = oldpath;
          return node;
        },readlink:function(node) {
          if (!FS.isLink(node.mode)) {
            throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
          }
          return node.link;
        }},stream_ops:{read:function(stream, buffer, offset, length, position) {
          var contents = stream.node.contents;
          if (position >= stream.node.usedBytes) return 0;
          var size = Math.min(stream.node.usedBytes - position, length);
          assert(size >= 0);
          if (size > 8 && contents.subarray) { // non-trivial, and typed array
            buffer.set(contents.subarray(position, position + size), offset);
          } else {
            for (var i = 0; i < size; i++) buffer[offset + i] = contents[position + i];
          }
          return size;
        },write:function(stream, buffer, offset, length, position, canOwn) {
          // If memory can grow, we don't want to hold on to references of
          // the memory Buffer, as they may get invalidated. That means
          // we need to do a copy here.
          canOwn = false;
  
          if (!length) return 0;
          var node = stream.node;
          node.timestamp = Date.now();
  
          if (buffer.subarray && (!node.contents || node.contents.subarray)) { // This write is from a typed array to a typed array?
            if (canOwn) {
              node.contents = buffer.subarray(offset, offset + length);
              node.usedBytes = length;
              return length;
            } else if (node.usedBytes === 0 && position === 0) { // If this is a simple first write to an empty file, do a fast set since we don't need to care about old data.
              node.contents = new Uint8Array(buffer.subarray(offset, offset + length));
              node.usedBytes = length;
              return length;
            } else if (position + length <= node.usedBytes) { // Writing to an already allocated and used subrange of the file?
              node.contents.set(buffer.subarray(offset, offset + length), position);
              return length;
            }
          }
  
          // Appending to an existing file and we need to reallocate, or source data did not come as a typed array.
          MEMFS.expandFileStorage(node, position+length);
          if (node.contents.subarray && buffer.subarray) node.contents.set(buffer.subarray(offset, offset + length), position); // Use typed array write if available.
          else {
            for (var i = 0; i < length; i++) {
             node.contents[position + i] = buffer[offset + i]; // Or fall back to manual write if not.
            }
          }
          node.usedBytes = Math.max(node.usedBytes, position+length);
          return length;
        },llseek:function(stream, offset, whence) {
          var position = offset;
          if (whence === 1) {  // SEEK_CUR.
            position += stream.position;
          } else if (whence === 2) {  // SEEK_END.
            if (FS.isFile(stream.node.mode)) {
              position += stream.node.usedBytes;
            }
          }
          if (position < 0) {
            throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
          }
          return position;
        },allocate:function(stream, offset, length) {
          MEMFS.expandFileStorage(stream.node, offset + length);
          stream.node.usedBytes = Math.max(stream.node.usedBytes, offset + length);
        },mmap:function(stream, buffer, offset, length, position, prot, flags) {
          if (!FS.isFile(stream.node.mode)) {
            throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
          }
          var ptr;
          var allocated;
          var contents = stream.node.contents;
          // Only make a new copy when MAP_PRIVATE is specified.
          if ( !(flags & 2) &&
                (contents.buffer === buffer || contents.buffer === buffer.buffer) ) {
            // We can't emulate MAP_SHARED when the file is not backed by the buffer
            // we're mapping to (e.g. the HEAP buffer).
            allocated = false;
            ptr = contents.byteOffset;
          } else {
            // Try to avoid unnecessary slices.
            if (position > 0 || position + length < stream.node.usedBytes) {
              if (contents.subarray) {
                contents = contents.subarray(position, position + length);
              } else {
                contents = Array.prototype.slice.call(contents, position, position + length);
              }
            }
            allocated = true;
            ptr = _malloc(length);
            if (!ptr) {
              throw new FS.ErrnoError(ERRNO_CODES.ENOMEM);
            }
            buffer.set(contents, ptr);
          }
          return { ptr: ptr, allocated: allocated };
        },msync:function(stream, buffer, offset, length, mmapFlags) {
          if (!FS.isFile(stream.node.mode)) {
            throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
          }
          if (mmapFlags & 2) {
            // MAP_PRIVATE calls need not to be synced back to underlying fs
            return 0;
          }
  
          var bytesWritten = MEMFS.stream_ops.write(stream, buffer, 0, length, offset, false);
          // should we check if bytesWritten and length are the same?
          return 0;
        }}};
  
  var IDBFS={dbs:{},indexedDB:function() {
        if (typeof indexedDB !== 'undefined') return indexedDB;
        var ret = null;
        if (typeof window === 'object') ret = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
        assert(ret, 'IDBFS used, but indexedDB not supported');
        return ret;
      },DB_VERSION:21,DB_STORE_NAME:"FILE_DATA",mount:function(mount) {
        // reuse all of the core MEMFS functionality
        return MEMFS.mount.apply(null, arguments);
      },syncfs:function(mount, populate, callback) {
        IDBFS.getLocalSet(mount, function(err, local) {
          if (err) return callback(err);
  
          IDBFS.getRemoteSet(mount, function(err, remote) {
            if (err) return callback(err);
  
            var src = populate ? remote : local;
            var dst = populate ? local : remote;
  
            IDBFS.reconcile(src, dst, callback);
          });
        });
      },getDB:function(name, callback) {
        // check the cache first
        var db = IDBFS.dbs[name];
        if (db) {
          return callback(null, db);
        }
  
        var req;
        try {
          req = IDBFS.indexedDB().open(name, IDBFS.DB_VERSION);
        } catch (e) {
          return callback(e);
        }
        if (!req) {
          return callback("Unable to connect to IndexedDB");
        }
        req.onupgradeneeded = function(e) {
          var db = e.target.result;
          var transaction = e.target.transaction;
  
          var fileStore;
  
          if (db.objectStoreNames.contains(IDBFS.DB_STORE_NAME)) {
            fileStore = transaction.objectStore(IDBFS.DB_STORE_NAME);
          } else {
            fileStore = db.createObjectStore(IDBFS.DB_STORE_NAME);
          }
  
          if (!fileStore.indexNames.contains('timestamp')) {
            fileStore.createIndex('timestamp', 'timestamp', { unique: false });
          }
        };
        req.onsuccess = function() {
          db = req.result;
  
          // add to the cache
          IDBFS.dbs[name] = db;
          callback(null, db);
        };
        req.onerror = function(e) {
          callback(this.error);
          e.preventDefault();
        };
      },getLocalSet:function(mount, callback) {
        var entries = {};
  
        function isRealDir(p) {
          return p !== '.' && p !== '..';
        };
        function toAbsolute(root) {
          return function(p) {
            return PATH.join2(root, p);
          }
        };
  
        var check = FS.readdir(mount.mountpoint).filter(isRealDir).map(toAbsolute(mount.mountpoint));
  
        while (check.length) {
          var path = check.pop();
          var stat;
  
          try {
            stat = FS.stat(path);
          } catch (e) {
            return callback(e);
          }
  
          if (FS.isDir(stat.mode)) {
            check.push.apply(check, FS.readdir(path).filter(isRealDir).map(toAbsolute(path)));
          }
  
          entries[path] = { timestamp: stat.mtime };
        }
  
        return callback(null, { type: 'local', entries: entries });
      },getRemoteSet:function(mount, callback) {
        var entries = {};
  
        IDBFS.getDB(mount.mountpoint, function(err, db) {
          if (err) return callback(err);
  
          try {
            var transaction = db.transaction([IDBFS.DB_STORE_NAME], 'readonly');
            transaction.onerror = function(e) {
              callback(this.error);
              e.preventDefault();
            };
  
            var store = transaction.objectStore(IDBFS.DB_STORE_NAME);
            var index = store.index('timestamp');
  
            index.openKeyCursor().onsuccess = function(event) {
              var cursor = event.target.result;
  
              if (!cursor) {
                return callback(null, { type: 'remote', db: db, entries: entries });
              }
  
              entries[cursor.primaryKey] = { timestamp: cursor.key };
  
              cursor.continue();
            };
          } catch (e) {
            return callback(e);
          }
        });
      },loadLocalEntry:function(path, callback) {
        var stat, node;
  
        try {
          var lookup = FS.lookupPath(path);
          node = lookup.node;
          stat = FS.stat(path);
        } catch (e) {
          return callback(e);
        }
  
        if (FS.isDir(stat.mode)) {
          return callback(null, { timestamp: stat.mtime, mode: stat.mode });
        } else if (FS.isFile(stat.mode)) {
          // Performance consideration: storing a normal JavaScript array to a IndexedDB is much slower than storing a typed array.
          // Therefore always convert the file contents to a typed array first before writing the data to IndexedDB.
          node.contents = MEMFS.getFileDataAsTypedArray(node);
          return callback(null, { timestamp: stat.mtime, mode: stat.mode, contents: node.contents });
        } else {
          return callback(new Error('node type not supported'));
        }
      },storeLocalEntry:function(path, entry, callback) {
        try {
          if (FS.isDir(entry.mode)) {
            FS.mkdir(path, entry.mode);
          } else if (FS.isFile(entry.mode)) {
            FS.writeFile(path, entry.contents, { canOwn: true });
          } else {
            return callback(new Error('node type not supported'));
          }
  
          FS.chmod(path, entry.mode);
          FS.utime(path, entry.timestamp, entry.timestamp);
        } catch (e) {
          return callback(e);
        }
  
        callback(null);
      },removeLocalEntry:function(path, callback) {
        try {
          var lookup = FS.lookupPath(path);
          var stat = FS.stat(path);
  
          if (FS.isDir(stat.mode)) {
            FS.rmdir(path);
          } else if (FS.isFile(stat.mode)) {
            FS.unlink(path);
          }
        } catch (e) {
          return callback(e);
        }
  
        callback(null);
      },loadRemoteEntry:function(store, path, callback) {
        var req = store.get(path);
        req.onsuccess = function(event) { callback(null, event.target.result); };
        req.onerror = function(e) {
          callback(this.error);
          e.preventDefault();
        };
      },storeRemoteEntry:function(store, path, entry, callback) {
        var req = store.put(entry, path);
        req.onsuccess = function() { callback(null); };
        req.onerror = function(e) {
          callback(this.error);
          e.preventDefault();
        };
      },removeRemoteEntry:function(store, path, callback) {
        var req = store.delete(path);
        req.onsuccess = function() { callback(null); };
        req.onerror = function(e) {
          callback(this.error);
          e.preventDefault();
        };
      },reconcile:function(src, dst, callback) {
        var total = 0;
  
        var create = [];
        Object.keys(src.entries).forEach(function (key) {
          var e = src.entries[key];
          var e2 = dst.entries[key];
          if (!e2 || e.timestamp > e2.timestamp) {
            create.push(key);
            total++;
          }
        });
  
        var remove = [];
        Object.keys(dst.entries).forEach(function (key) {
          var e = dst.entries[key];
          var e2 = src.entries[key];
          if (!e2) {
            remove.push(key);
            total++;
          }
        });
  
        if (!total) {
          return callback(null);
        }
  
        var errored = false;
        var completed = 0;
        var db = src.type === 'remote' ? src.db : dst.db;
        var transaction = db.transaction([IDBFS.DB_STORE_NAME], 'readwrite');
        var store = transaction.objectStore(IDBFS.DB_STORE_NAME);
  
        function done(err) {
          if (err) {
            if (!done.errored) {
              done.errored = true;
              return callback(err);
            }
            return;
          }
          if (++completed >= total) {
            return callback(null);
          }
        };
  
        transaction.onerror = function(e) {
          done(this.error);
          e.preventDefault();
        };
  
        // sort paths in ascending order so directory entries are created
        // before the files inside them
        create.sort().forEach(function (path) {
          if (dst.type === 'local') {
            IDBFS.loadRemoteEntry(store, path, function (err, entry) {
              if (err) return done(err);
              IDBFS.storeLocalEntry(path, entry, done);
            });
          } else {
            IDBFS.loadLocalEntry(path, function (err, entry) {
              if (err) return done(err);
              IDBFS.storeRemoteEntry(store, path, entry, done);
            });
          }
        });
  
        // sort paths in descending order so files are deleted before their
        // parent directories
        remove.sort().reverse().forEach(function(path) {
          if (dst.type === 'local') {
            IDBFS.removeLocalEntry(path, done);
          } else {
            IDBFS.removeRemoteEntry(store, path, done);
          }
        });
      }};
  
  var NODEFS={isWindows:false,staticInit:function() {
        NODEFS.isWindows = !!process.platform.match(/^win/);
        var flags = process["binding"]("constants");
        // Node.js 4 compatibility: it has no namespaces for constants
        if (flags["fs"]) {
          flags = flags["fs"];
        }
        NODEFS.flagsForNodeMap = {
          "1024": flags["O_APPEND"],
          "64": flags["O_CREAT"],
          "128": flags["O_EXCL"],
          "0": flags["O_RDONLY"],
          "2": flags["O_RDWR"],
          "4096": flags["O_SYNC"],
          "512": flags["O_TRUNC"],
          "1": flags["O_WRONLY"]
        };
      },bufferFrom:function (arrayBuffer) {
        // Node.js < 4.5 compatibility: Buffer.from does not support ArrayBuffer
        // Buffer.from before 4.5 was just a method inherited from Uint8Array
        // Buffer.alloc has been added with Buffer.from together, so check it instead
        return Buffer.alloc ? Buffer.from(arrayBuffer) : new Buffer(arrayBuffer);
      },mount:function (mount) {
        assert(ENVIRONMENT_IS_NODE);
        return NODEFS.createNode(null, '/', NODEFS.getMode(mount.opts.root), 0);
      },createNode:function (parent, name, mode, dev) {
        if (!FS.isDir(mode) && !FS.isFile(mode) && !FS.isLink(mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        var node = FS.createNode(parent, name, mode);
        node.node_ops = NODEFS.node_ops;
        node.stream_ops = NODEFS.stream_ops;
        return node;
      },getMode:function (path) {
        var stat;
        try {
          stat = fs.lstatSync(path);
          if (NODEFS.isWindows) {
            // Node.js on Windows never represents permission bit 'x', so
            // propagate read bits to execute bits
            stat.mode = stat.mode | ((stat.mode & 292) >> 2);
          }
        } catch (e) {
          if (!e.code) throw e;
          throw new FS.ErrnoError(ERRNO_CODES[e.code]);
        }
        return stat.mode;
      },realPath:function (node) {
        var parts = [];
        while (node.parent !== node) {
          parts.push(node.name);
          node = node.parent;
        }
        parts.push(node.mount.opts.root);
        parts.reverse();
        return PATH.join.apply(null, parts);
      },flagsForNode:function(flags) {
        flags &= ~0x200000 /*O_PATH*/; // Ignore this flag from musl, otherwise node.js fails to open the file.
        flags &= ~0x800 /*O_NONBLOCK*/; // Ignore this flag from musl, otherwise node.js fails to open the file.
        flags &= ~0x8000 /*O_LARGEFILE*/; // Ignore this flag from musl, otherwise node.js fails to open the file.
        flags &= ~0x80000 /*O_CLOEXEC*/; // Some applications may pass it; it makes no sense for a single process.
        var newFlags = 0;
        for (var k in NODEFS.flagsForNodeMap) {
          if (flags & k) {
            newFlags |= NODEFS.flagsForNodeMap[k];
            flags ^= k;
          }
        }
  
        if (!flags) {
          return newFlags;
        } else {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
      },node_ops:{getattr:function(node) {
          var path = NODEFS.realPath(node);
          var stat;
          try {
            stat = fs.lstatSync(path);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
          // node.js v0.10.20 doesn't report blksize and blocks on Windows. Fake them with default blksize of 4096.
          // See http://support.microsoft.com/kb/140365
          if (NODEFS.isWindows && !stat.blksize) {
            stat.blksize = 4096;
          }
          if (NODEFS.isWindows && !stat.blocks) {
            stat.blocks = (stat.size+stat.blksize-1)/stat.blksize|0;
          }
          return {
            dev: stat.dev,
            ino: stat.ino,
            mode: stat.mode,
            nlink: stat.nlink,
            uid: stat.uid,
            gid: stat.gid,
            rdev: stat.rdev,
            size: stat.size,
            atime: stat.atime,
            mtime: stat.mtime,
            ctime: stat.ctime,
            blksize: stat.blksize,
            blocks: stat.blocks
          };
        },setattr:function(node, attr) {
          var path = NODEFS.realPath(node);
          try {
            if (attr.mode !== undefined) {
              fs.chmodSync(path, attr.mode);
              // update the common node structure mode as well
              node.mode = attr.mode;
            }
            if (attr.timestamp !== undefined) {
              var date = new Date(attr.timestamp);
              fs.utimesSync(path, date, date);
            }
            if (attr.size !== undefined) {
              fs.truncateSync(path, attr.size);
            }
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },lookup:function (parent, name) {
          var path = PATH.join2(NODEFS.realPath(parent), name);
          var mode = NODEFS.getMode(path);
          return NODEFS.createNode(parent, name, mode);
        },mknod:function (parent, name, mode, dev) {
          var node = NODEFS.createNode(parent, name, mode, dev);
          // create the backing node for this in the fs root as well
          var path = NODEFS.realPath(node);
          try {
            if (FS.isDir(node.mode)) {
              fs.mkdirSync(path, node.mode);
            } else {
              fs.writeFileSync(path, '', { mode: node.mode });
            }
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
          return node;
        },rename:function (oldNode, newDir, newName) {
          var oldPath = NODEFS.realPath(oldNode);
          var newPath = PATH.join2(NODEFS.realPath(newDir), newName);
          try {
            fs.renameSync(oldPath, newPath);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },unlink:function(parent, name) {
          var path = PATH.join2(NODEFS.realPath(parent), name);
          try {
            fs.unlinkSync(path);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },rmdir:function(parent, name) {
          var path = PATH.join2(NODEFS.realPath(parent), name);
          try {
            fs.rmdirSync(path);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },readdir:function(node) {
          var path = NODEFS.realPath(node);
          try {
            return fs.readdirSync(path);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },symlink:function(parent, newName, oldPath) {
          var newPath = PATH.join2(NODEFS.realPath(parent), newName);
          try {
            fs.symlinkSync(oldPath, newPath);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },readlink:function(node) {
          var path = NODEFS.realPath(node);
          try {
            path = fs.readlinkSync(path);
            path = NODEJS_PATH.relative(NODEJS_PATH.resolve(node.mount.opts.root), path);
            return path;
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        }},stream_ops:{open:function (stream) {
          var path = NODEFS.realPath(stream.node);
          try {
            if (FS.isFile(stream.node.mode)) {
              stream.nfd = fs.openSync(path, NODEFS.flagsForNode(stream.flags));
            }
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },close:function (stream) {
          try {
            if (FS.isFile(stream.node.mode) && stream.nfd) {
              fs.closeSync(stream.nfd);
            }
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },read:function (stream, buffer, offset, length, position) {
          // Node.js < 6 compatibility: node errors on 0 length reads
          if (length === 0) return 0;
          try {
            return fs.readSync(stream.nfd, NODEFS.bufferFrom(buffer.buffer), offset, length, position);
          } catch (e) {
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },write:function (stream, buffer, offset, length, position) {
          try {
            return fs.writeSync(stream.nfd, NODEFS.bufferFrom(buffer.buffer), offset, length, position);
          } catch (e) {
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },llseek:function (stream, offset, whence) {
          var position = offset;
          if (whence === 1) {  // SEEK_CUR.
            position += stream.position;
          } else if (whence === 2) {  // SEEK_END.
            if (FS.isFile(stream.node.mode)) {
              try {
                var stat = fs.fstatSync(stream.nfd);
                position += stat.size;
              } catch (e) {
                throw new FS.ErrnoError(ERRNO_CODES[e.code]);
              }
            }
          }
  
          if (position < 0) {
            throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
          }
  
          return position;
        }}};
  
  var WORKERFS={DIR_MODE:16895,FILE_MODE:33279,reader:null,mount:function (mount) {
        assert(ENVIRONMENT_IS_WORKER);
        if (!WORKERFS.reader) WORKERFS.reader = new FileReaderSync();
        var root = WORKERFS.createNode(null, '/', WORKERFS.DIR_MODE, 0);
        var createdParents = {};
        function ensureParent(path) {
          // return the parent node, creating subdirs as necessary
          var parts = path.split('/');
          var parent = root;
          for (var i = 0; i < parts.length-1; i++) {
            var curr = parts.slice(0, i+1).join('/');
            // Issue 4254: Using curr as a node name will prevent the node
            // from being found in FS.nameTable when FS.open is called on
            // a path which holds a child of this node,
            // given that all FS functions assume node names
            // are just their corresponding parts within their given path,
            // rather than incremental aggregates which include their parent's
            // directories.
            if (!createdParents[curr]) {
              createdParents[curr] = WORKERFS.createNode(parent, parts[i], WORKERFS.DIR_MODE, 0);
            }
            parent = createdParents[curr];
          }
          return parent;
        }
        function base(path) {
          var parts = path.split('/');
          return parts[parts.length-1];
        }
        // We also accept FileList here, by using Array.prototype
        Array.prototype.forEach.call(mount.opts["files"] || [], function(file) {
          WORKERFS.createNode(ensureParent(file.name), base(file.name), WORKERFS.FILE_MODE, 0, file, file.lastModifiedDate);
        });
        (mount.opts["blobs"] || []).forEach(function(obj) {
          WORKERFS.createNode(ensureParent(obj["name"]), base(obj["name"]), WORKERFS.FILE_MODE, 0, obj["data"]);
        });
        (mount.opts["packages"] || []).forEach(function(pack) {
          pack['metadata'].files.forEach(function(file) {
            var name = file.filename.substr(1); // remove initial slash
            WORKERFS.createNode(ensureParent(name), base(name), WORKERFS.FILE_MODE, 0, pack['blob'].slice(file.start, file.end));
          });
        });
        return root;
      },createNode:function (parent, name, mode, dev, contents, mtime) {
        var node = FS.createNode(parent, name, mode);
        node.mode = mode;
        node.node_ops = WORKERFS.node_ops;
        node.stream_ops = WORKERFS.stream_ops;
        node.timestamp = (mtime || new Date).getTime();
        assert(WORKERFS.FILE_MODE !== WORKERFS.DIR_MODE);
        if (mode === WORKERFS.FILE_MODE) {
          node.size = contents.size;
          node.contents = contents;
        } else {
          node.size = 4096;
          node.contents = {};
        }
        if (parent) {
          parent.contents[name] = node;
        }
        return node;
      },node_ops:{getattr:function(node) {
          return {
            dev: 1,
            ino: undefined,
            mode: node.mode,
            nlink: 1,
            uid: 0,
            gid: 0,
            rdev: undefined,
            size: node.size,
            atime: new Date(node.timestamp),
            mtime: new Date(node.timestamp),
            ctime: new Date(node.timestamp),
            blksize: 4096,
            blocks: Math.ceil(node.size / 4096),
          };
        },setattr:function(node, attr) {
          if (attr.mode !== undefined) {
            node.mode = attr.mode;
          }
          if (attr.timestamp !== undefined) {
            node.timestamp = attr.timestamp;
          }
        },lookup:function(parent, name) {
          throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
        },mknod:function (parent, name, mode, dev) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        },rename:function (oldNode, newDir, newName) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        },unlink:function(parent, name) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        },rmdir:function(parent, name) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        },readdir:function(node) {
          var entries = ['.', '..'];
          for (var key in node.contents) {
            if (!node.contents.hasOwnProperty(key)) {
              continue;
            }
            entries.push(key);
          }
          return entries;
        },symlink:function(parent, newName, oldPath) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        },readlink:function(node) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }},stream_ops:{read:function (stream, buffer, offset, length, position) {
          if (position >= stream.node.size) return 0;
          var chunk = stream.node.contents.slice(position, position + length);
          var ab = WORKERFS.reader.readAsArrayBuffer(chunk);
          buffer.set(new Uint8Array(ab), offset);
          return chunk.size;
        },write:function (stream, buffer, offset, length, position) {
          throw new FS.ErrnoError(ERRNO_CODES.EIO);
        },llseek:function (stream, offset, whence) {
          var position = offset;
          if (whence === 1) {  // SEEK_CUR.
            position += stream.position;
          } else if (whence === 2) {  // SEEK_END.
            if (FS.isFile(stream.node.mode)) {
              position += stream.node.size;
            }
          }
          if (position < 0) {
            throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
          }
          return position;
        }}};
  
  var _stdin=24640;
  
  var _stdout=24656;
  
  var _stderr=24672;var FS={root:null,mounts:[],devices:{},streams:[],nextInode:1,nameTable:null,currentPath:"/",initialized:false,ignorePermissions:true,trackingDelegate:{},tracking:{openFlags:{READ:1,WRITE:2}},ErrnoError:null,genericErrors:{},filesystems:null,syncFSRequests:0,handleFSError:function(e) {
        if (!(e instanceof FS.ErrnoError)) throw e + ' : ' + stackTrace();
        return ___setErrNo(e.errno);
      },lookupPath:function(path, opts) {
        path = PATH.resolve(FS.cwd(), path);
        opts = opts || {};
  
        if (!path) return { path: '', node: null };
  
        var defaults = {
          follow_mount: true,
          recurse_count: 0
        };
        for (var key in defaults) {
          if (opts[key] === undefined) {
            opts[key] = defaults[key];
          }
        }
  
        if (opts.recurse_count > 8) {  // max recursive lookup of 8
          throw new FS.ErrnoError(40);
        }
  
        // split the path
        var parts = PATH.normalizeArray(path.split('/').filter(function(p) {
          return !!p;
        }), false);
  
        // start at the root
        var current = FS.root;
        var current_path = '/';
  
        for (var i = 0; i < parts.length; i++) {
          var islast = (i === parts.length-1);
          if (islast && opts.parent) {
            // stop resolving
            break;
          }
  
          current = FS.lookupNode(current, parts[i]);
          current_path = PATH.join2(current_path, parts[i]);
  
          // jump to the mount's root node if this is a mountpoint
          if (FS.isMountpoint(current)) {
            if (!islast || (islast && opts.follow_mount)) {
              current = current.mounted.root;
            }
          }
  
          // by default, lookupPath will not follow a symlink if it is the final path component.
          // setting opts.follow = true will override this behavior.
          if (!islast || opts.follow) {
            var count = 0;
            while (FS.isLink(current.mode)) {
              var link = FS.readlink(current_path);
              current_path = PATH.resolve(PATH.dirname(current_path), link);
  
              var lookup = FS.lookupPath(current_path, { recurse_count: opts.recurse_count });
              current = lookup.node;
  
              if (count++ > 40) {  // limit max consecutive symlinks to 40 (SYMLOOP_MAX).
                throw new FS.ErrnoError(40);
              }
            }
          }
        }
  
        return { path: current_path, node: current };
      },getPath:function(node) {
        var path;
        while (true) {
          if (FS.isRoot(node)) {
            var mount = node.mount.mountpoint;
            if (!path) return mount;
            return mount[mount.length-1] !== '/' ? mount + '/' + path : mount + path;
          }
          path = path ? node.name + '/' + path : node.name;
          node = node.parent;
        }
      },hashName:function(parentid, name) {
        var hash = 0;
  
  
        for (var i = 0; i < name.length; i++) {
          hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
        }
        return ((parentid + hash) >>> 0) % FS.nameTable.length;
      },hashAddNode:function(node) {
        var hash = FS.hashName(node.parent.id, node.name);
        node.name_next = FS.nameTable[hash];
        FS.nameTable[hash] = node;
      },hashRemoveNode:function(node) {
        var hash = FS.hashName(node.parent.id, node.name);
        if (FS.nameTable[hash] === node) {
          FS.nameTable[hash] = node.name_next;
        } else {
          var current = FS.nameTable[hash];
          while (current) {
            if (current.name_next === node) {
              current.name_next = node.name_next;
              break;
            }
            current = current.name_next;
          }
        }
      },lookupNode:function(parent, name) {
        var err = FS.mayLookup(parent);
        if (err) {
          throw new FS.ErrnoError(err, parent);
        }
        var hash = FS.hashName(parent.id, name);
        for (var node = FS.nameTable[hash]; node; node = node.name_next) {
          var nodeName = node.name;
          if (node.parent.id === parent.id && nodeName === name) {
            return node;
          }
        }
        // if we failed to find it in the cache, call into the VFS
        return FS.lookup(parent, name);
      },createNode:function(parent, name, mode, rdev) {
        if (!FS.FSNode) {
          FS.FSNode = function(parent, name, mode, rdev) {
            if (!parent) {
              parent = this;  // root node sets parent to itself
            }
            this.parent = parent;
            this.mount = parent.mount;
            this.mounted = null;
            this.id = FS.nextInode++;
            this.name = name;
            this.mode = mode;
            this.node_ops = {};
            this.stream_ops = {};
            this.rdev = rdev;
          };
  
          FS.FSNode.prototype = {};
  
          // compatibility
          var readMode = 292 | 73;
          var writeMode = 146;
  
          // NOTE we must use Object.defineProperties instead of individual calls to
          // Object.defineProperty in order to make closure compiler happy
          Object.defineProperties(FS.FSNode.prototype, {
            read: {
              get: function() { return (this.mode & readMode) === readMode; },
              set: function(val) { val ? this.mode |= readMode : this.mode &= ~readMode; }
            },
            write: {
              get: function() { return (this.mode & writeMode) === writeMode; },
              set: function(val) { val ? this.mode |= writeMode : this.mode &= ~writeMode; }
            },
            isFolder: {
              get: function() { return FS.isDir(this.mode); }
            },
            isDevice: {
              get: function() { return FS.isChrdev(this.mode); }
            }
          });
        }
  
        var node = new FS.FSNode(parent, name, mode, rdev);
  
        FS.hashAddNode(node);
  
        return node;
      },destroyNode:function(node) {
        FS.hashRemoveNode(node);
      },isRoot:function(node) {
        return node === node.parent;
      },isMountpoint:function(node) {
        return !!node.mounted;
      },isFile:function(mode) {
        return (mode & 61440) === 32768;
      },isDir:function(mode) {
        return (mode & 61440) === 16384;
      },isLink:function(mode) {
        return (mode & 61440) === 40960;
      },isChrdev:function(mode) {
        return (mode & 61440) === 8192;
      },isBlkdev:function(mode) {
        return (mode & 61440) === 24576;
      },isFIFO:function(mode) {
        return (mode & 61440) === 4096;
      },isSocket:function(mode) {
        return (mode & 49152) === 49152;
      },flagModes:{"r":0,"rs":1052672,"r+":2,"w":577,"wx":705,"xw":705,"w+":578,"wx+":706,"xw+":706,"a":1089,"ax":1217,"xa":1217,"a+":1090,"ax+":1218,"xa+":1218},modeStringToFlags:function(str) {
        var flags = FS.flagModes[str];
        if (typeof flags === 'undefined') {
          throw new Error('Unknown file open mode: ' + str);
        }
        return flags;
      },flagsToPermissionString:function(flag) {
        var perms = ['r', 'w', 'rw'][flag & 3];
        if ((flag & 512)) {
          perms += 'w';
        }
        return perms;
      },nodePermissions:function(node, perms) {
        if (FS.ignorePermissions) {
          return 0;
        }
        // return 0 if any user, group or owner bits are set.
        if (perms.indexOf('r') !== -1 && !(node.mode & 292)) {
          return 13;
        } else if (perms.indexOf('w') !== -1 && !(node.mode & 146)) {
          return 13;
        } else if (perms.indexOf('x') !== -1 && !(node.mode & 73)) {
          return 13;
        }
        return 0;
      },mayLookup:function(dir) {
        var err = FS.nodePermissions(dir, 'x');
        if (err) return err;
        if (!dir.node_ops.lookup) return 13;
        return 0;
      },mayCreate:function(dir, name) {
        try {
          var node = FS.lookupNode(dir, name);
          return 17;
        } catch (e) {
        }
        return FS.nodePermissions(dir, 'wx');
      },mayDelete:function(dir, name, isdir) {
        var node;
        try {
          node = FS.lookupNode(dir, name);
        } catch (e) {
          return e.errno;
        }
        var err = FS.nodePermissions(dir, 'wx');
        if (err) {
          return err;
        }
        if (isdir) {
          if (!FS.isDir(node.mode)) {
            return 20;
          }
          if (FS.isRoot(node) || FS.getPath(node) === FS.cwd()) {
            return 16;
          }
        } else {
          if (FS.isDir(node.mode)) {
            return 21;
          }
        }
        return 0;
      },mayOpen:function(node, flags) {
        if (!node) {
          return 2;
        }
        if (FS.isLink(node.mode)) {
          return 40;
        } else if (FS.isDir(node.mode)) {
          if (FS.flagsToPermissionString(flags) !== 'r' || // opening for write
              (flags & 512)) { // TODO: check for O_SEARCH? (== search for dir only)
            return 21;
          }
        }
        return FS.nodePermissions(node, FS.flagsToPermissionString(flags));
      },MAX_OPEN_FDS:4096,nextfd:function(fd_start, fd_end) {
        fd_start = fd_start || 0;
        fd_end = fd_end || FS.MAX_OPEN_FDS;
        for (var fd = fd_start; fd <= fd_end; fd++) {
          if (!FS.streams[fd]) {
            return fd;
          }
        }
        throw new FS.ErrnoError(24);
      },getStream:function(fd) {
        return FS.streams[fd];
      },createStream:function(stream, fd_start, fd_end) {
        if (!FS.FSStream) {
          FS.FSStream = function(){};
          FS.FSStream.prototype = {};
          // compatibility
          Object.defineProperties(FS.FSStream.prototype, {
            object: {
              get: function() { return this.node; },
              set: function(val) { this.node = val; }
            },
            isRead: {
              get: function() { return (this.flags & 2097155) !== 1; }
            },
            isWrite: {
              get: function() { return (this.flags & 2097155) !== 0; }
            },
            isAppend: {
              get: function() { return (this.flags & 1024); }
            }
          });
        }
        // clone it, so we can return an instance of FSStream
        var newStream = new FS.FSStream();
        for (var p in stream) {
          newStream[p] = stream[p];
        }
        stream = newStream;
        var fd = FS.nextfd(fd_start, fd_end);
        stream.fd = fd;
        FS.streams[fd] = stream;
        return stream;
      },closeStream:function(fd) {
        FS.streams[fd] = null;
      },chrdev_stream_ops:{open:function(stream) {
          var device = FS.getDevice(stream.node.rdev);
          // override node's stream ops with the device's
          stream.stream_ops = device.stream_ops;
          // forward the open call
          if (stream.stream_ops.open) {
            stream.stream_ops.open(stream);
          }
        },llseek:function() {
          throw new FS.ErrnoError(29);
        }},major:function(dev) {
        return ((dev) >> 8);
      },minor:function(dev) {
        return ((dev) & 0xff);
      },makedev:function(ma, mi) {
        return ((ma) << 8 | (mi));
      },registerDevice:function(dev, ops) {
        FS.devices[dev] = { stream_ops: ops };
      },getDevice:function(dev) {
        return FS.devices[dev];
      },getMounts:function(mount) {
        var mounts = [];
        var check = [mount];
  
        while (check.length) {
          var m = check.pop();
  
          mounts.push(m);
  
          check.push.apply(check, m.mounts);
        }
  
        return mounts;
      },syncfs:function(populate, callback) {
        if (typeof(populate) === 'function') {
          callback = populate;
          populate = false;
        }
  
        FS.syncFSRequests++;
  
        if (FS.syncFSRequests > 1) {
          console.log('warning: ' + FS.syncFSRequests + ' FS.syncfs operations in flight at once, probably just doing extra work');
        }
  
        var mounts = FS.getMounts(FS.root.mount);
        var completed = 0;
  
        function doCallback(err) {
          assert(FS.syncFSRequests > 0);
          FS.syncFSRequests--;
          return callback(err);
        }
  
        function done(err) {
          if (err) {
            if (!done.errored) {
              done.errored = true;
              return doCallback(err);
            }
            return;
          }
          if (++completed >= mounts.length) {
            doCallback(null);
          }
        };
  
        // sync all mounts
        mounts.forEach(function (mount) {
          if (!mount.type.syncfs) {
            return done(null);
          }
          mount.type.syncfs(mount, populate, done);
        });
      },mount:function(type, opts, mountpoint) {
        var root = mountpoint === '/';
        var pseudo = !mountpoint;
        var node;
  
        if (root && FS.root) {
          throw new FS.ErrnoError(16);
        } else if (!root && !pseudo) {
          var lookup = FS.lookupPath(mountpoint, { follow_mount: false });
  
          mountpoint = lookup.path;  // use the absolute path
          node = lookup.node;
  
          if (FS.isMountpoint(node)) {
            throw new FS.ErrnoError(16);
          }
  
          if (!FS.isDir(node.mode)) {
            throw new FS.ErrnoError(20);
          }
        }
  
        var mount = {
          type: type,
          opts: opts,
          mountpoint: mountpoint,
          mounts: []
        };
  
        // create a root node for the fs
        var mountRoot = type.mount(mount);
        mountRoot.mount = mount;
        mount.root = mountRoot;
  
        if (root) {
          FS.root = mountRoot;
        } else if (node) {
          // set as a mountpoint
          node.mounted = mount;
  
          // add the new mount to the current mount's children
          if (node.mount) {
            node.mount.mounts.push(mount);
          }
        }
  
        return mountRoot;
      },unmount:function (mountpoint) {
        var lookup = FS.lookupPath(mountpoint, { follow_mount: false });
  
        if (!FS.isMountpoint(lookup.node)) {
          throw new FS.ErrnoError(22);
        }
  
        // destroy the nodes for this mount, and all its child mounts
        var node = lookup.node;
        var mount = node.mounted;
        var mounts = FS.getMounts(mount);
  
        Object.keys(FS.nameTable).forEach(function (hash) {
          var current = FS.nameTable[hash];
  
          while (current) {
            var next = current.name_next;
  
            if (mounts.indexOf(current.mount) !== -1) {
              FS.destroyNode(current);
            }
  
            current = next;
          }
        });
  
        // no longer a mountpoint
        node.mounted = null;
  
        // remove this mount from the child mounts
        var idx = node.mount.mounts.indexOf(mount);
        assert(idx !== -1);
        node.mount.mounts.splice(idx, 1);
      },lookup:function(parent, name) {
        return parent.node_ops.lookup(parent, name);
      },mknod:function(path, mode, dev) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        var name = PATH.basename(path);
        if (!name || name === '.' || name === '..') {
          throw new FS.ErrnoError(22);
        }
        var err = FS.mayCreate(parent, name);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        if (!parent.node_ops.mknod) {
          throw new FS.ErrnoError(1);
        }
        return parent.node_ops.mknod(parent, name, mode, dev);
      },create:function(path, mode) {
        mode = mode !== undefined ? mode : 438 /* 0666 */;
        mode &= 4095;
        mode |= 32768;
        return FS.mknod(path, mode, 0);
      },mkdir:function(path, mode) {
        mode = mode !== undefined ? mode : 511 /* 0777 */;
        mode &= 511 | 512;
        mode |= 16384;
        return FS.mknod(path, mode, 0);
      },mkdirTree:function(path, mode) {
        var dirs = path.split('/');
        var d = '';
        for (var i = 0; i < dirs.length; ++i) {
          if (!dirs[i]) continue;
          d += '/' + dirs[i];
          try {
            FS.mkdir(d, mode);
          } catch(e) {
            if (e.errno != 17) throw e;
          }
        }
      },mkdev:function(path, mode, dev) {
        if (typeof(dev) === 'undefined') {
          dev = mode;
          mode = 438 /* 0666 */;
        }
        mode |= 8192;
        return FS.mknod(path, mode, dev);
      },symlink:function(oldpath, newpath) {
        if (!PATH.resolve(oldpath)) {
          throw new FS.ErrnoError(2);
        }
        var lookup = FS.lookupPath(newpath, { parent: true });
        var parent = lookup.node;
        if (!parent) {
          throw new FS.ErrnoError(2);
        }
        var newname = PATH.basename(newpath);
        var err = FS.mayCreate(parent, newname);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        if (!parent.node_ops.symlink) {
          throw new FS.ErrnoError(1);
        }
        return parent.node_ops.symlink(parent, newname, oldpath);
      },rename:function(old_path, new_path) {
        var old_dirname = PATH.dirname(old_path);
        var new_dirname = PATH.dirname(new_path);
        var old_name = PATH.basename(old_path);
        var new_name = PATH.basename(new_path);
        // parents must exist
        var lookup, old_dir, new_dir;
        try {
          lookup = FS.lookupPath(old_path, { parent: true });
          old_dir = lookup.node;
          lookup = FS.lookupPath(new_path, { parent: true });
          new_dir = lookup.node;
        } catch (e) {
          throw new FS.ErrnoError(16);
        }
        if (!old_dir || !new_dir) throw new FS.ErrnoError(2);
        // need to be part of the same mount
        if (old_dir.mount !== new_dir.mount) {
          throw new FS.ErrnoError(18);
        }
        // source must exist
        var old_node = FS.lookupNode(old_dir, old_name);
        // old path should not be an ancestor of the new path
        var relative = PATH.relative(old_path, new_dirname);
        if (relative.charAt(0) !== '.') {
          throw new FS.ErrnoError(22);
        }
        // new path should not be an ancestor of the old path
        relative = PATH.relative(new_path, old_dirname);
        if (relative.charAt(0) !== '.') {
          throw new FS.ErrnoError(39);
        }
        // see if the new path already exists
        var new_node;
        try {
          new_node = FS.lookupNode(new_dir, new_name);
        } catch (e) {
          // not fatal
        }
        // early out if nothing needs to change
        if (old_node === new_node) {
          return;
        }
        // we'll need to delete the old entry
        var isdir = FS.isDir(old_node.mode);
        var err = FS.mayDelete(old_dir, old_name, isdir);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        // need delete permissions if we'll be overwriting.
        // need create permissions if new doesn't already exist.
        err = new_node ?
          FS.mayDelete(new_dir, new_name, isdir) :
          FS.mayCreate(new_dir, new_name);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        if (!old_dir.node_ops.rename) {
          throw new FS.ErrnoError(1);
        }
        if (FS.isMountpoint(old_node) || (new_node && FS.isMountpoint(new_node))) {
          throw new FS.ErrnoError(16);
        }
        // if we are going to change the parent, check write permissions
        if (new_dir !== old_dir) {
          err = FS.nodePermissions(old_dir, 'w');
          if (err) {
            throw new FS.ErrnoError(err);
          }
        }
        try {
          if (FS.trackingDelegate['willMovePath']) {
            FS.trackingDelegate['willMovePath'](old_path, new_path);
          }
        } catch(e) {
          console.log("FS.trackingDelegate['willMovePath']('"+old_path+"', '"+new_path+"') threw an exception: " + e.message);
        }
        // remove the node from the lookup hash
        FS.hashRemoveNode(old_node);
        // do the underlying fs rename
        try {
          old_dir.node_ops.rename(old_node, new_dir, new_name);
        } catch (e) {
          throw e;
        } finally {
          // add the node back to the hash (in case node_ops.rename
          // changed its name)
          FS.hashAddNode(old_node);
        }
        try {
          if (FS.trackingDelegate['onMovePath']) FS.trackingDelegate['onMovePath'](old_path, new_path);
        } catch(e) {
          console.log("FS.trackingDelegate['onMovePath']('"+old_path+"', '"+new_path+"') threw an exception: " + e.message);
        }
      },rmdir:function(path) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        var name = PATH.basename(path);
        var node = FS.lookupNode(parent, name);
        var err = FS.mayDelete(parent, name, true);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        if (!parent.node_ops.rmdir) {
          throw new FS.ErrnoError(1);
        }
        if (FS.isMountpoint(node)) {
          throw new FS.ErrnoError(16);
        }
        try {
          if (FS.trackingDelegate['willDeletePath']) {
            FS.trackingDelegate['willDeletePath'](path);
          }
        } catch(e) {
          console.log("FS.trackingDelegate['willDeletePath']('"+path+"') threw an exception: " + e.message);
        }
        parent.node_ops.rmdir(parent, name);
        FS.destroyNode(node);
        try {
          if (FS.trackingDelegate['onDeletePath']) FS.trackingDelegate['onDeletePath'](path);
        } catch(e) {
          console.log("FS.trackingDelegate['onDeletePath']('"+path+"') threw an exception: " + e.message);
        }
      },readdir:function(path) {
        var lookup = FS.lookupPath(path, { follow: true });
        var node = lookup.node;
        if (!node.node_ops.readdir) {
          throw new FS.ErrnoError(20);
        }
        return node.node_ops.readdir(node);
      },unlink:function(path) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        var name = PATH.basename(path);
        var node = FS.lookupNode(parent, name);
        var err = FS.mayDelete(parent, name, false);
        if (err) {
          // According to POSIX, we should map EISDIR to EPERM, but
          // we instead do what Linux does (and we must, as we use
          // the musl linux libc).
          throw new FS.ErrnoError(err);
        }
        if (!parent.node_ops.unlink) {
          throw new FS.ErrnoError(1);
        }
        if (FS.isMountpoint(node)) {
          throw new FS.ErrnoError(16);
        }
        try {
          if (FS.trackingDelegate['willDeletePath']) {
            FS.trackingDelegate['willDeletePath'](path);
          }
        } catch(e) {
          console.log("FS.trackingDelegate['willDeletePath']('"+path+"') threw an exception: " + e.message);
        }
        parent.node_ops.unlink(parent, name);
        FS.destroyNode(node);
        try {
          if (FS.trackingDelegate['onDeletePath']) FS.trackingDelegate['onDeletePath'](path);
        } catch(e) {
          console.log("FS.trackingDelegate['onDeletePath']('"+path+"') threw an exception: " + e.message);
        }
      },readlink:function(path) {
        var lookup = FS.lookupPath(path);
        var link = lookup.node;
        if (!link) {
          throw new FS.ErrnoError(2);
        }
        if (!link.node_ops.readlink) {
          throw new FS.ErrnoError(22);
        }
        return PATH.resolve(FS.getPath(link.parent), link.node_ops.readlink(link));
      },stat:function(path, dontFollow) {
        var lookup = FS.lookupPath(path, { follow: !dontFollow });
        var node = lookup.node;
        if (!node) {
          throw new FS.ErrnoError(2);
        }
        if (!node.node_ops.getattr) {
          throw new FS.ErrnoError(1);
        }
        return node.node_ops.getattr(node);
      },lstat:function(path) {
        return FS.stat(path, true);
      },chmod:function(path, mode, dontFollow) {
        var node;
        if (typeof path === 'string') {
          var lookup = FS.lookupPath(path, { follow: !dontFollow });
          node = lookup.node;
        } else {
          node = path;
        }
        if (!node.node_ops.setattr) {
          throw new FS.ErrnoError(1);
        }
        node.node_ops.setattr(node, {
          mode: (mode & 4095) | (node.mode & ~4095),
          timestamp: Date.now()
        });
      },lchmod:function(path, mode) {
        FS.chmod(path, mode, true);
      },fchmod:function(fd, mode) {
        var stream = FS.getStream(fd);
        if (!stream) {
          throw new FS.ErrnoError(9);
        }
        FS.chmod(stream.node, mode);
      },chown:function(path, uid, gid, dontFollow) {
        var node;
        if (typeof path === 'string') {
          var lookup = FS.lookupPath(path, { follow: !dontFollow });
          node = lookup.node;
        } else {
          node = path;
        }
        if (!node.node_ops.setattr) {
          throw new FS.ErrnoError(1);
        }
        node.node_ops.setattr(node, {
          timestamp: Date.now()
          // we ignore the uid / gid for now
        });
      },lchown:function(path, uid, gid) {
        FS.chown(path, uid, gid, true);
      },fchown:function(fd, uid, gid) {
        var stream = FS.getStream(fd);
        if (!stream) {
          throw new FS.ErrnoError(9);
        }
        FS.chown(stream.node, uid, gid);
      },truncate:function(path, len) {
        if (len < 0) {
          throw new FS.ErrnoError(22);
        }
        var node;
        if (typeof path === 'string') {
          var lookup = FS.lookupPath(path, { follow: true });
          node = lookup.node;
        } else {
          node = path;
        }
        if (!node.node_ops.setattr) {
          throw new FS.ErrnoError(1);
        }
        if (FS.isDir(node.mode)) {
          throw new FS.ErrnoError(21);
        }
        if (!FS.isFile(node.mode)) {
          throw new FS.ErrnoError(22);
        }
        var err = FS.nodePermissions(node, 'w');
        if (err) {
          throw new FS.ErrnoError(err);
        }
        node.node_ops.setattr(node, {
          size: len,
          timestamp: Date.now()
        });
      },ftruncate:function(fd, len) {
        var stream = FS.getStream(fd);
        if (!stream) {
          throw new FS.ErrnoError(9);
        }
        if ((stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(22);
        }
        FS.truncate(stream.node, len);
      },utime:function(path, atime, mtime) {
        var lookup = FS.lookupPath(path, { follow: true });
        var node = lookup.node;
        node.node_ops.setattr(node, {
          timestamp: Math.max(atime, mtime)
        });
      },open:function(path, flags, mode, fd_start, fd_end) {
        if (path === "") {
          throw new FS.ErrnoError(2);
        }
        flags = typeof flags === 'string' ? FS.modeStringToFlags(flags) : flags;
        mode = typeof mode === 'undefined' ? 438 /* 0666 */ : mode;
        if ((flags & 64)) {
          mode = (mode & 4095) | 32768;
        } else {
          mode = 0;
        }
        var node;
        if (typeof path === 'object') {
          node = path;
        } else {
          path = PATH.normalize(path);
          try {
            var lookup = FS.lookupPath(path, {
              follow: !(flags & 131072)
            });
            node = lookup.node;
          } catch (e) {
            // ignore
          }
        }
        // perhaps we need to create the node
        var created = false;
        if ((flags & 64)) {
          if (node) {
            // if O_CREAT and O_EXCL are set, error out if the node already exists
            if ((flags & 128)) {
              throw new FS.ErrnoError(17);
            }
          } else {
            // node doesn't exist, try to create it
            node = FS.mknod(path, mode, 0);
            created = true;
          }
        }
        if (!node) {
          throw new FS.ErrnoError(2);
        }
        // can't truncate a device
        if (FS.isChrdev(node.mode)) {
          flags &= ~512;
        }
        // if asked only for a directory, then this must be one
        if ((flags & 65536) && !FS.isDir(node.mode)) {
          throw new FS.ErrnoError(20);
        }
        // check permissions, if this is not a file we just created now (it is ok to
        // create and write to a file with read-only permissions; it is read-only
        // for later use)
        if (!created) {
          var err = FS.mayOpen(node, flags);
          if (err) {
            throw new FS.ErrnoError(err);
          }
        }
        // do truncation if necessary
        if ((flags & 512)) {
          FS.truncate(node, 0);
        }
        // we've already handled these, don't pass down to the underlying vfs
        flags &= ~(128 | 512);
  
        // register the stream with the filesystem
        var stream = FS.createStream({
          node: node,
          path: FS.getPath(node),  // we want the absolute path to the node
          flags: flags,
          seekable: true,
          position: 0,
          stream_ops: node.stream_ops,
          // used by the file family libc calls (fopen, fwrite, ferror, etc.)
          ungotten: [],
          error: false
        }, fd_start, fd_end);
        // call the new stream's open function
        if (stream.stream_ops.open) {
          stream.stream_ops.open(stream);
        }
        if (Module['logReadFiles'] && !(flags & 1)) {
          if (!FS.readFiles) FS.readFiles = {};
          if (!(path in FS.readFiles)) {
            FS.readFiles[path] = 1;
            console.log("FS.trackingDelegate error on read file: " + path);
          }
        }
        try {
          if (FS.trackingDelegate['onOpenFile']) {
            var trackingFlags = 0;
            if ((flags & 2097155) !== 1) {
              trackingFlags |= FS.tracking.openFlags.READ;
            }
            if ((flags & 2097155) !== 0) {
              trackingFlags |= FS.tracking.openFlags.WRITE;
            }
            FS.trackingDelegate['onOpenFile'](path, trackingFlags);
          }
        } catch(e) {
          console.log("FS.trackingDelegate['onOpenFile']('"+path+"', flags) threw an exception: " + e.message);
        }
        return stream;
      },close:function(stream) {
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(9);
        }
        if (stream.getdents) stream.getdents = null; // free readdir state
        try {
          if (stream.stream_ops.close) {
            stream.stream_ops.close(stream);
          }
        } catch (e) {
          throw e;
        } finally {
          FS.closeStream(stream.fd);
        }
        stream.fd = null;
      },isClosed:function(stream) {
        return stream.fd === null;
      },llseek:function(stream, offset, whence) {
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(9);
        }
        if (!stream.seekable || !stream.stream_ops.llseek) {
          throw new FS.ErrnoError(29);
        }
        stream.position = stream.stream_ops.llseek(stream, offset, whence);
        stream.ungotten = [];
        return stream.position;
      },read:function(stream, buffer, offset, length, position) {
        if (length < 0 || position < 0) {
          throw new FS.ErrnoError(22);
        }
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(9);
        }
        if ((stream.flags & 2097155) === 1) {
          throw new FS.ErrnoError(9);
        }
        if (FS.isDir(stream.node.mode)) {
          throw new FS.ErrnoError(21);
        }
        if (!stream.stream_ops.read) {
          throw new FS.ErrnoError(22);
        }
        var seeking = typeof position !== 'undefined';
        if (!seeking) {
          position = stream.position;
        } else if (!stream.seekable) {
          throw new FS.ErrnoError(29);
        }
        var bytesRead = stream.stream_ops.read(stream, buffer, offset, length, position);
        if (!seeking) stream.position += bytesRead;
        return bytesRead;
      },write:function(stream, buffer, offset, length, position, canOwn) {
        if (length < 0 || position < 0) {
          throw new FS.ErrnoError(22);
        }
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(9);
        }
        if ((stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(9);
        }
        if (FS.isDir(stream.node.mode)) {
          throw new FS.ErrnoError(21);
        }
        if (!stream.stream_ops.write) {
          throw new FS.ErrnoError(22);
        }
        if (stream.flags & 1024) {
          // seek to the end before writing in append mode
          FS.llseek(stream, 0, 2);
        }
        var seeking = typeof position !== 'undefined';
        if (!seeking) {
          position = stream.position;
        } else if (!stream.seekable) {
          throw new FS.ErrnoError(29);
        }
        var bytesWritten = stream.stream_ops.write(stream, buffer, offset, length, position, canOwn);
        if (!seeking) stream.position += bytesWritten;
        try {
          if (stream.path && FS.trackingDelegate['onWriteToFile']) FS.trackingDelegate['onWriteToFile'](stream.path);
        } catch(e) {
          console.log("FS.trackingDelegate['onWriteToFile']('"+path+"') threw an exception: " + e.message);
        }
        return bytesWritten;
      },allocate:function(stream, offset, length) {
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(9);
        }
        if (offset < 0 || length <= 0) {
          throw new FS.ErrnoError(22);
        }
        if ((stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(9);
        }
        if (!FS.isFile(stream.node.mode) && !FS.isDir(stream.node.mode)) {
          throw new FS.ErrnoError(19);
        }
        if (!stream.stream_ops.allocate) {
          throw new FS.ErrnoError(95);
        }
        stream.stream_ops.allocate(stream, offset, length);
      },mmap:function(stream, buffer, offset, length, position, prot, flags) {
        // TODO if PROT is PROT_WRITE, make sure we have write access
        if ((stream.flags & 2097155) === 1) {
          throw new FS.ErrnoError(13);
        }
        if (!stream.stream_ops.mmap) {
          throw new FS.ErrnoError(19);
        }
        return stream.stream_ops.mmap(stream, buffer, offset, length, position, prot, flags);
      },msync:function(stream, buffer, offset, length, mmapFlags) {
        if (!stream || !stream.stream_ops.msync) {
          return 0;
        }
        return stream.stream_ops.msync(stream, buffer, offset, length, mmapFlags);
      },munmap:function(stream) {
        return 0;
      },ioctl:function(stream, cmd, arg) {
        if (!stream.stream_ops.ioctl) {
          throw new FS.ErrnoError(25);
        }
        return stream.stream_ops.ioctl(stream, cmd, arg);
      },readFile:function(path, opts) {
        opts = opts || {};
        opts.flags = opts.flags || 'r';
        opts.encoding = opts.encoding || 'binary';
        if (opts.encoding !== 'utf8' && opts.encoding !== 'binary') {
          throw new Error('Invalid encoding type "' + opts.encoding + '"');
        }
        var ret;
        var stream = FS.open(path, opts.flags);
        var stat = FS.stat(path);
        var length = stat.size;
        var buf = new Uint8Array(length);
        FS.read(stream, buf, 0, length, 0);
        if (opts.encoding === 'utf8') {
          ret = UTF8ArrayToString(buf, 0);
        } else if (opts.encoding === 'binary') {
          ret = buf;
        }
        FS.close(stream);
        return ret;
      },writeFile:function(path, data, opts) {
        opts = opts || {};
        opts.flags = opts.flags || 'w';
        var stream = FS.open(path, opts.flags, opts.mode);
        if (typeof data === 'string') {
          var buf = new Uint8Array(lengthBytesUTF8(data)+1);
          var actualNumBytes = stringToUTF8Array(data, buf, 0, buf.length);
          FS.write(stream, buf, 0, actualNumBytes, undefined, opts.canOwn);
        } else if (ArrayBuffer.isView(data)) {
          FS.write(stream, data, 0, data.byteLength, undefined, opts.canOwn);
        } else {
          throw new Error('Unsupported data type');
        }
        FS.close(stream);
      },cwd:function() {
        return FS.currentPath;
      },chdir:function(path) {
        var lookup = FS.lookupPath(path, { follow: true });
        if (lookup.node === null) {
          throw new FS.ErrnoError(2);
        }
        if (!FS.isDir(lookup.node.mode)) {
          throw new FS.ErrnoError(20);
        }
        var err = FS.nodePermissions(lookup.node, 'x');
        if (err) {
          throw new FS.ErrnoError(err);
        }
        FS.currentPath = lookup.path;
      },createDefaultDirectories:function() {
        FS.mkdir('/tmp');
        FS.mkdir('/home');
        FS.mkdir('/home/web_user');
      },createDefaultDevices:function() {
        // create /dev
        FS.mkdir('/dev');
        // setup /dev/null
        FS.registerDevice(FS.makedev(1, 3), {
          read: function() { return 0; },
          write: function(stream, buffer, offset, length, pos) { return length; }
        });
        FS.mkdev('/dev/null', FS.makedev(1, 3));
        // setup /dev/tty and /dev/tty1
        // stderr needs to print output using Module['printErr']
        // so we register a second tty just for it.
        TTY.register(FS.makedev(5, 0), TTY.default_tty_ops);
        TTY.register(FS.makedev(6, 0), TTY.default_tty1_ops);
        FS.mkdev('/dev/tty', FS.makedev(5, 0));
        FS.mkdev('/dev/tty1', FS.makedev(6, 0));
        // setup /dev/[u]random
        var random_device;
        if (typeof crypto !== 'undefined') {
          // for modern web browsers
          var randomBuffer = new Uint8Array(1);
          random_device = function() { crypto.getRandomValues(randomBuffer); return randomBuffer[0]; };
        } else if (ENVIRONMENT_IS_NODE) {
          // for nodejs
          random_device = function() { return require('crypto')['randomBytes'](1)[0]; };
        } else {
          // default for ES5 platforms
          random_device = function() { abort("random_device"); /*Math.random() is not safe for random number generation, so this fallback random_device implementation aborts... see emscripten-core/emscripten/pull/7096 */ };
        }
        FS.createDevice('/dev', 'random', random_device);
        FS.createDevice('/dev', 'urandom', random_device);
        // we're not going to emulate the actual shm device,
        // just create the tmp dirs that reside in it commonly
        FS.mkdir('/dev/shm');
        FS.mkdir('/dev/shm/tmp');
      },createSpecialDirectories:function() {
        // create /proc/self/fd which allows /proc/self/fd/6 => readlink gives the name of the stream for fd 6 (see test_unistd_ttyname)
        FS.mkdir('/proc');
        FS.mkdir('/proc/self');
        FS.mkdir('/proc/self/fd');
        FS.mount({
          mount: function() {
            var node = FS.createNode('/proc/self', 'fd', 16384 | 511 /* 0777 */, 73);
            node.node_ops = {
              lookup: function(parent, name) {
                var fd = +name;
                var stream = FS.getStream(fd);
                if (!stream) throw new FS.ErrnoError(9);
                var ret = {
                  parent: null,
                  mount: { mountpoint: 'fake' },
                  node_ops: { readlink: function() { return stream.path } }
                };
                ret.parent = ret; // make it look like a simple root node
                return ret;
              }
            };
            return node;
          }
        }, {}, '/proc/self/fd');
      },createStandardStreams:function() {
        // TODO deprecate the old functionality of a single
        // input / output callback and that utilizes FS.createDevice
        // and instead require a unique set of stream ops
  
        // by default, we symlink the standard streams to the
        // default tty devices. however, if the standard streams
        // have been overwritten we create a unique device for
        // them instead.
        if (Module['stdin']) {
          FS.createDevice('/dev', 'stdin', Module['stdin']);
        } else {
          FS.symlink('/dev/tty', '/dev/stdin');
        }
        if (Module['stdout']) {
          FS.createDevice('/dev', 'stdout', null, Module['stdout']);
        } else {
          FS.symlink('/dev/tty', '/dev/stdout');
        }
        if (Module['stderr']) {
          FS.createDevice('/dev', 'stderr', null, Module['stderr']);
        } else {
          FS.symlink('/dev/tty1', '/dev/stderr');
        }
  
        // open default streams for the stdin, stdout and stderr devices
        var stdin = FS.open('/dev/stdin', 'r');
        assert(stdin.fd === 0, 'invalid handle for stdin (' + stdin.fd + ')');
  
        var stdout = FS.open('/dev/stdout', 'w');
        assert(stdout.fd === 1, 'invalid handle for stdout (' + stdout.fd + ')');
  
        var stderr = FS.open('/dev/stderr', 'w');
        assert(stderr.fd === 2, 'invalid handle for stderr (' + stderr.fd + ')');
      },ensureErrnoError:function() {
        if (FS.ErrnoError) return;
        FS.ErrnoError = function ErrnoError(errno, node) {
          this.node = node;
          this.setErrno = function(errno) {
            this.errno = errno;
          };
          this.setErrno(errno);
          this.message = 'FS error';
          // Node.js compatibility: assigning on this.stack fails on Node 4 (but fixed on Node 8)
          if (this.stack) Object.defineProperty(this, "stack", { value: (new Error).stack, writable: true });
        };
        FS.ErrnoError.prototype = new Error();
        FS.ErrnoError.prototype.constructor = FS.ErrnoError;
        // Some errors may happen quite a bit, to avoid overhead we reuse them (and suffer a lack of stack info)
        [2].forEach(function(code) {
          FS.genericErrors[code] = new FS.ErrnoError(code);
          FS.genericErrors[code].stack = '<generic error, no stack>';
        });
      },staticInit:function() {
        FS.ensureErrnoError();
  
        FS.nameTable = new Array(4096);
  
        FS.mount(MEMFS, {}, '/');
  
        FS.createDefaultDirectories();
        FS.createDefaultDevices();
        FS.createSpecialDirectories();
  
        FS.filesystems = {
          'MEMFS': MEMFS,
          'IDBFS': IDBFS,
          'NODEFS': NODEFS,
          'WORKERFS': WORKERFS,
        };
      },init:function(input, output, error) {
        assert(!FS.init.initialized, 'FS.init was previously called. If you want to initialize later with custom parameters, remove any earlier calls (note that one is automatically added to the generated code)');
        FS.init.initialized = true;
  
        FS.ensureErrnoError();
  
        // Allow Module.stdin etc. to provide defaults, if none explicitly passed to us here
        Module['stdin'] = input || Module['stdin'];
        Module['stdout'] = output || Module['stdout'];
        Module['stderr'] = error || Module['stderr'];
  
        FS.createStandardStreams();
      },quit:function() {
        FS.init.initialized = false;
        // force-flush all streams, so we get musl std streams printed out
        var fflush = Module['_fflush'];
        if (fflush) fflush(0);
        // close all of our streams
        for (var i = 0; i < FS.streams.length; i++) {
          var stream = FS.streams[i];
          if (!stream) {
            continue;
          }
          FS.close(stream);
        }
      },getMode:function(canRead, canWrite) {
        var mode = 0;
        if (canRead) mode |= 292 | 73;
        if (canWrite) mode |= 146;
        return mode;
      },joinPath:function(parts, forceRelative) {
        var path = PATH.join.apply(null, parts);
        if (forceRelative && path[0] == '/') path = path.substr(1);
        return path;
      },absolutePath:function(relative, base) {
        return PATH.resolve(base, relative);
      },standardizePath:function(path) {
        return PATH.normalize(path);
      },findObject:function(path, dontResolveLastLink) {
        var ret = FS.analyzePath(path, dontResolveLastLink);
        if (ret.exists) {
          return ret.object;
        } else {
          ___setErrNo(ret.error);
          return null;
        }
      },analyzePath:function(path, dontResolveLastLink) {
        // operate from within the context of the symlink's target
        try {
          var lookup = FS.lookupPath(path, { follow: !dontResolveLastLink });
          path = lookup.path;
        } catch (e) {
        }
        var ret = {
          isRoot: false, exists: false, error: 0, name: null, path: null, object: null,
          parentExists: false, parentPath: null, parentObject: null
        };
        try {
          var lookup = FS.lookupPath(path, { parent: true });
          ret.parentExists = true;
          ret.parentPath = lookup.path;
          ret.parentObject = lookup.node;
          ret.name = PATH.basename(path);
          lookup = FS.lookupPath(path, { follow: !dontResolveLastLink });
          ret.exists = true;
          ret.path = lookup.path;
          ret.object = lookup.node;
          ret.name = lookup.node.name;
          ret.isRoot = lookup.path === '/';
        } catch (e) {
          ret.error = e.errno;
        };
        return ret;
      },createFolder:function(parent, name, canRead, canWrite) {
        var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
        var mode = FS.getMode(canRead, canWrite);
        return FS.mkdir(path, mode);
      },createPath:function(parent, path, canRead, canWrite) {
        parent = typeof parent === 'string' ? parent : FS.getPath(parent);
        var parts = path.split('/').reverse();
        while (parts.length) {
          var part = parts.pop();
          if (!part) continue;
          var current = PATH.join2(parent, part);
          try {
            FS.mkdir(current);
          } catch (e) {
            // ignore EEXIST
          }
          parent = current;
        }
        return current;
      },createFile:function(parent, name, properties, canRead, canWrite) {
        var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
        var mode = FS.getMode(canRead, canWrite);
        return FS.create(path, mode);
      },createDataFile:function(parent, name, data, canRead, canWrite, canOwn) {
        var path = name ? PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name) : parent;
        var mode = FS.getMode(canRead, canWrite);
        var node = FS.create(path, mode);
        if (data) {
          if (typeof data === 'string') {
            var arr = new Array(data.length);
            for (var i = 0, len = data.length; i < len; ++i) arr[i] = data.charCodeAt(i);
            data = arr;
          }
          // make sure we can write to the file
          FS.chmod(node, mode | 146);
          var stream = FS.open(node, 'w');
          FS.write(stream, data, 0, data.length, 0, canOwn);
          FS.close(stream);
          FS.chmod(node, mode);
        }
        return node;
      },createDevice:function(parent, name, input, output) {
        var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
        var mode = FS.getMode(!!input, !!output);
        if (!FS.createDevice.major) FS.createDevice.major = 64;
        var dev = FS.makedev(FS.createDevice.major++, 0);
        // Create a fake device that a set of stream ops to emulate
        // the old behavior.
        FS.registerDevice(dev, {
          open: function(stream) {
            stream.seekable = false;
          },
          close: function(stream) {
            // flush any pending line data
            if (output && output.buffer && output.buffer.length) {
              output(10);
            }
          },
          read: function(stream, buffer, offset, length, pos /* ignored */) {
            var bytesRead = 0;
            for (var i = 0; i < length; i++) {
              var result;
              try {
                result = input();
              } catch (e) {
                throw new FS.ErrnoError(5);
              }
              if (result === undefined && bytesRead === 0) {
                throw new FS.ErrnoError(11);
              }
              if (result === null || result === undefined) break;
              bytesRead++;
              buffer[offset+i] = result;
            }
            if (bytesRead) {
              stream.node.timestamp = Date.now();
            }
            return bytesRead;
          },
          write: function(stream, buffer, offset, length, pos) {
            for (var i = 0; i < length; i++) {
              try {
                output(buffer[offset+i]);
              } catch (e) {
                throw new FS.ErrnoError(5);
              }
            }
            if (length) {
              stream.node.timestamp = Date.now();
            }
            return i;
          }
        });
        return FS.mkdev(path, mode, dev);
      },createLink:function(parent, name, target, canRead, canWrite) {
        var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
        return FS.symlink(target, path);
      },forceLoadFile:function(obj) {
        if (obj.isDevice || obj.isFolder || obj.link || obj.contents) return true;
        var success = true;
        if (typeof XMLHttpRequest !== 'undefined') {
          throw new Error("Lazy loading should have been performed (contents set) in createLazyFile, but it was not. Lazy loading only works in web workers. Use --embed-file or --preload-file in emcc on the main thread.");
        } else if (Module['read']) {
          // Command-line.
          try {
            // WARNING: Can't read binary files in V8's d8 or tracemonkey's js, as
            //          read() will try to parse UTF8.
            obj.contents = intArrayFromString(Module['read'](obj.url), true);
            obj.usedBytes = obj.contents.length;
          } catch (e) {
            success = false;
          }
        } else {
          throw new Error('Cannot load without read() or XMLHttpRequest.');
        }
        if (!success) ___setErrNo(5);
        return success;
      },createLazyFile:function(parent, name, url, canRead, canWrite) {
        // Lazy chunked Uint8Array (implements get and length from Uint8Array). Actual getting is abstracted away for eventual reuse.
        function LazyUint8Array() {
          this.lengthKnown = false;
          this.chunks = []; // Loaded chunks. Index is the chunk number
        }
        LazyUint8Array.prototype.get = function LazyUint8Array_get(idx) {
          if (idx > this.length-1 || idx < 0) {
            return undefined;
          }
          var chunkOffset = idx % this.chunkSize;
          var chunkNum = (idx / this.chunkSize)|0;
          return this.getter(chunkNum)[chunkOffset];
        }
        LazyUint8Array.prototype.setDataGetter = function LazyUint8Array_setDataGetter(getter) {
          this.getter = getter;
        }
        LazyUint8Array.prototype.cacheLength = function LazyUint8Array_cacheLength() {
          // Find length
          var xhr = new XMLHttpRequest();
          xhr.open('HEAD', url, false);
          xhr.send(null);
          if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) throw new Error("Couldn't load " + url + ". Status: " + xhr.status);
          var datalength = Number(xhr.getResponseHeader("Content-length"));
          var header;
          var hasByteServing = (header = xhr.getResponseHeader("Accept-Ranges")) && header === "bytes";
          var usesGzip = (header = xhr.getResponseHeader("Content-Encoding")) && header === "gzip";
  
          var chunkSize = 1024*1024; // Chunk size in bytes
  
          if (!hasByteServing) chunkSize = datalength;
  
          // Function to get a range from the remote URL.
          var doXHR = (function(from, to) {
            if (from > to) throw new Error("invalid range (" + from + ", " + to + ") or no bytes requested!");
            if (to > datalength-1) throw new Error("only " + datalength + " bytes available! programmer error!");
  
            // TODO: Use mozResponseArrayBuffer, responseStream, etc. if available.
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, false);
            if (datalength !== chunkSize) xhr.setRequestHeader("Range", "bytes=" + from + "-" + to);
  
            // Some hints to the browser that we want binary data.
            if (typeof Uint8Array != 'undefined') xhr.responseType = 'arraybuffer';
            if (xhr.overrideMimeType) {
              xhr.overrideMimeType('text/plain; charset=x-user-defined');
            }
  
            xhr.send(null);
            if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) throw new Error("Couldn't load " + url + ". Status: " + xhr.status);
            if (xhr.response !== undefined) {
              return new Uint8Array(xhr.response || []);
            } else {
              return intArrayFromString(xhr.responseText || '', true);
            }
          });
          var lazyArray = this;
          lazyArray.setDataGetter(function(chunkNum) {
            var start = chunkNum * chunkSize;
            var end = (chunkNum+1) * chunkSize - 1; // including this byte
            end = Math.min(end, datalength-1); // if datalength-1 is selected, this is the last block
            if (typeof(lazyArray.chunks[chunkNum]) === "undefined") {
              lazyArray.chunks[chunkNum] = doXHR(start, end);
            }
            if (typeof(lazyArray.chunks[chunkNum]) === "undefined") throw new Error("doXHR failed!");
            return lazyArray.chunks[chunkNum];
          });
  
          if (usesGzip || !datalength) {
            // if the server uses gzip or doesn't supply the length, we have to download the whole file to get the (uncompressed) length
            chunkSize = datalength = 1; // this will force getter(0)/doXHR do download the whole file
            datalength = this.getter(0).length;
            chunkSize = datalength;
            console.log("LazyFiles on gzip forces download of the whole file when length is accessed");
          }
  
          this._length = datalength;
          this._chunkSize = chunkSize;
          this.lengthKnown = true;
        }
        if (typeof XMLHttpRequest !== 'undefined') {
          if (!ENVIRONMENT_IS_WORKER) throw 'Cannot do synchronous binary XHRs outside webworkers in modern browsers. Use --embed-file or --preload-file in emcc';
          var lazyArray = new LazyUint8Array();
          Object.defineProperties(lazyArray, {
            length: {
              get: function() {
                if(!this.lengthKnown) {
                  this.cacheLength();
                }
                return this._length;
              }
            },
            chunkSize: {
              get: function() {
                if(!this.lengthKnown) {
                  this.cacheLength();
                }
                return this._chunkSize;
              }
            }
          });
  
          var properties = { isDevice: false, contents: lazyArray };
        } else {
          var properties = { isDevice: false, url: url };
        }
  
        var node = FS.createFile(parent, name, properties, canRead, canWrite);
        // This is a total hack, but I want to get this lazy file code out of the
        // core of MEMFS. If we want to keep this lazy file concept I feel it should
        // be its own thin LAZYFS proxying calls to MEMFS.
        if (properties.contents) {
          node.contents = properties.contents;
        } else if (properties.url) {
          node.contents = null;
          node.url = properties.url;
        }
        // Add a function that defers querying the file size until it is asked the first time.
        Object.defineProperties(node, {
          usedBytes: {
            get: function() { return this.contents.length; }
          }
        });
        // override each stream op with one that tries to force load the lazy file first
        var stream_ops = {};
        var keys = Object.keys(node.stream_ops);
        keys.forEach(function(key) {
          var fn = node.stream_ops[key];
          stream_ops[key] = function forceLoadLazyFile() {
            if (!FS.forceLoadFile(node)) {
              throw new FS.ErrnoError(5);
            }
            return fn.apply(null, arguments);
          };
        });
        // use a custom read function
        stream_ops.read = function stream_ops_read(stream, buffer, offset, length, position) {
          if (!FS.forceLoadFile(node)) {
            throw new FS.ErrnoError(5);
          }
          var contents = stream.node.contents;
          if (position >= contents.length)
            return 0;
          var size = Math.min(contents.length - position, length);
          assert(size >= 0);
          if (contents.slice) { // normal array
            for (var i = 0; i < size; i++) {
              buffer[offset + i] = contents[position + i];
            }
          } else {
            for (var i = 0; i < size; i++) { // LazyUint8Array from sync binary XHR
              buffer[offset + i] = contents.get(position + i);
            }
          }
          return size;
        };
        node.stream_ops = stream_ops;
        return node;
      },createPreloadedFile:function(parent, name, url, canRead, canWrite, onload, onerror, dontCreateFile, canOwn, preFinish) {
        Browser.init(); // XXX perhaps this method should move onto Browser?
        // TODO we should allow people to just pass in a complete filename instead
        // of parent and name being that we just join them anyways
        var fullname = name ? PATH.resolve(PATH.join2(parent, name)) : parent;
        var dep = getUniqueRunDependency('cp ' + fullname); // might have several active requests for the same fullname
        function processData(byteArray) {
          function finish(byteArray) {
            if (preFinish) preFinish();
            if (!dontCreateFile) {
              FS.createDataFile(parent, name, byteArray, canRead, canWrite, canOwn);
            }
            if (onload) onload();
            removeRunDependency(dep);
          }
          var handled = false;
          Module['preloadPlugins'].forEach(function(plugin) {
            if (handled) return;
            if (plugin['canHandle'](fullname)) {
              plugin['handle'](byteArray, fullname, finish, function() {
                if (onerror) onerror();
                removeRunDependency(dep);
              });
              handled = true;
            }
          });
          if (!handled) finish(byteArray);
        }
        addRunDependency(dep);
        if (typeof url == 'string') {
          Browser.asyncLoad(url, function(byteArray) {
            processData(byteArray);
          }, onerror);
        } else {
          processData(url);
        }
      },indexedDB:function() {
        return window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
      },DB_NAME:function() {
        return 'EM_FS_' + window.location.pathname;
      },DB_VERSION:20,DB_STORE_NAME:"FILE_DATA",saveFilesToDB:function(paths, onload, onerror) {
        onload = onload || function(){};
        onerror = onerror || function(){};
        var indexedDB = FS.indexedDB();
        try {
          var openRequest = indexedDB.open(FS.DB_NAME(), FS.DB_VERSION);
        } catch (e) {
          return onerror(e);
        }
        openRequest.onupgradeneeded = function openRequest_onupgradeneeded() {
          console.log('creating db');
          var db = openRequest.result;
          db.createObjectStore(FS.DB_STORE_NAME);
        };
        openRequest.onsuccess = function openRequest_onsuccess() {
          var db = openRequest.result;
          var transaction = db.transaction([FS.DB_STORE_NAME], 'readwrite');
          var files = transaction.objectStore(FS.DB_STORE_NAME);
          var ok = 0, fail = 0, total = paths.length;
          function finish() {
            if (fail == 0) onload(); else onerror();
          }
          paths.forEach(function(path) {
            var putRequest = files.put(FS.analyzePath(path).object.contents, path);
            putRequest.onsuccess = function putRequest_onsuccess() { ok++; if (ok + fail == total) finish() };
            putRequest.onerror = function putRequest_onerror() { fail++; if (ok + fail == total) finish() };
          });
          transaction.onerror = onerror;
        };
        openRequest.onerror = onerror;
      },loadFilesFromDB:function(paths, onload, onerror) {
        onload = onload || function(){};
        onerror = onerror || function(){};
        var indexedDB = FS.indexedDB();
        try {
          var openRequest = indexedDB.open(FS.DB_NAME(), FS.DB_VERSION);
        } catch (e) {
          return onerror(e);
        }
        openRequest.onupgradeneeded = onerror; // no database to load from
        openRequest.onsuccess = function openRequest_onsuccess() {
          var db = openRequest.result;
          try {
            var transaction = db.transaction([FS.DB_STORE_NAME], 'readonly');
          } catch(e) {
            onerror(e);
            return;
          }
          var files = transaction.objectStore(FS.DB_STORE_NAME);
          var ok = 0, fail = 0, total = paths.length;
          function finish() {
            if (fail == 0) onload(); else onerror();
          }
          paths.forEach(function(path) {
            var getRequest = files.get(path);
            getRequest.onsuccess = function getRequest_onsuccess() {
              if (FS.analyzePath(path).exists) {
                FS.unlink(path);
              }
              FS.createDataFile(PATH.dirname(path), PATH.basename(path), getRequest.result, true, true, true);
              ok++;
              if (ok + fail == total) finish();
            };
            getRequest.onerror = function getRequest_onerror() { fail++; if (ok + fail == total) finish() };
          });
          transaction.onerror = onerror;
        };
        openRequest.onerror = onerror;
      }};
  
  var ERRNO_CODES={EPERM:1,ENOENT:2,ESRCH:3,EINTR:4,EIO:5,ENXIO:6,E2BIG:7,ENOEXEC:8,EBADF:9,ECHILD:10,EAGAIN:11,EWOULDBLOCK:11,ENOMEM:12,EACCES:13,EFAULT:14,ENOTBLK:15,EBUSY:16,EEXIST:17,EXDEV:18,ENODEV:19,ENOTDIR:20,EISDIR:21,EINVAL:22,ENFILE:23,EMFILE:24,ENOTTY:25,ETXTBSY:26,EFBIG:27,ENOSPC:28,ESPIPE:29,EROFS:30,EMLINK:31,EPIPE:32,EDOM:33,ERANGE:34,ENOMSG:42,EIDRM:43,ECHRNG:44,EL2NSYNC:45,EL3HLT:46,EL3RST:47,ELNRNG:48,EUNATCH:49,ENOCSI:50,EL2HLT:51,EDEADLK:35,ENOLCK:37,EBADE:52,EBADR:53,EXFULL:54,ENOANO:55,EBADRQC:56,EBADSLT:57,EDEADLOCK:35,EBFONT:59,ENOSTR:60,ENODATA:61,ETIME:62,ENOSR:63,ENONET:64,ENOPKG:65,EREMOTE:66,ENOLINK:67,EADV:68,ESRMNT:69,ECOMM:70,EPROTO:71,EMULTIHOP:72,EDOTDOT:73,EBADMSG:74,ENOTUNIQ:76,EBADFD:77,EREMCHG:78,ELIBACC:79,ELIBBAD:80,ELIBSCN:81,ELIBMAX:82,ELIBEXEC:83,ENOSYS:38,ENOTEMPTY:39,ENAMETOOLONG:36,ELOOP:40,EOPNOTSUPP:95,EPFNOSUPPORT:96,ECONNRESET:104,ENOBUFS:105,EAFNOSUPPORT:97,EPROTOTYPE:91,ENOTSOCK:88,ENOPROTOOPT:92,ESHUTDOWN:108,ECONNREFUSED:111,EADDRINUSE:98,ECONNABORTED:103,ENETUNREACH:101,ENETDOWN:100,ETIMEDOUT:110,EHOSTDOWN:112,EHOSTUNREACH:113,EINPROGRESS:115,EALREADY:114,EDESTADDRREQ:89,EMSGSIZE:90,EPROTONOSUPPORT:93,ESOCKTNOSUPPORT:94,EADDRNOTAVAIL:99,ENETRESET:102,EISCONN:106,ENOTCONN:107,ETOOMANYREFS:109,EUSERS:87,EDQUOT:122,ESTALE:116,ENOTSUP:95,ENOMEDIUM:123,EILSEQ:84,EOVERFLOW:75,ECANCELED:125,ENOTRECOVERABLE:131,EOWNERDEAD:130,ESTRPIPE:86};var SYSCALLS={DEFAULT_POLLMASK:5,mappings:{},umask:511,calculateAt:function(dirfd, path) {
        if (path[0] !== '/') {
          // relative path
          var dir;
          if (dirfd === -100) {
            dir = FS.cwd();
          } else {
            var dirstream = FS.getStream(dirfd);
            if (!dirstream) throw new FS.ErrnoError(ERRNO_CODES.EBADF);
            dir = dirstream.path;
          }
          path = PATH.join2(dir, path);
        }
        return path;
      },doStat:function(func, path, buf) {
        try {
          var stat = func(path);
        } catch (e) {
          if (e && e.node && PATH.normalize(path) !== PATH.normalize(FS.getPath(e.node))) {
            // an error occurred while trying to look up the path; we should just report ENOTDIR
            return -ERRNO_CODES.ENOTDIR;
          }
          throw e;
        }
        HEAP32[((buf)>>2)]=stat.dev;
        HEAP32[(((buf)+(4))>>2)]=0;
        HEAP32[(((buf)+(8))>>2)]=stat.ino;
        HEAP32[(((buf)+(12))>>2)]=stat.mode;
        HEAP32[(((buf)+(16))>>2)]=stat.nlink;
        HEAP32[(((buf)+(20))>>2)]=stat.uid;
        HEAP32[(((buf)+(24))>>2)]=stat.gid;
        HEAP32[(((buf)+(28))>>2)]=stat.rdev;
        HEAP32[(((buf)+(32))>>2)]=0;
        HEAP32[(((buf)+(36))>>2)]=stat.size;
        HEAP32[(((buf)+(40))>>2)]=4096;
        HEAP32[(((buf)+(44))>>2)]=stat.blocks;
        HEAP32[(((buf)+(48))>>2)]=(stat.atime.getTime() / 1000)|0;
        HEAP32[(((buf)+(52))>>2)]=0;
        HEAP32[(((buf)+(56))>>2)]=(stat.mtime.getTime() / 1000)|0;
        HEAP32[(((buf)+(60))>>2)]=0;
        HEAP32[(((buf)+(64))>>2)]=(stat.ctime.getTime() / 1000)|0;
        HEAP32[(((buf)+(68))>>2)]=0;
        HEAP32[(((buf)+(72))>>2)]=stat.ino;
        return 0;
      },doMsync:function(addr, stream, len, flags) {
        var buffer = new Uint8Array(HEAPU8.subarray(addr, addr + len));
        FS.msync(stream, buffer, 0, len, flags);
      },doMkdir:function(path, mode) {
        // remove a trailing slash, if one - /a/b/ has basename of '', but
        // we want to create b in the context of this function
        path = PATH.normalize(path);
        if (path[path.length-1] === '/') path = path.substr(0, path.length-1);
        FS.mkdir(path, mode, 0);
        return 0;
      },doMknod:function(path, mode, dev) {
        // we don't want this in the JS API as it uses mknod to create all nodes.
        switch (mode & 61440) {
          case 32768:
          case 8192:
          case 24576:
          case 4096:
          case 49152:
            break;
          default: return -ERRNO_CODES.EINVAL;
        }
        FS.mknod(path, mode, dev);
        return 0;
      },doReadlink:function(path, buf, bufsize) {
        if (bufsize <= 0) return -ERRNO_CODES.EINVAL;
        var ret = FS.readlink(path);
  
        var len = Math.min(bufsize, lengthBytesUTF8(ret));
        var endChar = HEAP8[buf+len];
        stringToUTF8(ret, buf, bufsize+1);
        // readlink is one of the rare functions that write out a C string, but does never append a null to the output buffer(!)
        // stringToUTF8() always appends a null byte, so restore the character under the null byte after the write.
        HEAP8[buf+len] = endChar;
  
        return len;
      },doAccess:function(path, amode) {
        if (amode & ~7) {
          // need a valid mode
          return -ERRNO_CODES.EINVAL;
        }
        var node;
        var lookup = FS.lookupPath(path, { follow: true });
        node = lookup.node;
        var perms = '';
        if (amode & 4) perms += 'r';
        if (amode & 2) perms += 'w';
        if (amode & 1) perms += 'x';
        if (perms /* otherwise, they've just passed F_OK */ && FS.nodePermissions(node, perms)) {
          return -ERRNO_CODES.EACCES;
        }
        return 0;
      },doDup:function(path, flags, suggestFD) {
        var suggest = FS.getStream(suggestFD);
        if (suggest) FS.close(suggest);
        return FS.open(path, flags, 0, suggestFD, suggestFD).fd;
      },doReadv:function(stream, iov, iovcnt, offset) {
        var ret = 0;
        for (var i = 0; i < iovcnt; i++) {
          var ptr = HEAP32[(((iov)+(i*8))>>2)];
          var len = HEAP32[(((iov)+(i*8 + 4))>>2)];
          var curr = FS.read(stream, HEAP8,ptr, len, offset);
          if (curr < 0) return -1;
          ret += curr;
          if (curr < len) break; // nothing more to read
        }
        return ret;
      },doWritev:function(stream, iov, iovcnt, offset) {
        var ret = 0;
        for (var i = 0; i < iovcnt; i++) {
          var ptr = HEAP32[(((iov)+(i*8))>>2)];
          var len = HEAP32[(((iov)+(i*8 + 4))>>2)];
          var curr = FS.write(stream, HEAP8,ptr, len, offset);
          if (curr < 0) return -1;
          ret += curr;
        }
        return ret;
      },varargs:0,get:function(varargs) {
        SYSCALLS.varargs += 4;
        var ret = HEAP32[(((SYSCALLS.varargs)-(4))>>2)];
        return ret;
      },getStr:function() {
        var ret = UTF8ToString(SYSCALLS.get());
        return ret;
      },getStreamFromFD:function() {
        var stream = FS.getStream(SYSCALLS.get());
        if (!stream) throw new FS.ErrnoError(ERRNO_CODES.EBADF);
        return stream;
      },getSocketFromFD:function() {
        var socket = SOCKFS.getSocket(SYSCALLS.get());
        if (!socket) throw new FS.ErrnoError(ERRNO_CODES.EBADF);
        return socket;
      },getSocketAddress:function(allowNull) {
        var addrp = SYSCALLS.get(), addrlen = SYSCALLS.get();
        if (allowNull && addrp === 0) return null;
        var info = __read_sockaddr(addrp, addrlen);
        if (info.errno) throw new FS.ErrnoError(info.errno);
        info.addr = DNS.lookup_addr(info.addr) || info.addr;
        return info;
      },get64:function() {
        var low = SYSCALLS.get(), high = SYSCALLS.get();
        if (low >= 0) assert(high === 0);
        else assert(high === -1);
        return low;
      },getZero:function() {
        assert(SYSCALLS.get() === 0);
      }};function ___syscall140(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // llseek
      var stream = SYSCALLS.getStreamFromFD(), offset_high = SYSCALLS.get(), offset_low = SYSCALLS.get(), result = SYSCALLS.get(), whence = SYSCALLS.get();
      // NOTE: offset_high is unused - Emscripten's off_t is 32-bit
      var offset = offset_low;
      FS.llseek(stream, offset, whence);
      HEAP32[((result)>>2)]=stream.position;
      if (stream.getdents && offset === 0 && whence === 0) stream.getdents = null; // reset readdir state
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall145(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // readv
      var stream = SYSCALLS.getStreamFromFD(), iov = SYSCALLS.get(), iovcnt = SYSCALLS.get();
      return SYSCALLS.doReadv(stream, iov, iovcnt);
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall146(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // writev
      var stream = SYSCALLS.getStreamFromFD(), iov = SYSCALLS.get(), iovcnt = SYSCALLS.get();
      return SYSCALLS.doWritev(stream, iov, iovcnt);
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall54(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // ioctl
      var stream = SYSCALLS.getStreamFromFD(), op = SYSCALLS.get();
      switch (op) {
        case 21509:
        case 21505: {
          if (!stream.tty) return -ERRNO_CODES.ENOTTY;
          return 0;
        }
        case 21510:
        case 21511:
        case 21512:
        case 21506:
        case 21507:
        case 21508: {
          if (!stream.tty) return -ERRNO_CODES.ENOTTY;
          return 0; // no-op, not actually adjusting terminal settings
        }
        case 21519: {
          if (!stream.tty) return -ERRNO_CODES.ENOTTY;
          var argp = SYSCALLS.get();
          HEAP32[((argp)>>2)]=0;
          return 0;
        }
        case 21520: {
          if (!stream.tty) return -ERRNO_CODES.ENOTTY;
          return -ERRNO_CODES.EINVAL; // not supported
        }
        case 21531: {
          var argp = SYSCALLS.get();
          return FS.ioctl(stream, op, argp);
        }
        case 21523: {
          // TODO: in theory we should write to the winsize struct that gets
          // passed in, but for now musl doesn't read anything on it
          if (!stream.tty) return -ERRNO_CODES.ENOTTY;
          return 0;
        }
        case 21524: {
          // TODO: technically, this ioctl call should change the window size.
          // but, since emscripten doesn't have any concept of a terminal window
          // yet, we'll just silently throw it away as we do TIOCGWINSZ
          if (!stream.tty) return -ERRNO_CODES.ENOTTY;
          return 0;
        }
        default: abort('bad ioctl syscall ' + op);
      }
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall6(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // close
      var stream = SYSCALLS.getStreamFromFD();
      FS.close(stream);
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall91(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // munmap
      var addr = SYSCALLS.get(), len = SYSCALLS.get();
      // TODO: support unmmap'ing parts of allocations
      var info = SYSCALLS.mappings[addr];
      if (!info) return 0;
      if (len === info.len) {
        var stream = FS.getStream(info.fd);
        SYSCALLS.doMsync(addr, stream, len, info.flags)
        FS.munmap(stream);
        SYSCALLS.mappings[addr] = null;
        if (info.allocated) {
          _free(info.malloc);
        }
      }
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___unlock() {}

  function _abort() {
      Module['abort']();
    }

  function _emscripten_get_heap_size() {
      return TOTAL_MEMORY;
    }

  function _emscripten_resize_heap(requestedSize) {
      var oldSize = _emscripten_get_heap_size();
      // TOTAL_MEMORY is the current size of the actual array, and DYNAMICTOP is the new top.
  
  
      var PAGE_MULTIPLE = 65536;
      var LIMIT = 2147483648 - PAGE_MULTIPLE; // We can do one page short of 2GB as theoretical maximum.
  
      if (requestedSize > LIMIT) {
        return false;
      }
  
      var MIN_TOTAL_MEMORY = 16777216;
      var newSize = Math.max(oldSize, MIN_TOTAL_MEMORY); // So the loop below will not be infinite, and minimum asm.js memory size is 16MB.
  
      while (newSize < requestedSize) { // Keep incrementing the heap size as long as it's less than what is requested.
        if (newSize <= 536870912) {
          newSize = alignUp(2 * newSize, PAGE_MULTIPLE); // Simple heuristic: double until 1GB...
        } else {
          // ..., but after that, add smaller increments towards 2GB, which we cannot reach
          newSize = Math.min(alignUp((3 * newSize + 2147483648) / 4, PAGE_MULTIPLE), LIMIT);
        }
      }
  
  
  
      var replacement = Module['reallocBuffer'](newSize);
      if (!replacement || replacement.byteLength != newSize) {
        return false;
      }
  
      // everything worked
      updateGlobalBuffer(replacement);
      updateGlobalBufferViews();
  
      TOTAL_MEMORY = newSize;
      HEAPU32[DYNAMICTOP_PTR>>2] = requestedSize;
  
  
  
      return true;
    }

  
  function __exit(status) {
      // void _exit(int status);
      // http://pubs.opengroup.org/onlinepubs/000095399/functions/exit.html
      exit(status);
    }function _exit(status) {
      __exit(status);
    }

  
  var ENV={};function _getenv(name) {
      // char *getenv(const char *name);
      // http://pubs.opengroup.org/onlinepubs/009695399/functions/getenv.html
      if (name === 0) return 0;
      name = UTF8ToString(name);
      if (!ENV.hasOwnProperty(name)) return 0;
  
      if (_getenv.ret) _free(_getenv.ret);
      _getenv.ret = allocateUTF8(ENV[name]);
      return _getenv.ret;
    }

   

  function _llvm_stackrestore(p) {
      var self = _llvm_stacksave;
      var ret = self.LLVM_SAVEDSTACKS[p];
      self.LLVM_SAVEDSTACKS.splice(p, 1);
      stackRestore(ret);
    }

  function _llvm_stacksave() {
      var self = _llvm_stacksave;
      if (!self.LLVM_SAVEDSTACKS) {
        self.LLVM_SAVEDSTACKS = [];
      }
      self.LLVM_SAVEDSTACKS.push(stackSave());
      return self.LLVM_SAVEDSTACKS.length-1;
    }

  
  function _emscripten_memcpy_big(dest, src, num) {
      HEAPU8.set(HEAPU8.subarray(src, src+num), dest);
    } 

   

   

   

  function _pthread_cond_wait() { return 0; }

   

   

   

  
  
  function __isLeapYear(year) {
        return year%4 === 0 && (year%100 !== 0 || year%400 === 0);
    }
  
  function __arraySum(array, index) {
      var sum = 0;
      for (var i = 0; i <= index; sum += array[i++]);
      return sum;
    }
  
  
  var __MONTH_DAYS_LEAP=[31,29,31,30,31,30,31,31,30,31,30,31];
  
  var __MONTH_DAYS_REGULAR=[31,28,31,30,31,30,31,31,30,31,30,31];function __addDays(date, days) {
      var newDate = new Date(date.getTime());
      while(days > 0) {
        var leap = __isLeapYear(newDate.getFullYear());
        var currentMonth = newDate.getMonth();
        var daysInCurrentMonth = (leap ? __MONTH_DAYS_LEAP : __MONTH_DAYS_REGULAR)[currentMonth];
  
        if (days > daysInCurrentMonth-newDate.getDate()) {
          // we spill over to next month
          days -= (daysInCurrentMonth-newDate.getDate()+1);
          newDate.setDate(1);
          if (currentMonth < 11) {
            newDate.setMonth(currentMonth+1)
          } else {
            newDate.setMonth(0);
            newDate.setFullYear(newDate.getFullYear()+1);
          }
        } else {
          // we stay in current month
          newDate.setDate(newDate.getDate()+days);
          return newDate;
        }
      }
  
      return newDate;
    }function _strftime(s, maxsize, format, tm) {
      // size_t strftime(char *restrict s, size_t maxsize, const char *restrict format, const struct tm *restrict timeptr);
      // http://pubs.opengroup.org/onlinepubs/009695399/functions/strftime.html
  
      var tm_zone = HEAP32[(((tm)+(40))>>2)];
  
      var date = {
        tm_sec: HEAP32[((tm)>>2)],
        tm_min: HEAP32[(((tm)+(4))>>2)],
        tm_hour: HEAP32[(((tm)+(8))>>2)],
        tm_mday: HEAP32[(((tm)+(12))>>2)],
        tm_mon: HEAP32[(((tm)+(16))>>2)],
        tm_year: HEAP32[(((tm)+(20))>>2)],
        tm_wday: HEAP32[(((tm)+(24))>>2)],
        tm_yday: HEAP32[(((tm)+(28))>>2)],
        tm_isdst: HEAP32[(((tm)+(32))>>2)],
        tm_gmtoff: HEAP32[(((tm)+(36))>>2)],
        tm_zone: tm_zone ? UTF8ToString(tm_zone) : ''
      };
  
      var pattern = UTF8ToString(format);
  
      // expand format
      var EXPANSION_RULES_1 = {
        '%c': '%a %b %d %H:%M:%S %Y',     // Replaced by the locale's appropriate date and time representation - e.g., Mon Aug  3 14:02:01 2013
        '%D': '%m/%d/%y',                 // Equivalent to %m / %d / %y
        '%F': '%Y-%m-%d',                 // Equivalent to %Y - %m - %d
        '%h': '%b',                       // Equivalent to %b
        '%r': '%I:%M:%S %p',              // Replaced by the time in a.m. and p.m. notation
        '%R': '%H:%M',                    // Replaced by the time in 24-hour notation
        '%T': '%H:%M:%S',                 // Replaced by the time
        '%x': '%m/%d/%y',                 // Replaced by the locale's appropriate date representation
        '%X': '%H:%M:%S'                  // Replaced by the locale's appropriate date representation
      };
      for (var rule in EXPANSION_RULES_1) {
        pattern = pattern.replace(new RegExp(rule, 'g'), EXPANSION_RULES_1[rule]);
      }
  
      var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  
      function leadingSomething(value, digits, character) {
        var str = typeof value === 'number' ? value.toString() : (value || '');
        while (str.length < digits) {
          str = character[0]+str;
        }
        return str;
      };
  
      function leadingNulls(value, digits) {
        return leadingSomething(value, digits, '0');
      };
  
      function compareByDay(date1, date2) {
        function sgn(value) {
          return value < 0 ? -1 : (value > 0 ? 1 : 0);
        };
  
        var compare;
        if ((compare = sgn(date1.getFullYear()-date2.getFullYear())) === 0) {
          if ((compare = sgn(date1.getMonth()-date2.getMonth())) === 0) {
            compare = sgn(date1.getDate()-date2.getDate());
          }
        }
        return compare;
      };
  
      function getFirstWeekStartDate(janFourth) {
          switch (janFourth.getDay()) {
            case 0: // Sunday
              return new Date(janFourth.getFullYear()-1, 11, 29);
            case 1: // Monday
              return janFourth;
            case 2: // Tuesday
              return new Date(janFourth.getFullYear(), 0, 3);
            case 3: // Wednesday
              return new Date(janFourth.getFullYear(), 0, 2);
            case 4: // Thursday
              return new Date(janFourth.getFullYear(), 0, 1);
            case 5: // Friday
              return new Date(janFourth.getFullYear()-1, 11, 31);
            case 6: // Saturday
              return new Date(janFourth.getFullYear()-1, 11, 30);
          }
      };
  
      function getWeekBasedYear(date) {
          var thisDate = __addDays(new Date(date.tm_year+1900, 0, 1), date.tm_yday);
  
          var janFourthThisYear = new Date(thisDate.getFullYear(), 0, 4);
          var janFourthNextYear = new Date(thisDate.getFullYear()+1, 0, 4);
  
          var firstWeekStartThisYear = getFirstWeekStartDate(janFourthThisYear);
          var firstWeekStartNextYear = getFirstWeekStartDate(janFourthNextYear);
  
          if (compareByDay(firstWeekStartThisYear, thisDate) <= 0) {
            // this date is after the start of the first week of this year
            if (compareByDay(firstWeekStartNextYear, thisDate) <= 0) {
              return thisDate.getFullYear()+1;
            } else {
              return thisDate.getFullYear();
            }
          } else {
            return thisDate.getFullYear()-1;
          }
      };
  
      var EXPANSION_RULES_2 = {
        '%a': function(date) {
          return WEEKDAYS[date.tm_wday].substring(0,3);
        },
        '%A': function(date) {
          return WEEKDAYS[date.tm_wday];
        },
        '%b': function(date) {
          return MONTHS[date.tm_mon].substring(0,3);
        },
        '%B': function(date) {
          return MONTHS[date.tm_mon];
        },
        '%C': function(date) {
          var year = date.tm_year+1900;
          return leadingNulls((year/100)|0,2);
        },
        '%d': function(date) {
          return leadingNulls(date.tm_mday, 2);
        },
        '%e': function(date) {
          return leadingSomething(date.tm_mday, 2, ' ');
        },
        '%g': function(date) {
          // %g, %G, and %V give values according to the ISO 8601:2000 standard week-based year.
          // In this system, weeks begin on a Monday and week 1 of the year is the week that includes
          // January 4th, which is also the week that includes the first Thursday of the year, and
          // is also the first week that contains at least four days in the year.
          // If the first Monday of January is the 2nd, 3rd, or 4th, the preceding days are part of
          // the last week of the preceding year; thus, for Saturday 2nd January 1999,
          // %G is replaced by 1998 and %V is replaced by 53. If December 29th, 30th,
          // or 31st is a Monday, it and any following days are part of week 1 of the following year.
          // Thus, for Tuesday 30th December 1997, %G is replaced by 1998 and %V is replaced by 01.
  
          return getWeekBasedYear(date).toString().substring(2);
        },
        '%G': function(date) {
          return getWeekBasedYear(date);
        },
        '%H': function(date) {
          return leadingNulls(date.tm_hour, 2);
        },
        '%I': function(date) {
          var twelveHour = date.tm_hour;
          if (twelveHour == 0) twelveHour = 12;
          else if (twelveHour > 12) twelveHour -= 12;
          return leadingNulls(twelveHour, 2);
        },
        '%j': function(date) {
          // Day of the year (001-366)
          return leadingNulls(date.tm_mday+__arraySum(__isLeapYear(date.tm_year+1900) ? __MONTH_DAYS_LEAP : __MONTH_DAYS_REGULAR, date.tm_mon-1), 3);
        },
        '%m': function(date) {
          return leadingNulls(date.tm_mon+1, 2);
        },
        '%M': function(date) {
          return leadingNulls(date.tm_min, 2);
        },
        '%n': function() {
          return '\n';
        },
        '%p': function(date) {
          if (date.tm_hour >= 0 && date.tm_hour < 12) {
            return 'AM';
          } else {
            return 'PM';
          }
        },
        '%S': function(date) {
          return leadingNulls(date.tm_sec, 2);
        },
        '%t': function() {
          return '\t';
        },
        '%u': function(date) {
          var day = new Date(date.tm_year+1900, date.tm_mon+1, date.tm_mday, 0, 0, 0, 0);
          return day.getDay() || 7;
        },
        '%U': function(date) {
          // Replaced by the week number of the year as a decimal number [00,53].
          // The first Sunday of January is the first day of week 1;
          // days in the new year before this are in week 0. [ tm_year, tm_wday, tm_yday]
          var janFirst = new Date(date.tm_year+1900, 0, 1);
          var firstSunday = janFirst.getDay() === 0 ? janFirst : __addDays(janFirst, 7-janFirst.getDay());
          var endDate = new Date(date.tm_year+1900, date.tm_mon, date.tm_mday);
  
          // is target date after the first Sunday?
          if (compareByDay(firstSunday, endDate) < 0) {
            // calculate difference in days between first Sunday and endDate
            var februaryFirstUntilEndMonth = __arraySum(__isLeapYear(endDate.getFullYear()) ? __MONTH_DAYS_LEAP : __MONTH_DAYS_REGULAR, endDate.getMonth()-1)-31;
            var firstSundayUntilEndJanuary = 31-firstSunday.getDate();
            var days = firstSundayUntilEndJanuary+februaryFirstUntilEndMonth+endDate.getDate();
            return leadingNulls(Math.ceil(days/7), 2);
          }
  
          return compareByDay(firstSunday, janFirst) === 0 ? '01': '00';
        },
        '%V': function(date) {
          // Replaced by the week number of the year (Monday as the first day of the week)
          // as a decimal number [01,53]. If the week containing 1 January has four
          // or more days in the new year, then it is considered week 1.
          // Otherwise, it is the last week of the previous year, and the next week is week 1.
          // Both January 4th and the first Thursday of January are always in week 1. [ tm_year, tm_wday, tm_yday]
          var janFourthThisYear = new Date(date.tm_year+1900, 0, 4);
          var janFourthNextYear = new Date(date.tm_year+1901, 0, 4);
  
          var firstWeekStartThisYear = getFirstWeekStartDate(janFourthThisYear);
          var firstWeekStartNextYear = getFirstWeekStartDate(janFourthNextYear);
  
          var endDate = __addDays(new Date(date.tm_year+1900, 0, 1), date.tm_yday);
  
          if (compareByDay(endDate, firstWeekStartThisYear) < 0) {
            // if given date is before this years first week, then it belongs to the 53rd week of last year
            return '53';
          }
  
          if (compareByDay(firstWeekStartNextYear, endDate) <= 0) {
            // if given date is after next years first week, then it belongs to the 01th week of next year
            return '01';
          }
  
          // given date is in between CW 01..53 of this calendar year
          var daysDifference;
          if (firstWeekStartThisYear.getFullYear() < date.tm_year+1900) {
            // first CW of this year starts last year
            daysDifference = date.tm_yday+32-firstWeekStartThisYear.getDate()
          } else {
            // first CW of this year starts this year
            daysDifference = date.tm_yday+1-firstWeekStartThisYear.getDate();
          }
          return leadingNulls(Math.ceil(daysDifference/7), 2);
        },
        '%w': function(date) {
          var day = new Date(date.tm_year+1900, date.tm_mon+1, date.tm_mday, 0, 0, 0, 0);
          return day.getDay();
        },
        '%W': function(date) {
          // Replaced by the week number of the year as a decimal number [00,53].
          // The first Monday of January is the first day of week 1;
          // days in the new year before this are in week 0. [ tm_year, tm_wday, tm_yday]
          var janFirst = new Date(date.tm_year, 0, 1);
          var firstMonday = janFirst.getDay() === 1 ? janFirst : __addDays(janFirst, janFirst.getDay() === 0 ? 1 : 7-janFirst.getDay()+1);
          var endDate = new Date(date.tm_year+1900, date.tm_mon, date.tm_mday);
  
          // is target date after the first Monday?
          if (compareByDay(firstMonday, endDate) < 0) {
            var februaryFirstUntilEndMonth = __arraySum(__isLeapYear(endDate.getFullYear()) ? __MONTH_DAYS_LEAP : __MONTH_DAYS_REGULAR, endDate.getMonth()-1)-31;
            var firstMondayUntilEndJanuary = 31-firstMonday.getDate();
            var days = firstMondayUntilEndJanuary+februaryFirstUntilEndMonth+endDate.getDate();
            return leadingNulls(Math.ceil(days/7), 2);
          }
          return compareByDay(firstMonday, janFirst) === 0 ? '01': '00';
        },
        '%y': function(date) {
          // Replaced by the last two digits of the year as a decimal number [00,99]. [ tm_year]
          return (date.tm_year+1900).toString().substring(2);
        },
        '%Y': function(date) {
          // Replaced by the year as a decimal number (for example, 1997). [ tm_year]
          return date.tm_year+1900;
        },
        '%z': function(date) {
          // Replaced by the offset from UTC in the ISO 8601:2000 standard format ( +hhmm or -hhmm ).
          // For example, "-0430" means 4 hours 30 minutes behind UTC (west of Greenwich).
          var off = date.tm_gmtoff;
          var ahead = off >= 0;
          off = Math.abs(off) / 60;
          // convert from minutes into hhmm format (which means 60 minutes = 100 units)
          off = (off / 60)*100 + (off % 60);
          return (ahead ? '+' : '-') + String("0000" + off).slice(-4);
        },
        '%Z': function(date) {
          return date.tm_zone;
        },
        '%%': function() {
          return '%';
        }
      };
      for (var rule in EXPANSION_RULES_2) {
        if (pattern.indexOf(rule) >= 0) {
          pattern = pattern.replace(new RegExp(rule, 'g'), EXPANSION_RULES_2[rule](date));
        }
      }
  
      var bytes = intArrayFromString(pattern, false);
      if (bytes.length > maxsize) {
        return 0;
      }
  
      writeArrayToMemory(bytes, s);
      return bytes.length-1;
    }function _strftime_l(s, maxsize, format, tm) {
      return _strftime(s, maxsize, format, tm); // no locale support yet
    }
FS.staticInit();__ATINIT__.unshift(function() { if (!Module["noFSInit"] && !FS.init.initialized) FS.init() });__ATMAIN__.push(function() { FS.ignorePermissions = false });__ATEXIT__.push(function() { FS.quit() });;
__ATINIT__.unshift(function() { TTY.init() });__ATEXIT__.push(function() { TTY.shutdown() });;
if (ENVIRONMENT_IS_NODE) { var fs = require("fs"); var NODEJS_PATH = require("path"); NODEFS.staticInit(); };
var ASSERTIONS = false;

// Copyright 2017 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

/** @type {function(string, boolean=, number=)} */
function intArrayFromString(stringy, dontAddNull, length) {
  var len = length > 0 ? length : lengthBytesUTF8(stringy)+1;
  var u8array = new Array(len);
  var numBytesWritten = stringToUTF8Array(stringy, u8array, 0, u8array.length);
  if (dontAddNull) u8array.length = numBytesWritten;
  return u8array;
}

function intArrayToString(array) {
  var ret = [];
  for (var i = 0; i < array.length; i++) {
    var chr = array[i];
    if (chr > 0xFF) {
      if (ASSERTIONS) {
        assert(false, 'Character code ' + chr + ' (' + String.fromCharCode(chr) + ')  at offset ' + i + ' not in 0x00-0xFF.');
      }
      chr &= 0xFF;
    }
    ret.push(String.fromCharCode(chr));
  }
  return ret.join('');
}


// Copied from https://github.com/strophe/strophejs/blob/e06d027/src/polyfills.js#L149

// This code was written by Tyler Akins and has been placed in the
// public domain.  It would be nice if you left this header intact.
// Base64 code from Tyler Akins -- http://rumkin.com

/**
 * Decodes a base64 string.
 * @param {String} input The string to decode.
 */
var decodeBase64 = typeof atob === 'function' ? atob : function (input) {
  var keyStr = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

  var output = '';
  var chr1, chr2, chr3;
  var enc1, enc2, enc3, enc4;
  var i = 0;
  // remove all characters that are not A-Z, a-z, 0-9, +, /, or =
  input = input.replace(/[^A-Za-z0-9\+\/\=]/g, '');
  do {
    enc1 = keyStr.indexOf(input.charAt(i++));
    enc2 = keyStr.indexOf(input.charAt(i++));
    enc3 = keyStr.indexOf(input.charAt(i++));
    enc4 = keyStr.indexOf(input.charAt(i++));

    chr1 = (enc1 << 2) | (enc2 >> 4);
    chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    chr3 = ((enc3 & 3) << 6) | enc4;

    output = output + String.fromCharCode(chr1);

    if (enc3 !== 64) {
      output = output + String.fromCharCode(chr2);
    }
    if (enc4 !== 64) {
      output = output + String.fromCharCode(chr3);
    }
  } while (i < input.length);
  return output;
};

// Converts a string of base64 into a byte array.
// Throws error on invalid input.
function intArrayFromBase64(s) {
  if (typeof ENVIRONMENT_IS_NODE === 'boolean' && ENVIRONMENT_IS_NODE) {
    var buf;
    try {
      buf = Buffer.from(s, 'base64');
    } catch (_) {
      buf = new Buffer(s, 'base64');
    }
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  try {
    var decoded = decodeBase64(s);
    var bytes = new Uint8Array(decoded.length);
    for (var i = 0 ; i < decoded.length ; ++i) {
      bytes[i] = decoded.charCodeAt(i);
    }
    return bytes;
  } catch (_) {
    throw new Error('Converting base64 string to bytes failed.');
  }
}

// If filename is a base64 data URI, parses and returns data (Buffer on node,
// Uint8Array otherwise). If filename is not a base64 data URI, returns undefined.
function tryParseAsDataURI(filename) {
  if (!isDataURI(filename)) {
    return;
  }

  return intArrayFromBase64(filename.slice(dataURIPrefix.length));
}



Module['wasmTableSize'] = 478;

Module['wasmMaxTableSize'] = 478;

var asmGlobalArg = {}

Module.asmLibraryArg = { "abort": abort, "assert": assert, "setTempRet0": setTempRet0, "getTempRet0": getTempRet0, "abortOnCannotGrowMemory": abortOnCannotGrowMemory, "__ZSt18uncaught_exceptionv": __ZSt18uncaught_exceptionv, "___cxa_find_matching_catch": ___cxa_find_matching_catch, "___cxa_free_exception": ___cxa_free_exception, "___gxx_personality_v0": ___gxx_personality_v0, "___lock": ___lock, "___map_file": ___map_file, "___resumeException": ___resumeException, "___setErrNo": ___setErrNo, "___syscall140": ___syscall140, "___syscall145": ___syscall145, "___syscall146": ___syscall146, "___syscall54": ___syscall54, "___syscall6": ___syscall6, "___syscall91": ___syscall91, "___unlock": ___unlock, "__addDays": __addDays, "__arraySum": __arraySum, "__exit": __exit, "__isLeapYear": __isLeapYear, "_abort": _abort, "_emscripten_get_heap_size": _emscripten_get_heap_size, "_emscripten_memcpy_big": _emscripten_memcpy_big, "_emscripten_resize_heap": _emscripten_resize_heap, "_exit": _exit, "_getenv": _getenv, "_llvm_stackrestore": _llvm_stackrestore, "_llvm_stacksave": _llvm_stacksave, "_pthread_cond_wait": _pthread_cond_wait, "_strftime": _strftime, "_strftime_l": _strftime_l, "DYNAMICTOP_PTR": DYNAMICTOP_PTR, "tempDoublePtr": tempDoublePtr };
// EMSCRIPTEN_START_ASM
var asm =Module["asm"]// EMSCRIPTEN_END_ASM
(asmGlobalArg, Module.asmLibraryArg, buffer);

Module["asm"] = asm;
var __GLOBAL__I_000101 = Module["__GLOBAL__I_000101"] = function() {  return Module["asm"]["__GLOBAL__I_000101"].apply(null, arguments) };
var __GLOBAL__sub_I_iostream_cpp = Module["__GLOBAL__sub_I_iostream_cpp"] = function() {  return Module["asm"]["__GLOBAL__sub_I_iostream_cpp"].apply(null, arguments) };
var ___cxa_can_catch = Module["___cxa_can_catch"] = function() {  return Module["asm"]["___cxa_can_catch"].apply(null, arguments) };
var ___cxa_is_pointer_type = Module["___cxa_is_pointer_type"] = function() {  return Module["asm"]["___cxa_is_pointer_type"].apply(null, arguments) };
var ___errno_location = Module["___errno_location"] = function() {  return Module["asm"]["___errno_location"].apply(null, arguments) };
var _emscripten_replace_memory = Module["_emscripten_replace_memory"] = function() {  return Module["asm"]["_emscripten_replace_memory"].apply(null, arguments) };
var _free = Module["_free"] = function() {  return Module["asm"]["_free"].apply(null, arguments) };
var _llvm_bswap_i32 = Module["_llvm_bswap_i32"] = function() {  return Module["asm"]["_llvm_bswap_i32"].apply(null, arguments) };
var _malloc = Module["_malloc"] = function() {  return Module["asm"]["_malloc"].apply(null, arguments) };
var _memcpy = Module["_memcpy"] = function() {  return Module["asm"]["_memcpy"].apply(null, arguments) };
var _memmove = Module["_memmove"] = function() {  return Module["asm"]["_memmove"].apply(null, arguments) };
var _memset = Module["_memset"] = function() {  return Module["asm"]["_memset"].apply(null, arguments) };
var _pthread_cond_broadcast = Module["_pthread_cond_broadcast"] = function() {  return Module["asm"]["_pthread_cond_broadcast"].apply(null, arguments) };
var _pthread_mutex_lock = Module["_pthread_mutex_lock"] = function() {  return Module["asm"]["_pthread_mutex_lock"].apply(null, arguments) };
var _pthread_mutex_unlock = Module["_pthread_mutex_unlock"] = function() {  return Module["asm"]["_pthread_mutex_unlock"].apply(null, arguments) };
var _sbrk = Module["_sbrk"] = function() {  return Module["asm"]["_sbrk"].apply(null, arguments) };
var _synthesis = Module["_synthesis"] = function() {  return Module["asm"]["_synthesis"].apply(null, arguments) };
var establishStackSpace = Module["establishStackSpace"] = function() {  return Module["asm"]["establishStackSpace"].apply(null, arguments) };
var setThrew = Module["setThrew"] = function() {  return Module["asm"]["setThrew"].apply(null, arguments) };
var stackAlloc = Module["stackAlloc"] = function() {  return Module["asm"]["stackAlloc"].apply(null, arguments) };
var stackRestore = Module["stackRestore"] = function() {  return Module["asm"]["stackRestore"].apply(null, arguments) };
var stackSave = Module["stackSave"] = function() {  return Module["asm"]["stackSave"].apply(null, arguments) };
var dynCall_ii = Module["dynCall_ii"] = function() {  return Module["asm"]["dynCall_ii"].apply(null, arguments) };
var dynCall_iii = Module["dynCall_iii"] = function() {  return Module["asm"]["dynCall_iii"].apply(null, arguments) };
var dynCall_iiii = Module["dynCall_iiii"] = function() {  return Module["asm"]["dynCall_iiii"].apply(null, arguments) };
var dynCall_iiiii = Module["dynCall_iiiii"] = function() {  return Module["asm"]["dynCall_iiiii"].apply(null, arguments) };
var dynCall_iiiiid = Module["dynCall_iiiiid"] = function() {  return Module["asm"]["dynCall_iiiiid"].apply(null, arguments) };
var dynCall_iiiiii = Module["dynCall_iiiiii"] = function() {  return Module["asm"]["dynCall_iiiiii"].apply(null, arguments) };
var dynCall_iiiiiid = Module["dynCall_iiiiiid"] = function() {  return Module["asm"]["dynCall_iiiiiid"].apply(null, arguments) };
var dynCall_iiiiiii = Module["dynCall_iiiiiii"] = function() {  return Module["asm"]["dynCall_iiiiiii"].apply(null, arguments) };
var dynCall_iiiiiiii = Module["dynCall_iiiiiiii"] = function() {  return Module["asm"]["dynCall_iiiiiiii"].apply(null, arguments) };
var dynCall_iiiiiiiii = Module["dynCall_iiiiiiiii"] = function() {  return Module["asm"]["dynCall_iiiiiiiii"].apply(null, arguments) };
var dynCall_iiiiij = Module["dynCall_iiiiij"] = function() {  return Module["asm"]["dynCall_iiiiij"].apply(null, arguments) };
var dynCall_v = Module["dynCall_v"] = function() {  return Module["asm"]["dynCall_v"].apply(null, arguments) };
var dynCall_vi = Module["dynCall_vi"] = function() {  return Module["asm"]["dynCall_vi"].apply(null, arguments) };
var dynCall_vii = Module["dynCall_vii"] = function() {  return Module["asm"]["dynCall_vii"].apply(null, arguments) };
var dynCall_viii = Module["dynCall_viii"] = function() {  return Module["asm"]["dynCall_viii"].apply(null, arguments) };
var dynCall_viiii = Module["dynCall_viiii"] = function() {  return Module["asm"]["dynCall_viiii"].apply(null, arguments) };
var dynCall_viiiii = Module["dynCall_viiiii"] = function() {  return Module["asm"]["dynCall_viiiii"].apply(null, arguments) };
var dynCall_viiiiii = Module["dynCall_viiiiii"] = function() {  return Module["asm"]["dynCall_viiiiii"].apply(null, arguments) };
var dynCall_viijii = Module["dynCall_viijii"] = function() {  return Module["asm"]["dynCall_viijii"].apply(null, arguments) };
;



// === Auto-generated postamble setup entry stuff ===

Module['asm'] = asm;



Module["ccall"] = ccall;
Module["cwrap"] = cwrap;









































































/**
 * @constructor
 * @extends {Error}
 * @this {ExitStatus}
 */
function ExitStatus(status) {
  this.name = "ExitStatus";
  this.message = "Program terminated with exit(" + status + ")";
  this.status = status;
};
ExitStatus.prototype = new Error();
ExitStatus.prototype.constructor = ExitStatus;

var calledMain = false;

dependenciesFulfilled = function runCaller() {
  // If run has never been called, and we should call run (INVOKE_RUN is true, and Module.noInitialRun is not false)
  if (!Module['calledRun']) run();
  if (!Module['calledRun']) dependenciesFulfilled = runCaller; // try this again later, after new deps are fulfilled
}





/** @type {function(Array=)} */
function run(args) {
  args = args || Module['arguments'];

  if (runDependencies > 0) {
    return;
  }


  preRun();

  if (runDependencies > 0) return; // a preRun added a dependency, run will be called later
  if (Module['calledRun']) return; // run may have just been called through dependencies being fulfilled just in this very frame

  function doRun() {
    if (Module['calledRun']) return; // run may have just been called while the async setStatus time below was happening
    Module['calledRun'] = true;

    if (ABORT) return;

    ensureInitRuntime();

    preMain();

    if (Module['onRuntimeInitialized']) Module['onRuntimeInitialized']();


    postRun();
  }

  if (Module['setStatus']) {
    Module['setStatus']('Running...');
    setTimeout(function() {
      setTimeout(function() {
        Module['setStatus']('');
      }, 1);
      doRun();
    }, 1);
  } else {
    doRun();
  }
}
Module['run'] = run;


function exit(status, implicit) {

  // if this is just main exit-ing implicitly, and the status is 0, then we
  // don't need to do anything here and can just leave. if the status is
  // non-zero, though, then we need to report it.
  // (we may have warned about this earlier, if a situation justifies doing so)
  if (implicit && Module['noExitRuntime'] && status === 0) {
    return;
  }

  if (Module['noExitRuntime']) {
  } else {

    ABORT = true;
    EXITSTATUS = status;

    exitRuntime();

    if (Module['onExit']) Module['onExit'](status);
  }

  Module['quit'](status, new ExitStatus(status));
}

var abortDecorators = [];

function abort(what) {
  if (Module['onAbort']) {
    Module['onAbort'](what);
  }

  if (what !== undefined) {
    out(what);
    err(what);
    what = JSON.stringify(what)
  } else {
    what = '';
  }

  ABORT = true;
  EXITSTATUS = 1;

  throw 'abort(' + what + '). Build with -s ASSERTIONS=1 for more info.';
}
Module['abort'] = abort;

if (Module['preInit']) {
  if (typeof Module['preInit'] == 'function') Module['preInit'] = [Module['preInit']];
  while (Module['preInit'].length > 0) {
    Module['preInit'].pop()();
  }
}


  Module["noExitRuntime"] = true;

run();





// {{MODULE_ADDITIONS}}



export default Module;

