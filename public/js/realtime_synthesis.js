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
var _sendWav = function(pointer, size){
    const result = new Float64Array(Module.HEAPU8.buffer, pointer, size);
    const max = Math.pow(2, 16);
    //const max = result.reduce((l, r) => Math.max(Math.abs(l), Math.abs(r)), 1);
    const result_float = new Float32Array(result).map(e => e / max);

    this.postMessage({
        message: 'wav',
        data: result_float
    }, [result_float.buffer]);
    
}.bind(this);



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




var wasmBinaryFile = 'data:application/octet-stream;base64,AGFzbQEAAAAB2QM3YAN/f38Bf2ADf39/AGABfwF/YAJ/fwF/YAJ/fwBgBX9/f39/AX9gCH9/f39/f39/AX9gAX8AYAZ/f39/f38Bf2AEf39/fwF/YAAAYAR/f39/AGAGf39/f39/AGAFf39/f38AYAV/f39/fAF/YAZ/f39/f3wBf2AHf39/f39/fwF/YAV/f39/fgF/YAV/f35/fwBgAXwBfGAAAX9gB39/f39/f38AYA5/f39/f3x/f39/f39/fwBgBH9/f3wAYAZ8f398f38BfGAFfH98f38BfGAFfH9/fH8BfGABfwF8YAN/f34AYAR/f39+AX5gA39/fwF8YAV/f39/fwF8YAZ/f39/f38BfGACf38BfmACfH8BfGACfHwBfGABfAF+YAN+f38Bf2ACfn8Bf2AGf3x/f39/AX9gA39/fwF+YAR/f39/AX5gAn9/AX1gAn9/AXxgA39/fwF9YAp/f39/f39/f39/AX9gDH9/f39/f39/f39/fwF/YAt/f39/f39/f39/fwF/YAp/f39/f39/f39/AGAPf39/f39/f39/f39/f39/AGAIf39/f39/f38AYAd/f39/f398AX9gCX9/f39/f39/fwF/YAZ/f39/f34Bf2AGf39/fn9/AALbBB8LZ2xvYmFsLk1hdGgDZXhwABMLZ2xvYmFsLk1hdGgDbG9nABMDZW52BWFib3J0AAcDZW52F2Fib3J0T25DYW5ub3RHcm93TWVtb3J5ABQDZW52B19fX2xvY2sABwNlbnYLX19fbWFwX2ZpbGUAAwNlbnYLX19fc2V0RXJyTm8ABwNlbnYNX19fc3lzY2FsbDE0MAADA2Vudg1fX19zeXNjYWxsMTQ1AAMDZW52DV9fX3N5c2NhbGwxNDYAAwNlbnYMX19fc3lzY2FsbDU0AAMDZW52C19fX3N5c2NhbGw2AAMDZW52DF9fX3N5c2NhbGw5MQADA2VudglfX191bmxvY2sABwNlbnYGX2Fib3J0AAoDZW52GV9lbXNjcmlwdGVuX2dldF9oZWFwX3NpemUAFANlbnYWX2Vtc2NyaXB0ZW5fbWVtY3B5X2JpZwAAA2VudhdfZW1zY3JpcHRlbl9yZXNpemVfaGVhcAACA2VudgVfZXhpdAAHA2VudgdfZ2V0ZW52AAIDZW52El9sbHZtX3N0YWNrcmVzdG9yZQAHA2Vudg9fbGx2bV9zdGFja3NhdmUAFANlbnYSX3B0aHJlYWRfY29uZF93YWl0AAMDZW52CF9zZW5kV2F2AAQDZW52C19zdHJmdGltZV9sAAUDZW52DF9fdGFibGVfYmFzZQN/AANlbnYORFlOQU1JQ1RPUF9QVFIDfwAGZ2xvYmFsA05hTgN8AAZnbG9iYWwISW5maW5pdHkDfAADZW52Bm1lbW9yeQIAgAIDZW52BXRhYmxlAXAB3gPeAwO2BbQFAgIUBwQEDRQDAgICAggVFgMCFBcYGRgaGBgaAhsbAgAAAhQCAAAUAgIUFBQCFAMCFAIACQcCAgADAAMUCgMCAgAAAAAEAgMcCQIdHh8gISIjIyIjJCMCAgAAAAAFAQIBJSYmAg0DJyIiAAMDCQkABwIDAAMDCh0JAgADAwICKAkpKSgDAwAJBSoeKyssHh4AAAAFAgcDAwMEBwcEBwcHBAASCwACAgMAAAcHAAICAwAABwcHBwcHBwcHBwcHBwcHBwQEAwcHCgoHAQEBAQQCAAMCBAADBAICAwMEAgIDAwcHBwULAAEEBwULAAEEBwgICAgICAgICAgIAwctFAkCAwcBBwcIDS4eCwgeCCwIAgABKQAICQgICQgpCAkQCAgICAgICAgICAgtCA0uCAgIAAEACAgICAgQBQURBREODgUFAAAJFQsVBQURBREODgUIFRUCCAgICAgGAgICAgICAgoKCgwMBgwMDAwMDA0MDAwMDA0FCAgICAgGAgICAgICAgIKCgoMDAYMDAwMDAwNDAwMDAwNBQcHEAwDBxAMAwcCBAQEAgQQEC8AADABARAQLwAwDwgwMQ8IMDEADAwGBgUFAgUGBgYFBgYFAgUCBwcGBgUFBgYHBwcHBwMAAwADCQAFFBQUBwcCAgQEBAcHAgIEBAQACQkJAwADAAMJAAUHBwsEBAoECgQKBAoECgQKBAoECgQKBAoECgQKBAoECgQKBAoECgQKBAoECgQKBAoECgQKBAoECgQKBAoEAQQEBAILBAQHBAQEBBQUChQEFAcBCgIHBwQBAQAHAAAyBAMBABUABAEBAAAAMgQDFQAEBwAMDQsACwsNCQwNCwwNCwsMDQIUAAICAAAAAgMACQUPCDMQBjQ1BwQBCw0MFTYCAwAJDgUPCBAGEQoHBAELDQwSEBUGKQd/ASMBC38BQQALfwFBAAt8ASMCC3wBIwMLfwFBsMIBC38BQbDCwQILB8QFKRBfX2dyb3dXYXNtTWVtb3J5ABkSX19HTE9CQUxfX0lfMDAwMTAxAN8BHF9fR0xPQkFMX19zdWJfSV9pb3N0cmVhbV9jcHAAjgEQX19fY3hhX2Nhbl9jYXRjaACeBRZfX19jeGFfaXNfcG9pbnRlcl90eXBlAJ8FEV9fX2Vycm5vX2xvY2F0aW9uADsFX2ZyZWUArQEPX2xsdm1fYnN3YXBfaTMyAKAFB19tYWxsb2MArAEHX21lbWNweQChBQhfbWVtbW92ZQCiBQdfbWVtc2V0AKMFF19wdGhyZWFkX2NvbmRfYnJvYWRjYXN0AJEBE19wdGhyZWFkX211dGV4X2xvY2sAkQEVX3B0aHJlYWRfbXV0ZXhfdW5sb2NrAJEBBV9zYnJrAKQFCl9zeW50aGVzaXMAHwpkeW5DYWxsX2lpAKUFC2R5bkNhbGxfaWlpAKYFDGR5bkNhbGxfaWlpaQCnBQ1keW5DYWxsX2lpaWlpAKgFDmR5bkNhbGxfaWlpaWlkAKkFDmR5bkNhbGxfaWlpaWlpAKoFD2R5bkNhbGxfaWlpaWlpZACrBQ9keW5DYWxsX2lpaWlpaWkArAUQZHluQ2FsbF9paWlpaWlpaQCtBRFkeW5DYWxsX2lpaWlpaWlpaQCuBQ5keW5DYWxsX2lpaWlpagDLBQlkeW5DYWxsX3YAsAUKZHluQ2FsbF92aQCxBQtkeW5DYWxsX3ZpaQCyBQxkeW5DYWxsX3ZpaWkAswUNZHluQ2FsbF92aWlpaQC0BQ5keW5DYWxsX3ZpaWlpaQC1BQ9keW5DYWxsX3ZpaWlpaWkAtgUOZHluQ2FsbF92aWlqaWkAzAUTZXN0YWJsaXNoU3RhY2tTcGFjZQAdCHNldFRocmV3AB4Kc3RhY2tBbGxvYwAaDHN0YWNrUmVzdG9yZQAcCXN0YWNrU2F2ZQAbCbUHAQAjAAveA7gFN5EBkQG9Ab4BkQGRAcUBxgHnAecB7wHwAfQB9QHrAvIC8wL0AvUC9gL3AvgC6wKTA5QDlQOWA5cDmAOZA7kDuQORAbkDuQORAb0DvQORAb0DvQORAZEBkQHbA+QDkQHmA4EEggSIBIkETk5OkQGRAdsDuAW4BbgFuAW5Bb8BvwHHAccB6QHtAfEB9gH0A/YD+AORBJMElQS5BboFODk9PocBuQG8AcABuQHEAcgB6AHsAf0BgwLUA9QD9QP3A/oDjQSSBJQElwSKBVu6BboFugW6BboFuwX5A44EjwSQBJYEuwW7BbwF1gLXAuUC5gK8BbwFvAW9BfsBgQLRAtIC1ALYAuAC4QLjAucC2QPaA+MD5QP7A5gE2QPgA9kD6wO9Bb0FvQW9Bb0FvQW9Bb0FvQW9Bb0FvgXMA9ADvgW/BYcCiAKJAooCiwKMAo0CjgKPApACkQK2ArcCuAK5AroCuwK8Ar0CvgK/AsAC7ALtAu4C7wLwAo0DjgOPA5ADkQPNA9EDvwW/Bb8FvwW/Bb8FvwW/Bb8FvwW/Bb8FvwW/Bb8FvwW/Bb8FvwW/Bb8FvwW/Bb8FvwW/Bb8FvwW/BcAFsQO1A78DwAPHA8gDwAXBBfECkgPXA9gD4QPiA98D3wPpA+oDwQXBBcEFwQXBBcIF0wLVAuIC5ALCBcIFwgXDBcQFswG1AbYBtwHCAcMBygHLAcwBzQHOAc8B0AHRAdIB0wHUAdUB1gHXAdgB2QHDAbcBwwG3AfgB+QH6AfgBgAL4AYYC+AGGAvgBhgL4AYYC+AGGAvgBhgKvA7ADrwOwA/gBhgL4AYYC+AGGAvgBhgL4AYYC+AGGAvgBhgL4AYYC+AGGAvgBhgJNhgKGAucD6APvA/AD8gPzA/8DgASGBIcEhgKGAoYChgKGAk2JBU1NiQWJBZkCmwJNrQHEBcQFxAXEBcQFxAXEBcQFxAXEBcQFxAXEBcQFxAXEBcQFxAXEBcQFxAXEBcQFxAXEBcQFxAXEBcQFxAXEBcQFxQW4AbgB5gHrAe4B8wG6A7oDugO7A7wDvAO6A7oDugO7A7wDvAO6A7oDugO+A7wDvAO6A7oDugO+A7wDvAO4AbgBgwSEBIUEigSLBIwExQXFBcUFxQXFBcUFxQXFBcUFxQXFBcUFxQXFBcUFxQXFBcUFxQXFBcUFxQXFBcUFxQXGBccFuwG7AfwBggKNBZUFmAXIBYwFlAWXBckF1QPWA4sFkwWWBckFyQXKBboBugHKBQrb1wm0BQYAIABAAAsbAQF/IwkhASAAIwlqJAkjCUEPakFwcSQJIAELBAAjCQsGACAAJAkLCgAgACQJIAEkCgsQACMFRQRAIAAkBSABJAYLC8kCAQV/IwkhBSMJQSBqJAkgBSEIIAVBGGoi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ACADDQEMBQsLIARBADoAACABQQA2AgAgAiADayECDAMLIAIgA2shAgsFIAEoAgAiACgCACIBBEBBACECA0AgAUH/AEsEQCAHIAFBABCCASIBQX9GBEBBfyECDAULBUEBIQELIAEgAmohAiAAQQRqIgAoAgAiAQ0ACwVBACECCwsLIAYkCSACC/4CAQh/IwkhCSMJQZAIaiQJIAlBgAhqIgcgASgCACIFNgIAIANBgAIgAEEARyILGyEGIAAgCSIIIAsbIQMgBkEARyAFQQBHcQRAAkBBACEAA0ACQCACQQJ2IgogBk8iDCACQYMBS3JFDQIgAiAGIAogDBsiBWshAiADIAcgBSAEEJgBIgVBf0YNACAGQQAgBSADIAhGIgobayEGIAMgBUECdCADaiAKGyEDIAAgBWohACAHKAIAIgVBAEcgBkEAR3ENAQwCCwtBfyEAQQAhBiAHKAIAIQULBUEAIQALIAUEQCAGQQBHIAJBAEdxBEACQANAIAMgBSACIAQQYSIIQQJqQQNPBEAgByAIIAcoAgBqIgU2AgAgA0EEaiEDIABBAWohACAGQX9qIgZBAEcgAiAIayICQQBHcQ0BDAILCwJAAkACQCAIQX9rDgIAAQILIAghAAwCCyAHQQA2AgAMAQsgBEEANgIACwsLIAsEQCABIAcoAgA2AgALIAkkCSAACwwAIAAgAUEAEKIBtgvqAQIEfwF8IwkhBCMJQYABaiQJIAQiA0IANwIAIANCADcCCCADQgA3AhAgA0IANwIYIANCADcCICADQgA3AiggA0IANwIwIANCADcCOCADQUBrQgA3AgAgA0IANwJIIANCADcCUCADQgA3AlggA0IANwJgIANCADcCaCADQgA3AnAgA0EANgJ4IANBBGoiBSAANgIAIANBCGoiBkF/NgIAIAMgADYCLCADQX82AkwgA0EAEF0gAyACQQEQZCEHIAMoAmwgBSgCACAGKAIAa2ohAiABBEAgASAAIAJqIAAgAhs2AgALIAQkCSAHCwsAIAAgAUEBEKIBCwsAIAAgAUECEKIBCwkAIAAgARChAQsJACAAIAEQowELCQAgACABEKQBCzABAn8gAgRAIAAhAwNAIANBBGohBCADIAE2AgAgAkF/aiICBEAgBCEDDAELCwsgAAtvAQN/IAAgAWtBAnUgAkkEQANAIAJBf2oiAkEC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QeyoASACIANyNgIAIAFBCGohAyABCyECIAMgADYCACACIAA2AgwgACACNgIIIAAgATYCDA8LIANBCHYiAQR/IANB////B0sEf0EfBSABIAFBgP4/akEQdkEIcSICdCIEQYDgH2pBEHZBBHEhAUEOIAEgAnIgBCABdCIBQYCAD2pBEHZBAnEiAnJrIAEgAnRBD3ZqIgFBAXQgAyABQQdqdkEBcXILBUEACyICQQJ0QZyrAWohASAAIAI2AhwgAEEANgIUIABBADYCEEHwqAEoAgAiBEEBIAJ0IgZxRQRAQfCoASAEIAZyNgIAIAEgADYCACAAIAE2AhggACAANgIMIAAgADYCCA8LIAMgASgCACIBKAIEQXhxRgRAIAEhAgUCQCADQQBBGSACQQF2ayACQR9GG3QhBANAIAFBEGogBEEfdkECdGoiBigCACICBEAgBEEBdCEEIAMgAigCBEF4cUYNAiACIQEMAQsLIAYgADYCACAAIAE2AhggACAANgIMIAAgADYCCA8LCyACQQhqIgEoAgAiAyAANgIMIAEgADYCACAAIAM2AgggACACNgIMIABBADYCGAsHACAAELMBCzoAIABB0NMANgIAIABBABC0ASAAQRxqEJMCIAAoAiAQrQEgACgCJBCtASAAKAIwEK0BIAAoAjwQrQELTwEDfyAAQSBqIQMgAEEkaiEEIAAoAighAgNAIAIEQCADKAIAIAJBf2oiAkECdGooAgAaIAEgACAEKAIAIAJBAnRqKAIAQcUDEQEADAELCwsMACAAELMBIAAQ7QQLEwAgAEHg0wA2AgAgAEEEahCTAgsMACAAELYBIAAQ7QQLAwABCwQAIAALEAAgAEIANwMAIABCfzcDCAsQACAAQgA3AwAgAEJ/NwMIC6MBAQZ/ECAaIABBDGohBSAAQRBqIQZBACEEA0ACQCAEIAJODQAgBSgCACIDIAYoAgAiB0kEfyABIAMgAiAEayIIIAcgA2siAyAIIANIGyIDEMEBGiAFIAMgBSgCAGo2AgAgASADagUgACgCACgCKCEDIAAgA0E/cRECACIDQX9GDQEgASADECI6AABBASEDIAFBAWoLIQEgAyAEaiEEDAELCyAECwQAECALPgEBfyAAKAIAKAIkIQEgACABQT9xEQIAECBGBH8QIAUgAEEMaiIBKAIAIQAgASAAQQFqNgIAIAAsAAAQJAsLBAAQIAumAQEHfxAgIQcgAEEYaiEFIABBHGohCEEAIQQDQAJAIAQgAk4NACAFKAIAIgYgCCgCACIDSQR/IAYgASACIARrIgkgAyAGayIDIAkgA0gbIgMQwQEaIAUgAyAFKAIAajYCACADIARqIQQgASADagUgACgCACgCNCEDIAAgASwAABAkIANBD3FBQGsRAwAgB0YNASAEQQFqIQQgAUEBagshAQwBCwsgBAsTACACBEAgACABIAIQoQUaCyAACxMAIABBoNQANgIAIABBBGoQkwILDAAgABDCASAAEO0EC6wBAQZ/ECAaIABBDGohBSAAQRBqIQZBACEEA0ACQCAEIAJODQAgBSgCACIDIAYoAgAiB0kEfyABIAMgAiAEayIIIAcgA2tBAnUiAyAIIANIGyIDEMkBGiAFIAUoAgAgA0ECdGo2AgAgA0ECdCABagUgACgCACgCKCEDIAAgA0E/cRECACIDQX9GDQEgASADEDw2AgBBASEDIAFBBGoLIQEgAyAEaiEEDAELCyAECwQAECALPgEBfyAAKAIAKAIkIQEgACABQT9xEQIAECBGBH8QIAUgAEEMaiIBKAIAIQAgASAAQQRqNgIAIAAoAgAQPAsLBAAQIAuvAQEHfxAgIQcgAEEYaiEFIABBHGohCEEAIQQDQAJAIAQgAk4NACAFKAIAIgYgCCgCACIDSQR/IAYgASACIARrIgkgAyAGa0ECdSIDIAkgA0gbIgMQyQEaIAUgBSgCACADQQJ0ajYCACADIARqIQQgA0ECdCABagUgACgCACgCNCEDIAAgASgCABA8IANBD3FBQGsRAwAgB0YNASAEQQFqIQQgAUEEagshAQwBCwsgBAsWACACBH8gACABIAIQkgEaIAAFIAALCxMAIABBgNUAELgBIABBCGoQsgELDAAgABDKASAAEO0ECxMAIAAgACgCAEF0aigCAGoQygELEwAgACAAKAIAQXRqKAIAahDLAQsTACAAQbDVABC4ASAAQQhqELIBCwwAIAAQzgEgABDtBAsTACAAIAAoAgBBdGooAgBqEM4BCxMAIAAgACgCAEF0aigCAGoQzwELEwAgAEHg1QAQuAEgAEEEahCyAQsMACAAENIBIAAQ7QQLEwAgACAAKAIAQXRqKAIAahDSAQsTACAAIAAoAgBBdGooAgBqENMB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IARBADYCACAHQYABaiIIIAMQ2wEgCEH0tAEQkgIhCSAIEJMCAn8CQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQCAGQRh0QRh1QSVrDlUWFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXAAEXBBcFFwYHFxcXChcXFxcODxAXFxcTFRcXFxcXFxcAAQIDAxcXARcIFxcJCxcMFw0XCxcXERIUFwsgDCACKAIANgIAIAggDCgCADYCACAAIAVBGGogASAIIAQgCRD8AgwXCyANIAIoAgA2AgAgCCANKAIANgIAIAAgBUEQaiABIAggBCAJEP0CDBYLIABBCGoiBigCACgCDCELIAYgC0E/cRECACEGIA4gASgCADYCACAPIAIoAgA2AgAgBigCACAGIAYsAAsiAkEASCILGyIJIAYoAgQgAkH/AXEgCxtqIQIgCiAOKAIANgIAIAggDygCADYCACABIAAgCiAIIAMgBCAFIAkgAhD+AjYCAAwVCyAQIAIoAgA2AgAgCCAQKAIANgIAIAAgBUEMaiABIAggBCAJEP8CDBQLIBEgASgCADYCACASIAIoAgA2AgAgCiARKAIANgIAIAggEigCADYCACABIAAgCiAIIAMgBCAFQcH5AEHJ+QAQ/gI2AgAMEwsgEyABKAIANgIAIBQgAigCADYCACAKIBMoAgA2AgAgCCAUKAIANgIAIAEgACAKIAggAyAEIAVByfkAQdH5ABD+AjYCAAwSCyAVIAIoAgA2AgAgCCAVKAIANgIAIAAgBUEIaiABIAggBCAJEIADDBELIBYgAigCADYCACAIIBYoAgA2AgAgACAFQQhqIAEgCCAEIAkQgQMMEAsgFyACKAIANgIAIAggFygCADYCACAAIAVBHGogASAIIAQgCRCCAwwPCyAYIAIoAgA2AgAgCCAYKAIANgIAIAAgBUEQaiABIAggBCAJEIMDDA4LIBkgAigCADYCACAIIBkoAgA2AgAgACAFQQRqIAEgCCAEIAkQhAMMDQsgGiACKAIANgIAIAggGigCADYCACAAIAEgCCAEIAkQhQMMDAsgGyACKAIANgIAIAggGygCADYCACAAIAVBCGogASAIIAQgCRCGAwwLCyAcIAEoAgA2AgAgHSACKAIANgIAIAogHCgCADYCACAI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NgIAIBQgAigCADYCACAKIBMoAgA2AgAgCCAUKAIANgIAIAEgACAKIAggAyAEIAVBsMAAQdDAABCgAzYCAAwSCyAVIAIoAgA2AgAgCCAVKAIANgIAIAAgBUEIaiABIAggBCAJEKIDDBELIBYgAigCADYCACAIIBYoAgA2AgAgACAFQQhqIAEgCCAEIAkQowMMEAsgFyACKAIANgIAIAggFygCADYCACAAIAVBHGogASAIIAQgCRCkAwwPCyAYIAIoAgA2AgAgCCAYKAIANgIAIAAgBUEQaiABIAggBCAJEKUDDA4LIBkgAigCADYCACAIIBkoAgA2AgAgACAFQQRqIAEgCCAEIAkQpgMMDQsgGiACKAIANgIAIAggGigCADYCACAAIAEgCCAEIAkQpwMMDAsgGyACKAIANgIAIAggGygCADYCACAAIAVBCGogASAIIAQgCRCoAwwLCyAcIAEoAgA2AgAgHSACKAIANgIAIAogHCgCADYCACAIIB0oAgA2AgAgASAAIAogCCADIAQgBUHQwABB/MAAEKADNgIADAoLIB4gASgCADYCACAfIAIoAgA2AgAgCiAeKAIANgIAIAggHygCADYCACABIAAgCiAIIAMgBCAFQYDBAEGUwQAQoAM2AgAMCQsgICACKAIANgIAIAggICgCADYCACAAIAUgASAIIAQgCRCpAwwICyAhIAEoAgA2AgAgIiACKAIANgIAIAogISgCADYCACAIICIoAgA2AgAgASAAIAogCCADIAQgBUGgwQBBwMEAEKADNgIADAcLICMgAigCADYCACAIICMoAgA2AgAgACAFQRhqIAEgCCAEIAkQqgMMBgsgACgCACgCFCEGICQgASgCADYCACAlIAIoAgA2AgAgCiAkKAIANgIAIAggJSgCADYCACAAIAogCCADIAQgBSAGQT9xQaQBahEIAAwGCyAAQQhqIgYoAgAoAhghCyAGIAtBP3ERAgAhBiAmIAEoAgA2AgAgJyACKAIANgIAIAYoAgAgBiAGLAALIgtBAEgiCRshAiAGKAIEIAtB/wFxIAkbQQJ0IAJqIQYgCiAmKAIANgIAIAggJygCADYCACABIAAgCiAIIAMgBCAFIAIgBhCgAzYCAAwECyAoIAIoAgA2AgAgCCAoKAIANgIAIAAgBUEUaiABIAggBCAJEKsDDAMLICkgAigC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IAVBC2oiACwAAEEASAR/IAUoAgAhACALQQA6AAAgACALEP8BIAVBADYCBCAFBSALQQA6AAAgBSALEP8BIABBADoAACAFCyEAIAVBABD3BCAAIAopAgA3AgAgACAKKAIINgIIQQAhAANAIABBA0cEQCAAQQJ0IApqQQA2AgAgAEEBaiEADAELCyAKEPMEIAEoAgAoAhghACAKIAEgAEE/cUGFA2oRBAAgBkELaiIALAAAQQBIBEAgBigCACEAIAtBADYCACAAIAsQhQIgBkEANgIEBSALQQA2AgAgBiALEIUCIABBADoAAAsgBkEAEIQFIAYgCikCADcCACAGIAooAgg2AghBACEAA0AgAEEDRwRAIABBAnQgCmpBADYCACAAQQFqIQAMAQsLIAoQ8wQgASgCACgCJCEAIAEgAEE/cRECAAUgAUHktgEQkgIiASgCACgCLCEAIAsgASAAQT9xQYUDahEEACACIAsoAgA2AAAgASgCACgCICEAIAogASAAQT9xQYUDahEEACAIQQtqIgAsAABBAEgEQCAIKAIAIQAgC0EANgIAIAAgCxCFAiAIQQA2AgQFIAtBADYCACAIIAsQhQIgAEEAOgAACyAIQQAQhAUgCCAKKQIANwIAIAggCigCCDYCCEEAIQADQCAAQQNHBEAgAEECdCAKakEANgIAIABBAWohAAwBCwsgChDzBCABKAIAKAIcIQAgCiABIABBP3FBhQNqEQQAIAdBC2oiACwAAEEASARAIAcoAgAhACALQQA2AgAgACALEIUCIAdBADYCBAUgC0EANgIAIAcgCxCFAiAAQQA6AAALIAdBABCEBSAHIAopAgA3AgAgByAKKAIINgIIQQAhAANAIABBA0cEQCAAQQJ0IApqQQA2AgAgAEEBaiEADAELCyAKEPMEIAEoAgAoAgwhACADIAEgAEE/cRECADYCACABKAIAKAIQIQAgBCABIABBP3ERAgA2AgAgASgCACgCFCEAIAogASAAQT9xQYUDahEEACAFQQtqIgAsAABBAEgEfyAFKAIAIQAgC0EAOgAAIAAgCxD/ASAFQQA2AgQgBQUgC0EAOgAAIAUgCxD/ASAAQQA6AAAgBQshACAFQQAQ9wQgACAKKQIANwIAIAAgCigCCDYCCEEAIQADQCAAQQNHBEAgAEECdCAKakEANgIAIABBAWohAAwB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CyAJIAAEfyACQey2ARCSAiECIAEEQCACKAIAKAIsIQAgCiACIABBP3FBhQNqEQQAIAMgCigCADYAACACKAIAKAIgIQAgCyACIABBP3FBhQNqEQQAIAhBC2oiACwAAEEASARAIAgoAgAhACAKQQA2AgAgACAKEIUCIAhBADYCBAUgCkEANgIAIAggChCFAiAAQQA6AAALIAhBABCEBSAIIAspAgA3AgAgCCALKAIINgIIQQAhAANAIABBA0cEQCAAQQJ0IAtqQQA2AgAgAEEBaiEADAELCyALEPMEBSACKAIAKAIoIQAgCiACIABBP3FBhQNqEQQAIAMgCigCADYAACACKAIAKAIcIQAgCyACIABBP3FBhQNqEQQAIAhBC2oiACwAAEEASARAIAgoAgAhACAKQQA2AgAgACAKEIUCIAhBADYCBAUgCkEANgIAIAggChCFAiAAQQA6AAALIAhBABCEBSAIIAspAgA3AgAgCCALKAIINgIIQQAhAANAIABBA0cEQCAAQQJ0IAtqQQA2AgAgAEEBaiEADAELCyALEPMECyACKAIAKAIMIQAgBCACIABBP3ERAgA2AgAgAigCACgCECEAIAUgAiAAQT9xEQIANgIAIAIoAgAoAhQhACALIAIgAEE/cUGFA2oRBAAgBkELaiIALAAAQQBIBH8gBigCACEAIApBADoAACAAIAoQ/wEgBkEANgIEIAYFIApBADoAACAGIAoQ/wEgAEEAOgAAIAYLIQAgBkEAEPcEIAAgCykCADcCACAAIAsoAgg2AghBACEAA0AgAEEDRwRAIABBAnQgC2pBADYCACAAQQFqIQAMAQsLIAsQ8wQgAigCACgCGCEAIAsgAiAAQT9xQYUDahEEACAHQQtqIgAsAABBAEgEQCAHKAIAIQAgCkEANgIAIAAgChCFAiAHQQA2AgQFIApBADYCACAHIAoQhQIgAEEAOgAACyAHQQAQhAUgByALKQIANwIAIAcgCygCCDYCCEEAIQADQCAAQQNHBEAgAEECdCALakEANgIAIABBAWohAAwBCwsgCxDzBCACKAIAKAIkIQAgAiAAQT9xEQIABSACQeS2ARCSAiECIAEEQCACKAIAKAIsIQAgCiACIABBP3FBhQNqEQQAIAMgCigCADYAACACKAIAKAIgIQAgCyACIABBP3FBhQNqEQQAIAhBC2oi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IAAgASACakhxBEAgACEDIAEgAmohASAAIAJqIQADQCACQQBKBEAgAkEBayECIABBAWsiACABQQFrIgEsAAA6AAAMAQsLIAMhAAUgACABIAIQoQUaCyAAC5gCAQR/IAAgAmohBCABQf8BcSEBIAJBwwBOBEADQCAAQQNxBEAgACABOgAAIABBAWohAAwBCwsgBEF8cSIFQUBqIQYgAUEIdCABciABQRB0ciABQRh0ciEDA0AgACAGTARAIAAgAzYCACAAIAM2AgQgACADNgIIIAAgAzYCDCAAIAM2AhAgACADNgIUIAAgAzYCGCAAIAM2AhwgACADNgIgIAAgAzYCJCAAIAM2AiggACADNgIsIAAgAzYCMCAAIAM2AjQgACADNgI4IAAgAzYCPCAAQUBrIQAMAQsLA0AgACAFSARAIAAgAzYCACAAQQRqIQAMAQsLCwNAIAAgBEgEQCAAIAE6AAAgAEEBaiEADAELCyAEIAJrC00BAn8gACMEKAIAIgJqIgEgAkggAEEASnEgAUEASHIEQBADGkEMEAZBfw8LIAEQD0wEQCMEIAE2AgAFIAEQEUUEQEEMEAZBfw8LCyACCwwAIAEgAEE/cRECAAsRACABIAIgAEEPcUFAaxEDAAsUACABIAIgAyAAQR9xQdAAahEAAAsWACABIAIgAyAEIABBB3FB8ABqEQkACxgAIAEgAiADIAQgBSAAQQdxQfgAahEOAAsYACABIAIgAyAEIAUgAEEfcUGAAWoRBQALGgAgASACIAMgBCAFIAYgAEEDcUGgAWoRDwALGgAgASACIAMgBCAFIAYgAEE/cUGkAWoRCAALHAAgASACIAMgBCAFIAYgByAAQQdxQeQBahEQAAseACABIAIgAyAEIAUgBiAHIAggAEEPcUHsAWoRBgALGAAgASACIAMgBCAFIABBB3FB/AFqEREACwgAQYQCEQoACxEAIAEgAEH/AHFBhQJqEQcACxIAIAEgAiAAQT9xQYUDahEEAAsOACABIAIgA0HFAxEBAAsWACABIAIgAyAEIABBB3FBxgNqEQsACxgAIAEgAiADIAQgBSAAQQNxQc4DahENAAsaACABIAIgAyAEIAUgBiAAQQdxQdIDahEMAAsYACABIAIgAyAEIAUgAEEDcUHaA2oREgALCABBABACQQALCABBARACQQALCABBAhACQQALCABBAxACQQALCABBBBACQQALCABBBRACQQALCABBBhACQQALCABBBxACQQALCABBCBACQQALCABBCRACQQALCABBChACQQALBgBBCxACCwYAQQwQAgsGAEENEAILBgBBDhACCwYAQQ8QAgsGAEEQEAILBgBBERACCwYAQRIQAgsZACAAIAEgAiADIAQgBa0gBq1CIIaEEK8FCxkAIAAgASACIAOtIAStQiCGhCAFIAYQtwULC5ZkMwBBhggLCvA/AAAAAAAA8D8AQZ4ICwLwPwBBtggLAvA/AEHWCAveAfA/SSr4Es/+3z9ag/dVuVC7P6Vp7QlU94c/2bKFqtSIQj8AAAAAAADwP5V3H5EA/98/YsFYOnpXvD+1XRVmqQ6MP9vKkoqUV08/b6ZFwQ7l/z4AAAAAAADwP9invFQAAOA/QQt/oeUUvT9KrDhDPv6OPw5bic+Kn1Q/IMxOItJvED/sJiM9rdy4PgAAAAAAAPA/i+pfQsX83z+R9bAJpoK9P7p6GIutYZA/j5ttttDMVz+Jlc0u/84WPy6+kbLu9co+7F13RnKubj7eEgSVAAAAAP///////////////wBBwAoLzAECAADAAwAAwAQAAMAFAADABgAAwAcAAMAIAADACQAAwAoAAMALAADADAAAwA0AAMAOAADADwAAwBAAAMARAADAEgAAwBMAAMAUAADAFQAAwBYAAMAXAADAGAAAwBkAAMAaAADAGwAAwBwAAMAdAADAHgAAwB8AAMAAAACzAQAAwwIAAMMDAADDBAAAwwUAAMMGAADDBwAAwwgAAMMJAADDCgAAwwsAAMMMAADDDQAA0w4AAMMPAADDAAAMuwEADMMCAAzDAwAMwwQADNMAQZQQC/kDAQAAAAIAAAADAAAABAAAAAUAAAAGAAAABwAAAAgAAAAJAAAACgAAAAsAAAAMAAAADQAAAA4AAAAPAAAAEAAAABEAAAASAAAAEwAAABQAAAAVAAAAFgAAABcAAAAYAAAAGQAAABoAAAAbAAAAHAAAAB0AAAAeAAAAHwAAACAAAAAhAAAAIgAAACMAAAAkAAAAJQAAACYAAAAnAAAAKAAAACkAAAAqAAAAKwAAACwAAAAtAAAALgAAAC8AAAAwAAAAMQAAADIAAAAzAAAANAAAADUAAAA2AAAANwAAADgAAAA5AAAAOgAAADsAAAA8AAAAPQAAAD4AAAA/AAAAQAAAAGEAAABiAAAAYwAAAGQAAABlAAAAZgAAAGcAAABoAAAAaQAAAGoAAABrAAAAbAAAAG0AAABuAAAAbwAAAHAAAABxAAAAcgAAAHMAAAB0AAAAdQAAAHYAAAB3AAAAeAAAAHkAAAB6AAAAWwAAAFwAAABdAAAAXgAAAF8AAABgAAAAYQAAAGIAAABjAAAAZAAAAGUAAABmAAAAZwAAAGgAAABpAAAAagAAAGsAAABsAAAAbQAAAG4AAABvAAAAcAAAAHEAAAByAAAAcwAAAHQAAAB1AAAAdgAAAHcAAAB4AAAAeQAAAHoAAAB7AAAAfAAAAH0AAAB+AAAAfwBBkBoL/wECAAIAAgACAAIAAgACAAIAAgADIAIgAiACIAIgAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAWAEwATABMAEwATABMAEwATABMAEwATABMAEwATABMAI2AjYCNgI2AjYCNgI2AjYCNgI2ATABMAEwATABMAEwATACNUI1QjVCNUI1QjVCMUIxQjFCMUIxQjFCMUIxQjFCMUIxQjFCMUIxQjFCMUIxQjFCMUIxQTABMAEwATABMAEwAjWCNYI1gjWCNYI1gjGCMYIxgjGCMYIxgjGCMYIxgjGCMYIxgjGCMYIxgjGCMYIxgjGCMYEwATABMAEwAIAQZQiC/kDAQAAAAIAAAADAAAABAAAAAUAAAAGAAAABwAAAAgAAAAJAAAACgAAAAsAAAAMAAAADQAAAA4AAAAPAAAAEAAAABEAAAASAAAAEwAAABQAAAAVAAAAFgAAABcAAAAYAAAAGQAAABoAAAAbAAAAHAAAAB0AAAAeAAAAHwAAACAAAAAhAAAAIgAAACMAAAAkAAAAJQAAACYAAAAnAAAAKAAAACkAAAAqAAAAKwAAACwAAAAtAAAALgAAAC8AAAAwAAAAMQAAADIAAAAzAAAANAAAADUAAAA2AAAANwAAADgAAAA5AAAAOgAAADsAAAA8AAAAPQAAAD4AAAA/AAAAQAAAAEEAAABCAAAAQwAAAEQAAABFAAAARgAAAEcAAABIAAAASQAAAEoAAABLAAAATAAAAE0AAABOAAAATwAAAFAAAABRAAAAUgAAAFMAAABUAAAAVQAAAFYAAABXAAAAWAAAAFkAAABaAAAAWwAAAFwAAABdAAAAXgAAAF8AAABgAAAAQQAAAEIAAABDAAAARAAAAEUAAABGAAAARwAAAEgAAABJAAAASgAAAEsAAABMAAAATQAAAE4AAABPAAAAUAAAAFEAAABSAAAAUwAAAFQAAABVAAAAVgAAAFcAAABYAAAAWQAAAFoAAAB7AAAAfAAAAH0AAAB+AAAAfwBBkCoLoQIKAAAAZAAAAOgDAAAQJwAAoIYBAEBCDwCAlpgAAOH1Bf////////////////////////////////////////////////////////////////8AAQIDBAUGBwgJ/////////woLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIj////////CgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiP/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AEHALAsYEQAKABEREQAAAAAFAAAAAAAACQAAAAALAEHgLAshEQAPChEREQMKBwABEwkLCwAACQYLAAALAAYRAAAAERERAEGRLQsBCwBBmi0LGBEACgoREREACgAAAgAJCwAAAAkACwAACwBByy0LAQwAQdctCxUMAAAAAAwAAAAACQwAAAAAAAwAAAwAQYUuCwEOAEGRLgsVDQAAAAQNAAAAAAkOAAAAAAAOAAAOAEG/LgsBEABByy4LHg8AAAAADwAAAAAJEAAAAAAAEAAAEAAAEgAAABISEgBBgi8LDhIAAAASEhIAAAAAAAAJAEGzLwsBCwBBvy8LFQoAAAAACgAAAAAJCwAAAAAACwAACwBB7S8LAQwAQfkvC34MAAAAAAwAAAAACQwAAAAAAAwAAAwAADAxMjM0NTY3ODlBQkNERUZUISIZDQECAxFLHAwQBAsdEh4naG5vcHFiIAUGDxMUFRoIFgcoJBcYCQoOGx8lI4OCfSYqKzw9Pj9DR0pNWFlaW1xdXl9gYWNkZWZnaWprbHJzdHl6e3wAQYAxC9cOSWxsZWdhbCBieXRlIHNlcXVlbmNlAERvbWFpbiBlcnJvcgBSZXN1bHQgbm90IHJlcHJlc2VudGFibGUATm90IGEgdHR5AFBlcm1pc3Npb24gZGVuaWVkAE9wZXJhdGlvbiBub3QgcGVybWl0dGVkAE5vIHN1Y2ggZmlsZSBvciBkaXJlY3RvcnkATm8gc3VjaCBwcm9jZXNzAEZpbGUgZXhpc3RzAFZhbHVlIHRvbyBsYXJnZSBmb3IgZGF0YSB0eXBlAE5vIHNwYWNlIGxlZnQgb24gZGV2aWNlAE91dCBvZiBtZW1vcnkAUmVzb3VyY2UgYnVzeQBJbnRlcnJ1cHRlZCBzeXN0ZW0gY2FsbABSZXNvdXJjZSB0ZW1wb3JhcmlseSB1bmF2YWlsYWJsZQBJbnZhbGlkIHNlZWsAQ3Jvc3MtZGV2aWNlIGxpbmsAUmVhZC1vbmx5IGZpbGUgc3lzdGVtAERpcmVjdG9yeSBub3QgZW1wdHkAQ29ubmVjdGlvbiByZXNldCBieSBwZWVyAE9wZXJhdGlvbiB0aW1lZCBvdXQAQ29ubmVjdGlvbiByZWZ1c2VkAEhvc3QgaXMgZG93bgBIb3N0IGlzIHVucmVhY2hhYmxlAEFkZHJlc3MgaW4gdXNlAEJyb2tlbiBwaXBlAEkvTyBlcnJvcgBObyBzdWNoIGRldmljZSBvciBhZGRyZXNzAEJsb2NrIGRldmljZSByZXF1aXJlZABObyBzdWNoIGRldmljZQBOb3QgYSBkaXJlY3RvcnkASXMgYSBkaXJlY3RvcnkAVGV4dCBmaWxlIGJ1c3kARXhlYyBmb3JtYXQgZXJyb3IASW52YWxpZCBhcmd1bWVudABBcmd1bWVudCBsaXN0IHRvbyBsb25nAFN5bWJvbGljIGxpbmsgbG9vcABGaWxlbmFtZSB0b28gbG9uZwBUb28gbWFueSBvcGVuIGZpbGVzIGluIHN5c3RlbQBObyBmaWxlIGRlc2NyaXB0b3JzIGF2YWlsYWJsZQBCYWQgZmlsZSBkZXNjcmlwdG9yAE5vIGNoaWxkIHByb2Nlc3MAQmFkIGFkZHJlc3MARmlsZSB0b28gbGFyZ2UAVG9vIG1hbnkgbGlua3MATm8gbG9ja3MgYXZhaWxhYmxlAFJlc291cmNlIGRlYWRsb2NrIHdvdWxkIG9jY3VyAFN0YXRlIG5vdCByZWNvdmVyYWJsZQBQcmV2aW91cyBvd25lciBkaWVkAE9wZXJhdGlvbiBjYW5jZWxlZABGdW5jdGlvbiBub3QgaW1wbGVtZW50ZWQATm8gbWVzc2FnZSBvZiBkZXNpcmVkIHR5cGUASWRlbnRpZmllciByZW1vdmVkAERldmljZSBub3QgYSBzdHJlYW0ATm8gZGF0YSBhdmFpbGFibGUARGV2aWNlIHRpbWVvdXQAT3V0IG9mIHN0cmVhbXMgcmVzb3VyY2VzAExpbmsgaGFzIGJlZW4gc2V2ZXJlZABQcm90b2NvbCBlcnJvcgBCYWQgbWVzc2FnZQBGaWxlIGRlc2NyaXB0b3IgaW4gYmFkIHN0YXRlAE5vdCBhIHNvY2tldABEZXN0aW5hdGlvbiBhZGRyZXNzIHJlcXVpcmVkAE1lc3NhZ2UgdG9vIGxhcmdlAFByb3RvY29sIHdyb25nIHR5cGUgZm9yIHNvY2tldABQcm90b2NvbCBub3QgYXZhaWxhYmxlAFByb3RvY29sIG5vdCBzdXBwb3J0ZWQAU29ja2V0IHR5cGUgbm90IHN1cHBvcnRlZABOb3Qgc3VwcG9ydGVkAFByb3RvY29sIGZhbWlseSBub3Qgc3VwcG9ydGVkAEFkZHJlc3MgZmFtaWx5IG5vdCBzdXBwb3J0ZWQgYnkgcHJvdG9jb2wAQWRkcmVzcyBub3QgYXZhaWxhYmxlAE5ldHdvcmsgaXMgZG93bgBOZXR3b3JrIHVucmVhY2hhYmxlAENvbm5lY3Rpb24gcmVzZXQgYnkgbmV0d29yawBDb25uZWN0aW9uIGFib3J0ZWQATm8gYnVmZmVyIHNwYWNlIGF2YWlsYWJsZQBTb2NrZXQgaXMgY29ubmVjdGVkAFNvY2tldCBub3QgY29ubmVjdGVkAENhbm5vdCBzZW5kIGFmdGVyIHNvY2tldCBzaHV0ZG93bgBPcGVyYXRpb24gYWxyZWFkeSBpbiBwcm9ncmVzcwBPcGVyYXRpb24gaW4gcHJvZ3Jlc3MAU3RhbGUgZmlsZSBoYW5kbGUAUmVtb3RlIEkvTyBlcnJvcgBRdW90YSBleGNlZWRlZABObyBtZWRpdW0gZm91bmQAV3JvbmcgbWVkaXVtIHR5cGUATm8gZXJyb3IgaW5mb3JtYXRpb24AAAAAAABMQ19DVFlQRQAAAABMQ19OVU1FUklDAABMQ19USU1FAAAAAABM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biB0aGUgcmFnZSBvZiA0IHRvIDchCgBDYW5ub3QgYWxsb2NhdGUgbWVtb3J5IQoAaW5maW5pdHkAAAECBAcDBgUALSsgICAwWDB4AChudWxsKQAtMFgrMFggMFgtMHgrMHggMHgAaW5mAElORgBuYW4ATkFOAC4ATENfQUxMAExBTkcAQy5VVEYtOABQT1NJWABNVVNMX0xPQ1BBVEgATlN0M19fMjhpb3NfYmFzZUUATlN0M19fMjliYXNpY19pb3NJY05TXzExY2hhcl90cmFpdHNJY0VFRUUATlN0M19fMjliYXNpY19pb3NJd05TXzExY2hhcl90cmFpdHNJd0VFRUUATlN0M19fMjE1YmFzaWNfc3RyZWFtYnVmSWNOU18xMWNoYXJfdHJhaXRzSWNFRUVFAE5TdDNfXzIxNWJhc2ljX3N0cmVhbWJ1Zkl3TlNfMTFjaGFyX3RyYWl0c0l3RUVFRQBOU3QzX18yMTNiYXNpY19pc3RyZWFtSWNOU18xMWNoYXJfdHJhaXRzSWNFRUVFAE5TdDNfXzIxM2Jhc2ljX2lzdHJlYW1Jd05TXzExY2hhcl90cmFpdHNJd0VFRUUATlN0M19fMjEzYmFzaWNfb3N0cmVhbUljTlNfMTFjaGFyX3RyYWl0c0ljRUVFRQBOU3QzX18yMTNiYXNpY19vc3RyZWFtSXdOU18xMWNoYXJfdHJhaXRzSXdFRUVFAE5TdDNfXzIxMV9fc3Rkb3V0YnVmSXdFRQBOU3QzX18yMTFfX3N0ZG91dGJ1ZkljRUUAdW5zdXBwb3J0ZWQgbG9jYWxlIGZvciBzdGFuZGFyZCBpbnB1dABOU3QzX18yMTBfX3N0ZGluYnVmSXdFRQBOU3QzX18yMTBfX3N0ZGluYnVmSWNFRQBOU3QzX18yN2NvbGxhdGVJY0VFAE5TdDNfXzI2bG9jYWxlNWZhY2V0RQBOU3QzX18yN2NvbGxhdGVJd0VFACVwAEMATlN0M19fMjdudW1fZ2V0SWNOU18xOWlzdHJlYW1idWZfaXRlcmF0b3JJY05TXzExY2hhcl90cmFpdHNJY0VFRUVFRQBOU3QzX18yOV9fbnVtX2dldEljRUUATlN0M19fMjE0X19udW1fZ2V0X2Jhc2VFAE5TdDNfXzI3bnVtX2dldEl3TlNfMTlpc3RyZWFtYnVmX2l0ZXJhdG9ySXdOU18xMWNoYXJfdHJhaXRzSXdFRUVFRUUATlN0M19fMjlfX251bV9nZXRJd0VFACVwAAAAAEwAbGwAJQAAAAAAbABOU3QzX18yN251bV9wdXRJY05TXzE5b3N0cmVhbWJ1Zl9pdGVyYXRvckljTlNfMTFjaGFyX3RyYWl0c0ljRUVFRUVFAE5TdDNfXzI5X19udW1fcHV0SWNFRQBOU3QzX18yMTRfX251bV9wdXRfYmFzZUUATlN0M19fMjdudW1fcHV0SXdOU18xOW9zdHJlYW1idWZfaXRlcmF0b3JJd05TXzExY2hhcl90cmFpdHNJd0VFRUVFRQBOU3QzX18yOV9fbnVtX3B1dEl3RUUAJUg6JU06JVMAJW0vJWQvJXkAJUk6JU06JVMgJXAAJWEgJWIgJWQgJUg6JU06JVMgJVkAQU0AUE0ASmFudWFyeQBGZWJydWFyeQBNYXJjaABBcHJpbABNYXkASnVuZQBKdWx5AEF1Z3VzdABTZXB0ZW1iZXIAT2N0b2JlcgBOb3ZlbWJlcgBEZWNlbWJlcgBKYW4ARmViAE1hcgBBcHIASnVuAEp1bABBdWcAU2VwAE9jdABOb3YARGVjAFN1bmRheQBNb25kYXkAVHVlc2RheQBXZWRuZXNkYXkAVGh1cnNkYXkARnJpZGF5AFNhdHVyZGF5AFN1bgBNb24AVHVlAFdlZABUaHUARnJpAFNhdAAlbS8lZC8leSVZLSVtLSVkJUk6JU06JVMgJXAlSDolTSVIOiVNOiVTJUg6JU06JVNOU3QzX18yOHRpbWVfZ2V0SWNOU18xOWlzdHJlYW1idWZfaXRlcmF0b3JJY05TXzExY2hhcl90cmFpdHNJY0VFRUVFRQBOU3QzX18yMjBfX3RpbWVfZ2V0X2Nfc3RvcmFnZUljRUUATlN0M19fMjl0aW1lX2Jhc2VFAE5TdDNfXzI4dGltZV9nZXRJd05TXzE5aXN0cmVhbWJ1Zl9pdGVyYXRvckl3TlNfMTFjaGFyX3RyYWl0c0l3RUVFRUVFAE5TdDNfXzIyMF9fdGltZV9nZXRfY19zdG9yYWdlSXdFRQBOU3QzX18yOHRpbWVfcHV0SWNOU18xOW9zdHJlYW1idWZfaXRlcmF0b3JJY05TXzExY2hhcl90cmFpdHNJY0VFRUVFRQBOU3QzX18yMTBfX3RpbWVfcHV0RQBOU3QzX18yOHRpbWVfcHV0SXdOU18xOW9zdHJlYW1idWZfaXRlcmF0b3JJd05TXzExY2hhcl90cmFpdHNJd0VFRUVFRQBOU3QzX18yMTBtb25leXB1bmN0SWNMYjBFRUUATlN0M19fMjEwbW9uZXlfYmFzZUUATlN0M19fMjEwbW9uZXlwdW5jdEljTGIxRUVFAE5TdDNfXzIxMG1vbmV5cHVuY3RJd0xiMEVFRQBOU3QzX18yMTBtb25leXB1bmN0SXdMYjFFRUUAMDEyMzQ1Njc4OQAlTGYATlN0M19fMjltb25leV9nZXRJY05TXzE5aXN0cmVhbWJ1Zl9pdGVyYXRvckljTlNfMTFjaGFyX3RyYWl0c0ljRUVFRUVFAE5TdDNfXzIxMV9fbW9uZXlfZ2V0SWNFRQAwMTIzNDU2Nzg5AE5TdDNfXzI5bW9uZXlfZ2V0SXdOU18xOWlzdHJlYW1idWZfaXRlcmF0b3JJd05TXzExY2hhcl90cmFpdHNJd0VFRUVFRQBOU3QzX18yMTFfX21vbmV5X2dldEl3RUUAJS4wTGYATlN0M19fMjltb25leV9wdXRJY05TXzE5b3N0cmVhbWJ1Zl9pdGVyYXRvckljTlNfMTFjaGFyX3RyYWl0c0ljRUVFRUVFAE5TdDNfXzIxMV9fbW9uZXlfcHV0SWNFRQBOU3QzX18yOW1vbmV5X3B1dEl3TlNfMTlvc3RyZWFtYnVmX2l0ZXJhdG9ySXdOU18xMWNoYXJfdHJhaXRzSXdFRUVFRUUATlN0M19fMjExX19tb25leV9wdXRJd0VFAE5TdDNfXzI4bWVzc2FnZXNJY0VFAE5TdDNfXzIxM21lc3NhZ2VzX2Jhc2VFAE5TdDNfXzIxN19fd2lkZW5fZnJvbV91dGY4SUxtMzJFRUUATlN0M19fMjdjb2RlY3Z0SURpYzExX19tYnN0YXRlX3RFRQBOU3QzX18yMTJjb2RlY3Z0X2Jhc2VFAE5TdDNfXzIxNl9fbmFycm93X3RvX3V0ZjhJTG0zMkVFRQBOU3QzX18yOG1lc3NhZ2VzSXdFRQBOU3QzX18yN2NvZGVjdnRJY2MxMV9fbWJzdGF0ZV90RUUATlN0M19fMjdjb2RlY3Z0SXdjMTFfX21ic3RhdGVfdEVFAE5TdDNfXzI3Y29kZWN2dElEc2MxMV9fbWJzdGF0ZV90RUUATlN0M19fMjZsb2NhbGU1X19pbXBFAE5TdDNfXzI1Y3R5cGVJY0VFAE5TdDNfXzIxMGN0eXBlX2Jhc2VFAE5TdDNfXzI1Y3R5cGVJd0VFAGZhbHNlAHRydWUATlN0M19fMjhudW1wdW5jdEljRUUATlN0M19fMjhudW1wdW5jdEl3RUUATlN0M19fMjE0X19zaGFyZWRfY291bnRFAE4xMF9fY3h4YWJpdjExNl9fc2hpbV90eXBlX2luZm9FAFN0OXR5cGVfaW5mbwBOMTBfX2N4eGFiaXYxMjBfX3NpX2NsYXNzX3R5cGVfaW5mb0UATjEwX19jeHhhYml2MTE3X19jbGFzc190eXBlX2luZm9FAE4xMF9fY3h4YWJpdjExOV9fcG9pbnRlcl90eXBlX2luZm9FAE4xMF9fY3h4YWJpdjExN19fcGJhc2VfdHlwZV9pbmZvRQBOMTBfX2N4eGFiaXYxMjFfX3ZtaV9jbGFzc190eXBlX2luZm9F';
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

   

   

   

  function _sendWav(
  ) {
  err('missing function: sendWav'); abort(-1);
  }

  
  
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

