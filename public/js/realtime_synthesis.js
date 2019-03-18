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




var wasmBinaryFile = 'data:application/octet-stream;base64,AGFzbQEAAAAB2QM3YAN/f38Bf2ADf39/AGABfwF/YAJ/fwF/YAJ/fwBgBX9/f39/AX9gCH9/f39/f39/AX9gAX8AYAZ/f39/f38Bf2AEf39/fwF/YAAAYAR/f39/AGAGf39/f39/AGAFf39/f38AYAV/f39/fAF/YAZ/f39/f3wBf2AHf39/f39/fwF/YAV/f39/fgF/YAV/f35/fwBgAXwBfGAAAX9gB39/f39/f38AYA5/f39/f3x/f39/f39/fwBgBH9/f3wAYAZ8f398f38BfGAFfH98f38BfGAFfH9/fH8BfGABfwF8YAN/f34AYAR/f39+AX5gA39/fwF8YAV/f39/fwF8YAZ/f39/f38BfGACf38BfmACfH8BfGACfHwBfGABfAF+YAN+f38Bf2ACfn8Bf2AGf3x/f39/AX9gA39/fwF+YAR/f39/AX5gAn9/AX1gAn9/AXxgA39/fwF9YAp/f39/f39/f39/AX9gDH9/f39/f39/f39/fwF/YAt/f39/f39/f39/fwF/YAp/f39/f39/f39/AGAPf39/f39/f39/f39/f39/AGAIf39/f39/f38AYAd/f39/f398AX9gCX9/f39/f39/fwF/YAZ/f39/f34Bf2AGf39/fn9/AALbBB8LZ2xvYmFsLk1hdGgDZXhwABMLZ2xvYmFsLk1hdGgDbG9nABMDZW52BWFib3J0AAcDZW52F2Fib3J0T25DYW5ub3RHcm93TWVtb3J5ABQDZW52B19fX2xvY2sABwNlbnYLX19fbWFwX2ZpbGUAAwNlbnYLX19fc2V0RXJyTm8ABwNlbnYNX19fc3lzY2FsbDE0MAADA2Vudg1fX19zeXNjYWxsMTQ1AAMDZW52DV9fX3N5c2NhbGwxNDYAAwNlbnYMX19fc3lzY2FsbDU0AAMDZW52C19fX3N5c2NhbGw2AAMDZW52DF9fX3N5c2NhbGw5MQADA2VudglfX191bmxvY2sABwNlbnYGX2Fib3J0AAoDZW52GV9lbXNjcmlwdGVuX2dldF9oZWFwX3NpemUAFANlbnYWX2Vtc2NyaXB0ZW5fbWVtY3B5X2JpZwAAA2VudhdfZW1zY3JpcHRlbl9yZXNpemVfaGVhcAACA2VudgVfZXhpdAAHA2VudgdfZ2V0ZW52AAIDZW52El9sbHZtX3N0YWNrcmVzdG9yZQAHA2Vudg9fbGx2bV9zdGFja3NhdmUAFANlbnYSX3B0aHJlYWRfY29uZF93YWl0AAMDZW52CF9zZW5kV2F2AAQDZW52C19zdHJmdGltZV9sAAUDZW52DF9fdGFibGVfYmFzZQN/AANlbnYORFlOQU1JQ1RPUF9QVFIDfwAGZ2xvYmFsA05hTgN8AAZnbG9iYWwISW5maW5pdHkDfAADZW52Bm1lbW9yeQIAgAIDZW52BXRhYmxlAXAB3gPeAwO2BbQFAgIUBwQEDRQDAgICAggVFgMCFBcYGRgaGBgaAhsbAgAAAhQCAAAUAgIUFBQCFAMCFAIACQcCAgADAAMUCgMCAgAAAAAEAgMcCQIdHh8gISIjIyIjJCMCAgAAAAAFAQIBJSYmAg0DJyIiAAMDCQkABwIDAAMDCh0JAgADAwICKAkpKSgDAwAJBSoeKyssHh4AAAAFAgcDAwMEBwcEBwcHBAASCwACAgMAAAcHAAICAwAABwcHBwcHBwcHBwcHBwcHBwQEAwcHCgoHAQEBAQQCAAMCBAADBAICAwMEAgIDAwcHBwULAAEEBwULAAEEBwgICAgICAgICAgIAwctFAkCAwcBBwcIDS4eCwgeCCwIAgABKQAICQgICQgpCAkQCAgICAgICAgICAgtCA0uCAgIAAEACAgICAgQBQURBREODgUFAAAJFQsVBQURBREODgUIFRUCCAgICAgGAgICAgICAgoKCgwMBgwMDAwMDA0MDAwMDA0FCAgICAgGAgICAgICAgIKCgoMDAYMDAwMDAwNDAwMDAwNBQcHEAwDBxAMAwcCBAQEAgQQEC8AADABARAQLwAwDwgwMQ8IMDEADAwGBgUFAgUGBgYFBgYFAgUCBwcGBgUFBgYHBwcHBwMAAwADCQAFFBQUBwcCAgQEBAcHAgIEBAQACQkJAwADAAMJAAUHBwsEBAoECgQKBAoECgQKBAoECgQKBAoECgQKBAoECgQKBAoECgQKBAoECgQKBAoECgQKBAoECgQKBAoEAQQEBAILBAQHBAQEBBQUChQEFAcBCgIHBwQBAQAHAAAyBAMBABUABAEBAAAAMgQDFQAEBwAMDQsACwsNCQwNCwwNCwsMDQIUAAICAAAAAgMACQUPCDMQBjQ1BwQBCw0MFTYCAwAJDgUPCBAGEQoHBAELDQwSEBUGKQd/ASMBC38BQQALfwFBAAt8ASMCC3wBIwMLfwFBsMIBC38BQbDCwQILB8QFKRBfX2dyb3dXYXNtTWVtb3J5ABkSX19HTE9CQUxfX0lfMDAwMTAxAN8BHF9fR0xPQkFMX19zdWJfSV9pb3N0cmVhbV9jcHAAjgEQX19fY3hhX2Nhbl9jYXRjaACeBRZfX19jeGFfaXNfcG9pbnRlcl90eXBlAJ8FEV9fX2Vycm5vX2xvY2F0aW9uADsFX2ZyZWUArQEPX2xsdm1fYnN3YXBfaTMyAKAFB19tYWxsb2MArAEHX21lbWNweQChBQhfbWVtbW92ZQCiBQdfbWVtc2V0AKMFF19wdGhyZWFkX2NvbmRfYnJvYWRjYXN0AJEBE19wdGhyZWFkX211dGV4X2xvY2sAkQEVX3B0aHJlYWRfbXV0ZXhfdW5sb2NrAJEBBV9zYnJrAKQFCl9zeW50aGVzaXMAHwpkeW5DYWxsX2lpAKUFC2R5bkNhbGxfaWlpAKYFDGR5bkNhbGxfaWlpaQCnBQ1keW5DYWxsX2lpaWlpAKgFDmR5bkNhbGxfaWlpaWlkAKkFDmR5bkNhbGxfaWlpaWlpAKoFD2R5bkNhbGxfaWlpaWlpZACrBQ9keW5DYWxsX2lpaWlpaWkArAUQZHluQ2FsbF9paWlpaWlpaQCtBRFkeW5DYWxsX2lpaWlpaWlpaQCuBQ5keW5DYWxsX2lpaWlpagDLBQlkeW5DYWxsX3YAsAUKZHluQ2FsbF92aQCxBQtkeW5DYWxsX3ZpaQCyBQxkeW5DYWxsX3ZpaWkAswUNZHluQ2FsbF92aWlpaQC0BQ5keW5DYWxsX3ZpaWlpaQC1BQ9keW5DYWxsX3ZpaWlpaWkAtgUOZHluQ2FsbF92aWlqaWkAzAUTZXN0YWJsaXNoU3RhY2tTcGFjZQAdCHNldFRocmV3AB4Kc3RhY2tBbGxvYwAaDHN0YWNrUmVzdG9yZQAcCXN0YWNrU2F2ZQAbCbUHAQAjAAveA7gFN5EBkQG9Ab4BkQGRAcUBxgHnAecB7wHwAfQB9QHrAvIC8wL0AvUC9gL3AvgC6wKTA5QDlQOWA5cDmAOZA7kDuQORAbkDuQORAb0DvQORAb0DvQORAZEBkQHbA+QDkQHmA4EEggSIBIkETk5OkQGRAdsDuAW4BbgFuAW5Bb8BvwHHAccB6QHtAfEB9gH0A/YD+AORBJMElQS5BboFODk9PocBuQG8AcABuQHEAcgB6AHsAf0BgwLUA9QD9QP3A/oDjQSSBJQElwSKBVu6BboFugW6BboFuwX5A44EjwSQBJYEuwW7BbwF1gLXAuUC5gK8BbwFvAW9BfsBgQLRAtIC1ALYAuAC4QLjAucC2QPaA+MD5QP7A5gE2QPgA9kD6wO9Bb0FvQW9Bb0FvQW9Bb0FvQW9Bb0FvgXMA9ADvgW/BYcCiAKJAooCiwKMAo0CjgKPApACkQK2ArcCuAK5AroCuwK8Ar0CvgK/AsAC7ALtAu4C7wLwAo0DjgOPA5ADkQPNA9EDvwW/Bb8FvwW/Bb8FvwW/Bb8FvwW/Bb8FvwW/Bb8FvwW/Bb8FvwW/Bb8FvwW/Bb8FvwW/Bb8FvwW/BcAFsQO1A78DwAPHA8gDwAXBBfECkgPXA9gD4QPiA98D3wPpA+oDwQXBBcEFwQXBBcIF0wLVAuIC5ALCBcIFwgXDBcQFswG1AbYBtwHCAcMBygHLAcwBzQHOAc8B0AHRAdIB0wHUAdUB1gHXAdgB2QHDAbcBwwG3AfgB+QH6AfgBgAL4AYYC+AGGAvgBhgL4AYYC+AGGAvgBhgKvA7ADrwOwA/gBhgL4AYYC+AGGAvgBhgL4AYYC+AGGAvgBhgL4AYYC+AGGAvgBhgJNhgKGAucD6APvA/AD8gPzA/8DgASGBIcEhgKGAoYChgKGAk2JBU1NiQWJBZkCmwJNrQHEBcQFxAXEBcQFxAXEBcQFxAXEBcQFxAXEBcQFxAXEBcQFxAXEBcQFxAXEBcQFxAXEBcQFxAXEBcQFxAXEBcQFxQW4AbgB5gHrAe4B8wG6A7oDugO7A7wDvAO6A7oDugO7A7wDvAO6A7oDugO+A7wDvAO6A7oDugO+A7wDvAO4AbgBgwSEBIUEigSLBIwExQXFBcUFxQXFBcUFxQXFBcUFxQXFBcUFxQXFBcUFxQXFBcUFxQXFBcUFxQXFBcUFxQXGBccFuwG7AfwBggKNBZUFmAXIBYwFlAWXBckF1QPWA4sFkwWWBckFyQXKBboBugHKBQrv1wm0BQYAIABAAAsbAQF/IwkhASAAIwlqJAkjCUEPakFwcSQJIAELBAAjCQsGACAAJAkLCgAgACQJIAEkCgsQACMFRQRAIAAkBSABJAYLC5sCAQR/IwkhBSMJQSBqJAkgBUEUaiIGIAA2AgAgBUEQaiIHIAE2AgAgBUEMaiIBIAI2AgAgBUEIaiIIIAM2AgAgBUEEaiICIAQ2AgAgBSIAQQA2AgADQAJAIAYoAgAhAyAAKAIAIAEoAgBODQAgACgCAEEDdCADaisDAEQAAAAAAAAAAGIEQCAGKAIAIAAoAgBBA3RqRAAAAAAAQM9AIAYoAgAgACgCAEEDdGorAwCjOQMACyAAIAAoAgBBAWo2AgAMAQsLIAMgASgCAEHQAEEBQQFBASACKAIAECcgAigCACAHKAIAIAEoAgBBAWtB0ABsIAgoAgBBGEThehSuR+HaP0HQAEEBQQBBBEEAQQBBACACKAIAECggBSQJCwQAQX8LNQECfyMJIQIjCUEQaiQJIAJBBGoiAyAANgIAIAIgATYCACADKAIAIAIoAgBGIQAgAiQJIAALJwEBfyMJIQEjCUEQaiQJIAEgADYCACABKAIAQf8BcSEAIAEkCSAACz8BAn8jCSEBIwlBEGokCSABIgIgADYCACABKAIAECAQIQR/ECBBf3MhACABJAkgAAUgAigCACEAIAEkCSAACwsjAQF/IwkhASMJQRBqJAkgASAAOgAAIAEtAAAhACABJAkgAAslAQF/IwkhASMJQRBqJAkgASAANgIAIAEoAgAQSiEAIAEkCSAAC/wJAS1/IwkhBiMJQcABaiQJIAZBsAFqIQ8gBkGsAWohECAGQagBaiERIAZBpAFqIRIgBkGgAWohEyAGQZwBaiEUIAZBmAFqIRUgBkGUAWohFiAGQZABaiEXIAZBjAFqIRggBkGIAWohGSAGQYQBaiEaIAZBgAFqIRsgBkH8AGohHCAGQfgAaiEdIAZB9ABqIR4gBkHwAGohHyAGQewAaiExIAZB6ABqISAgBkHkAGohISAGQeAAaiEiIAZB3ABqISMgBkHYAGohJCAGQbUBaiElIAZB1ABqISYgBkHQAGohJyAGQcwAaiEoIAZByABqISkgBkHEAGohKiAGQUBrISsgBkE8aiEsIAZBOGohLSAGQTRqITIgBkEwaiEuIAZBLGohByAGQRhqIQogBkEUaiEIIAZBEGohCSAGQQRqIQsgBiEMIAZBKGoiDSABNgIAIAZBJGoiDiACNgIAIAZBIGoiLyADNgIAIAZBHGoiMCAENgIAIAZBtAFqIgMgBToAACAAKAIARQRAIAcgACgCADYCACAHKAIAIQAgBiQJIAAPCyAKIC8oAgAgDSgCAGs2AgAgLiAwKAIANgIAIAggLigCACgCDDYCACAIKAIAIAooAgBKBEAgCCAIKAIAIAooAgBrNgIABSAIQQA2AgALIAkgDigCACANKAIAazYCACAJKAIAQQBKBEAgDSgCACECIAkoAgAhASAmIAAoAgA2AgAgJyACNgIAICggATYCACAmKAIAIgIoAgAoAjAhASACICcoAgAgKCgCACABQR9xQdAAahEAACAJKAIARwRAIABBADYCACAHIAAoAgA2AgAgBygCACEAIAYkCSAADwsLIAgoAgBBAEoEQCAIKAIAIQIgAywAACEBICMgCzYCACAkIAI2AgAgJSABOgAAICIgIygCACIDNgIAICEgIigCACICNgIAICEoAgAiAUIANwIAIAFBADYCCCAgIAI2AgAgMSAgKAIANgIAIAMgJCgCACAlLAAAEPEEIAAoAgAhAyAfIAs2AgAgHiAfKAIANgIAIB0gHigCACIBNgIAIBwgHSgCADYCACAbIBwoAgA2AgAgEiAbKAIALQALQYABcQR/IBUgATYCACAUIBUoAgA2AgAgEyAUKAIANgIAIBMoAgAoAgAFIBogATYCACAZIBooAgA2AgAgGCAZKAIANgIAIBcgGCgCADYCACAWIBcoAgA2AgAgFigCAAs2AgAgEigCACECIAgoAgAhASAPIAM2AgAgECACNgIAIBEgATYCACAPKAIAIgIoAgAoAjAhASACIBAoAgAgESgCACABQR9xQdAAahEAACAIKAIARwRAIABBADYCACAHIAAoAgA2AgAgDEEBNgIABSAMQQA2AgALIAsQ8wQgDCgCAEEBTwRAIAcoAgAhACAGJAkgAA8LCyAJIC8oAgAgDigCAGs2AgAgCSgCAEEASgRAIA4oAgAhAiAJKAIAIQEgKSAAKAIANgIAICogAjYCACArIAE2AgAgKSgCACICKAIAKAIwIQEgAiAqKAIAICsoAgAgAUEfcUHQAGoRAAAgCSgCAEcEQCAAQQA2AgAgByAAKAIANgIAIAcoAgAhACAGJAkgAA8LCyAsIDAoAgA2AgAgLUEANgIAIDIgLCgCACIBKAIMNgIAIAEgLSgCADYCDCAHIAAoAgA2AgAgBygCACEAIAYkCSAAC4MGAgx/AXwjCSEHIwlB4ABqJAkgB0EgaiEL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BEUgA0EYdEEYdSAERnINAiAAQQFqIgBBA3ENAAsLIAJBgYKECGwhAyAAKAIAIgJB//37d2ogAkGAgYKEeHFBgIGChHhzcUUEQANAIAIgA3MiAkH//ft3aiACQYCBgoR4cUGAgYKEeHNxRQRAASAAQQRqIgAoAgAiAkH//ft3aiACQYCBgoR4cUGAgYKEeHNxRQ0BCwsLIAFB/wFxIQIDQCAAQQFqIQEgACwAACIDRSACQRh0QRh1IANGckUEQCABIQAMAQsLCwUgABBKIABqIQALIAALoQEBAn8gAARAAn8gACgCTEF/TARAIAAQWAwBCyAAEE5FIQIgABBYIQEgAgR/IAEFIAAQTSABCwshAAVBwNAAKAIABH9BwNAAKAIAEFcFQQALIQAQVCgCACIBBEADQCABKAJMQX9KBH8gARBOBUEACyECIAEoAhQgASgCHEsEQCABEFggAHIhAAsgAgRAIAEQTQsgASgCOCIBDQALCxBVCyAAC6QBAQd/An8CQCAAQRRqIgIoAgAgAEEcaiIDKAIATQ0AIAAoAiQhASAAQQBBACABQR9xQdAAahEAABogAigCAA0AQX8MAQsgAEEEaiIBKAIAIgQgAEEIaiIFKAIAIgZJBEAgACgCKCEHIAAgBCAGa0EBIAdBH3FB0ABqEQAAGgsgAEEANgIQIANBADYCACACQQA2AgAgBUEANgIAIAFBADYCAEEACwsmAQF/IwkhAyMJQRBqJAkgAyACNgIAIAAgASADEFohACADJAkgAAuvAQEBfyMJIQMjCUGAAWokCSADQgA3AgAgA0IANwIIIANCADcCECADQgA3AhggA0IANwIgIANCADcCKCADQgA3AjAgA0IANwI4IANBQGtCADcCACADQgA3AkggA0IANwJQIANCADcCWCADQgA3AmAgA0IANwJoIANCADcCcCADQQA2AnggA0EaNgIgIAMgADYCLCADQX82AkwgAyAANgJUIAMgASACEFwhACADJAkgAAsKACAAIAEgAhBxC6cWAxx/AX4BfCMJIRUjCUGgAmokCSAVQYgCaiEUIBUiDEGEAmohFyAMQZACaiEYIAAoAkxBf0oEfyAAEE4FQQALIRogASwAACIIBEACQCAAQQRqIQUgAEHkAGohDSAAQewAaiERIABBCGohEiAMQQpqIRkgDEEhaiEbIAxBLmohHCAM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A0L/////////h4B/g0KAgICAgICA8D+EvyEACyAAC6ACACAABH8CfyABQYABSQRAIAAgAToAAEEBDAELEEMoArwBKAIARQRAIAFBgH9xQYC/A0YEQCAAIAE6AABBAQwCBRA7QdQANgIAQX8MAgsACyABQYAQSQRAIAAgAUEGdkHAAXI6AAAgACABQT9xQYABcjoAAUECDAELIAFBgEBxQYDAA0YgAUGAsANJcgRAIAAgAUEMdkHgAXI6AAAgACABQQZ2QT9xQYABcjoAASAAIAFBP3FBgAFyOgACQQMMAQsgAUGAgHxqQYCAwABJBH8gACABQRJ2QfABcjoAACAAIAFBDHZBP3FBgAFyOgABIAAgAUEGdkE/cUGAAXI6AAIgACABQT9xQYABcjoAA0EEBRA7QdQANgIAQX8LCwVBAQsLdgECf0EAIQICQAJAA0AgAkGgMGotAAAgAEcEQCACQQFqIgJB1wBHDQFB1wAhAgwCCwsgAg0AQYAxIQAMAQtBgDEhAANAIAAhAwNAIANBAWohACADLAAABEAgACEDDAELCyACQX9qIgINAAsLIAAgASgCFBCEAQsIACAAIAEQUQspAQF/IwkhBCMJQRBqJAkgBCADNgIAIAAgASACIAQQhgEhACAEJAkgAAuAAwEEfyMJIQYjCUGAAWokCSAGQfwAaiEFIAYiBEHM0gApAgA3AgAgBEHU0gApAgA3AgggBEHc0gApAgA3AhAgBEHk0gApAgA3AhggBEHs0gApAgA3AiAgBEH00gApAgA3AiggBEH80gApAgA3AjAgBEGE0wApAgA3AjggBEFAa0GM0wApAgA3AgAgBEGU0wApAgA3AkggBEGc0wApAgA3AlAgBEGk0wApAgA3AlggBEGs0wApAgA3AmAgBEG00wApAgA3AmggBEG80wApAgA3AnAgBEHE0wAoAgA2AngCQAJAIAFBf2pB/v///wdNDQAgAQR/EDtBywA2AgBBfwUgBSEAQQEhAQwBCyEADAELIARBfiAAayIFIAEgASAFSxsiBzYCMCAEQRRqIgEgADYCACAEIAA2AiwgBEEQaiIFIAAgB2oiADYCACAEIAA2AhwgBCACIAMQdCEAIAcEQCABKAIAIgEgASAFKAIARkEfdEEfdWpBADoAAAsLIAYkCSAACzsBAn8gAiAAKAIQIABBFGoiACgCACIE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ACADQX9qCyEDIAEgAEEEaiIANgIAIAMNAQwFCwsgBEEAOgAAIAFBADYCACACIANrIQIMAwsgAiADayECCwUgASgCACIAKAIAIgEEQEEAIQIDQCABQf8ASwRAIAcgAUEAEIIBIgFBf0YEQEF/IQIMBQsFQQEhAQsgASACaiECIABBBGoiACgCACIBDQALBUEAIQILCwsgBiQJIAIL/gIBCH8jCSEJIwlBkAhqJAkgCUGACGoiByABKAIAIgU2AgAgA0GAAiAAQQBHIgsbIQYgACAJIgggCxshAyAGQQBHIAVBAEdxBEACQEEAIQADQAJAIAJBAnYiCiAGTyIMIAJBgwFLckUNAiACIAYgCiAMGyIFayECIAMgByAFIAQQmAEiBUF/Rg0AIAZBACAFIAMgCEYiChtrIQYgAyAFQQJ0IANqIAobIQMgACAFaiEAIAcoAgAiBUEARyAGQQBHcQ0BDAILC0F/IQBBACEGIAcoAgAhBQsFQQAhAAsgBQRAIAZBAEcgAkEAR3EEQAJAA0AgAyAFIAIgBBBhIghBAmpBA08EQCAHIAggBygCAGoiBTYCACADQQRqIQMgAEEBaiEAIAZBf2oiBkEARyACIAhrIgJBAEdxDQEMAgsLAkACQAJAIAhBf2sOAgABAgsgCCEADAILIAdBADYCAAwBCyAEQQA2AgALCwsgCwRAIAEgBygCADYCAAsgCSQJIAALDAAgACABQQAQogG2C+oBAgR/AXwjCSEEIwlBgAFqJAkgBCIDQgA3AgAgA0IANwIIIANCADcCECADQgA3AhggA0IANwIgIANCADcCKCADQgA3AjAgA0IANwI4IANBQGtCADcCACADQgA3AkggA0IANwJQIANCADcCWCADQgA3AmAgA0IANwJoIANCADcCcCADQQA2AnggA0EEaiIFIAA2AgAgA0EIaiIGQX82AgAgAyAANgIsIANBfzYCTCADQQAQXSADIAJBARBkIQcgAygCbCAFKAIAIAYoAgBraiECIAEEQCABIAAgAmogACACGzYCAAsgBCQJIAcLCwAgACABQQEQogELCwAgACABQQIQogELCQAgACABEKEBCwkAIAAgARCjAQsJACAAIAEQpAELMAECfyACBEAgACEDA0AgA0EEaiEEIAMgATYCACACQX9qIgIEQCAEIQMMAQsLCyAAC28BA38gACAB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NgIAQaisAUEANgIAQcSsASAJQXBxQdiq1aoFczYCAEGAIAsiAWoiCEEAIAFrIglxIgUgAE0EQCAKJAlBAA8LQaSsASgCACIBBEAgBUGcrAEoAgAiA2oiByADTSAHIAFLcgRAIAokCUEADwsLAkACQEGorAEoAgBBBHEEQEEAIQIFAkACQAJAQYSpASgCACIBRQ0AQaysASEDA0ACQCADKAIAIgcgAU0EQCAHIAMoAgRqIAFLDQELIAMoAggiAw0BDAILCyAJIAggAmtxIgJB/////wdJBEAgAhCkBSIBIAMoAgAgAygCBGpGBEAgAUF/Rw0GBQwDCwVBACECCwwCC0EAEKQFIgFBf0YEf0EABUGcrAEoAgAiCCAFIAFByKwBKAIAIgJBf2oiA2pBACACa3EgAWtBACABIANxG2oiAmohAyACQf////8HSSACIABLcQR/QaSsASgCACIJBEAgAyAITSADIAlLcgRAQQAhAgwFCwsgASACEKQFIgNGDQUgAyEBDAIFQQALCyECDAELQQAgAmshCCABQX9HIAJB/////wdJcSAEIAJLcUUEQCABQX9GBEBBACECDAIFDAQLAAtBzKwBKAIAIgMgBiACa2pBACADa3EiA0H/////B08NAiADEKQFQX9GBH8gCBCkBRpBAAUgAiADaiECDAMLIQILQaisAUGorAEoAgBBBHI2AgALIAVB/////wdJBEAgBRCkBSEBQQAQpAUiAyABayIEIABBKGpLIQUgBCACIAUbIQIgBUEBcyABQX9GciABQX9HIANBf0dxIAEgA0lxQQFzckUNAQsMAQtBnKwBIAJBnKwBKAIAaiIDNgIAIANBoKwBKAIASwRAQaCsASADNgIAC0GEqQEoAgAiBQRAAkBBrKwBIQMCQAJAA0AgASADKAIAIgQgAygCBCIGakYNASADKAIIIgMNAAsMAQsgA0EEaiEIIAMoAgxBCHFFBEAgBCAFTSABIAVLcQRAIAggAiAGajYCACAFQQAgBUEIaiIBa0EHcUEAIAFBB3EbIgNqIQEgAkH4qAEoAgBqIgQgA2shAkGEqQEgATYCAEH4qAEgAjYCACABIAJBAXI2AgQgBCAFakEoNgIEQYipAUHUrAEoAgA2AgAMAwsLCyABQfyoASgCAEkEQEH8qAEgATYCAAsgASACaiEEQaysASEDAkACQANA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IAIoAgA2AgAgCiAcKAIANgIAIAggHSgCADYCACABIAAgCiAIIAMgBCAFQdH5AEHc+QAQ/gI2AgAMCgsgHiABKAIANgIAIB8gAigCADYCACAKIB4oAgA2AgAgCCAfKAIANgIAIAEgACAKIAggAyAEIAVB3PkAQeH5ABD+AjYCAAwJCyAgIAIoAgA2AgAgCCAgKAIANgIAIAAgBSABIAggBCAJEIcDDAgLICEgASgCADYCACAiIAIoAgA2AgAgCiAhKAIANgIAIAggIigCADYCACABIAAgCiAIIAMgBCAFQeH5AEHp+QAQ/gI2AgAMBwsgIyACKAIANgIAIAggIygCADYCACAAIAVBGGogASAIIAQgCRCIAwwGCyAAKAIAKAIUIQYgJCABKAIANgIAICUgAigCADYCACAKICQoAgA2AgAgCCAlKAIANgIAIAAgCiAIIAMgBCAFIAZBP3FBpAFqEQgADAYLIABBCGoiBigCACgCGCELIAYgC0E/cRECACEGICYgASgCADYCACAnIAIoAgA2AgAgBigCACAGIAYsAAsiAkEASCILGyIJIAYoAgQgAkH/AXEgCxtqIQIgCiAmKAIANgIAIAggJygCADYCACABIAAgCiAIIAMgBCAFIAkgAhD+AjYCAAwECyAoIAIoAgA2AgAgCCAoKAIANgIAIAAgBUEUaiABIAggBCAJEIkDDAMLICkgAigCADYCACAIICkoAgA2AgAgACAFQRRqIAEgCCAEIAkQigMMAgsgCyACKAIANgIAIAggCygCADYCACAAIAEgCCAEIAkQiwMMAQsgBCAEKAIAQQRyNgIACyABKAIACyEAIAckCSAACywAQaCjASwAAEUEQEGgowEQnAUEQBD7AkH0tQFBoJsBNgIACwtB9LUBKAIACywAQZCjASwAAEUEQEGQowEQnAUEQBD6AkHwtQFBgJkBNgIACwtB8LUBKAIACywAQYCjASwAAEUEQEGAowEQnAUEQBD5AkHstQFB4JYBNgIACwtB7LUBKAIACz4AQfiiASwAAEUEQEH4ogEQnAUEQEHgtQFCADcCAEHotQFBADYCAEHgtQFBz/cAQc/3ABAlEPAECwtB4LUBCz4AQfCiASwAAEUEQEHwogEQnAUEQEHUtQFCADcCAEHctQFBADYCAEHUtQFBw/cAQcP3ABAlEPAECwtB1LUBCz4AQeiiASwAAEUEQEHoogEQnAUEQEHItQFCADcCAEHQtQFBADYCAEHItQFBuvcAQbr3ABAlEPAECwtByLUBCz4AQeCiASwAAEUEQEHgogEQnAUEQEG8tQFCADcCAEHEtQFBADYCAEG8tQFBsfcAQbH3ABAlEPAECwtBvLUBC3sBAn9BiKMBLAAARQRAQYijARCcBQRAQeCWASEAA0AgAEIANwIAIABBADYCCEEAIQEDQCABQQNHBEAgAUECdCAAakEANgIAIAFBAWohAQwBCwsgAEEMaiIAQYCZAUcNAAsLC0HglgFB5PcAEPgEGkHslgFB5/cAEPgEGguDAwECf0GYowEsAABFBEBBmKMBEJwFBEBBgJkBIQADQCAAQgA3AgAgAEEANgIIQQAhAQNAIAFBA0cEQCABQQJ0IABqQQA2AgAgAUEBaiEBDAELCyAAQQxqIgBBoJsBRw0ACwsLQYCZAUHq9wAQ+AQaQYyZAUHy9wAQ+AQaQZiZAUH79wAQ+AQaQaSZAUGB+AAQ+AQaQbCZAUGH+AAQ+AQaQbyZAUGL+AAQ+AQaQciZAUGQ+AAQ+AQaQdSZAUGV+AAQ+AQaQeCZAUGc+AAQ+AQaQeyZAUGm+AAQ+AQaQfiZAUGu+AAQ+AQaQYSaAUG3+AAQ+AQaQZCaAUHA+AAQ+AQaQZyaAUHE+AAQ+AQaQaiaAUHI+AAQ+AQaQbSaAUHM+AAQ+AQaQcCaAUGH+AAQ+AQaQcyaAUHQ+AAQ+AQaQdiaAUHU+AAQ+AQaQeSaAUHY+AAQ+AQaQfCaAUHc+AAQ+AQaQfyaAUHg+AAQ+AQaQYibAUHk+AAQ+AQaQZSbAUHo+AAQ+AQaC4sCAQJ/QaijASwAAEUEQEGoowEQnAUEQEGgmwEhAANAIABCADcCACAAQQA2AghBACEBA0AgAUEDRwRAIAFBAnQgAGpBADYCACABQQFqIQEMAQsLIABBDGoiAEHInAFHDQALCwtBoJsBQez4ABD4BBpBrJsBQfP4ABD4BBpBuJsBQfr4ABD4BBpBxJsBQYL5ABD4BBpB0JsBQYz5ABD4BBpB3JsBQZX5ABD4BBpB6JsBQZz5ABD4BBpB9JsBQaX5ABD4BBpBgJwBQan5ABD4BBpBjJwBQa35ABD4BBpBmJwBQbH5ABD4BBpBpJwBQbX5ABD4BBpBsJwBQbn5ABD4BBpBvJwBQb35ABD4BBoLdQECfyMJIQYjCUEQaiQJIABBCGoiACgCACgCACEHIAAgB0E/cRECACEAIAYgAygCADYCACAGQQRqIgMgBigCADYCACACIAMgACAAQagBaiAFIARBABC1AiAAayIAQagBSARAIAEgAEEMbUEHbzYCAAsgBiQJC3UBAn8jCSEGIwlBEGokCSAAQQhqIgAoAgAoAgQhByAAIAdBP3ERAgAhACAGIAMoAgA2AgAgBkEEaiIDIAYoAgA2AgAgAiADIAAgAEGgAmogBSAEQQAQtQIgAGsiAEGgAkgEQCABIABBDG1BDG82AgALIAYkCQuFCwENfyMJIQ4jCUEQaiQJIA5BCGohESAOQQRqIRIgDiETIA5BDGoiECADENsBIBBB9LQBEJICIQ0gEBCTAiAEQQA2AgAgDUEIaiEUQQAhCwJAAkADQAJAIAEoAgAhCCALRSAGIAdHcUUNACAIIQsgCAR/IAgoAgwiCSAIKAIQRgR/IAgoAgAoAiQhCSAIIAlBP3ERAgAFIAksAAAQJAsQIBAhBH8gAUEANgIAQQAhCEEAIQtBAQVBAAsFQQAhCEEBCyEMIAIoAgAiCiEJAkACQCAKRQ0AIAooAgwiDyAKKAIQRgR/IAooAgAoAiQhDyAKIA9BP3ERAgAFIA8sAAAQJAsQIBAhBEAgAkEANgIAQQAhCQwBBSAMRQ0FCwwBCyAMDQNBACEKCyANKAIAKAIkIQwgDSAGLAAAQQAgDEEfcUHQAGoRAABB/wFxQSVGBEAgByAGQQFqIgxGDQMgDSgCACgCJCEKAkACQAJAIA0gDCwAAEEAIApBH3FB0ABqEQAAIgpBGHRBGHVBMGsOFgABAQEBAQEBAQEBAQEBAQEBAQEBAQABCyAHIAZBAmoiBkYNBSANKAIAKAIkIQ8gCiEIIA0gBiwAAEEAIA9BH3FB0ABqEQAAIQogDCEGDAELQQAhCAsgACgCACgCJCEMIBIgCzYCACATIAk2AgAgESASKAIANgIAIBAgEygCADYCACABIAAgESAQIAMgBCAFIAogCCAMQQ9xQewBahEGADYCACAGQQJqIQYFAkAgBiwAACILQX9KBEAgC0EBdCAUKAIAIgtqLgEAQYDAAHEEQANAAkAgByAGQQFqIgZGBEAgByEGDAELIAYsAAAiCUF/TA0AIAlBAXQgC2ouAQBBgMAAcQ0BCwsgCiELA0AgCAR/IAgoAgwiCSAIKAIQRgR/IAgoAgAoAiQhCSAIIAlBP3ERAgAFIAksAAAQJAsQIBAhBH8gAUEANgIAQQAhCEEBBUEACwVBACEIQQELIQkCQAJAIAtFDQAgCygCDCIKIAsoAhBGBH8gCygCACgCJCEKIAsgCkE/cRECAAUgCiwAABAkCxAgECEEQCACQQA2AgAMAQUgCUUNBgsMAQsgCQ0EQQAhCwsgCEEMaiIKKAIAIgkgCEEQaiIMKAIARgR/IAgoAgAoAiQhCSAIIAlBP3ERAgAFIAksAAAQJAsiCUH/AXFBGHRBGHVBf0wNAyAUKAIAIAlBGHRBGHVBAXRqLgEAQYDAAHFFDQMgCigCACIJIAwoAgBGBEAgCCgCACgCKCEJIAggCUE/cRECABoFIAogCUEBajYCACAJLAAAECQaCwwAAAsACwsgCEEMaiILKAIAIgkgCEEQaiIKKAIARgR/IAgoAgAoAiQhCSAIIAlBP3ERAgAFIAksAAAQJAshCSANKAIAKAIMIQwgDSAJQf8BcSAMQQ9xQUBrEQMAIQkgDSgCACgCDCEMIAlB/wFxIA0gBiwAACAMQQ9xQUBrEQMAQf8BcUcEQCAEQQQ2AgAMAQsgCygCACIJIAooAgBGBEAgCCgCACgCKCELIAggC0E/cRECABoFIAsgCUEBajYCACAJLAAAECQaCyAGQQFqIQYLCyAEKAIAIQsMAQsLDAELIARBBDYCAAsgCAR/IAgoAgwiACAIKAIQRgR/IAgoAgAoAiQhACAIIABBP3ERAgAFIAAsAAAQJAsQIBAhBH8gAUEANgIAQQAhCEEBBUEACwVBACEIQQELIQACQAJAAkAgAigCACIBRQ0AIAEoAgwiAyABKAIQRgR/IAEoAgAoAiQhAyABIANBP3ERAgAFIAMsAAAQJAsQIBAhBEAgAkEANgIADAEFIABFDQILDAILIAANAAwBCyAEIAQoAgBBAnI2AgALIA4kCSAIC2IAIwkhACMJQRBqJAkgACADKAIANgIAIABBBGoiAyAAKAIANgIAIAIgAyAEIAVBAhCMAyECIAQoAgAiA0EEcUUgAkF/akEfSXEEQCABIAI2AgAFIAQgA0EEcjYCAAsgACQJC18AIwkhACMJQRBqJAkgACADKAIANgIAIABBBGoiAyAAKAIANgIAIAIgAyAEIAVBAhCMAyECIAQoAgAiA0EEcUUgAkEYSHEEQCABIAI2AgAFIAQgA0EEcjYCAAsgACQJC2IAIwkhACMJQRBqJAkgACADKAIANgIAIABBBGoiAyAAKAIANgIAIAIgAyAEIAVBAhCMAyECIAQoAgAiA0EEcUUgAkF/akEMSXEEQCABIAI2AgAFIAQgA0EEcjYCAAsgACQJC2AAIwkhACMJQRBqJAkgACADKAIANgIAIABBBGoiAyAAKAIANgIAIAIgAyAEIAVBAxCMAyECIAQoAgAiA0EEcUUgAkHuAkhxBEAgASACNgIABSAEIANBBHI2AgALIAAkCQtiACMJIQAjCUEQaiQJIAAgAygCADYCACAAQQRqIgMgACgCADYCACACIAMgBCAFQQIQjAMhAiAEKAIAIgNBBHFFIAJBDUhxBEAgASACQX9qNgIABSAEIANBBHI2AgALIAAkCQtfACMJIQAjCUEQaiQJIAAgAygCADYCACAAQQRqIgMgACgCADYCACACIAMgBCAFQQIQjAMhAiAEKAIAIgNBBHFFIAJBPEhxBEAgASACNgIABSAEIANBBHI2AgALIAAkCQugBAECfyAEQQhqIQYDQAJAIAEoAgAiAAR/IAAoAgwiBCAAKAIQRgR/IAAoAgAoAiQhBCAAIARBP3ERAgAFIAQsAAAQJAsQIBAhBH8gAUEANgIAQQEFIAEoAgBFCwVBAQshBAJAAkAgAigCACIARQ0AIAAoAgwiBSAAKAIQRgR/IAAoAgAoAiQhBSAAIAVBP3ERAgAFIAUsAAAQJAsQIBAhBEAgAkEANgIADAEFIARFDQMLDAELIAQEf0EAIQAMAgVBAAshAAsgASgCACIEKAIMIgUgBCgCEEYEfyAEKAIAKAIkIQUgBCAFQT9xEQIABSAFLAAAECQLIgRB/wFxQRh0QRh1QX9MDQAgBigCACAEQRh0QRh1QQF0ai4BAEGAwABxRQ0AIAEoAgAiAEEMaiIFKAIAIgQgACgCEEYEQCAAKAIAKAIoIQQgACAEQT9xEQIAGgUgBSAEQQFqNgIAIAQsAAAQJBoLDAELCyABKAIAIgQEfyAEKAIMIgUgBCgCEEYEfyAEKAIAKAIkIQUgBCAFQT9xEQIABSAFLAAAECQLECAQIQR/IAFBADYCAEEBBSABKAIARQsFQQELIQECQAJAAkAgAEUNACAAKAIMIgQgACgCEEYEfyAAKAIAKAIkIQQgACAEQT9xEQIABSAELAAAECQLECAQIQRAIAJBADYCAAwBBSABRQ0CCwwCCyABDQAMAQsgAyADKAIAQQJyNgIACwviAQEFfyMJIQcjCUEQaiQJIAdBBGohCCAHIQkgAEEIaiIAKAIAKAIIIQYgACAGQT9xEQIAIgAsAAsiBkEASAR/IAAoAgQFIAZB/wFxCyEGQQAgACwAFyIKQQBIBH8gACgCEAUgCkH/AXELayAGRgRAIAQgBCgCAEEEcjYCAAUCQCAJIAMoAgA2AgAgCCAJKAIANgIAIAIgCCAAIABBGGogBSAEQQAQtQIgAGsiAkUgASgCACIAQQxGcQRAIAFBADYCAAwBCyACQQxGIABBDEhxBEAgASAAQQxqNgIACwsLIAckCQtfACMJIQAjCUEQaiQJIAAgAygCADYCACAAQQRqIgMgACgCADYCACACIAMgBCAFQQIQjAMhAiAEKAIAIgNBBHFFIAJBPUhxBEAgASACNgIABSAEIANBBHI2AgALIAAkCQtfACMJIQAjCUEQaiQJIAAgAygCADYCACAAQQRqIgMgACgCADYCACACIAMgBCAFQQEQjAMhAiAEKAIAIgNBBHFFIAJBB0hxBEAgASACNgIABSAEIANBBHI2AgALIAAkCQtvAQF/IwkhBiMJQRBqJAkgBiADKAIANgIAIAZBBGoiACAGKAIANgIAIAIgACAEIAVBBBCMAyEAIAQoAgBBBHFFBEAgASAAQcUASAR/IABB0A9qBSAAQewOaiAAIABB5ABIGwtBlHFqNgIACyAGJAkLUAAjCSEAIwlBEGokCSAAIAMoAgA2AgAgAEEEaiIDIAAoAgA2AgAgAiADIAQgBUEEEIwDIQIgBCgCAEEEcUUEQCABIAJBlHFqNgIACyAAJAkLqgQBAn8gASgCACIABH8gACgCDCIFIAAoAhBGBH8gACgCACgCJCEFIAAgBUE/cRECAAUgBSwAABAkCxAgECEEfyABQQA2AgBBAQUgASgCAEULBUEBCyEFAkACQAJAIAIoAgAiAARAIAAoAgwiBiAAKAIQRgR/IAAoAgAoAiQhBiAAIAZBP3ERAgAFIAYsAAAQJAsQIBAhBEAgAkEANgIABSAFBEAMBAUMAwsACwsgBUUEQEEAIQAMAgsLIAMgAygCAEEGcjYCAAwBCyABKAIAIgUoAgwiBiAFKAIQRgR/IAUoAgAoAiQhBiAFIAZBP3ERAgAFIAYsAAAQJAshBSAEKAIAKAIkIQYgBCAFQf8BcUEAIAZBH3FB0ABqEQAAQf8BcUElRwRAIAMgAygCAEEEcjYCAAwBCyABKAIAIgRBDGoiBigCACIFIAQoAhBGBEAgBCgCACgCKCEFIAQgBUE/cRECABoFIAYgBUEBajYCACAFLAAAECQaCyABKAIAIgQEfyAEKAIMIgUgBCgCEEYEfyAEKAIAKAIkIQUgBCAFQT9xEQIABSAFLAAAECQLECAQIQR/IAFBADYCAEEBBSABKAIARQsFQQELIQECQAJAIABFDQAgACgCDCIEIAAoAhBGBH8gACgCACgCJCEEIAAgBEE/cRECAAUgBCwAABAkCxAgECEEQCACQQA2AgAMAQUgAQ0DCwwBCyABRQ0BCyADIAMoAgBBAnI2AgALC/8HAQh/IAAoAgAiBQR/IAUoAgwiByAFKAIQRgR/IAUoAgAoAiQhByAFIAdBP3ERAgAFIAcsAAAQJAsQIBAhBH8gAEEANgIAQQEFIAAoAgBFCwVBAQshBgJAAkACQCABKAIAIgcEQCAHKAIMIgUgBygCEEYEfyAHKAIAKAIkIQUgByAFQT9xEQIABSAFLAAAECQLECAQIQRAIAFBADYCAAUgBgRADAQFDAMLAAsLIAZFBEBBACEHDAILCyACIAIoAgBBBnI2AgBBACEEDAELIAAoAgAiBigCDCIFIAYoAhBGBH8gBigCACgCJCEFIAYgBUE/cRECAAUgBSwAABAkCyIFQf8BcSIGQRh0QRh1QX9KBEAgA0EIaiIMKAIAIAVBGHRBGHVBAXRqLgEAQYAQcQRAIAMoAgAoAiQhBSADIAZBACAFQR9xQdAAahEAAEEYdEEYdSEFIAAoAgAiC0EMaiIGKAIAIgggCygCEEYEQCALKAIAKAIoIQYgCyAGQT9xEQIAGgUgBiAIQQFqNgIAIAgsAAAQJBoLIAQhCCAHIQYDQAJAIAVBUGohBCAIQX9qIQsgACgCACIJBH8gCSgCDCIFIAkoAhBGBH8gCSgCACgCJCEFIAkgBUE/cRECAAUgBSwAABAkCxAgECEEfyAAQQA2AgBBAQUgACgCAEULBUEBCyEJIAYEfyAGKAIMIgUgBigCEEYEfyAGKAIAKAIkIQUgBiAFQT9xEQIABSAFLAAAECQLECAQIQR/IAFBADYCAEEAIQdBACEGQQEFQQALBUEAIQZBAQshBSAAKAIAIQogBSAJcyAIQQFKcUUNACAKKAIMIgUgCigCEEYEfyAKKAIAKAIkIQUgCiAFQT9xEQIABSAFLAAAECQLIgVB/wFxIghBGHRBGHVBf0wNBCAMKAIAIAVBGHRBGHVBAXRqLgEAQYAQcUUNBCADKAIAKAIkIQUgBEEKbCADIAhBACAFQR9xQdAAahEAAEEYdEEYdWohBSAAKAIAIglBDGoiBCgCACIIIAkoAhBGBEAgCSgCACgCKCEEIAkgBEE/cRECABoFIAQgCEEBajYCACAILAAAECQaCyALIQgMAQsLIAoEfyAKKAIMIgMgCigCEEYEfyAKKAIAKAIkIQMgCiADQT9xEQIABSADLAAAECQLECAQIQR/IABBADYCAEEBBSAAKAIARQsFQQELIQMCQAJAIAdFDQAgBygCDCIAIAcoAhBGBH8gBygCACgCJCEAIAcgAEE/cRECAAUgACwAABAkCxAgECEEQCABQQA2AgAMAQUgAw0FCwwBCyADRQ0DCyACIAIoAgBBAnI2AgAMAgsLIAIgAigCAEEEcjYCAEEAIQQLIAQLZQECfyMJIQYjCUEQaiQJIAZBBGoiByABKAIANgIAIAYgAigCADYCACAGQQhqIgEgBygCADYCACAGQQxqIgIgBigCADYCACAAIAEgAiADIAQgBUHAwQBB4MEAEKADIQAgBiQJIAALqAEBBH8jCSEHIwlBEGokCSAAQQhqIgYoAgAoAhQhCCAGIAhBP3ERAgAhBiAHQQRqIgggASgCADYCACAHIAIoAgA2AgAgBigCACAGIAYsAAsiAkEASCIJGyEBIAYoAgQgAkH/AXEgCRtBAnQgAWohAiAHQQhqIgYgCCgCADYCACAHQQxqIgggBygCADYCACAAIAYgCCADIAQgBSABIAIQoAMhACAHJAkgAAteAQJ/IwkhBiMJQRBqJAkgBkEEaiIHIAMQ2wEgB0GUtQEQkgIhAyAHEJMCIAYgAigCADYCACAHIAYoAgA2AgAgACAFQRhqIAEgByAEIAMQngMgASgCACEAIAYkCSAAC14BAn8jCSEGIwlBEGokCSAGQQRqIgcgAxDbASAHQZS1ARCSAiEDIAcQkwIgBiACKAIANgIAIAcgBigCADYCACAAIAVBEGogASAHIAQgAxCfAyABKAIAIQAgBiQJIAALXgECfyMJIQYjCUEQaiQJIAZBBGoiByADENsBIAdBlLUBEJICIQMgBxCTAiAGIAIoAgA2AgAgByAGKAIANgIAIAAgBUEUaiABIAcgBCADEKsDIAEoAgAhACAGJAkgAAvyDQEifyMJIQcjCUGQAWokCSAHQfAAaiEKIAdB/ABqIQwgB0H4AGohDSAHQfQAaiEOIAdB7ABqIQ8gB0HoAGohECAHQeQAaiERIAdB4ABqIRIgB0HcAGohEyAHQdgAaiEUIAdB1ABqIRUgB0HQAGohFiAHQcwAaiEXIAdByABqIRggB0HEAGohGSAHQUBrIRogB0E8aiEbIAdBOGohHCAHQTRqIR0gB0EwaiEeIAdBLGohHyAHQShqISAgB0EkaiEhIAdBIGohIiAHQRxqISMgB0EYaiEkIAdBFGohJSAHQRBqISYgB0EMaiEnIAdBCGohKCAHQQRqISkgByELIARBADYCACAHQYABaiIIIAMQ2wEgCEGUtQEQkgIhCSAIEJMCAn8CQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQCAGQRh0QRh1QSVrDlUWFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXAAEXBBcFFwYHFxcXChcXFxcODxAXFxcTFRcXFxcXFxcAAQIDAxcXARcIFxcJCxcMFw0XCxcXERIUFwsgDCACKAIANgIAIAggDCgCADYCACAAIAVBGGogASAIIAQgCRCeAwwXCyANIAIoAgA2AgAgCCANKAIANgIAIAAgBUEQaiABIAggBCAJEJ8DDBYLIABBCGoiBigCACgCDCELIAYgC0E/cRECACEGIA4gASgCADYCACAPIAIoAgA2AgAgBigCACAGIAYsAAsiC0EASCIJGyECIAYoAgQgC0H/AXEgCRtBAnQgAmohBiAKIA4oAgA2AgAgCCAPKAIANgIAIAEgACAKIAggAyAEIAUgAiAGEKADNgIADBULIBAgAigCADYCACAIIBAoAgA2AgAgACAFQQxqIAEgCCAEIAkQoQMMFAsgESABKAIANgIAIBIgAigCADYCACAKIBEoAgA2AgAgCCASKAIANgIAIAEgACAKIAggAyAEIAVBkMAAQbDAABCgAzYCAAwTCyATIAEoAgA2AgAgFCACKAIANgIAIAogEygCADYCACAIIBQoAgA2AgAgASAAIAogCCADIAQgBUGwwABB0MAAEKADNgIADBILIBUgAigCADYCACAIIBUoAgA2AgAgACAFQQhqIAEgCCAEIAkQogMMEQsgFiACKAIANgIAIAggFigCADYCACAAIAVBCGogASAIIAQgCRCjAwwQCyAXIAIoAgA2AgAgCCAXKAIANgIAIAAgBUEcaiABIAggBCAJEKQDDA8LIBggAigCADYCACAIIBgoAgA2AgAgACAFQRBqIAEgCCAEIAkQpQMMDgsgGSACKAIANgIAIAggGSgCADYCACAAIAVBBGogASAIIAQgCRCmAwwNCyAaIAIoAgA2AgAgCCAaKAIANgIAIAAgASAIIAQgCRCnAwwMCyAbIAIoAgA2AgAgCCAbKAIANgIAIAAgBUEIaiABIAggBCAJEKgDDAsLIBwgASgCADYCACAdIAIoAgA2AgAgCiAcKAIANgIAIAggHSgCADYCACABIAAgCiAIIAMgBCAFQdDAAEH8wAAQoAM2AgAMCgsgHiABKAIANgIAIB8gAigCADYCACAKIB4oAgA2AgAgCCAfKAIANgIAIAEgACAKIAggAyAEIAVBgMEAQZTBABCgAzYCAAwJCyAgIAIoAgA2AgAgCCAgKAIANgIAIAAgBSABIAggBCAJEKkDDAgLICEgASgCADYCACAiIAIoAgA2AgAgCiAhKAIANgIAIAggIigCADYCACABIAAgCiAIIAMgBCAFQaDBAEHAwQAQoAM2AgAMBwsgIyACKAIANgIAIAggIygCADYCACAAIAVBGGogASAIIAQgCRCqAwwGCyAAKAIAKAIUIQYgJCABKAIANgIAICUgAigCADYCACAKICQoAgA2AgAgCCAlKAIANgIAIAAgCiAIIAMgBCAFIAZBP3FBpAFqEQgADAYLIABBCGoiBigCACgCGCELIAYgC0E/cRECACEGICYgASgCADYCACAnIAIoAgA2AgAgBigCACAGIAYsAAsiC0EASCIJGyECIAYoAgQgC0H/AXEgCRtBAnQgAmohBiAKICYoAgA2AgAgCCAnKAIANgIAIAEgACAKIAggAyAEIAUgAiAGEKADNgIADAQLICggAigCADYCACAIICgoAgA2AgAgACAFQRRqIAEgCCAEIAkQqwMMAwsgKSACKAIANgIAIAggKSgCADYCACAAIAVBFGogASAIIAQgCRCsAwwCCyALIAIoAgA2AgAgCCALKAIANgIAIAAgASAIIAQgCRCtAwwBCyAEIAQoAgBBBHI2AgALIAEoAgALIQAgByQJIAALLABB8KMBLAAARQRAQfCjARCcBQRAEJ0DQbi2AUGQoQE2AgALC0G4tgEoAgALLABB4KMBLAAARQRAQeCjARCcBQRAEJwDQbS2AUHwngE2AgALC0G0tgEoAgALLABB0KMBLAAARQRAQdCjARCcBQRAEJsDQbC2AUHQnAE2AgALC0GwtgEoAgALPwBByKMBLAAARQRAQcijARCcBQRAQaS2AUIANwIAQay2AUEANgIAQaS2AUHg3ABB4NwAEJoDEP4ECwtBpLYBCz8AQcCjASwAAEUEQEHAowEQnAUEQEGYtgFCADcCAEGgtgFBADYCAEGYtgFBsNwAQbDcABCaAxD+BAsLQZi2AQs/AEG4owEsAABFBEBBuKMBEJwFBEBBjLYBQgA3AgBBlLYBQQA2AgBBjLYBQYzcAEGM3AAQmgMQ/gQLC0GMtgELPwBBsKMBLAAARQRAQbCjARCcBQRAQYC2AUIANwIAQYi2AUEANgIAQYC2AUHo2wBB6NsAEJoDEP4ECwtBgLYBCwYAIAAQQQt7AQJ/QdijASwAAEUEQEHYowEQnAUEQEHQnAEhAANAIABCADcCACAAQQA2AghBACEBA0AgAUEDRwRAIAFBAnQgAGpBADYCACABQQFqIQEMAQsLIABBDGoiAEHwngFHDQALCwtB0JwBQbTdABCFBRpB3JwBQcDdABCFBRoLgwMBAn9B6KMBLAAARQRAQeijARCcBQRAQfCeASEAA0AgAEIANwIAIABBADYCCEEAIQEDQCABQQNHBEAgAUECdCAAakEANgIAIAFBAWohAQwBCwsgAEEMaiIAQZChAUcNAAsLC0HwngFBzN0AEIUFGkH8ngFB7N0AEIUFGkGInwFBkN4AEIUFGkGUnwFBqN4AEIUFGkGgnwFBwN4AEIUFGkGsnwFB0N4AEIUFGkG4nwFB5N4AEIUFGkHEnwFB+N4AEIUFGkHQnwFBlN8AEIUFGkHcnwFBvN8AEIUFGkHonwFB3N8AEIUFGkH0nwFBgOAAEIUFGkGAoAFBpOAAEIUFGkGMoAFBtOAAEIUFGkGYoAFBxOAAEIUFGkGkoAFB1OAAEIUFGkGwoAFBwN4AEIUFGkG8oAFB5OAAEIUFGkHIoAFB9OAAEIUFGkHUoAFBhOEAEIUFGkHgoAFBlOEAEIUFGkHsoAFBpOEAEIUFGkH4oAFBtOEAEIUFGkGEoQFBxOEAEIUFGguLAgECf0H4owEsAABFBEBB+KMBEJwFBEBBkKEBIQADQCAAQgA3AgAgAEEANgIIQQAhAQNAIAFBA0cEQCABQQJ0IABqQQA2AgAgAUEBaiEBDAELCyAAQQxqIgBBuKIBRw0ACwsLQZChAUHU4QAQhQUaQZyhAUHw4QAQhQUaQaihAUGM4gAQhQUaQbShAUGs4gAQhQUaQcChAUHU4gAQhQUaQcyhAUH44gAQhQUaQdihAUGU4wAQhQUaQeShAUG44wAQhQUaQfChAUHI4wAQhQUaQfyhAUHY4wAQhQUaQYiiAUHo4wAQhQUaQZSiAUH44wAQhQUaQaCiAUGI5AAQhQUaQayiAUGY5AAQhQUaC3UBAn8jCSEGIwlBEGokCSAAQQhqIgAoAgAoAgAhByAAIAdBP3ERAgAhACAGIAMoAgA2AgAgBkEEaiIDIAYoAgA2AgAgAiADIAAgAEGoAWogBSAEQQAQ0AIgAGsiAEGoAUgEQCABIABBDG1BB282AgALIAYkCQt1AQJ/IwkhBiMJQRBqJAkgAEEIaiIAKAIAKAIEIQcgACAHQT9xEQIAIQAgBiADKAIANgIAIAZBBGoiAyAGKAIANgIAIAIgAyAAIABBoAJqIAUgBEEAENACIABrIgBBoAJIBEAgASAAQQxtQQxvNgIACyAGJAkL9QoBDH8jCSEPIwlBEGokCSAPQQhqIREgD0EEaiESIA8hEyAPQQxqIhAgAxDbASAQQZS1ARCSAiEMIBAQkwIgBEEANgIAQQAhCwJAAkADQAJAIAEoAgAhCCALRSAGIAdHcUUNACAIIQsgCAR/IAgoAgwiCSAIKAIQRgR/IAgoAgAoAiQhCSAIIAlBP3ERAgAFIAkoAgAQPAsQIBDcAQR/IAFBADYCAEEAIQhBACELQQEFQQALBUEAIQhBAQshDSACKAIAIgohCQJAAkAgCkUNACAKKAIMIg4gCigCEEYEfyAKKAIAKAIkIQ4gCiAOQT9xEQIABSAOKAIAEDwLECAQ3AEEQCACQQA2AgBBACEJDAEFIA1FDQULDAELIA0NA0EAIQoLIAwoAgAoAjQhDSAMIAYoAgBBACANQR9xQdAAahEAAEH/AXFBJUYEQCAHIAZBBGoiDUYNAyAMKAIAKAI0IQoCQAJAAkAgDCANKAIAQQAgCkEfcUHQAGoRAAAiCkEYdEEYdUEwaw4WAAEBAQEBAQEBAQEBAQEBAQEBAQEBAAELIAcgBkEIaiIGRg0FIAwoAgAoAjQhDiAKIQggDCAGKAIAQQAgDkEfcUHQAGoRAAAhCiANIQYMAQtBACEICyAAKAIAKAIkIQ0gEiALNgIAIBMgCTYCACARIBIoAgA2AgAgECATKAIANgIAIAEgACARIBAgAyAEIAUgCiAIIA1BD3FB7AFqEQYANgIAIAZBCGohBgUCQCAMKAIAKAIMIQsgDEGAwAAgBigCACALQR9xQdAAahEAAEUEQCAIQQxqIgsoAgAiCSAIQRBqIgooAgBGBH8gCCgCACgCJCEJIAggCUE/cRECAAUgCSgCABA8CyEJIAwoAgAoAhwhDSAMIAkgDUEPcUFAaxEDACEJIAwoAgAoAhwhDSAMIAYoAgAgDUEPcUFAaxEDACAJRwRAIARBBDYCAAwCCyALKAIAIgkgCigCAEYEQCAIKAIAKAIoIQsgCCALQT9xEQIAGgUgCyAJQQRqNgIAIAkoAgAQPBoLIAZBBGohBgwBCwNAAkAgByAGQQRqIgZGBEAgByEGDAELIAwoAgAoAgwhCyAMQYDAACAGKAIAIAtBH3FB0ABqEQAADQELCyAKIQsDQCAIBH8gCCgCDCIJIAgoAhBGBH8gCCgCACgCJCEJIAggCUE/cRECAAUgCSgCABA8CxAgENwBBH8gAUEANgIAQQAhCEEBBUEACwVBACEIQQELIQkCQAJAIAtFDQAgCygCDCIKIAsoAhBGBH8gCygCACgCJCEKIAsgCkE/cRECAAUgCigCABA8CxAgENwBBEAgAkEANgIADAEFIAlFDQQLDAELIAkNAkEAIQsLIAhBDGoiCSgCACIKIAhBEGoiDSgCAEYEfyAIKAIAKAIkIQogCCAKQT9xEQIABSAKKAIAEDwLIQogDCgCACgCDCEOIAxBgMAAIAogDkEfcUHQAGoRAABFDQEgCSgCACIKIA0oAgBGBEAgCCgCACgCKCEJIAggCUE/cRECABoFIAkgCkEEajYCACAKKAIAEDwaCwwAAAsACwsgBCgCACELDAELCwwBCyAEQQQ2AgALIAgEfyAIKAIMIgAgCCgCEEYEfyAIKAIAKAIkIQAgCCAAQT9xEQIABSAAKAIAEDwLECAQ3AEEfyABQQA2AgBBACEIQQEFQQALBUEAIQhBAQshAAJAAkACQCACKAIAIgFFDQAgASgCDCIDIAEoAhBGBH8gASgCACgCJCEDIAEgA0E/cRECAAUgAygCABA8CxAgENwBBEAgAkEANgIADAEFIABFDQILDAILIAANAAwBCyAEIAQoAgBBAnI2AgALIA8kCSAIC2IAIwkhACMJQRBqJAkgACADKAIANgIAIABBBGoiAyAAKAIANgIAIAIgAyAEIAVBAhCuAyECIAQoAgAiA0EEcUUgAkF/akEfSXEEQCABIAI2AgAFIAQgA0EEcjYCAAsgACQJC18AIwkhACMJQRBqJAkgACADKAIANgIAIABBBGoiAyAAKAIANgIAIAIgAyAEIAVBAhCuAyECIAQoAgAiA0EEcUUgAkEYSHEEQCABIAI2AgAFIAQgA0EEcjYCAAsgACQJC2IAIwkhACMJQRBqJAkgACADKAIANgIAIABBBGoiAyAAKAIANgIAIAIgAyAEIAVBAhCuAyECIAQoAgAiA0EEcUUgAkF/akEMSXEEQCABIAI2AgAFIAQgA0EEcjYCAAsgACQJC2AAIwkhACMJQRBqJAkgACADKAIANgIAIABBBGoiAyAAKAIANgIAIAIgAyAEIAVBAxCuAyECIAQoAgAiA0EEcUUgAkHuAkhxBEAgASACNgIABSAEIANBBHI2AgALIAAkCQtiACMJIQAjCUEQaiQJIAAgAygCADYCACAAQQRqIgMgACgCADYCACACIAMgBCAFQQIQrgMhAiAEKAIAIgNBBHFFIAJBDUhxBEAgASACQX9qNgIABSAEIANBBHI2AgALIAAkCQtfACMJIQAjCUEQaiQJIAAgAygCADYCACAAQQRqIgMgACgCADYCACACIAMgBCAFQQIQrgMhAiAEKAIAIgNBBHFFIAJBPEhxBEAgASACNgIABSAEIANBBHI2AgALIAAkCQuTBAECfwNAAkAgASgCACIABH8gACgCDCIFIAAoAhBGBH8gACgCACgCJCEFIAAgBUE/cRECAAUgBSgCABA8CxAgENwBBH8gAUEANgIAQQEFIAEoAgBFCwVBAQshBQJAAkAgAigCACIARQ0AIAAoAgwiBiAAKAIQRgR/IAAoAgAoAiQhBiAAIAZBP3ERAgAFIAYoAgAQPAsQIBDcAQRAIAJBADYCAAwBBSAFRQ0DCwwBCyAFBH9BACEADAIFQQALIQALIAEoAgAiBSgCDCIGIAUoAhBGBH8gBSgCACgCJCEGIAUgBkE/cRECAAUgBigCABA8CyEFIAQoAgAoAgwhBiAEQYDAACAFIAZBH3FB0ABqEQAARQ0AIAEoAgAiAEEMaiIGKAIAIgUgACgCEEYEQCAAKAIAKAIoIQUgACAFQT9xEQIAGgUgBiAFQQRqNgIAIAUoAgAQPBoLDAELCyABKAIAIgQEfyAEKAIMIgUgBCgCEEYEfyAEKAIAKAIkIQUgBCAFQT9xEQIABSAFKAIAEDwLECAQ3AEEfyABQQA2AgBBAQUgASgCAEULBUEBCyEBAkACQAJAIABFDQAgACgCDCIEIAAoAhBGBH8gACgCACgCJCEEIAAgBEE/cRECAAUgBCgCABA8CxAgENwBBEAgAkEANgIADAEFIAFFDQILDAILIAENAAwBCyADIAMoAgBBAnI2AgALC+IBAQV/IwkhByMJQRBqJAkgB0EEaiEIIAchCSAAQQhqIgAoAgAoAgghBiAAIAZBP3ERAgAiACwACyIGQQBIBH8gACgCBAUgBkH/AXELIQZBACAALAAXIgpBAEgEfyAAKAIQBSAKQf8BcQtrIAZGBEAgBCAEKAIAQQRyNgIABQJAIAkgAygCADYCACAIIAkoAgA2AgAgAiAIIAAgAEEYaiAFIARBABDQAiAAayICRSABKAIAIgBBDEZxBEAgAUEANgIADAELIAJBDEYgAEEMSHEEQCABIABBDGo2AgALCwsgByQJC18AIwkhACMJQRBqJAkgACADKAIANgIAIABBBGoiAyAAKAIANgIAIAIgAyAEIAVBAhCuAyECIAQoAgAiA0EEcUUgAkE9SHEEQCABIAI2AgAFIAQgA0EEcjYCAAsgACQJC18AIwkhACMJQRBqJAkgACADKAIANgIAIABBBGoiAyAAKAIANgIAIAIgAyAEIAVBARCuAyECIAQoAgAiA0EEcUUgAkEHSHEEQCABIAI2AgAFIAQgA0EEcjYCAAsgACQJC28BAX8jCSEGIwlBEGokCSAGIAMoAgA2AgAgBkEEaiIAIAYoAgA2AgAgAiAAIAQgBUEEEK4DIQAgBCgCAEEEcUUEQCABIABBxQBIBH8gAEHQD2oFIABB7A5qIAAgAEHkAEgbC0GUcWo2AgALIAYkCQtQACMJIQAjCUEQaiQJIAAgAygCADYCACAAQQRqIgMgACgCADYCACACIAMgBCAFQQQQrgMhAiAEKAIAQQRxRQRAIAEgAkGUcWo2AgALIAAkCQuqBAECfyABKAIAIgAEfyAAKAIMIgUgACgCEEYEfyAAKAIAKAIkIQUgACAFQT9xEQIABSAFKAIAEDwLECAQ3AEEfyABQQA2AgBBAQUgASgCAEULBUEBCyEFAkACQAJAIAIoAgAiAARAIAAoAgwiBiAAKAIQRgR/IAAoAgAoAiQhBiAAIAZBP3ERAgAFIAYoAgAQPAsQIBDcAQRAIAJBADYCAAUgBQRADAQFDAMLAAsLIAVFBEBBACEADAILCyADIAMoAgBBBnI2AgAMAQsgASgCACIFKAIMIgYgBSgCEEYEfyAFKAIAKAIkIQYgBSAGQT9xEQIABSAGKAIAEDwLIQUgBCgCACgCNCEGIAQgBUEAIAZBH3FB0ABqEQAAQf8BcUElRwRAIAMgAygCAEEEcjYCAAwBCyABKAIAIgRBDGoiBigCACIFIAQoAhBGBEAgBCgCACgCKCEFIAQgBUE/cRECABoFIAYgBUEEajYCACAFKAIAEDwaCyABKAIAIgQEfyAEKAIMIgUgBCgCEEYEfyAEKAIAKAIkIQUgBCAFQT9xEQIABSAFKAIAEDwLECAQ3AEEfyABQQA2AgBBAQUgASgCAEULBUEBCyEBAkACQCAARQ0AIAAoAgwiBCAAKAIQRgR/IAAoAgAoAiQhBCAAIARBP3ERAgAFIAQoAgAQPAsQIBDcAQRAIAJBADYCAAwBBSABDQMLDAELIAFFDQELIAMgAygCAEECcjYCAAsL6AcBB38gACgCACIIBH8gCCgCDCIGIAgoAhBGBH8gCCgCACgCJCEGIAggBkE/cRECAAUgBigCABA8CxAgENwBBH8gAEEANgIAQQEFIAAoAgBFCwVBAQshBQJAAkACQCABKAIAIggEQCAIKAIMIgYgCCgCEEYEfyAIKAIAKAIkIQYgCCAGQT9xEQIABSAGKAIAEDwLECAQ3AEEQCABQQA2AgAFIAUEQAwEBQwDCwALCyAFRQRAQQAhCAwCCwsgAiACKAIAQQZyNgIAQQAhBgwBCyAAKAIAIgUoAgwiBiAFKAIQRgR/IAUoAgAoAiQhBiAFIAZBP3ERAgAFIAYoAgAQPAshBSADKAIAKAIMIQYgA0GAECAFIAZBH3FB0ABqEQAARQRAIAIgAigCAEEEcjYCAEEAIQYMAQsgAygCACgCNCEGIAMgBUEAIAZBH3FB0ABqEQAAQRh0QRh1IQYgACgCACIHQQxqIgUoAgAiCyAHKAIQRgRAIAcoAgAoAighBSAHIAVBP3ERAgAaBSAFIAtBBGo2AgAgCygCABA8GgsgBCEFIAghBANAAkAgBkFQaiEGIAVBf2ohCyAAKAIAIgkEfyAJKAIMIgcgCSgCEEYEfyAJKAIAKAIkIQcgCSAHQT9xEQIABSAHKAIAEDwLECAQ3AEEfyAAQQA2AgBBAQUgACgCAEULBUEBCyEJIAgEfyAIKAIMIgcgCCgCEEYEfyAIKAIAKAIkIQcgCCAHQT9xEQIABSAHKAIAEDwLECAQ3AEEfyABQQA2AgBBACEEQQAhCEEBBUEACwVBACEIQQELIQcgACgCACEKIAcgCXMgBUEBSnFFDQAgCigCDCIFIAooAhBGBH8gCigCACgCJCEFIAogBUE/cRECAAUgBSgCABA8CyEHIAMoAgAoAgwhBSADQYAQIAcgBUEfcUHQAGoRAABFDQIgAygCACgCNCEFIAZBCmwgAyAHQQAgBUEfcUHQAGoRAABBGHRBGHVqIQYgACgCACIJQQxqIgUoAgAiByAJKAIQRgRAIAkoAgAoAighBSAJIAVBP3ERAgAaBSAFIAdBBGo2AgAgBygCABA8GgsgCyEFDAELCyAKBH8gCigCDCIDIAooAhBGBH8gCigCACgCJCEDIAogA0E/cRECAAUgAygCABA8CxAgENwBBH8gAEEANgIAQQEFIAAoAgBFCwVBAQshAwJAAkAgBEUNACAEKAIMIgAgBCgCEEYEfyAEKAIAKAIkIQAgBCAAQT9xEQIABSAAKAIAEDwLECAQ3AEEQCABQQA2AgAMAQUgAw0DCwwBCyADRQ0BCyACIAIoAgBBAnI2AgALIAYLDgAgAEEIahC0AyAAEE0LEwAgAEEIahC0AyAAEE0gABDtBAu9AQAjCSECIwlB8ABqJAkgAkHkAGoiAyACQeQAajYCACAAQQhqIAIgAyAEIAUgBhCyAyADKAIAIQUgAiEDIAEoAgAhAANAIAMgBUcEQCADLAAAIQEgAAR/QQAgACAAQRhqIgYoAgAiBCAAKAIcRgR/IAAoAgAoAjQhBCAAIAEQJCAEQQ9xQUBrEQMABSAGIARBAWo2AgAgBCABOgAAIAEQJAsQIBAhGwVBAAshACADQQFqIQMMAQsLIAIkCSAAC3EBBH8jCSEHIwlBEGokCSAHIgZBJToAACAGQQFqIgggBDoAACAGQQJqIgkgBToAACAGQQA6AAMgBUH/AXEEQCAIIAU6AAAgCSAEOgAACyACIAEgASACKAIAELMDIAYgAyAAKAIAEBggAWo2AgAgByQJCwcAIAEgAGsLFgAgACgCABCVAkcEQCAAKAIAEIgBCwu+AQAjCSECIwlBoANqJAkgAkGQA2oiAyACQZADajYCACAAQQhqIAIgAyAEIAUgBhC2AyADKAIAIQUgAiEDIAEoAgAhAANAIAMgBUcEQCADKAIAIQEgAAR/QQAgACAAQRhqIgYoAgAiBCAAKAIcRgR/IAAoAgAoAjQhBCAAIAEQPCAEQQ9xQUBrEQMABSAGIARBBGo2AgAgBCABNgIAIAEQPAsQIBDcARsFQQALIQAgA0EEaiEDDAELCyACJAkgAAuXAQECfyMJIQYjCUGAAWokCSAGQfQAaiIHIAZB5ABqNgIAIAAgBiAHIAMgBCAFELIDIAZB6ABqIgNCADcDACAGQfAAaiIEIAY2AgAgASACKAIAELcDIQUgACgCABCVASEAIAEgBCAFIAMQmAEhAyAABEAgABCVARoLIANBf0YEQEEAELgDBSACIANBAnQgAWo2AgAgBiQJCwsKACABIABrQQJ1CwQAEA4LBQBB/wALNwEBfyAAQgA3AgAgAEEANgIIQQAhAgNAIAJBA0cEQCACQQJ0IABqQQA2AgAgAkEBaiECDAELCwsZACAAQgA3AgAgAEEANgIIIABBAUEtEPEECwwAIABBgoaAIDYAAAsIAEH/////BwsZACAAQgA3AgAgAEEANgIIIABBAUEtEP8EC7YFAQx/IwkhByMJQYACaiQJIAdB2AFqIRAgByERIAdB6AFqIgsgB0HwAGoiCTYCACALQd4ANgIEIAdB4AFqIg0gBBDbASANQfS0ARCSAiEOIAdB+gFqIgxBADoAACAHQdwBaiIKIAIoAgA2AgAgBCgCBCEAIAdB8AFqIgQgCigCADYCACABIAQgAyANIAAgBSAMIA4gCyAHQeQBaiISIAlB5ABqEMEDBEAgDigCACgCICEAIA5B9v0AQYD+ACAEIABBB3FB8ABqEQkAGiASKAIAIgAgCygCACIDayIKQeIASgRAIApBAmoQrAEiCSEKIAkEQCAJIQggCiEPBRDrBAsFIBEhCEEAIQ8LIAwsAAAEQCAIQS06AAAgCEEBaiEICyAEQQpqIQkgBCEKA0AgAyAASQRAIAMsAAAhDCAEIQADQAJAIAAgCUYEQCAJIQAMAQsgACwAACAMRwRAIABBAWohAAwCCwsLIAggACAKa0H2/QBqLAAAOgAAIANBAWohAyAIQQFqIQggEigCACEADAELCyAIQQA6AAAgECAGNgIAIBFBgf4AIBAQWUEBRwRAQQAQuAMLIA8EQCAPEK0BCwsgASgCACIDBH8gAygCDCIAIAMoAhBGBH8gAygCACgCJCEAIAMgAEE/cRECAAUgACwAABAkCxAgECEEfyABQQA2AgBBAQUgASgCAEULBUEBCyEEAkACQAJAIAIoAgAiA0UNACADKAIMIgAgAygCEEYEfyADKAIAKAIkIQAgAyAAQT9xEQIABSAALAAAECQLECAQIQRAIAJBADYCAAwBBSAERQ0CCwwCCyAEDQAMAQsgBSAFKAIAQQJyNgIACyABKAIAIQEgDRCTAiALKAIAIQIgC0EANgIAIAIEQCALKAIEIQAgAiAAQf8AcUGFAmoRBwALIAckCSABC9MEAQd/IwkhCCMJQYABaiQJIAhB8ABqIgkgCDYCACAJQd4ANgIEIAhB5ABqIgwgBBDbASAMQfS0ARCSAiEKIAhB/ABqIgtBADoAACAIQegAaiIAIAIoAgAiDTYCACAEKAIEIQQgCEH4AGoiByAAKAIANgIAIA0hACABIAcgAyAMIAQgBSALIAogCSAIQewAaiIEIAhB5ABqEMEDBEAgBkELaiIDLAAAQQBIBEAgBigCACEDIAdBADoAACADIAcQ/wEgBkEANgIEBSAHQQA6AAAgBiAHEP8BIANBADoAAAsgCywAAARAIAooAgAoAhwhAyAGIApBLSADQQ9xQUBrEQMAEP0ECyAKKAIAKAIcIQMgCkEwIANBD3FBQGsRAwAhCyAEKAIAIgRBf2ohAyAJKAIAIQcDQAJAIAcgA08NACAHLQAAIAtB/wFxRw0AIAdBAWohBwwBCwsgBiAHIAQQwgMaCyABKAIAIgQEfyAEKAIMIgMgBCgCEEYEfyAEKAIAKAIkIQMgBCADQT9xEQIABSADLAAAECQLECAQIQR/IAFBADYCAEEBBSABKAIARQsFQQELIQQCQAJAAkAgDUUNACAAKAIMIgMgACgCEEYEfyANKAIAKAIkIQMgACADQT9xEQIABSADLAAAECQLECAQIQRAIAJBADYCAAwBBSAERQ0CCwwCCyAEDQAMAQsgBSAFKAIAQQJyNgIACyABKAIAIQEgDBCTAiAJKAIAIQIgCUEANgIAIAIEQCAJKAIEIQAgAiAAQf8AcUGFAmoRBwALIAgkCSABC80lASR/IwkhDCMJQYAEaiQJIAxB8ANqIRwgDEHtA2ohJiAMQewDaiEnIAxBvANqIQ0gDEGwA2ohDiAMQaQDaiEPIAxBmANqIREgDEGUA2ohGCAMQZADaiEhIAxB6ANqIh0gCjYCACAMQeADaiIUIAw2AgAgFEHeADYCBCAMQdgDaiITIAw2AgAgDEHUA2oiHiAMQZADajYCACAMQcgDaiIVQgA3AgAgFUEANgIIQQAhCgNAIApBA0cEQCAKQQJ0IBVqQQA2AgAgCkEBaiEKDAELCyANQgA3AgAgDUEANgIIQQAhCgNAIApBA0cEQCAKQQJ0IA1qQQA2AgAgCkEBaiEKDAELCyAOQgA3AgAgDkEANgIIQQAhCgNAIApBA0cEQCAKQQJ0IA5qQQA2AgAgCkEBaiEKDAELCyAPQgA3AgAgD0EANgIIQQAhCgNAIApBA0cEQCAKQQJ0IA9qQQA2AgAgCkEBaiEKDAELCyARQgA3AgAgEUEANgIIQQAhCgNAIApBA0cEQCAKQQJ0IBFqQQA2AgAgCkEBaiEKDAELCyACIAMgHCAmICcgFSANIA4gDyAYEMQDIAkgCCgCADYCACAHQQhqIRkgDkELaiEaIA5BBGohIiAPQQtqIRsgD0EEaiEjIBVBC2ohKSAVQQRqISogBEGABHFBAEchKCANQQtqIR8gHEEDaiErIA1BBGohJCARQQtqISwgEUEEaiEtQQAhAkEAIRICfwJAAkACQAJAAkACQANAAkAgEkEETw0HIAAoAgAiAwR/IAMoAgwiBCADKAIQRgR/IAMoAgAoAiQhBCADIARBP3ERAgAFIAQsAAAQJAsQIBAhBH8gAEEANgIAQQEFIAAoAgBFCwVBAQshAwJAAkAgASgCACIKRQ0AIAooAgwiBCAKKAIQRgR/IAooAgAoAiQhBCAKIARBP3ERAgAFIAQsAAAQJAsQIBAhBEAgAUEANgIADAEFIANFDQoLDAELIAMNCEEAIQoLAkACQAJAAkACQAJAAkAgEiAcaiwAAA4FAQADAgQGCyASQQNHBEAgACgCACIDKAIMIgQgAygCEEYEfyADKAIAKAIkIQQgAyAEQT9xEQIABSAELAAAECQLIgNB/wFxQRh0QRh1QX9MDQcgGSgCACADQRh0QRh1QQF0ai4BAEGAwABxRQ0HIBEgACgCACIDQQxqIgcoAgAiBCADKAIQRgR/IAMoAgAoAighBCADIARBP3ERAgAFIAcgBEEBajYCACAELAAAECQLQf8BcRD9BAwFCwwFCyASQQNHDQMMBAsgIigCACAaLAAAIgNB/wFxIANBAEgbIgpBACAjKAIAIBssAAAiA0H/AXEgA0EASBsiC2tHBEAgACgCACIDKAIMIgQgAygCEEYhByAKRSIKIAtFcgRAIAcEfyADKAIAKAIkIQQgAyAEQT9xEQIABSAELAAAECQLQf8BcSEDIAoEQCAPKAIAIA8gGywAAEEASBstAAAgA0H/AXFHDQYgACgCACIDQQxqIgcoAgAiBCADKAIQRgRAIAMoAgAoAighBCADIARBP3ERAgAaBSAHIARBAWo2AgAgBCwAABAkGgsgBkEBOgAAIA8gAiAjKAIAIBssAAAiAkH/AXEgAkEASBtBAUsbIQIMBgsgDigCACAOIBosAABBAEgbLQAAIANB/wFxRwRAIAZBAToAAAwGCyAAKAIAIgNBDGoiBygCACIEIAMoAhBGBEAgAygCACgCKCEEIAMgBEE/cRECABoFIAcgBEEBajYCACAELAAAECQaCyAOIAIgIigCACAaLAAAIgJB/wFxIAJBAEgbQQFLGyECDAULIAcEfyADKAIAKAIkIQQgAyAEQT9xEQIABSAELAAAECQLIQcgACgCACIDQQxqIgsoAgAiBCADKAIQRiEKIA4oAgAgDiAaLAAAQQBIGy0AACAHQf8BcUYEQCAKBEAgAygCACgCKCEEIAMgBEE/cRECABoFIAsgBEEBajYCACAELAAAECQaCyAOIAIgIigCACAaLAAAIgJB/wFxIAJBAEgbQQFLGyECDAULIAoEfyADKAIAKAIkIQQgAyAEQT9xEQIABSAELAAAECQLQf8BcSAPKAIAIA8gGywAAEEASBstAABHDQcgACgCACIDQQxqIgcoAgAiBCADKAIQRgRAIAMoAgAoAighBCADIARBP3ERAgAaBSAHIARBAWo2AgAgBCwAABAkGgsgBkEBOgAAIA8gAiAjKAIAIBssAAAiAkH/AXEgAkEASBtBAUsbIQILDAMLAkACQCASQQJJIAJyBEAgDSgCACIHIA0gHywAACIDQQBIIgsbIhYhBCASDQEFIBJBAkYgKywAAEEAR3EgKHJFBEBBACECDAYLIA0oAgAiByANIB8sAAAiA0EASCILGyIWIQQMAQsMAQsgHCASQX9qai0AAEECSARAICQoAgAgA0H/AXEgCxsgFmohICAEIQsDQAJAICAgCyIQRg0AIBAsAAAiF0F/TA0AIBkoAgAgF0EBdGouAQBBgMAAcUUNACAQQQFqIQsMAQsLICwsAAAiF0EASCEQIAsgBGsiICAtKAIAIiUgF0H/AXEiFyAQG00EQCAlIBEoAgBqIiUgESAXaiIXIBAbIS4gJSAgayAXICBrIBAbIRADQCAQIC5GBEAgCyEEDAQLIBAsAAAgFiwAAEYEQCAWQQFqIRYgEEEBaiEQDAELCwsLCwNAAkAgBCAHIA0gA0EYdEEYdUEASCIHGyAkKAIAIANB/wFxIAcbakYNACAAKAIAIgMEfyADKAIMIgcgAygCEEYEfyADKAIAKAIkIQcgAyAHQT9xEQIABSAHLAAAECQLECAQIQR/IABBADYCAEEBBSAAKAIARQsFQQELIQMCQAJAIApFDQAgCigCDCIHIAooAhBGBH8gCigCACgCJCEHIAogB0E/cRECAAUgBywAABAkCxAgECEEQCABQQA2AgAMAQUgA0UNAwsMAQsgAw0BQQAhCgsgACgCACIDKAIMIgcgAygCEEYEfyADKAIAKAIkIQcgAyAHQT9xEQIABSAHLAAAECQLQf8BcSAELQAARw0AIAAoAgAiA0EMaiILKAIAIgcgAygCEEYEQCADKAIAKAIoIQcgAyAHQT9xEQIAGgUgCyAHQQFqNgIAIAcsAAAQJBoLIARBAWohBCAfLAAAIQMgDSgCACEHDAELCyAoBEAgBCANKAIAIA0gHywAACIDQQBIIgQbICQoAgAgA0H/AXEgBBtqRw0HCwwCC0EAIQQgCiEDA0ACQCAAKAIAIgcEfyAHKAIMIgsgBygCEEYEfyAHKAIAKAIkIQsgByALQT9xEQIABSALLAAAECQLECAQIQR/IABBADYCAEEBBSAAKAIARQsFQQELIQcCQAJAIApFDQAgCigCDCILIAooAhBGBH8gCigCACgCJCELIAogC0E/cRECAAUgCywAABAkCxAgECEEQCABQQA2AgBBACEDDAEFIAdFDQMLDAELIAcNAUEAIQoLAn8CQCAAKAIAIgcoAgwiCyAHKAIQRgR/IAcoAgAoAiQhCyAHIAtBP3ERAgAFIAssAAAQJAsiB0H/AXEiC0EYdEEYdUF/TA0AIBkoAgAgB0EYdEEYdUEBdGouAQBBgBBxRQ0AIAkoAgAiByAdKAIARgRAIAggCSAdEMUDIAkoAgAhBwsgCSAHQQFqNgIAIAcgCzoAACAEQQFqDAELICooAgAgKSwAACIHQf8BcSAHQQBIG0EARyAEQQBHcSAnLQAAIAtB/wFxRnFFDQEgEygCACIHIB4oAgBGBEAgFCATIB4QxgMgEygCACEHCyATIAdBBGo2AgAgByAENgIAQQALIQQgACgCACIHQQxqIhYoAgAiCyAHKAIQRgRAIAcoAgAoAighCyAHIAtBP3ERAgAaBSAWIAtBAWo2AgAgCywAABAkGgsMAQsLIBMoAgAiByAUKAIARyAEQQBHcQRAIAcgHigCAEYEQCAUIBMgHhDGAyATKAIAIQcLIBMgB0EEajYCACAHIAQ2AgALIBgoAgBBAEoEQAJAIAAoAgAiBAR/IAQoAgwiByAEKAIQRgR/IAQoAgAoAiQhByAEIAdBP3ERAgAFIAcsAAAQJAsQIBAhBH8gAEEANgIAQQEFIAAoAgBFCwVBAQshBAJAAkAgA0UNACADKAIMIgcgAygCEEYEfyADKAIAKAIkIQcgAyAHQT9xEQIABSAHLAAAECQLECAQIQRAIAFBADYCAAwBBSAERQ0LCwwBCyAEDQlBACEDCyAAKAIAIgQoAgwiByAEKAIQRgR/IAQoAgAoAiQhByAEIAdBP3ERAgAFIAcsAAAQJAtB/wFxICYtAABHDQggACgCACIEQQxqIgooAgAiByAEKAIQRgRAIAQoAgAoAighByAEIAdBP3ERAgAaBSAKIAdBAWo2AgAgBywAABAkGgsDQCAYKAIAQQBMDQEgACgCACIEBH8gBCgCDCIHIAQoAhBGBH8gBCgCACgCJCEHIAQgB0E/cRECAAUgBywAABAkCxAgECEEfyAAQQA2AgBBAQUgACgCAEULBUEBCyEEAkACQCADRQ0AIAMoAgwiByADKAIQRgR/IAMoAgAoAiQhByADIAdBP3ERAgAFIAcsAAAQJAsQIBAhBEAgAUEANgIADAEFIARFDQ0LDAELIAQNC0EAIQMLIAAoAgAiBCgCDCIHIAQoAhBGBH8gBCgCACgCJCEHIAQgB0E/cRECAAUgBywAABAkCyIEQf8BcUEYdEEYdUF/TA0KIBkoAgAgBEEYdEEYdUEBdGouAQBBgBBxRQ0KIAkoAgAgHSgCAEYEQCAIIAkgHRDFAwsgACgCACIEKAIMIgcgBCgCEEYEfyAEKAIAKAIkIQcgBCAHQT9xEQIABSAHLAAAECQLIQQgCSAJKAIAIgdBAWo2AgAgByAEOgAAIBggGCgCAEF/ajYCACAAKAIAIgRBDGoiCigCACIHIAQoAhBGBEAgBCgCACgCKCEHIAQgB0E/cRECABoFIAogB0EBajYCACAHLAAAECQaCwwAAAsACwsgCSgCACAIKAIARg0IDAELA0AgACgCACIDBH8gAygCDCIEIAMoAhBGBH8gAygCACgCJCEEIAMgBEE/cRECAAUgBCwAABAkCxAgECEEfyAAQQA2AgBBAQUgACgCAEULBUEBCyEDAkACQCAKRQ0AIAooAgwiBCAKKAIQRgR/IAooAgAoAiQhBCAKIARBP3ERAgAFIAQsAAAQJAsQIBAhBEAgAUEANgIADAEFIANFDQQLDAELIAMNAkEAIQoLIAAoAgAiAygCDCIEIAMoAhBGBH8gAygCACgCJCEEIAMgBEE/cRECAAUgBCwAABAkCyIDQf8BcUEYdEEYdUF/TA0BIBkoAgAgA0EYdEEYdUEBdGouAQBBgMAAcUUNASARIAAoAgAiA0EMaiIHKAIAIgQgAygCEEYEfyADKAIAKAIoIQQgAyAEQT9xEQIABSAHIARBAWo2AgAgBCwAABAkC0H/AXEQ/QQMAAALAAsgEkEBaiESDAELCyAFIAUoAgBBBHI2AgBBAAwGCyAFIAUoAgBBBHI2AgBBAAwFCyAFIAUoAgBBBHI2AgBBAAwECyAFIAUoAgBBBHI2AgBBAAwDCyAFIAUoAgBBBHI2AgBBAAwCCyAFIAUoAgBBBHI2AgBBAAwBCyACBEACQCACQQtqIQcgAkEEaiEIQQEhAwNAAkAgAyAHLAAAIgRBAEgEfyAIKAIABSAEQf8BcQtPDQIgACgCACIEBH8gBCgCDCIGIAQoAhBGBH8gBCgCACgCJCEGIAQgBkE/cRECAAUgBiwAABAkCxAgECEEfyAAQQA2AgBBAQUgACgCAEULBUEBCyEEAkACQCABKAIAIgZFDQAgBigCDCIJIAYoAhBGBH8gBigCACgCJCEJIAYgCUE/cRECAAUgCSwAABAkCxAgECEEQCABQQA2AgAMAQUgBEUNAwsMAQsgBA0BCyAAKAIAIgQoAgwiBiAEKAIQRgR/IAQoAgAoAiQhBiAEIAZBP3ERAgAFIAYsAAAQJAtB/wFxIAcsAABBAEgEfyACKAIABSACCyADai0AAEcNACADQQFqIQMgACgCACIEQQxqIgkoAgAiBiAEKAIQRgRAIAQoAgAoAighBiAEIAZBP3ERAgAaBSAJIAZBAWo2AgAgBiwAABAkGgsMAQsLIAUgBSgCAEEEcjYCAEEADAILCyAUKAIAIgAgEygCACIBRgR/QQEFICFBADYCACAVIAAgASAhEKECICEoAgAEfyAFIAUoAgBBBHI2AgBBAAVBAQsLCyEAIBEQ8wQgDxDzBCAOEPMEIA0Q8wQgFRDzBCAUKAIAIQEgFEEANgIAIAEEQCAUKAIEIQIgASACQf8AcUGFAmoRBwALIAwkCSAAC+wCAQl/IwkhCyMJQRBqJAkgASEFIAshAyAAQQtqIgksAAAiB0EASCIIBH8gACgCCEH/////B3FBf2ohBiAAKAIEBUEKIQYgB0H/AXELIQQgAiAFayIKBEACQCABIAgEfyAAKAIEIQcgACgCAAUgB0H/AXEhByAACyIIIAcgCGoQwwMEQCADQgA3AgAgA0EANgIIIAMgASACEP4BIAAgAygCACADIAMsAAsiAUEASCICGyADKAIEIAFB/wFxIAIbEPwEGiADEPMEDAELIAYgBGsgCkkEQCAAIAYgBCAKaiAGayAEIARBAEEAEPsECyACIAQgBWtqIQYgBCAJLAAAQQBIBH8gACgCAAUgAAsiCGohBQNAIAEgAkcEQCAFIAEQ/wEgBUEBaiEFIAFBAWohAQwBCwsgA0EAOgAAIAYgCGogAxD/ASAEIApqIQEgCSwAAEEASARAIAAgATYCBAUgCSABOgAACwsLIAskCSAACw0AIAAgAkkgASAATXELxwwBA38jCSEMIwlBEGokCSAMQQxqIQsgDCEKIAkgAAR/IAFB3LYBEJICIgEoAgAoAiwhACALIAEgAEE/cUGFA2oRBAAgAiALKAIANgAAIAEoAgAoAiAhACAKIAEgAEE/cUGFA2oRBAAgCEELaiIALAAAQQBIBH8gCCgCACEAIAtBADoAACAAIAsQ/wEgCEEANgIEIAgFIAtBADoAACAIIAsQ/wEgAEEAOgAAIAgLIQAgCEEAEPcEIAAgCikCADcCACAAIAooAgg2AghBACEAA0AgAEEDRwRAIABBAnQgCmpBADYCACAAQQFqIQAMAQsLIAoQ8wQgASgCACgCHCEAIAogASAAQT9xQYUDahEEACAHQQtqIgAsAABBAEgEfyAHKAIAIQAgC0EAOgAAIAAgCxD/ASAHQQA2AgQgBwUgC0EAOgAAIAcgCxD/ASAAQQA6AAAgBwshACAHQQAQ9wQgACAKKQIANwIAIAAgCigCCDYCCEEAIQADQCAAQQNHBEAgAEECdCAKakEANgIAIABBAWohAAwBCwsgChDzBCABKAIAKAIMIQAgAyABIABBP3ERAgA6AAAgASgCACgCECEAIAQgASAAQT9xEQIAOgAAIAEoAgAoAhQhACAKIAEgAEE/cUGFA2oRBAAgBUELaiIALAAAQQBIBH8gBSgCACEAIAtBADoAACAAIAsQ/wEgBUEANgIEIAUFIAtBADoAACAFIAsQ/wEgAEEAOgAAIAULIQAgBUEAEPcEIAAgCikCADcCACAAIAooAgg2AghBACEAA0AgAEEDRwRAIABBAnQgCmpBADYCACAAQQFqIQAMAQsLIAoQ8wQgASgCACgCGCEAIAogASAAQT9xQYUDahEEACAGQQtqIgAsAABBAEgEfyAGKAIAIQAgC0EAOgAAIAAgCxD/ASAGQQA2AgQgBgUgC0EAOgAAIAYgCxD/ASAAQQA6AAAgBgshACAGQQAQ9wQgACAKKQIANwIAIAAgCigCCDYCCEEAIQADQCAAQQNHBEAgAEECdCAKakEANgIAIABBAWohAAwBCwsgChDzBCABKAIAKAIkIQAgASAAQT9xEQIABSABQdS2ARCSAiIBKAIAKAIsIQAgCyABIABBP3FBhQNqEQQAIAIgCygCADYAACABKAIAKAIgIQAgCiABIABBP3FBhQNqEQQAIAhBC2oiACwAAEEASAR/IAgoAgAhACALQQA6AAAgACALEP8BIAhBADYCBCAIBSALQQA6AAAgCCALEP8BIABBADoAACAICyEAIAhBABD3BCAAIAopAgA3AgAgACAKKAIINgIIQQAhAANAIABBA0cEQCAAQQJ0IApqQQA2AgAgAEEBaiEADAELCyAKEPMEIAEoAgAoAhwhACAKIAEgAEE/cUGFA2oRBAAgB0ELaiIALAAAQQBIBH8gBygCACEAIAtBADoAACAAIAsQ/wEgB0EANgIEIAcFIAtBADoAACAHIAsQ/wEgAEEAOgAAIAcLIQAgB0EAEPcEIAAgCikCADcCACAAIAooAgg2AghBACEAA0AgAEEDRwRAIABBAnQgCmpBADYCACAAQQFqIQAMAQsLIAoQ8wQgASgCACgCDCEAIAMgASAAQT9xEQIAOgAAIAEoAgAoAhAhACAEIAEgAEE/cRECADoAACABKAIAKAIUIQAgCiABIABBP3FBhQNqEQQAIAVBC2oiACwAAEEASAR/IAUoAgAhACALQQA6AAAgACALEP8BIAVBADYCBCAFBSALQQA6AAAgBSALEP8BIABBADoAACAFCyEAIAVBABD3BCAAIAopAgA3AgAgACAKKAIINgIIQQAhAANAIABBA0cEQCAAQQJ0IApqQQA2AgAgAEEBaiEADAELCyAKEPMEIAEoAgAoAhghACAKIAEgAEE/cUGFA2oRBAAgBkELaiIALAAAQQBIBH8gBigCACEAIAtBADoAACAAIAsQ/wEgBkEANgIEIAYFIAtBADoAACAGIAsQ/wEgAEEAOgAAIAYLIQAgBkEAEPcEIAAgCikCADcCACAAIAooAgg2AghBACEAA0AgAEEDRwRAIABBAnQgCmpBADYCACAAQQFqIQAMAQsLIAoQ8wQgASgCACgCJCEAIAEgAEE/cRECAAs2AgAgDCQJC7YBAQV/IAIoAgAgACgCACIFIgZrIgRBAXQiA0EBIAMbQX8gBEH/////B0kbIQcgASgCACAGayEGIAVBACAAQQRqIgUoAgBB3gBHIgQbIAcQrwEiA0UEQBDrBAsgBARAIAAgAzYCAAUgACgCACEEIAAgAzYCACAEBEAgBSgCACEDIAQgA0H/AHFBhQJqEQcAIAAoAgAhAwsLIAVB3wA2AgAgASADIAZqNgIAIAIgByAAKAIAajYCAAvCAQEFfyACKAIAIAAoAgAiBSIGayIEQQF0IgNBBCADG0F/IARB/////wdJGyEHIAEoAgAgBmtBAnUhBiAFQQAgAEEEaiIFKAIAQd4ARyIEGyAHEK8BIgNFBEAQ6wQLIAQEQCAAIAM2AgAFIAAoAgAhBCAAIAM2AgAgBARAIAUoAgAhAyAEIANB/wBxQYUCahEHACAAKAIAIQMLCyAFQd8ANgIAIAEgBkECdCADajYCACACIAAoAgAgB0ECdkECdGo2AgALvgUBDH8jCSEHIwlB0ARqJAkgB0GoBGohECAHIREgB0G4BGoiCyAHQfAAaiIJNgIAIAtB3gA2AgQgB0GwBGoiDSAEENsBIA1BlLUBEJICIQ4gB0HABGoiDEEAOgAAIAdBrARqIgogAigCADYCACAEKAIEIQAgB0GABGoiBCAKKAIANgIAIAEgBCADIA0gACAFIAwgDiALIAdBtARqIhIgCUGQA2oQyQMEQCAOKAIAKAIwIQAgDkHk/gBB7v4AIAQgAEEHcUHwAGoRCQAaIBIoAgAiACALKAIAIgNrIgpBiANKBEAgCkECdkECahCsASIJIQogCQRAIAkhCCAKIQ8FEOsECwUgESEIQQAhDwsgDCwAAARAIAhBLToAACAIQQFqIQgLIARBKGohCSAEIQoDQCADIABJBEAgAygCACEMIAQhAANAAkAgACAJRgRAIAkhAAwBCyAAKAIAIAxHBEAgAEEEaiEADAILCwsgCCAAIAprQQJ1QeT+AGosAAA6AAAgA0EEaiEDIAhBAWohCCASKAIAIQAMAQsLIAhBADoAACAQIAY2AgAgEUGB/gAgEBBZQQFHBEBBABC4AwsgDwRAIA8QrQELCyABKAIAIgMEfyADKAIMIgAgAygCEEYEfyADKAIAKAIkIQAgAyAAQT9xEQIABSAAKAIAEDwLECAQ3AEEfyABQQA2AgBBAQUgASgCAEULBUEBCyEEAkACQAJAIAIoAgAiA0UNACADKAIMIgAgAygCEEYEfyADKAIAKAIkIQAgAyAAQT9xEQIABSAAKAIAEDwLECAQ3AEEQCACQQA2AgAMAQUgBEUNAgsMAgsgBA0ADAELIAUgBSgCAEECcjYCAAsgASgCACEBIA0QkwIgCygCACECIAtBADYCACACBEAgCygCBCEAIAIgAEH/AHFBhQJqEQcACyAHJAkgAQvRBAEHfyMJIQgjCUGwA2okCSAIQaADaiIJIAg2AgAgCUHeADYCBCAIQZADaiIMIAQQ2wEgDEGUtQEQkgIhCiAIQawDaiILQQA6AAAgCEGUA2oiACACKAIAIg02AgAgBCgCBCEEIAhBqANqIgcgACgCADYCACANIQAgASAHIAMgDCAEIAUgCyAKIAkgCEGYA2oiBCAIQZADahDJAwRAIAZBC2oiAywAAEEASARAIAYoAgAhAyAHQQA2AgAgAyAHEIUCIAZBADYCBAUgB0EANgIAIAYgBxCFAiADQQA6AAALIAssAAAEQCAKKAIAKAIsIQMgBiAKQS0gA0EPcUFAaxEDABCIBQsgCigCACgCLCEDIApBMCADQQ9xQUBrEQMAIQsgBCgCACIEQXxqIQMgCSgCACEHA0ACQCAHIANPDQAgBygCACALRw0AIAdBBGohBwwBCwsgBiAHIAQQygMaCyABKAIAIgQEfyAEKAIMIgMgBCgCEEYEfyAEKAIAKAIkIQMgBCADQT9xEQIABSADKAIAEDwLECAQ3AEEfyABQQA2AgBBAQUgASgCAEULBUEBCyEEAkACQAJAIA1FDQAgACgCDCIDIAAoAhBGBH8gDSgCACgCJCEDIAAgA0E/cRECAAUgAygCABA8CxAgENwBBEAgAkEANgIADAEFIARFDQILDAILIAQNAAwBCyAFIAUoAgBBAnI2AgALIAEoAgAhASAMEJMCIAkoAgAhAiAJQQA2AgAgAgRAIAkoAgQhACACIABB/wBxQYUCahEHAAsgCCQJIAELyCUBJH8jCSEOIwlBgARqJAkgDkH0A2ohHSAOQdgDaiElIA5B1ANqISYgDkG8A2ohDSAOQbADaiEPIA5BpANqIRAgDkGYA2ohESAOQZQDaiEYIA5BkANqISAgDkHwA2oiHiAKNgIAIA5B6ANqIhQgDjYCACAUQd4ANgIEIA5B4ANqIhMgDjYCACAOQdwDaiIfIA5BkANqNgIAIA5ByANqIhZCADcCACAWQQA2AghBACEKA0AgCkEDRwRAIApBAnQgFmpBADYCACAKQQFqIQoMAQsLIA1CADcCACANQQA2AghBACEKA0AgCkEDRwRAIApBAnQgDWpBADYCACAKQQFqIQoMAQsLIA9CADcCACAPQQA2AghBACEKA0AgCkEDRwRAIApBAnQgD2pBADYCACAKQQFqIQoMAQsLIBBCADcCACAQQQA2AghBACEKA0AgCkEDRwRAIApBAnQgEGpBADYCACAKQQFqIQoMAQsLIBFCADcCACARQQA2AghBACEKA0AgCkEDRwRAIApBAnQgEWpBADYCACAKQQFqIQoMAQsLIAIgAyAdICUgJiAWIA0gDyAQIBgQywMgCSAIKAIANgIAIA9BC2ohGSAPQQRqISEgEEELaiEaIBBBBGohIiAWQQtqISggFkEEaiEpIARBgARxQQBHIScgDUELaiEXIB1BA2ohKiANQQRqISMgEUELaiErIBFBBGohLEEAIQJBACESAn8CQAJAAkACQAJAAkADQAJAIBJBBE8NByAAKAIAIgMEfyADKAIMIgQgAygCEEYEfyADKAIAKAIkIQQgAyAEQT9xEQIABSAEKAIAEDwLECAQ3AEEfyAAQQA2AgBBAQUgACgCAEULBUEBCyEDAkACQCABKAIAIgtFDQAgCygCDCIEIAsoAhBGBH8gCygCACgCJCEEIAsgBEE/cRECAAUgBCgCABA8CxAgENwBBEAgAUEANgIADAEFIANFDQoLDAELIAMNCEEAIQsLAkACQAJAAkACQAJAAkAgEiAdaiwAAA4FAQADAgQGCyASQQNHBEAgACgCACIDKAIMIgQgAygCEEYEfyADKAIAKAIkIQQgAyAEQT9xEQIABSAEKAIAEDwLIQMgBygCACgCDCEEIAdBgMAAIAMgBEEfcUHQAGoRAABFDQcgESAAKAIAIgNBDGoiCigCACIEIAMoAhBGBH8gAygCACgCKCEEIAMgBEE/cRECAAUgCiAEQQRqNgIAIAQoAgAQPAsQiAUMBQsMBQsgEkEDRw0DDAQLICEoAgAgGSwAACIDQf8BcSADQQBIGyILQQAgIigCACAaLAAAIgNB/wFxIANBAEgbIgxrRwRAIAAoAgAiAygCDCIEIAMoAhBGIQogC0UiCyAMRXIEQCAKBH8gAygCACgCJCEEIAMgBEE/cRECAAUgBCgCABA8CyEDIAsEQCAQKAIAIBAgGiwAAEEASBsoAgAgA0cNBiAAKAIAIgNBDGoiCigCACIEIAMoAhBGBEAgAygCACgCKCEEIAMgBEE/cRECABoFIAogBEEEajYCACAEKAIAEDwaCyAGQQE6AAAgECACICIoAgAgGiwAACICQf8BcSACQQBIG0EBSxshAgwGCyAPKAIAIA8gGSwAAEEASBsoAgAgA0cEQCAGQQE6AAAMBgsgACgCACIDQQxqIgooAgAiBCADKAIQRgRAIAMoAgAoAighBCADIARBP3ERAgAaBSAKIARBBGo2AgAgBCgCABA8GgsgDyACICEoAgAgGSwAACICQf8BcSACQQBIG0EBSxshAgwFCyAKBH8gAygCACgCJCEEIAMgBEE/cRECAAUgBCgCABA8CyEKIAAoAgAiA0EMaiIMKAIAIgQgAygCEEYhCyAKIA8oAgAgDyAZLAAAQQBIGygCAEYEQCALBEAgAygCACgCKCEEIAMgBEE/cRECABoFIAwgBEEEajYCACAEKAIAEDwaCyAPIAIgISgCACAZLAAAIgJB/wFxIAJBAEgbQQFLGyECDAULIAsEfyADKAIAKAIkIQQgAyAEQT9xEQIABSAEKAIAEDwLIBAoAgAgECAaLAAAQQBIGygCAEcNByAAKAIAIgNBDGoiCigCACIEIAMoAhBGBEAgAygCACgCKCEEIAMgBEE/cRECABoFIAogBEEEajYCACAEKAIAEDwaCyAGQQE6AAAgECACICIoAgAgGiwAACICQf8BcSACQQBIG0EBSxshAgsMAwsCQAJAIBJBAkkgAnIEQCANKAIAIgQgDSAXLAAAIgpBAEgbIQMgEg0BBSASQQJGICosAABBAEdxICdyRQRAQQAhAgwGCyANKAIAIgQgDSAXLAAAIgpBAEgbIQMMAQsMAQsgHSASQX9qai0AAEECSARAAkACQANAICMoAgAgCkH/AXEgCkEYdEEYdUEASCIMG0ECdCAEIA0gDBtqIAMiDEcEQCAHKAIAKAIMIQQgB0GAwAAgDCgCACAEQR9xQdAAahEAAEUNAiAMQQRqIQMgFywAACEKIA0oAgAhBAwBCwsMAQsgFywAACEKIA0oAgAhBAsgKywAACIbQQBIIRUgAyAEIA0gCkEYdEEYdUEASBsiHCIMa0ECdSItICwoAgAiJCAbQf8BcSIbIBUbSwR/IAwFIBEoAgAgJEECdGoiJCAbQQJ0IBFqIhsgFRshLkEAIC1rQQJ0ICQgGyAVG2ohFQN/IBUgLkYNAyAVKAIAIBwoAgBGBH8gHEEEaiEcIBVBBGohFQwBBSAMCwsLIQMLCwNAAkAgAyAjKAIAIApB/wFxIApBGHRBGHVBAEgiChtBAnQgBCANIAobakYNACAAKAIAIgQEfyAEKAIMIgogBCgCEEYEfyAEKAIAKAIkIQogBCAKQT9xEQIABSAKKAIAEDwLECAQ3AEEfyAAQQA2AgBBAQUgACgCAEULBUEBCyEEAkACQCALRQ0AIAsoAgwiCiALKAIQRgR/IAsoAgAoAiQhCiALIApBP3ERAgAFIAooAgAQPAsQIBDcAQRAIAFBADYCAAwBBSAERQ0DCwwBCyAEDQFBACELCyAAKAIAIgQoAgwiCiAEKAIQRgR/IAQoAgAoAiQhCiAEIApBP3ERAgAFIAooAgAQPAsgAygCAEcNACAAKAIAIgRBDGoiDCgCACIKIAQoAhBGBEAgBCgCACgCKCEKIAQgCkE/cRECABoFIAwgCkEEajYCACAKKAIAEDwaCyADQQRqIQMgFywAACEKIA0oAgAhBAwBCwsgJwRAIBcsAAAiCkEASCEEICMoAgAgCkH/AXEgBBtBAnQgDSgCACANIAQbaiADRw0HCwwCC0EAIQQgCyEDA0ACQCAAKAIAIgoEfyAKKAIMIgwgCigCEEYEfyAKKAIAKAIkIQwgCiAMQT9xEQIABSAMKAIAEDwLECAQ3AEEfyAAQQA2AgBBAQUgACgCAEULBUEBCyEKAkACQCALRQ0AIAsoAgwiDCALKAIQRgR/IAsoAgAoAiQhDCALIAxBP3ERAgAFIAwoAgAQPAsQIBDcAQRAIAFBADYCAEEAIQMMAQUgCkUNAwsMAQsgCg0BQQAhCwsgACgCACIKKAIMIgwgCigCEEYEfyAKKAIAKAIkIQwgCiAMQT9xEQIABSAMKAIAEDwLIQwgBygCACgCDCEKIAdBgBAgDCAKQR9xQdAAahEAAAR/IAkoAgAiCiAeKAIARgRAIAggCSAeEMYDIAkoAgAhCgsgCSAKQQRqNgIAIAogDDYCACAEQQFqBSApKAIAICgsAAAiCkH/AXEgCkEASBtBAEcgBEEAR3EgDCAmKAIARnFFDQEgEygCACIKIB8oAgBGBEAgFCATIB8QxgMgEygCACEKCyATIApBBGo2AgAgCiAENgIAQQALIQQgACgCACIKQQxqIhwoAgAiDCAKKAIQRgRAIAooAgAoAighDCAKIAxBP3ERAgAaBSAcIAxBBGo2AgAgDCgCABA8GgsMAQsLIBMoAgAiCiAUKAIARyAEQQBHcQRAIAogHygCAEYEQCAUIBMgHxDGAyATKAIAIQoLIBMgCkEEajYCACAKIAQ2AgALIBgoAgBBAEoEQAJAIAAoAgAiBAR/IAQoAgwiCiAEKAIQRgR/IAQoAgAoAiQhCiAEIApBP3ERAgAFIAooAgAQPAsQIBDcAQR/IABBADYCAEEBBSAAKAIARQsFQQELIQQCQAJAIANFDQAgAygCDCIKIAMoAhBGBH8gAygCACgCJCEKIAMgCkE/cRECAAUgCigCABA8CxAgENwBBEAgAUEANgIADAEFIARFDQsLDAELIAQNCUEAIQMLIAAoAgAiBCgCDCIKIAQoAhBGBH8gBCgCACgCJCEKIAQgCkE/cRECAAUgCigCABA8CyAlKAIARw0IIAAoAgAiBEEMaiILKAIAIgogBCgCEEYEQCAEKAIAKAIoIQogBCAKQT9xEQIAGgUgCyAKQQRqNgIAIAooAgAQPBoLA0AgGCgCAEEATA0BIAAoAgAiBAR/IAQoAgwiCiAEKAIQRgR/IAQoAgAoAiQhCiAEIApBP3ERAgAFIAooAgAQPAsQIBDcAQR/IABBADYCAEEBBSAAKAIARQsFQQELIQQCQAJAIANFDQAgAygCDCIKIAMoAhBGBH8gAygCACgCJCEKIAMgCkE/cRECAAUgCigCABA8CxAgENwBBEAgAUEANgIADAEFIARFDQ0LDAELIAQNC0EAIQMLIAAoAgAiBCgCDCIKIAQoAhBGBH8gBCgCACgCJCEKIAQgCkE/cRECAAUgCigCABA8CyEEIAcoAgAoAgwhCiAHQYAQIAQgCkEfcUHQAGoRAABFDQogCSgCACAeKAIARgRAIAggCSAeEMYDCyAAKAIAIgQoAgwiCiAEKAIQRgR/IAQoAgAoAiQhCiAEIApBP3ERAgAFIAooAgAQPAshBCAJIAkoAgAiCkEEajYCACAKIAQ2AgAgGCAYKAIAQX9qNgIAIAAoAgAiBEEMaiILKAIAIgogBCgCEEYEQCAEKAIAKAIoIQogBCAKQT9xEQIAGgUgCyAKQQRqNgIAIAooAgAQPBoLDAAACwALCyAJKAIAIAgoAgBGDQgMAQsDQCAAKAIAIgMEfyADKAIMIgQgAygCEEYEfyADKAIAKAIkIQQgAyAEQT9xEQIABSAEKAIAEDwLECAQ3AEEfyAAQQA2AgBBAQUgACgCAEULBUEBCyEDAkACQCALRQ0AIAsoAgwiBCALKAIQRgR/IAsoAgAoAiQhBCALIARBP3ERAgAFIAQoAgAQPAsQIBDcAQRAIAFBADYCAAwBBSADRQ0ECwwBCyADDQJBACELCyAAKAIAIgMoAgwiBCADKAIQRgR/IAMoAgAoAiQhBCADIARBP3ERAgAFIAQoAgAQPAshAyAHKAIAKAIMIQQgB0GAwAAgAyAEQR9xQdAAahEAAEUNASARIAAoAgAiA0EMaiIKKAIAIgQgAygCEEYEfyADKAIAKAIoIQQgAyAEQT9xEQIABSAKIARBBGo2AgAgBCgCABA8CxCIBQwAAAsACyASQQFqIRIMAQsLIAUgBSgCAEEEcjYCAEEADAYLIAUgBSgCAEEEcjYCAEEADAULIAUgBSgCAEEEcjYCAEEADAQLIAUgBSgCAEEEcjYCAEEADAMLIAUgBSgCAEEEcjYCAEEADAILIAUgBSgCAEEEcjYCAEEADAELIAIEQAJAIAJBC2ohByACQQRqIQhBASEDA0ACQCADIAcsAAAiBEEASAR/IAgoAgAFIARB/wFxC08NAiAAKAIAIgQEfyAEKAIMIgYgBCgCEEYEfyAEKAIAKAIkIQYgBCAGQT9xEQIABSAGKAIAEDwLECAQ3AEEfyAAQQA2AgBBAQUgACgCAEULBUEBCyEEAkACQCABKAIAIgZFDQAgBigCDCIJIAYoAhBGBH8gBigCACgCJCEJIAYgCUE/cRECAAUgCSgCABA8CxAgENwBBEAgAUEANgIADAEFIARFDQMLDAELIAQNAQsgACgCACIEKAIMIgYgBCgCEEYEfyAEKAIAKAIkIQYgBCAGQT9xEQIABSAGKAIAEDwLIAcsAABBAEgEfyACKAIABSACCyADQQJ0aigCAEcNACADQQFqIQMgACgCACIEQQxqIgkoAgAiBiAEKAIQRgRAIAQoAgAoAighBiAEIAZBP3ERAgAaBSAJIAZBBGo2AgAgBigCABA8GgsMAQsLIAUgBSgCAEEEcjYCAEEADAILCyAUKAIAIgAgEygCACIBRgR/QQEFICBBADYCACAWIAAgASAgEKECICAoAgAEfyAFIAUoAgBBBHI2AgBBAAVBAQsLCyEAIBEQ8wQgEBDzBCAPEPMEIA0Q8wQgFhDzBCAUKAIAIQEgFEEANgIAIAEEQCAUKAIEIQIgASACQf8AcUGFAmoRBwALIA4kCSAAC+sCAQl/IwkhCiMJQRBqJAkgCiEDIABBCGoiBEEDaiIILAAAIgZBAEgiCwR/IAQoAgBB/////wdxQX9qIQcgACgCBAVBASEHIAZB/wFxCyEFIAIgAWsiBEECdSEJIAQEQAJAIAEgCwR/IAAoAgQhBiAAKAIABSAGQf8BcSEGIAALIgQgBkECdCAEahDDAwRAIANCADcCACADQQA2AgggAyABIAIQhAIgACADKAIAIAMgAywACyIBQQBIIgIbIAMoAgQgAUH/AXEgAhsQhwUaIAMQ8wQMAQsgByAFayAJSQRAIAAgByAFIAlqIAdrIAUgBUEAQQAQhgULIAgsAABBAEgEfyAAKAIABSAACyAFQQJ0aiEEA0AgASACRwRAIAQgARCFAiAEQQRqIQQgAUEEaiEBDAELCyADQQA2AgAgBCADEIUCIAUgCWohASAILAAAQQBIBEAgACABNgIEBSAIIAE6AAALCwsgCiQJIAALowwBA38jCSEMIwlBEGokCSAMQQxqIQsgDCEKIAkgAAR/IAFB7LYBEJICIgEoAgAoAiwhACALIAEgAEE/cUGFA2oRBAAgAiALKAIANgAAIAEoAgAoAiAhACAKIAEgAEE/cUGFA2oRBAAgCEELaiIALAAAQQBIBEAgCCgCACEAIAtBADYCACAAIAsQhQIgCEEANgIEBSALQQA2AgAgCCALEIUCIABBADoAAAsgCEEAEIQFIAggCikCADcCACAIIAooAgg2AghBACEAA0AgAEEDRwRAIABBAnQgCmpBADYCACAAQQFqIQAMAQsLIAoQ8wQgASgCACgCHCEAIAogASAAQT9xQYUDahEEACAHQQtqIgAsAABBAEgEQCAHKAIAIQAgC0EANgIAIAAgCxCFAiAHQQA2AgQFIAtBADYCACAHIAsQhQIgAEEAOgAACyAHQQAQhAUgByAKKQIANwIAIAcgCigCCDYCCEEAIQADQCAAQQNHBEAgAEECdCAKakEANgIAIABBAWohAAwBCwsgChDzBCABKAIAKAIMIQAgAyABIABBP3ERAgA2AgAgASgCACgCECEAIAQgASAAQT9xEQIANgIAIAEoAgAoAhQhACAKIAEgAEE/cUGFA2oRBAAgBUELaiIALAAAQQBIBH8gBSgCACEAIAtBADoAACAAIAsQ/wEgBUEANgIEIAUFIAtBADoAACAFIAsQ/wEgAEEAOgAAIAULIQAgBUEAEPcEIAAgCikCADcCACAAIAooAgg2AghBACEAA0AgAEEDRwRAIABBAnQgCmpBADYCACAAQQFqIQAMAQsLIAoQ8wQgASgCACgCGCEAIAogASAAQT9xQYUDahEEACAGQQtqIgAsAABBAEgEQCAGKAIAIQAgC0EANgIAIAAgCxCFAiAGQQA2AgQFIAtBADYCACAGIAsQhQIgAEEAOgAACyAGQQAQhAUgBiAKKQIANwIAIAYgCigCCDYCCEEAIQADQCAAQQNHBEAgAEECdCAKakEANgIAIABBAWohAAwBCwsgChDzBCABKAIAKAIkIQAgASAAQT9xEQIABSABQeS2ARCSAiIBKAIAKAIsIQAgCyABIABBP3FBhQNqEQQAIAIgCygCADYAACABKAIAKAIgIQAgCiABIABBP3FBhQNqEQQAIAhBC2oiACwAAEEASARAIAgoAgAhACALQQA2AgAgACALEIUCIAhBADYCBAUgC0EANgIAIAggCxCFAiAAQQA6AAALIAhBABCEBSAIIAopAgA3AgAgCCAKKAIINgIIQQAhAANAIABBA0cEQCAAQQJ0IApqQQA2AgAgAEEBaiEADAELCyAKEPMEIAEoAgAoAhwhACAKIAEgAEE/cUGFA2oRBAAgB0ELaiIALAAAQQBIBEAgBygCACEAIAtBADYCACAAIAsQhQIgB0EANgIEBSALQQA2AgAgByALEIUCIABBADoAAAsgB0EAEIQFIAcgCikCADcCACAHIAooAgg2AghBACEAA0AgAEEDRwRAIABBAnQgCmpBADYCACAAQQFqIQAMAQsLIAoQ8wQgASgCACgCDCEAIAMgASAAQT9xEQIANgIAIAEoAgAoAhAhACAEIAEgAEE/cRECADYCACABKAIAKAIUIQAgCiABIABBP3FBhQNqEQQAIAVBC2oiACwAAEEASAR/IAUoAgAhACALQQA6AAAgACALEP8BIAVBADYCBCAFBSALQQA6AAAgBSALEP8BIABBADoAACAFCyEAIAVBABD3BCAAIAopAgA3AgAgACAKKAIINgIIQQAhAANAIABBA0cEQCAA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IAIgAEE/cUGFA2oRBAAgCEELaiIALAAAQQBIBEAgCCgCACEAIApBADYCACAAIAoQhQIgCEEANgIEBSAKQQA2AgAgCCAKEIUCIABBADoAAAsgCEEAEIQFIAggCykCADcCACAIIAsoAgg2AghBACEAA0AgAEEDRwRAIABBAnQgC2pBADYCACAAQQFqIQAMAQsLIAsQ8wQFIAIoAgAoAighACAKIAIgAEE/cUGFA2oRBAAgAyAKKAIANgAAIAIoAgAoAhwhACALIAIgAEE/cUGFA2oRBAAgCEELaiIALAAAQQBIBEAgCCgCACEAIApBADYCACAAIAoQhQIgCEEANgIEBSAKQQA2AgAgCCAKEIUCIABBADoAAAsgCEEAEIQFIAggCykCADcCACAIIAsoAgg2AghBACEAA0AgAEEDRwRAIABBAnQgC2pBADYCACAAQQFqIQAMAQsLIAsQ8wQLIAIoAgAoAgwhACAEIAIgAEE/cRECADYCACACKAIAKAIQIQAgBSACIABBP3ERAgA2AgAgAigCACgCFCEAIAsgAiAAQT9xQYUDahEEACAGQQtqIgAsAABBAEgEfyAGKAIAIQAgCkEAOgAAIAAgChD/ASAGQQA2AgQgBgUgCkEAOgAAIAYgChD/ASAAQQA6AAAgBgshACAGQQAQ9wQgACALKQIANwIAIAAgCygCCDYCCEEAIQADQCAAQQNHBEAgAEECdCALakEANgIAIABBAWohAAwBCwsgCxDzBCACKAIAKAIYIQAgCyACIABBP3FBhQNqEQQAIAdBC2oiACwAAEEASARAIAcoAgAhACAKQQA2AgAgACAKEIUCIAdBADYCBAUgCkEANgIAIAcgChCFAiAAQQA6AAALIAdBABCEBSAHIAspAgA3AgAgByALKAIINgIIQQAhAANAIABBA0cEQCAAQQJ0IAtqQQA2AgAgAEEBaiEADAELCyALEPMEIAIoAgAoAiQhACACIABBP3ERAgALNgIAIAwkCQu1CQERfyACIAA2AgAgDUELaiEZIA1BBGohGCAMQQtqIRwgDEEEaiEdIANBgARxRSEeIA5BAEohHyALQQtqIRogC0EEaiEbQQAhFwNAIBdBBEcEQAJAAkACQAJAAkACQCAIIBdqLAAADgUAAQMCBAULIAEgAigCADYCAAwECyABIAIoAgA2AgAgBigCACgCLCEP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ABBGKAIACxcAIABByOkANgIAIABBDGoQ8wQgABBNCwwAIAAQ/wMgABDtBAsHACAALAAICwcAIAAsAAkLDAAgACABQQxqEO8ECx8AIABCADcCACAAQQA2AgggAEGPhAFBj4QBECUQ8AQLHwAgAEIANwIAIABBADYCCCAAQYmEAUGJhAEQJRDwBAsXACAAQfDpADYCACAAQRBqEPMEIAAQTQsMACAAEIYEIAAQ7QQLBwAgACgCCAsHACAAKAIMCwwAIAAgAUEQahDvBAsgACAAQgA3AgAgAEEANgIIIABBqOoAQajqABCaAxD+BAsgACAAQgA3AgAgAEEANgIIIABBkOoAQZDqABCaAxD+BAslACACQYABSQR/IAEQ/gMgAkEBdGouAQBxQf//A3FBAEcFQQALC0YAA0AgASACRwRAIAMgASgCAEGAAUkEfxD+AyEAIAEoAgBBAXQgAGovAQAFQQALOwEAIANBAmohAyABQQRqIQEMAQsLIAILSgADQAJAIAIgA0YEQCADIQIMAQsgAigCAEGAAUkEQBD+AyEAIAEgAigCAEEBdCAAai4BAHFB//8DcQ0BCyACQQRqIQIMAQsLIAILSgADQAJAIAIgA0YEQCADIQIMAQsgAigCAEGAAU8NABD+AyEAIAEgAigCAEEBdCAAai4BAHFB//8DcQRAIAJBBGohAgwCCwsLIAILGgAgAUGAAUkEfxD9AyABQQJ0aigCAAUgAQsLQgADQCABIAJHBEAgASgCACIAQYABSQRAEP0DIQAgASgCAEECdCAAaigCACEACyABIAA2AgAgAUEEaiEBDAELCyACCxoAIAFBgAFJBH8Q/AMgAUECdGooAgAFIAELC0IAA0AgASACRwRAIAEoAgAiAEGAAUkEQBD8AyEAIAEoAgBBAnQgAGooAgAhAAsgASAANgIAIAFBBGohAQwBCwsgAgsKACABQRh0QRh1CykAA0AgASACRwRAIAMgASwAADYCACADQQRqIQMgAUEBaiEBDAELCyACCxEAIAFB/wFxIAIgAUGAAUkbC04BAn8gAiABa0ECdiEFIAEhAANAIAAgAkcEQCAEIAAoAgAiBkH/AXEgAyAGQYABSRs6AAAgBEEBaiEEIABBBGohAAwBCwsgBUECdCABagsLACAAQazsADYCAAsLACAAQdDsADYCAAs7AQF/IAAgA0F/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IAEgBCABSxsiAUECSSEFQQEgAUEEakF8cUF/aiAFGyIIIAJHBEACQAJAAkAgBQRAIAAoAgAhAiADBH9BACEDIAAFIAAgAiAGQf8BcUEBahDJARogAhDtBAwDCyEBBSAIQQFqIgJB/////wNLBEAQDgsgAkECdBDsBCEBIAMEf0EBIQMgACgCAAUgASAAIAZB/wFxQQFqEMkBGiAAQQRqIQUMAgshAgsgASACIABBBGoiBSgCAEEBahDJARogAhDtBCADRQ0BIAhBAWohAgsgByACQYCAgIB4cjYCACAFIAQ2AgAgACABNgIADAELIAkgBDoAAAsLCw4AIAAgASABEJoDEIEFC+gBAQR/Qe////8DIAFrIAJJBEAgABC4AwsgAEEIaiIJLAADQQBIBH8gACgCAAUgAAshByABQef///8BSQRAQQIgAUEBdCIKIAEgAmoiAiACIApJGyICQQRqQXxxIAJBAkkbIgJB/////wNLBEAQDgUgAiEICwVB7////wMhCAsgCEECdBDsBCECIAQEQCACIAcgBBDJARoLIAMgBWsgBGsiAwRAIARBAnQgAmogBkECdGogBEECdCAHaiAFQQJ0aiADEMkBGgsgAUEBRwRAIAcQ7QQLIAAgAjYCACAJIAhBgICAgHhyNgIAC88BAQZ/IwkhBSMJQRBqJAkgBSEGIABBCGoiBEEDaiIHLAAAIgNBAEgiCAR/IAAoAgQhAyAEKAIAQf////8HcUF/agUgA0H/AXEhA0EBCyIEIANrIAJJBEAgACAEIAIgA2ogBGsgAyADQQAgAiABEIMFBSACBEAgCAR/IAAoAgAFIAALIgQgA0ECdGogASACEMkBGiACIANqIQEgBywAAEEASARAIAAgATYCBAUgByABOgAACyAGQQA2AgAgAUECdCAEaiAGEIUCCwsgBSQJIAALzgEBBn8jCSEDIwlBEGokCSADQQRqIQQgAyIGIAE2AgAgAEEIaiIBQQNqIgUsAAAiAkEASCIHBH8gACgCBCECIAEoAgBB/////wdxQX9qBSACQf8BcSECQQELIQECQAJAIAEgAkYEQCAAIAFBASABIAFBAEEAEIYFIAUsAABBAEgNAQUgBw0BCyAFIAJBAWo6AAAMAQsgACgCACEBIAAgAkEBajYCBCABIQALIAJBAnQgAGoiACAGEIUCIARBADYCACAAQQRqIAQQhQIgAyQJCwsAIAAQTSAAEO0EC9YBAQN/IwkhBSMJQUBrJAkgBSEDIAAgAUEAEI4FBH9BAQUgAQR/IAFBsMwAQaDMAEEAEJIFIgEEfyADQQRqIgRCADcCACAEQgA3AgggBEIANwIQIARCADcCGCAEQgA3AiAgBEIANwIoIARBADYCMCADIAE2AgAgAyAANgIIIANBfzYCDCADQQE2AjAgASgCACgCHCEAIAEgAyACKAIAQQEgAEEHcUHGA2oRCwAgAygCGEEBRgR/IAIgAygCEDYCAEEBBUEACwVBAAsFQQALCyEAIAUkCSAACx4AIAAgASgCCCAFEI4FBEBBACABIAIgAyAEEJEFCwufAQAgACABKAIIIAQQjgUEQEEAIAEgAiADEJAFBSAAIAEoAgAgBBCOBQRAAkAgASgCECACRwRAIAFBFGoiACgCACACRwRAIAEgAzYCICAAIAI2AgAgAUEoaiIAIAAoAgBBAWo2AgAgASgCJEEBRgRAIAEoAhhBAkYEQCABQQE6ADYLCyABQQQ2AiwMAgsLIANBAUYEQCABQQE2AiALCwsLCxwAIAAgASgCCEEAEI4FBEBBACABIAIgAxCPBQsLBwAgACABRgttAQF/IAFBEGoiACgCACIEBEACQCACIARHBEAgAUEkaiIAIAAoAgBBAWo2AgAgAUECNgIYIAFBAToANgwBCyABQRhqIgAoAgBBAkYEQCAAIAM2AgALCwUgACACNgIAIAEgAzYCGCABQQE2AiQLCyYBAX8gAiABKAIERgRAIAFBHGoiBCgCAEEBRwRAIAQgAzYCAAsLC7YBACABQQE6ADUgAyABKAIERgRAAkAgAUEBOgA0IAFBEGoiACgCACIDRQRAIAAgAjYCACABIAQ2AhggAUEBNgIkIAEoAjBBAUYgBEEBRnFFDQEgAUEBOgA2DAELIAIgA0cEQCABQSRqIgAgACgCAEEBajYCACABQQE6ADYMAQsgAUEYaiICKAIAIgBBAkYEQCACIAQ2AgAFIAAhBAsgASgCMEEBRiAEQQFGcQRAIAFBAToANgsLCwv5AgEIfyMJIQgjCUFAayQJIAAgACgCACIEQXhqKAIAaiEHIARBfGooAgAhBiAIIgQgAjYCACAEIAA2AgQgBCABNgIIIAQgAzYCDCAEQRRqIQEgBEEYaiEJIARBHGohCiAEQSBqIQsgBEEoaiEDIARBEGoiBUIANwIAIAVCADcCCCAFQgA3AhAgBUIANwIYIAVBADYCICAFQQA7ASQgBUEAOgAmIAYgAkEAEI4FBH8gBEEBNgIwIAYoAgAoAhQhACAGIAQgByAHQQFBACAAQQdxQdIDahEMACAHQQAgCSgCAEEBRhsFAn8gBigCACgCGCEAIAYgBCAHQQFBACAAQQNxQc4DahENAAJAAkACQCAEKAIkDgIAAgELIAEoAgBBACADKAIAQQFGIAooAgBBAUZxIAsoAgBBAUZxGwwCC0EADAELIAkoAgBBAUcEQEEAIAMoAgBFIAooAgBBAUZxIAsoAgBBAUZxRQ0BGgsgBSgCAAsLIQAgCCQJIAALSAEBfyAAIAEoAgggBRCOBQRAQQAgASACIAMgBBCRBQUgACgCCCIAKAIAKAIUIQYgACABIAIgAyAEIAUgBkEHcUHSA2oRDAALC8MCAQR/IAAgASgCCCAEEI4FBEBBACABIAIgAxCQBQUCQCAAIAEoAgAgBBCOBUUEQCAAKAIIIgAoAgAoAhghBSAAIAEgAiADIAQgBUEDcUHOA2oRDQAMAQsgASgCECACRwRAIAFBFGoiBSgCACACRwRAIAEgAzYCICABQSxqIgMoAgBBBEYNAiABQTRqIgZBADoAACABQTVqIgdBADoAACAAKAIIIgAoAgAoAhQhCCAAIAEgAiACQQEgBCAIQQdxQdIDahEMACADAn8CQCAHLAAABH8gBiwAAA0BQQEFQQALIQAgBSACNgIAIAFBKGoiAiACKAIAQQFqNgIAIAEoAiRBAUYEQCABKAIYQQJGBEAgAUEBOgA2IAANAkEEDAMLCyAADQBBBAwBC0EDCzYCAAwCCwsgA0EBRgRAIAFBATYCIAsLCwtCAQF/IAAgASgCCEEAEI4FBEBBACABIAIgAxCPBQUgACgCCCIAKAIAKAIcIQQgACABIAIgAyAEQQdxQcYDahELAAsLhAIBCH8gACABKAIIIAUQjgUEQEEAIAEgAiADIAQQkQUFIAFBNGoiBiwAACEJIAFBNWoiBywAACEKIABBEGogACgCDCIIQQN0aiELIAZBADoAACAHQQA6AAAgAEEQaiABIAIgAyAEIAUQmgUgCEEBSgRAAkAgAUEYaiEMIABBCGohCCABQTZqIQ0gAEEYaiEAA0AgDSwAAA0BIAYsAAAEQCAMKAIAQQFGDQIgCCgCAEECcUUNAgUgBywAAARAIAgoAgBBAXFFDQMLCyAGQQA6AAAgB0EAOgAAIAAgASACIAMgBCAFEJoFIABBCGoiACALSQ0ACwsLIAYgCToAACAHIAo6AAALC5IFAQl/IAAgASgCCCAEEI4FBEBBACABIAIgAxCQBQUCQCAAIAEoAgAgBBCOBUUEQCAAQRBqIAAoAgwiBkEDdGohByAAQRBqIAEgAiADIAQQmwUgAEEYaiEFIAZBAUwNASAAKAIIIgZBAnFFBEAgAUEkaiIAKAIAQQFHBEAgBkEBcUUEQCABQTZqIQYDQCAGLAAADQUgACgCAEEBRg0FIAUgASACIAMgBBCbBSAFQQhqIgUgB0kNAAsMBAsgAUEYaiEGIAFBNmohCANAIAgsAAANBCAAKAIAQQFGBEAgBigCAEEBRg0FCyAFIAEgAiADIAQQmwUgBUEIaiIFIAdJDQALDAMLCyABQTZqIQADQCAALAAADQIgBSABIAIgAyAEEJsFIAVBCGoiBSAHSQ0ACwwBCyABKAIQIAJHBEAgAUEUaiILKAIAIAJHBEAgASADNgIgIAFBLGoiDCgCAEEERg0CIABBEGogACgCDEEDdGohDSABQTRqIQcgAUE1aiEGIAFBNmohCCAAQQhqIQkgAUEYaiEKQQAhAyAAQRBqIQVBACEAIAwCfwJAA0ACQCAFIA1PDQAgB0EAOgAAIAZBADoAACAFIAEgAiACQQEgBBCaBSAILAAADQAgBiwAAARAAn8gBywAAEUEQCAJKAIAQQFxBEBBAQwCBUEBIQMMBAsACyAKKAIAQQFGDQQgCSgCAEECcUUNBEEBIQBBAQshAwsgBUEIaiEFDAELCyAARQRAIAsgAjYCACABQShqIgAgACgCAEEBajYCACABKAIkQQFGBEAgCigCAEECRgRAIAhBAToAACADDQNBBAwECwsLIAMNAEEEDAELQQMLNgIADAILCyADQQFGBEAgAUEBNgIgCwsLC3kBAn8gACABKAIIQQAQjgUEQEEAIAEgAiADEI8FBQJAIABBEGogACgCDCIEQQN0aiEFIABBEGogASACIAMQmQUgBEEBSgRAIAFBNmohBCAAQRhqIQADQCAAIAEgAiADEJkFIAQsAAANAiAAQQhqIgAgBUkNAAsLCwsLUwEDfyAAKAIEIgVBCHUhBCAFQQFxBEAgBCACKAIAaigCACEECyAAKAIAIgAoAgAoAhwhBiAAIAEgAiAEaiADQQIgBUECcRsgBkEHcUHGA2oRCwALVwEDfyAAKAIEIgdBCHUhBiAHQQFxBEAgAygCACAGaigCACEGCyAAKAIAIgAoAgAoAhQhCCAAIAEgAiADIAZqIARBAiAHQQJxGyAFIAhBB3FB0gNqEQwAC1UBA38gACgCBCIGQQh1IQUgBkEBcQRAIAIoAgAgBWooAgAhBQsgACgCACIAKAIAKAIYIQcgACABIAIgBWogA0ECIAZBAnEbIAQgB0EDcUHOA2oRDQALGQAgACwAAEEBRgR/QQAFIABBAToAAEEBCwsWAQF/QaC4AUGguAEoAgAiADYCACAAC1MBA38jCSEDIwlBEGokCSADIgQgAigCADYCACAAKAIAKAIQIQUgACABIAMgBUEfcUHQAGoRAAAiAUEBcSEAIAEEQCACIAQoAgA2AgALIAMkCSAACxwAIAAEfyAAQbDMAEHozABBABCSBUEARwVBAAsLKwAgAEH/AXFBGHQgAEEIdUH/AXFBEHRyIABBEHVB/wFxQQh0ciAAQRh2cgvGAwEDfyACQYDAAE4EQCAAIAEgAhAQGiAADwsgACEEIAAgAmohAyAAQQNxIAFBA3FGBEADQCAAQQNxBEAgAkUEQCAEDwsgACABLAAAOgAAIABBAWohACABQQFqIQEgAkEBayECDAELCyADQXxxIgJBQGohBQNAIAAgBUwEQCAAIAEoAgA2AgAgACABKAIENgIEIAAgASgCCDYCCCAAIAEoAgw2AgwgACABKAIQNgIQIAAgASgCFDYCFCAAIAEoAhg2AhggACABKAIcNgIcIAAgASgCIDYCICAAIAEoAiQ2AiQgACABKAIoNgIoIAAgASgCLDYCLCAAIAEoAjA2AjAgACABKAI0NgI0IAAgASgCODYCOCAAIAEoAjw2AjwgAEFAayEAIAFBQGshAQwBCwsDQCAAIAJIBEAgACABKAIANgIAIABBBGohACABQQRqIQEMAQsLBSADQQRrIQIDQCAAIAJIBEAgACABLAAAOgAAIAAgASwAAToAASAAIAEsAAI6AAIgACABLAADOgADIABBBGohACABQQRqIQEMAQsLCwNAIAAgA0gEQCAAIAEsAAA6AAAgAEEBaiEAIAFBAWohAQwBCwsgBAtgAQF/IAEgAEggACABIAJqSHEEQCAAIQMgASACaiEBIAAgAmohAANAIAJBAEoEQCACQQFrIQIgAEEBayIAIAFBAWsiASwAADoAAAwBCwsgAyEABSAAIAEgAhChBRoLIAALmAIBBH8gACACaiEEIAFB/wFxIQEgAkHDAE4EQANAIABBA3EEQCAAIAE6AAAgAEEBaiEADAELCyAEQXxxIgVBQGohBiABQQh0IAFyIAFBEHRyIAFBGHRyIQMDQCAAIAZMBEAgACADNgIAIAAgAzYCBCAAIAM2AgggACADNgIMIAAgAzYCECAAIAM2AhQgACADNgIYIAAgAzYCHCAAIAM2AiAgACADNgIkIAAgAzYCKCAAIAM2AiwgACADNgIwIAAgAzYCNCAAIAM2AjggACADNgI8IABBQGshAAwBCwsDQCAAIAVIBEAgACADNgIAIABBBGohAAwBCwsLA0AgACAESARAIAAgAToAACAAQQFqIQAMAQsLIAQgAmsLTQECfyAAIwQoAgAiAmoiASACSCAAQQBKcSABQQBIcgRAEAMaQQwQBkF/DwsgARAPTARAIwQgATYCAAUgARARRQRAQQwQBkF/DwsLIAILDAAgASAAQT9xEQIACxEAIAEgAiAAQQ9xQUBrEQMACxQAIAEgAiADIABBH3FB0ABqEQAACxYAIAEgAiADIAQgAEEHcUHwAGoRCQALGAAgASACIAMgBCAFIABBB3FB+ABqEQ4ACxgAIAEgAiADIAQgBSAAQR9xQYABahEFAAsaACABIAIgAyAEIAUgBiAAQQNxQaABahEPAAsaACABIAIgAyAEIAUgBiAAQT9xQaQBahEIAAscACABIAIgAyAEIAUgBiAHIABBB3FB5AFqERAACx4AIAEgAiADIAQgBSAGIAcgCCAAQQ9xQewBahEGAAsYACABIAIgAyAEIAUgAEEHcUH8AWoREQALCABBhAIRCgALEQAgASAAQf8AcUGFAmoRBwALEgAgASACIABBP3FBhQNqEQQACw4AIAEgAiADQcUDEQEACxYAIAEgAiADIAQgAEEHcUHGA2oRCwALGAAgASACIAMgBCAFIABBA3FBzgNqEQ0ACxoAIAEgAiADIAQgBSAGIABBB3FB0gNqEQwACxgAIAEgAiADIAQgBSAAQQNxQdoDahESAAsIAEEAEAJBAAsIAEEBEAJBAAsIAEECEAJBAAsIAEEDEAJBAAsIAEEEEAJBAAsIAEEFEAJBAAsIAEEGEAJBAAsIAEEHEAJBAAsIAEEIEAJBAAsIAEEJEAJBAAsIAEEKEAJBAAsGAEELEAILBgBBDBACCwYAQQ0QAgsGAEEOEAILBgBBDxACCwYAQRAQAgsGAEEREAILBgBBEhACCxkAIAAgASACIAMgBCAFrSAGrUIghoQQrwULGQAgACABIAIgA60gBK1CIIaEIAUgBhC3BQsLlmQzAEGGCAsK8D8AAAAAAADwPwBBnggLAvA/AEG2CAsC8D8AQdYIC94B8D9JKvgSz/7fP1qD91W5ULs/pWntCVT3hz/ZsoWq1IhCPwAAAAAAAPA/lXcfkQD/3z9iwVg6ele8P7VdFWapDow/28qSipRXTz9vpkXBDuX/PgAAAAAAAPA/2Ke8VAAA4D9BC3+h5RS9P0qsOEM+/o4/DluJz4qfVD8gzE4i0m8QP+wmIz2t3Lg+AAAAAAAA8D+L6l9CxfzfP5H1sAmmgr0/unoYi61hkD+Pm2220MxXP4mVzS7/zhY/Lr6Rsu71yj7sXXdGcq5uPt4SBJUAAAAA////////////////AEHACgvMAQIAAMADAADABAAAwAUAAMAGAADABwAAwAgAAMAJAADACgAAwAsAAMAMAADADQAAwA4AAMAPAADAEAAAwBEAAMASAADAEwAAwBQAAMAVAADAFgAAwBcAAMAYAADAGQAAwBoAAMAbAADAHAAAwB0AAMAeAADAHwAAwAAAALMBAADDAgAAwwMAAMMEAADDBQAAwwYAAMMHAADDCAAAwwkAAMMKAADDCwAAwwwAAMMNAADTDgAAww8AAMMAAAy7AQAMwwIADMMDAAzDBAAM0wBBlBAL+QMBAAAAAgAAAAMAAAAEAAAABQAAAAYAAAAHAAAACAAAAAkAAAAKAAAACwAAAAwAAAANAAAADgAAAA8AAAAQAAAAEQAAABIAAAATAAAAFAAAABUAAAAWAAAAFwAAABgAAAAZAAAAGgAAABsAAAAcAAAAHQAAAB4AAAAfAAAAIAAAACEAAAAiAAAAIwAAACQAAAAlAAAAJgAAACcAAAAoAAAAKQAAACoAAAArAAAALAAAAC0AAAAuAAAALwAAADAAAAAxAAAAMgAAADMAAAA0AAAANQAAADYAAAA3AAAAOAAAADkAAAA6AAAAOwAAADwAAAA9AAAAPgAAAD8AAABAAAAAYQAAAGIAAABjAAAAZAAAAGUAAABmAAAAZwAAAGgAAABpAAAAagAAAGsAAABsAAAAbQAAAG4AAABvAAAAcAAAAHEAAAByAAAAcwAAAHQAAAB1AAAAdgAAAHcAAAB4AAAAeQAAAHoAAABbAAAAXAAAAF0AAABeAAAAXwAAAGAAAABhAAAAYgAAAGMAAABkAAAAZQAAAGYAAABnAAAAaAAAAGkAAABqAAAAawAAAGwAAABtAAAAbgAAAG8AAABwAAAAcQAAAHIAAABzAAAAdAAAAHUAAAB2AAAAdwAAAHgAAAB5AAAAegAAAHsAAAB8AAAAfQAAAH4AAAB/AEGQGgv/AQIAAgACAAIAAgACAAIAAgACAAMgAiACIAIgAiACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgABYATABMAEwATABMAEwATABMAEwATABMAEwATABMAEwAjYCNgI2AjYCNgI2AjYCNgI2AjYBMAEwATABMAEwATABMAI1QjVCNUI1QjVCNUIxQjFCMUIxQjFCMUIxQjFCMUIxQjFCMUIxQjFCMUIxQjFCMUIxQjFBMAEwATABMAEwATACNYI1gjWCNYI1gjWCMYIxgjGCMYIxgjGCMYIxgjGCMYIxgjGCMYIxgjGCMYIxgjGCMYIxgTABMAEwATAAgBBlCIL+QMBAAAAAgAAAAMAAAAEAAAABQAAAAYAAAAHAAAACAAAAAkAAAAKAAAACwAAAAwAAAANAAAADgAAAA8AAAAQAAAAEQAAABIAAAATAAAAFAAAABUAAAAWAAAAFwAAABgAAAAZAAAAGgAAABsAAAAcAAAAHQAAAB4AAAAfAAAAIAAAACEAAAAiAAAAIwAAACQAAAAlAAAAJgAAACcAAAAoAAAAKQAAACoAAAArAAAALAAAAC0AAAAuAAAALwAAADAAAAAxAAAAMgAAADMAAAA0AAAANQAAADYAAAA3AAAAOAAAADkAAAA6AAAAOwAAADwAAAA9AAAAPgAAAD8AAABAAAAAQQAAAEIAAABDAAAARAAAAEUAAABGAAAARwAAAEgAAABJAAAASgAAAEsAAABMAAAATQAAAE4AAABPAAAAUAAAAFEAAABSAAAAUwAAAFQAAABVAAAAVgAAAFcAAABYAAAAWQAAAFoAAABbAAAAXAAAAF0AAABeAAAAXwAAAGAAAABBAAAAQgAAAEMAAABEAAAARQAAAEYAAABHAAAASAAAAEkAAABKAAAASwAAAEwAAABNAAAATgAAAE8AAABQAAAAUQAAAFIAAABTAAAAVAAAAFUAAABWAAAAVwAAAFgAAABZAAAAWgAAAHsAAAB8AAAAfQAAAH4AAAB/AEGQKguhAgoAAABkAAAA6AMAABAnAACghgEAQEIPAICWmAAA4fUF/////////////////////////////////////////////////////////////////wABAgMEBQYHCAn/////////CgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiP///////8KCwwNDg8QERITFBUWFxgZGhscHR4fICEiI/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AQcAsCxgRAAoAERERAAAAAAUAAAAAAAAJAAAAAAsAQeAsCyERAA8KERERAwoHAAETCQsLAAAJBgsAAAsABhEAAAAREREAQZEtCwELAEGaLQsYEQAKChEREQAKAAACAAkLAAAACQALAAALAEHLLQsBDABB1y0LFQwAAAAADAAAAAAJDAAAAAAADAAADABBhS4LAQ4AQZEuCxUNAAAABA0AAAAACQ4AAAAAAA4AAA4AQb8uCwEQAEHLLgseDwAAAAAPAAAAAAkQAAAAAAAQAAAQAAASAAAAEhISAEGCLwsOEgAAABISEgAAAAAAAAkAQbMvCwELAEG/LwsVCgAAAAAKAAAAAAkLAAAAAAALAAALAEHtLwsBDABB+S8LfgwAAAAADAAAAAAJDAAAAAAADAAADAAAMDEyMzQ1Njc4OUFCQ0RFRlQhIhkNAQIDEUscDBAECx0SHidobm9wcWIgBQYPExQVGggWBygkFxgJCg4bHyUjg4J9JiorPD0+P0NHSk1YWVpbXF1eX2BhY2RlZmdpamtscnN0eXp7fABBgDEL1w5JbGxlZ2FsIGJ5dGUgc2VxdWVuY2UARG9tYWluIGVycm9yAFJlc3VsdCBub3QgcmVwcmVzZW50YWJsZQBOb3QgYSB0dHkAUGVybWlzc2lvbiBkZW5pZWQAT3BlcmF0aW9uIG5vdCBwZXJtaXR0ZWQATm8gc3VjaCBmaWxlIG9yIGRpcmVjdG9yeQBObyBzdWNoIHByb2Nlc3MARmlsZSBleGlzdHMAVmFsdWUgdG9vIGxhcmdlIGZvciBkYXRhIHR5cGUATm8gc3BhY2UgbGVmdCBvbiBkZXZpY2UAT3V0IG9mIG1lbW9yeQBSZXNvdXJjZSBidXN5AEludGVycnVwdGVkIHN5c3RlbSBjYWxsAFJlc291cmNlIHRlbXBvcmFyaWx5IHVuYXZhaWxhYmxlAEludmFsaWQgc2VlawBDcm9zcy1kZXZpY2UgbGluawBSZWFkLW9ubHkgZmlsZSBzeXN0ZW0ARGlyZWN0b3J5IG5vdCBlbXB0eQBDb25uZWN0aW9uIHJlc2V0IGJ5IHBlZXIAT3BlcmF0aW9uIHRpbWVkIG91dABDb25uZWN0aW9uIHJlZnVzZWQASG9zdCBpcyBkb3duAEhvc3QgaXMgdW5yZWFjaGFibGUAQWRkcmVzcyBpbiB1c2UAQnJva2VuIHBpcGUASS9PIGVycm9yAE5vIHN1Y2ggZGV2aWNlIG9yIGFkZHJlc3MAQmxvY2sgZGV2aWNlIHJlcXVpcmVkAE5vIHN1Y2ggZGV2aWNlAE5vdCBhIGRpcmVjdG9yeQBJcyBhIGRpcmVjdG9yeQBUZXh0IGZpbGUgYnVzeQBFeGVjIGZvcm1hdCBlcnJvcgBJbnZhbGlkIGFyZ3VtZW50AEFyZ3VtZW50IGxpc3QgdG9vIGxvbmcAU3ltYm9saWMgbGluayBsb29wAEZpbGVuYW1lIHRvbyBsb25nAFRvbyBtYW55IG9wZW4gZmlsZXMgaW4gc3lzdGVtAE5vIGZpbGUgZGVzY3JpcHRvcnMgYXZhaWxhYmxlAEJhZCBmaWxlIGRlc2NyaXB0b3IATm8gY2hpbGQgcHJvY2VzcwBCYWQgYWRkcmVzcwBGaWxlIHRvbyBsYXJnZQBUb28gbWFueSBsaW5rcwBObyBsb2NrcyBhdmFpbGFibGUAUmVzb3VyY2UgZGVhZGxvY2sgd291bGQgb2NjdXIAU3RhdGUgbm90IHJlY292ZXJhYmxlAFByZXZpb3VzIG93bmVyIGRpZWQAT3BlcmF0aW9uIGNhbmNlbGVkAEZ1bmN0aW9uIG5vdCBpbXBsZW1lbnRlZABObyBtZXNzYWdlIG9mIGRlc2lyZWQgdHlwZQBJZGVudGlmaWVyIHJlbW92ZWQARGV2aWNlIG5vdCBhIHN0cmVhbQBObyBkYXRhIGF2YWlsYWJsZQBEZXZpY2UgdGltZW91dABPdXQgb2Ygc3RyZWFtcyByZXNvdXJjZXMATGluayBoYXMgYmVlbiBzZXZlcmVkAFByb3RvY29sIGVycm9yAEJhZCBtZXNzYWdlAEZpbGUgZGVzY3JpcHRvciBpbiBiYWQgc3RhdGUATm90IGEgc29ja2V0AERlc3RpbmF0aW9uIGFkZHJlc3MgcmVxdWlyZWQATWVzc2FnZSB0b28gbGFyZ2UAUHJvdG9jb2wgd3JvbmcgdHlwZSBmb3Igc29ja2V0AFByb3RvY29sIG5vdCBhdmFpbGFibGUAUHJvdG9jb2wgbm90IHN1cHBvcnRlZABTb2NrZXQgdHlwZSBub3Qgc3VwcG9ydGVkAE5vdCBzdXBwb3J0ZWQAUHJvdG9jb2wgZmFtaWx5IG5vdCBzdXBwb3J0ZWQAQWRkcmVzcyBmYW1pbHkgbm90IHN1cHBvcnRlZCBieSBwcm90b2NvbABBZGRyZXNzIG5vdCBhdmFpbGFibGUATmV0d29yayBpcyBkb3duAE5ldHdvcmsgdW5yZWFjaGFibGUAQ29ubmVjdGlvbiByZXNldCBieSBuZXR3b3JrAENvbm5lY3Rpb24gYWJvcnRlZABObyBidWZmZXIgc3BhY2UgYXZhaWxhYmxlAFNvY2tldCBpcyBjb25uZWN0ZWQAU29ja2V0IG5vdCBjb25uZWN0ZWQAQ2Fubm90IHNlbmQgYWZ0ZXIgc29ja2V0IHNodXRkb3duAE9wZXJhdGlvbiBhbHJlYWR5IGluIHByb2dyZXNzAE9wZXJhdGlvbiBpbiBwcm9ncmVzcwBTdGFsZSBmaWxlIGhhbmRsZQBSZW1vdGUgSS9PIGVycm9yAFF1b3RhIGV4Y2VlZGVkAE5vIG1lZGl1bSBmb3VuZABXcm9uZyBtZWRpdW0gdHlwZQBObyBlcnJvciBpbmZvcm1hdGlvbgAAAAAAAExDX0NUWVBFAAAAAExDX05VTUVSSUMAAExDX1RJTUUAAAAAAExDX0NPTExBVEUAAExDX01PTkVUQVJZAExDX01FU1NBR0VTAEHgPwsgMDEyMzQ1Njc4OWFiY2RlZkFCQ0RFRnhYKy1wUGlJbk4AQZDAAAuBASUAAABtAAAALwAAACUAAABkAAAALwAAACUAAAB5AAAAJQAAAFkAAAAtAAAAJQAAAG0AAAAtAAAAJQAAAGQAAAAlAAAASQAAADoAAAAlAAAATQAAADoAAAAlAAAAUwAAACAAAAAlAAAAcAAAAAAAAAAlAAAASAAAADoAAAAlAAAATQBBoMEAC/sLJQAAAEgAAAA6AAAAJQAAAE0AAAA6AAAAJQAAAFMAAAAlAAAASAAAADoAAAAlAAAATQAAADoAAAAlAAAAUwAAAJw2AADHNwAA8CAAAAAAAAB0NgAAtTcAAJw2AADxNwAA8CAAAAAAAAB0NgAAGzgAAHQ2AABMOAAAxDYAAH04AAAAAAAAAQAAAOAgAAAD9P//xDYAAKw4AAAAAAAAAQAAAPggAAAD9P//xDYAANs4AAAAAAAAAQAAAOAgAAAD9P//xDYAAAo5AAAAAAAAAQAAAPggAAAD9P//nDYAADk5AAAQIQAAAAAAAJw2AABSOQAACCEAAAAAAACcNgAAkTkAABAhAAAAAAAAnDYAAKk5AAAIIQAAAAAAAJw2AADBOQAAyCEAAAAAAACcNgAA1TkAABgmAAAAAAAAnDYAAOs5AADIIQAAAAAAAMQ2AAAEOgAAAAAAAAIAAADIIQAAAgAAAAgiAAAAAAAAxDYAAEg6AAAAAAAAAQAAACAiAAAAAAAAdDYAAF46AADENgAAdzoAAAAAAAACAAAAyCEAAAIAAABIIgAAAAAAAMQ2AAC7OgAAAAAAAAEAAAAgIgAAAAAAAMQ2AADkOgAAAAAAAAIAAADIIQAAAgAAAIAiAAAAAAAAxDYAACg7AAAAAAAAAQAAAJgiAAAAAAAAdDYAAD47AADENgAAVzsAAAAAAAACAAAAyCEAAAIAAADAIgAAAAAAAMQ2AACbOwAAAAAAAAEAAACYIgAAAAAAAMQ2AADxPAAAAAAAAAMAAADIIQAAAgAAAAAjAAACAAAACCMAAAAIAAB0NgAAWD0AAHQ2AAA2PQAAxDYAAGs9AAAAAAAAAwAAAMghAAACAAAAACMAAAIAAAA4IwAAAAgAAHQ2AACwPQAAxDYAANI9AAAAAAAAAgAAAMghAAACAAAAYCMAAAAIAAB0NgAAFz4AAMQ2AAAsPgAAAAAAAAIAAADIIQAAAgAAAGAjAAAACAAAxDYAAHE+AAAAAAAAAgAAAMghAAACAAAAqCMAAAIAAAB0NgAAjT4AAMQ2AACiPgAAAAAAAAIAAADIIQAAAgAAAKgjAAACAAAAxDYAAL4+AAAAAAAAAgAAAMghAAACAAAAqCMAAAIAAADENgAA2j4AAAAAAAACAAAAyCEAAAIAAACoIwAAAgAAAMQ2AAAFPwAAAAAAAAIAAADIIQAAAgAAADAkAAAAAAAAdDYAAEs/AADENgAAbz8AAAAAAAACAAAAyCEAAAIAAABYJAAAAAAAAHQ2AAC1PwAAxDYAANQ/AAAAAAAAAgAAAMghAAACAAAAgCQAAAAAAAB0NgAAGkAAAMQ2AAAzQAAAAAAAAAIAAADIIQAAAgAAAKgkAAAAAAAAdDYAAHlAAADENgAAkkAAAAAAAAACAAAAyCEAAAIAAADQJAAAAgAAAHQ2AACnQAAAxDYAAD5BAAAAAAAAAgAAAMghAAACAAAA0CQAAAIAAACcNgAAv0AAAAglAAAAAAAAxDYAAOJAAAAAAAAAAgAAAMghAAACAAAAKCUAAAIAAAB0NgAABUEAAJw2AAAcQQAACCUAAAAAAADENgAAU0EAAAAAAAACAAAAyCEAAAIAAAAoJQAAAgAAAMQ2AAB1QQAAAAAAAAIAAADIIQAAAgAAACglAAACAAAAxDYAAJdBAAAAAAAAAgAAAMghAAACAAAAKCUAAAIAAACcNgAAukEAAMghAAAAAAAAxDYAANBBAAAAAAAAAgAAAMghAAACAAAA0CUAAAIAAAB0NgAA4kEAAMQ2AAD3QQAAAAAAAAIAAADIIQAAAgAAANAlAAACAAAAnDYAABRCAADIIQAAAAAAAJw2AAApQgAAyCEAAAAAAAB0NgAAPkIAAJw2AACqQgAAMCYAAAAAAACcNgAAV0IAAEAmAAAAAAAAdDYAAHhCAACcNgAAhUIAACAmAAAAAAAAnDYAAPBCAAAwJgAAAAAAAJw2AADMQgAAWCYAAAAAAACcNgAAEkMAACAmAAAAAAAAVVVVVSAFAAAUAAAAQy5VVEYtOABBqM0ACwKMJgBBwM0ACwXEJgAABQBB0M0ACwEBAEHozQALCgEAAAACAAAALFwAQYDOAAsBAgBBj84ACwX//////wBBwM4ACwVEJwAACQBB0M4ACwEBAEHkzgALEgMAAAAAAAAAAgAAAEhDAAAABABBkM8ACwT/////AEHAzwALBcQnAAAFAEHQzwALAQEAQejPAAsOBAAAAAIAAABYRwAAAAQAQYDQAAsBAQBBj9AACwUK/////wBBwNAACwbEJwAAEAgAQYTSAAsCMFQAQbzSAAsQEA0AABARAABfcIkA/wkvDwBB8NIACwEFAEGX0wALBf//////AEHM0wAL1RDwIAAAAQAAAAIAAAAAAAAACCEAAAMAAAAEAAAAAQAAAAYAAAABAAAAAQAAAAIAAAADAAAABwAAAAQAAAAFAAAAAQAAAAgAAAACAAAAAAAAABAhAAAFAAAABgAAAAIAAAAJAAAAAgAAAAIAAAAGAAAABwAAAAoAAAAIAAAACQAAAAMAAAALAAAABAAAAAgAAAAAAAAAGCEAAAcAAAAIAAAA+P////j///8YIQAACQAAAAoAAABkKgAAeCoAAAgAAAAAAAAAMCEAAAsAAAAMAAAA+P////j///8wIQAADQAAAA4AAACUKgAAqCoAAAQAAAAAAAAASCEAAA8AAAAQAAAA/P////z///9IIQAAEQAAABIAAADEKgAA2CoAAAQAAAAAAAAAYCEAABMAAAAUAAAA/P////z///9gIQAAFQAAABYAAAD0KgAACCsAAAAAAAB4IQAABQAAABcAAAADAAAACQAAAAIAAAACAAAACgAAAAcAAAAKAAAACAAAAAkAAAADAAAADAAAAAUAAAAAAAAAiCEAAAMAAAAYAAAABAAAAAYAAAABAAAAAQAAAAsAAAADAAAABwAAAAQAAAAFAAAAAQAAAA0AAAAGAAAAAAAAAJghAAAFAAAAGQAAAAUAAAAJAAAAAgAAAAIAAAAGAAAABwAAAAoAAAAMAAAADQAAAAcAAAALAAAABAAAAAAAAACoIQAAAwAAABoAAAAGAAAABgAAAAEAAAABAAAAAgAAAAMAAAAHAAAADgAAAA8AAAAIAAAACAAAAAIAAAAAAAAAuCEAABsAAAAcAAAAHQAAAAEAAAADAAAADgAAAAAAAADYIQAAHgAAAB8AAAAdAAAAAgAAAAQAAAAPAAAAAAAAAOghAAAgAAAAIQAAAB0AAAABAAAAAgAAAAMAAAAEAAAABQAAAAYAAAAHAAAACAAAAAkAAAAKAAAACwAAAAAAAAAoIgAAIgAAACMAAAAdAAAADAAAAA0AAAAOAAAADwAAABAAAAARAAAAEgAAABMAAAAUAAAAFQAAABYAAAAAAAAAYCIAACQAAAAlAAAAHQAAAAMAAAAEAAAAAQAAAAUAAAACAAAAAQAAAAIAAAAGAAAAAAAAAKAiAAAmAAAAJwAAAB0AAAAHAAAACAAAAAMAAAAJAAAABAAAAAMAAAAEAAAACgAAAAAAAADYIgAAKAAAACkAAAAdAAAAEAAAABcAAAAYAAAAGQAAABoAAAAbAAAAAQAAAPj////YIgAAEQAAABIAAAATAAAAFAAAABUAAAAWAAAAFwAAAAAAAAAQIwAAKgAAACsAAAAdAAAAGAAAABwAAAAdAAAAHgAAAB8AAAAgAAAAAgAAAPj///8QIwAAGQAAABoAAAAbAAAAHAAAAB0AAAAeAAAAHwAAACUAAABIAAAAOgAAACUAAABNAAAAOgAAACUAAABTAAAAAAAAACUAAABtAAAALwAAACUAAABkAAAALwAAACUAAAB5AAAAAAAAACUAAABJAAAAOgAAACUAAABNAAAAOgAAACUAAABTAAAAIAAAACUAAABwAAAAAAAAACUAAABhAAAAIAAAACUAAABiAAAAIAAAACUAAABkAAAAIAAAACUAAABIAAAAOgAAACUAAABNAAAAOgAAACUAAABTAAAAIAAAACUAAABZAAAAAAAAAEEAAABNAAAAAAAAAFAAAABNAAAAAAAAAEoAAABhAAAAbgAAAHUAAABhAAAAcgAAAHkAAAAAAAAARgAAAGUAAABiAAAAcgAAAHUAAABhAAAAcgAAAHkAAAAAAAAATQAAAGEAAAByAAAAYwAAAGgAAAAAAAAAQQAAAHAAAAByAAAAaQAAAGwAAAAAAAAATQAAAGEAAAB5AAAAAAAAAEoAAAB1AAAAbgAAAGUAAAAAAAAASgAAAHUAAABsAAAAeQAAAAAAAABBAAAAdQAAAGcAAAB1AAAAcwAAAHQAAAAAAAAAUwAAAGUAAABwAAAAdAAAAGUAAABtAAAAYgAAAGUAAAByAAAAAAAAAE8AAABjAAAAdAAAAG8AAABiAAAAZQAAAHIAAAAAAAAATgAAAG8AAAB2AAAAZQAAAG0AAABiAAAAZQAAAHIAAAAAAAAARAAAAGUAAABjAAAAZQAAAG0AAABiAAAAZQAAAHIAAAAAAAAASgAAAGEAAABuAAAAAAAAAEYAAABlAAAAYgAAAAAAAABNAAAAYQAAAHIAAAAAAAAAQQAAAHAAAAByAAAAAAAAAEoAAAB1AAAAbgAAAAAAAABKAAAAdQAAAGwAAAAAAAAAQQAAAHUAAABnAAAAAAAAAFMAAABlAAAAcAAAAAAAAABPAAAAYwAAAHQAAAAAAAAATgAAAG8AAAB2AAAAAAAAAEQAAABlAAAAYwAAAAAAAABTAAAAdQAAAG4AAABkAAAAYQAAAHkAAAAAAAAATQAAAG8AAABuAAAAZAAAAGEAAAB5AAAAAAAAAFQAAAB1AAAAZQAAAHMAAABkAAAAYQAAAHkAAAAAAAAAVwAAAGUAAABkAAAAbgAAAGUAAABzAAAAZAAAAGEAAAB5AAAAAAAAAFQAAABoAAAAdQAAAHIAAABzAAAAZAAAAGEAAAB5AAAAAAAAAEYAAAByAAAAaQAAAGQAAABhAAAAeQAAAAAAAABTAAAAYQAAAHQAAAB1AAAAcgAAAGQAAABhAAAAeQAAAAAAAABTAAAAdQAAAG4AAAAAAAAATQAAAG8AAABuAAAAAAAAAFQAAAB1AAAAZQAAAAAAAABXAAAAZQAAAGQAAAAAAAAAVAAAAGgAAAB1AAAAAAAAAEYAAAByAAAAaQAAAAAAAABTAAAAYQAAAHQAQazkAAuJBkAjAAAsAAAALQAAAB0AAAABAAAAAAAAAGgjAAAuAAAALwAAAB0AAAACAAAAAAAAAIgjAAAwAAAAMQAAAB0AAAAgAAAAIQAAAAcAAAAIAAAACQAAAAoAAAAiAAAACwAAAAwAAAAAAAAAsCMAADIAAAAzAAAAHQAAACMAAAAkAAAADQAAAA4AAAAPAAAAEAAAACUAAAARAAAAEgAAAAAAAADQIwAANAAAADUAAAAdAAAAJgAAACcAAAATAAAAFAAAABUAAAAWAAAAKAAAABcAAAAYAAAAAAAAAPAjAAA2AAAANwAAAB0AAAApAAAAKgAAABkAAAAaAAAAGwAAABwAAAArAAAAHQAAAB4AAAAAAAAAECQAADgAAAA5AAAAHQAAAAMAAAAEAAAAAAAAADgkAAA6AAAAOwAAAB0AAAAFAAAABgAAAAAAAABgJAAAPAAAAD0AAAAdAAAAAQAAACEAAAAAAAAAiCQAAD4AAAA/AAAAHQAAAAIAAAAiAAAAAAAAALAkAABAAAAAQQAAAB0AAAAQAAAAAQAAAB8AAAAAAAAA2CQAAEIAAABDAAAAHQAAABEAAAACAAAAIAAAAAAAAAAwJQAARAAAAEUAAAAdAAAAAwAAAAQAAAALAAAALAAAAC0AAAAMAAAALgAAAAAAAAD4JAAARAAAAEYAAAAdAAAAAwAAAAQAAAALAAAALAAAAC0AAAAMAAAALgAAAAAAAABgJQAARwAAAEgAAAAdAAAABQAAAAYAAAANAAAALwAAADAAAAAOAAAAMQAAAAAAAACgJQAASQAAAEoAAAAdAAAAAAAAALAlAABLAAAATAAAAB0AAAAJAAAAEgAAAAoAAAATAAAACwAAAAEAAAAUAAAADwAAAAAAAAD4JQAATQAAAE4AAAAdAAAAMgAAADMAAAAhAAAAIgAAACMAAAAAAAAACCYAAE8AAABQAAAAHQAAADQAAAA1AAAAJAAAACUAAAAmAAAAZgAAAGEAAABsAAAAcwAAAGUAAAAAAAAAdAAAAHIAAAB1AAAAZQBBwOoAC/cbyCEAAEQAAABRAAAAHQAAAAAAAADYJQAARAAAAFIAAAAdAAAAFQAAAAIAAAADAAAABAAAAAwAAAAWAAAADQAAABcAAAAOAAAABQAAABgAAAAQAAAAAAAAAEAlAABEAAAAUwAAAB0AAAAHAAAACAAAABEAAAA2AAAANwAAABIAAAA4AAAAAAAAAIAlAABEAAAAVAAAAB0AAAAJAAAACgAAABMAAAA5AAAAOgAAABQAAAA7AAAAAAAAAAglAABEAAAAVQAAAB0AAAADAAAABAAAAAsAAAAsAAAALQAAAAwAAAAuAAAAAAAAAAgjAAARAAAAEgAAABMAAAAUAAAAFQAAABYAAAAXAAAAAAAAADgjAAAZAAAAGgAAABsAAAAcAAAAHQAAAB4AAAAfAAAAAAAAACAmAABWAAAAVwAAAFgAAABZAAAAGQAAAAMAAAABAAAABQAAAAAAAABIJgAAVgAAAFoAAABYAAAAWQAAABkAAAAEAAAAAgAAAAYAAAAAAAAAeCYAAFYAAABbAAAAWAAAAFkAAAAZAAAABQAAAAMAAAAHAAAAT3JkZXIgb2YgUGFkZSBhcHByb3hpbWF0aW9uIHNob3VsZCBiZSBhbiBpbnRlZ2VyIGluIHRoZSByYWdlIG9mIDQgdG8gNyEKAENhbm5vdCBhbGxvY2F0ZSBtZW1vcnkhCgBpbmZpbml0eQAAAQIEBwMGBQAtKyAgIDBYMHgAKG51bGwpAC0wWCswWCAwWC0weCsweCAweABpbmYASU5GAG5hbgBOQU4ALgBMQ19BTEwATEFORwBDLlVURi04AFBPU0lYAE1VU0xfTE9DUEFUSABOU3QzX18yOGlvc19iYXNlRQBOU3QzX18yOWJhc2ljX2lvc0ljTlNfMTFjaGFyX3RyYWl0c0ljRUVFRQBOU3QzX18yOWJhc2ljX2lvc0l3TlNfMTFjaGFyX3RyYWl0c0l3RUVFRQBOU3QzX18yMTViYXNpY19zdHJlYW1idWZJY05TXzExY2hhcl90cmFpdHNJY0VFRUUATlN0M19fMjE1YmFzaWNfc3RyZWFtYnVmSXdOU18xMWNoYXJfdHJhaXRzSXdFRUVFAE5TdDNfXzIxM2Jhc2ljX2lzdHJlYW1JY05TXzExY2hhcl90cmFpdHNJY0VFRUUATlN0M19fMjEzYmFzaWNfaXN0cmVhbUl3TlNfMTFjaGFyX3RyYWl0c0l3RUVFRQBOU3QzX18yMTNiYXNpY19vc3RyZWFtSWNOU18xMWNoYXJfdHJhaXRzSWNFRUVFAE5TdDNfXzIxM2Jhc2ljX29zdHJlYW1Jd05TXzExY2hhcl90cmFpdHNJd0VFRUUATlN0M19fMjExX19zdGRvdXRidWZJd0VFAE5TdDNfXzIxMV9fc3Rkb3V0YnVmSWNFRQB1bnN1cHBvcnRlZCBsb2NhbGUgZm9yIHN0YW5kYXJkIGlucHV0AE5TdDNfXzIxMF9fc3RkaW5idWZJd0VFAE5TdDNfXzIxMF9fc3RkaW5idWZJY0VFAE5TdDNfXzI3Y29sbGF0ZUljRUUATlN0M19fMjZsb2NhbGU1ZmFjZXRFAE5TdDNfXzI3Y29sbGF0ZUl3RUUAJXAAQwBOU3QzX18yN251bV9nZXRJY05TXzE5aXN0cmVhbWJ1Zl9pdGVyYXRvckljTlNfMTFjaGFyX3RyYWl0c0ljRUVFRUVFAE5TdDNfXzI5X19udW1fZ2V0SWNFRQBOU3QzX18yMTRfX251bV9nZXRfYmFzZUUATlN0M19fMjdudW1fZ2V0SXdOU18xOWlzdHJlYW1idWZfaXRlcmF0b3JJd05TXzExY2hhcl90cmFpdHNJd0VFRUVFRQBOU3QzX18yOV9fbnVtX2dldEl3RUUAJXAAAAAATABsbAAlAAAAAABsAE5TdDNfXzI3bnVtX3B1dEljTlNfMTlvc3RyZWFtYnVmX2l0ZXJhdG9ySWNOU18xMWNoYXJfdHJhaXRzSWNFRUVFRUUATlN0M19fMjlfX251bV9wdXRJY0VFAE5TdDNfXzIxNF9fbnVtX3B1dF9iYXNlRQBOU3QzX18yN251bV9wdXRJd05TXzE5b3N0cmVhbWJ1Zl9pdGVyYXRvckl3TlNfMTFjaGFyX3RyYWl0c0l3RUVFRUVFAE5TdDNfXzI5X19udW1fcHV0SXdFRQAlSDolTTolUwAlbS8lZC8leQAlSTolTTolUyAlcAAlYSAlYiAlZCAlSDolTTolUyAlWQBBTQBQTQBKYW51YXJ5AEZlYnJ1YXJ5AE1hcmNoAEFwcmlsAE1heQBKdW5lAEp1bHkAQXVndXN0AFNlcHRlbWJlcgBPY3RvYmVyAE5vdmVtYmVyAERlY2VtYmVyAEphbgBGZWIATWFyAEFwcgBKdW4ASnVsAEF1ZwBTZXAAT2N0AE5vdgBEZWMAU3VuZGF5AE1vbmRheQBUdWVzZGF5AFdlZG5lc2RheQBUaHVyc2RheQBGcmlkYXkAU2F0dXJkYXkAU3VuAE1vbgBUdWUAV2VkAFRodQBGcmkAU2F0ACVtLyVkLyV5JVktJW0tJWQlSTolTTolUyAlcCVIOiVNJUg6JU06JVMlSDolTTolU05TdDNfXzI4dGltZV9nZXRJY05TXzE5aXN0cmVhbWJ1Zl9pdGVyYXRvckljTlNfMTFjaGFyX3RyYWl0c0ljRUVFRUVFAE5TdDNfXzIyMF9fdGltZV9nZXRfY19zdG9yYWdlSWNFRQBOU3QzX18yOXRpbWVfYmFzZUUATlN0M19fMjh0aW1lX2dldEl3TlNfMTlpc3RyZWFtYnVmX2l0ZXJhdG9ySXdOU18xMWNoYXJfdHJhaXRzSXdFRUVFRUUATlN0M19fMjIwX190aW1lX2dldF9jX3N0b3JhZ2VJd0VFAE5TdDNfXzI4dGltZV9wdXRJY05TXzE5b3N0cmVhbWJ1Zl9pdGVyYXRvckljTlNfMTFjaGFyX3RyYWl0c0ljRUVFRUVFAE5TdDNfXzIxMF9fdGltZV9wdXRFAE5TdDNfXzI4dGltZV9wdXRJd05TXzE5b3N0cmVhbWJ1Zl9pdGVyYXRvckl3TlNfMTFjaGFyX3RyYWl0c0l3RUVFRUVFAE5TdDNfXzIxMG1vbmV5cHVuY3RJY0xiMEVFRQBOU3QzX18yMTBtb25leV9iYXNlRQBOU3QzX18yMTBtb25leXB1bmN0SWNMYjFFRUUATlN0M19fMjEwbW9uZXlwdW5jdEl3TGIwRUVFAE5TdDNfXzIxMG1vbmV5cHVuY3RJd0xiMUVFRQAwMTIzNDU2Nzg5ACVMZgBOU3QzX18yOW1vbmV5X2dldEljTlNfMTlpc3RyZWFtYnVmX2l0ZXJhdG9ySWNOU18xMWNoYXJfdHJhaXRzSWNFRUVFRUUATlN0M19fMjExX19tb25leV9nZXRJY0VFADAxMjM0NTY3ODkATlN0M19fMjltb25leV9nZXRJd05TXzE5aXN0cmVhbWJ1Zl9pdGVyYXRvckl3TlNfMTFjaGFyX3RyYWl0c0l3RUVFRUVFAE5TdDNfXzIxMV9fbW9uZXlfZ2V0SXdFRQAlLjBMZgBOU3QzX18yOW1vbmV5X3B1dEljTlNfMTlvc3RyZWFtYnVmX2l0ZXJhdG9ySWNOU18xMWNoYXJfdHJhaXRzSWNFRUVFRUUATlN0M19fMjExX19tb25leV9wdXRJY0VFAE5TdDNfXzI5bW9uZXlfcHV0SXdOU18xOW9zdHJlYW1idWZfaXRlcmF0b3JJd05TXzExY2hhcl90cmFpdHNJd0VFRUVFRQBOU3QzX18yMTFfX21vbmV5X3B1dEl3RUUATlN0M19fMjhtZXNzYWdlc0ljRUUATlN0M19fMjEzbWVzc2FnZXNfYmFzZUUATlN0M19fMjE3X193aWRlbl9mcm9tX3V0ZjhJTG0zMkVFRQBOU3QzX18yN2NvZGVjdnRJRGljMTFfX21ic3RhdGVfdEVFAE5TdDNfXzIxMmNvZGVjdnRfYmFzZUUATlN0M19fMjE2X19uYXJyb3dfdG9fdXRmOElMbTMyRUVFAE5TdDNfXzI4bWVzc2FnZXNJd0VFAE5TdDNfXzI3Y29kZWN2dEljYzExX19tYnN0YXRlX3RFRQBOU3QzX18yN2NvZGVjdnRJd2MxMV9fbWJzdGF0ZV90RUUATlN0M19fMjdjb2RlY3Z0SURzYzExX19tYnN0YXRlX3RFRQBOU3QzX18yNmxvY2FsZTVfX2ltcEUATlN0M19fMjVjdHlwZUljRUUATlN0M19fMjEwY3R5cGVfYmFzZUUATlN0M19fMjVjdHlwZUl3RUUAZmFsc2UAdHJ1ZQBOU3QzX18yOG51bXB1bmN0SWNFRQBOU3QzX18yOG51bXB1bmN0SXdFRQBOU3QzX18yMTRfX3NoYXJlZF9jb3VudEUATjEwX19jeHhhYml2MTE2X19zaGltX3R5cGVfaW5mb0UAU3Q5dHlwZV9pbmZvAE4xMF9fY3h4YWJpdjEyMF9fc2lfY2xhc3NfdHlwZV9pbmZvRQBOMTBfX2N4eGFiaXYxMTdfX2NsYXNzX3R5cGVfaW5mb0UATjEwX19jeHhhYml2MTE5X19wb2ludGVyX3R5cGVfaW5mb0UATjEwX19jeHhhYml2MTE3X19wYmFzZV90eXBlX2luZm9FAE4xMF9fY3h4YWJpdjEyMV9fdm1pX2NsYXNzX3R5cGVfaW5mb0U=';
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



