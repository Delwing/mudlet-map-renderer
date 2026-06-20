// Browser shim for `qtdatastream`.
//
// qtdatastream's main entry (`index.js`) eagerly `require()`s `socket.js` and
// `transform.js`, which `extends stream.Transform` from Node's `stream` module.
// Vite externalises `stream` in the browser, so loading the real entry throws
// "Class extends value undefined". The Mudlet binary reader only uses the
// `buffer` (ReadBuffer) and `types` exports for parsing, so this shim re-exports
// the browser-safe submodules and omits the socket/transform networking code.
//
// Wired in for the demo via vite.config.ts (serve only), matching the bare
// `qtdatastream` specifier exactly — subpaths like `qtdatastream/src/types`
// resolve to the real package untouched.
export {default as util} from "qtdatastream/src/util";
export {default as types} from "qtdatastream/src/types";
export {default as buffer} from "qtdatastream/src/buffer";
export {default as serialization} from "qtdatastream/src/serialization";