Module.asmLibraryArg = { "abort": abort, "assert": assert, "setTempRet0": setTempRet0, "getTempRet0": getTempRet0, "abortOnCannotGrowMemory": abortOnCannotGrowMemory, "__ZSt18uncaught_exceptionv": __ZSt18uncaught_exceptionv, "___cxa_find_matching_catch": ___cxa_find_matching_catch, "___cxa_free_exception": ___cxa_free_exception, "___gxx_personality_v0": ___gxx_personality_v0, "___lock": ___lock, "___map_file": ___map_file, "___resumeException": ___resumeException, "___setErrNo": ___setErrNo, "___syscall140": ___syscall140, "___syscall145": ___syscall145, "___syscall146": ___syscall146, "___syscall54": ___syscall54, "___syscall6": ___syscall6, "___syscall91": ___syscall91, "___unlock": ___unlock, "__addDays": __addDays, "__arraySum": __arraySum, "__exit": __exit, "__isLeapYear": __isLeapYear, "_abort": _abort, "_emscripten_get_heap_size": _emscripten_get_heap_size, "_emscripten_memcpy_big": _emscripten_memcpy_big, "_emscripten_resize_heap": _emscripten_resize_heap, "_exit": _exit, "_getenv": _getenv, "_llvm_stackrestore": _llvm_stackrestore, "_llvm_stacksave": _llvm_stacksave, "_pthread_cond_wait": _pthread_cond_wait, "_sendWav": _sendWav, "_strftime": _strftime, "_strftime_l": _strftime_l, "DYNAMICTOP_PTR": DYNAMICTOP_PTR, "tempDoublePtr": tempDoublePtr };
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



