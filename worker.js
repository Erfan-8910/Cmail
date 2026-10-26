var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/util.ts
function clean(s, max = 255) {
  if (typeof s !== "string")
    return "";
  return s.trim().slice(0, max);
}
function usernameValid(u) {
  return /^[a-zA-Z0-9_.-]{3,32}$/.test(u);
}
function passwordStrong(p) {
  return typeof p === "string" && p.length >= 8 && p.length <= 128;
}
async function getSetting(env, key) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
  return row?.value ?? null;
}
async function setSetting(env, key, value) {
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).bind(key, value).run();
}
async function getSettings(env, keys) {
  const out = {};
  if (!keys.length)
    return out;
  const ph = keys.map(() => "?").join(",");
  const { results } = await env.DB.prepare(`SELECT key, value FROM settings WHERE key IN (${ph})`).bind(...keys).all();
  for (const r of results ?? [])
    out[r.key] = r.value;
  return out;
}
async function appSecret(env) {
  if (env.APP_SECRET && env.APP_SECRET.length >= 16)
    return env.APP_SECRET;
  let s = await getSetting(env, "app_secret");
  if (!s) {
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    s = b64.encode(buf);
    await setSetting(env, "app_secret", s);
  }
  return s;
}
async function aesKey(secret) {
  const base = await crypto.subtle.importKey("raw", str.toBuf(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: str.toBuf("cmail-aes-v1"), info: str.toBuf("totp-seal") },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
async function sealText(env, plain) {
  const key = await aesKey(await appSecret(env));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, str.toBuf(plain));
  return "v1." + b64.encode(iv) + "." + b64.encode(ct);
}
async function openText(env, sealed) {
  const [v, ivB, ctB] = sealed.split(".");
  if (v !== "v1")
    throw new Error("bad ciphertext");
  const key = await aesKey(await appSecret(env));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64.decode(ivB) }, key, b64.decode(ctB));
  return str.fromBuf(pt);
}
async function hashPassword(password) {
  const iterations = 1e5;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await pbkdf2(password, salt, iterations);
  return `pbkdf2$${iterations}$${b64.encode(salt)}$${b64.encode(key)}`;
}
async function verifyPassword(password, stored) {
  try {
    const [scheme, iterStr, saltB64, hashB64] = stored.split("$");
    if (scheme !== "pbkdf2")
      return false;
    const salt = b64.decode(saltB64);
    const key = await pbkdf2(password, salt, parseInt(iterStr, 10));
    const a = b64.encode(key);
    if (a.length !== hashB64.length)
      return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++)
      diff |= a.charCodeAt(i) ^ hashB64.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}
async function pbkdf2(password, salt, iterations) {
  const base = await crypto.subtle.importKey("raw", str.toBuf(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, 256);
}
function previewOf(text, len = 160) {
  if (!text)
    return "";
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > len ? t.slice(0, len) + "\u2026" : t;
}
function randomLocalPart() {
  const words = ["swift", "quiet", "amber", "noble", "crimson", "velvet", "orbit", "lunar", "cobalt", "ember", "zephyr", "onyx", "delta", "harbor", "echo", "atlas", "raven", "cinder", "frost", "sable"];
  const w = words[Math.floor(Math.random() * words.length)];
  const n = Math.random().toString(36).slice(2, 8);
  return `${w}.${n}`;
}
var uid, now, randomToken, b64, str, RE_LOCAL_PART, RE_DOMAIN;
var init_util = __esm({
  "src/util.ts"() {
    "use strict";
    uid = (prefix = "") => prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    now = () => Date.now();
    randomToken = (bytes = 32) => {
      const buf = new Uint8Array(bytes);
      crypto.getRandomValues(buf);
      return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    };
    b64 = {
      encode(buf) {
        const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
        let s = "";
        for (let i = 0; i < u8.length; i++)
          s += String.fromCharCode(u8[i]);
        return btoa(s);
      },
      decode(str2) {
        const s = atob(str2.replace(/-/g, "+").replace(/_/g, "/"));
        const u8 = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++)
          u8[i] = s.charCodeAt(i);
        return u8;
      }
    };
    str = {
      toBuf(s) {
        return new TextEncoder().encode(s);
      },
      fromBuf(buf) {
        return new TextDecoder().decode(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
      }
    };
    RE_LOCAL_PART = /^[a-z0-9]([a-z0-9._-]{0,30})[a-z0-9]$/i;
    RE_DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
  }
});

// node_modules/postal-mime/src/decode-strings.js
function decodeBase64(base64) {
  let bufferLength = Math.ceil(base64.length / 4) * 3;
  const len = base64.length;
  let p = 0;
  if (base64.length % 4 === 3) {
    bufferLength--;
  } else if (base64.length % 4 === 2) {
    bufferLength -= 2;
  } else if (base64[base64.length - 1] === "=") {
    bufferLength--;
    if (base64[base64.length - 2] === "=") {
      bufferLength--;
    }
  }
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const bytes = new Uint8Array(arrayBuffer);
  for (let i = 0; i < len; i += 4) {
    let encoded1 = base64Lookup[base64.charCodeAt(i)];
    let encoded2 = base64Lookup[base64.charCodeAt(i + 1)];
    let encoded3 = base64Lookup[base64.charCodeAt(i + 2)];
    let encoded4 = base64Lookup[base64.charCodeAt(i + 3)];
    bytes[p++] = encoded1 << 2 | encoded2 >> 4;
    bytes[p++] = (encoded2 & 15) << 4 | encoded3 >> 2;
    bytes[p++] = (encoded3 & 3) << 6 | encoded4 & 63;
  }
  return arrayBuffer;
}
function getDecoder(charset) {
  charset = (charset || "utf8").trim().toLowerCase();
  charset = charsetAliases.get(charset) || charset;
  let decoder;
  try {
    decoder = new TextDecoder(charset);
  } catch (err) {
    decoder = new TextDecoder("windows-1252");
  }
  return decoder;
}
async function blobToArrayBuffer(blob) {
  if ("arrayBuffer" in blob) {
    return await blob.arrayBuffer();
  }
  const fr = new FileReader();
  return new Promise((resolve, reject) => {
    fr.onload = function(e) {
      resolve(e.target.result);
    };
    fr.onerror = function(e) {
      reject(fr.error);
    };
    fr.readAsArrayBuffer(blob);
  });
}
function getHex(c) {
  if (c >= 48 && c <= 57 || c >= 97 && c <= 102 || c >= 65 && c <= 70) {
    return String.fromCharCode(c);
  }
  return false;
}
function decodeWord(charset, encoding, str2) {
  let splitPos = charset.indexOf("*");
  if (splitPos >= 0) {
    charset = charset.substr(0, splitPos);
  }
  encoding = encoding.toUpperCase();
  let byteStr;
  if (encoding === "Q") {
    str2 = str2.replace(/=\s+([0-9a-fA-F])/g, "=$1").replace(/[_\s]/g, " ");
    let buf = textEncoder.encode(str2);
    let encodedBytes = [];
    for (let i = 0, len = buf.length; i < len; i++) {
      let c = buf[i];
      if (i <= len - 2 && c === 61) {
        let c1 = getHex(buf[i + 1]);
        let c2 = getHex(buf[i + 2]);
        if (c1 && c2) {
          let c3 = parseInt(c1 + c2, 16);
          encodedBytes.push(c3);
          i += 2;
          continue;
        }
      }
      encodedBytes.push(c);
    }
    byteStr = new ArrayBuffer(encodedBytes.length);
    let dataView = new DataView(byteStr);
    for (let i = 0, len = encodedBytes.length; i < len; i++) {
      dataView.setUint8(i, encodedBytes[i]);
    }
  } else if (encoding === "B") {
    byteStr = decodeBase64(str2.replace(/[^a-zA-Z0-9\+\/=]+/g, ""));
  } else {
    byteStr = textEncoder.encode(str2);
  }
  return getDecoder(charset).decode(byteStr);
}
function decodeWords(str2) {
  let joinString = true;
  let done = false;
  while (!done) {
    let result = (str2 || "").toString().replace(
      /(=\?([^?]+)\?[Bb]\?([^?]*)\?=)\s*(?==\?([^?]+)\?[Bb]\?[^?]*\?=)/g,
      (match2, left, chLeft, encodedLeftStr, chRight) => {
        if (!joinString) {
          return match2;
        }
        if (chLeft === chRight && encodedLeftStr.length % 4 === 0 && !/=$/.test(encodedLeftStr)) {
          return left + "__\0JOIN\0__";
        }
        return match2;
      }
    ).replace(
      /(=\?([^?]+)\?[Qq]\?[^?]*\?=)\s*(?==\?([^?]+)\?[Qq]\?[^?]*\?=)/g,
      (match2, left, chLeft, chRight) => {
        if (!joinString) {
          return match2;
        }
        if (chLeft === chRight) {
          return left + "__\0JOIN\0__";
        }
        return match2;
      }
    ).replace(/(\?=)?__\x00JOIN\x00__(=\?([^?]+)\?[QqBb]\?)?/g, "").replace(/(=\?[^?]+\?[QqBb]\?[^?]*\?=)\s+(?==\?[^?]+\?[QqBb]\?[^?]*\?=)/g, "$1").replace(
      /=\?([\w_\-*]+)\?([QqBb])\?([^?]*)\?=/g,
      (m, charset, encoding, text) => decodeWord(charset, encoding, text)
    );
    if (joinString && result.indexOf("\uFFFD") >= 0) {
      joinString = false;
    } else {
      return result;
    }
  }
}
function decodeURIComponentWithCharset(encodedStr, charset) {
  charset = charset || "utf-8";
  let encodedBytes = [];
  for (let i = 0; i < encodedStr.length; i++) {
    let c = encodedStr.charAt(i);
    if (c === "%" && /^[a-f0-9]{2}/i.test(encodedStr.substr(i + 1, 2))) {
      let byte = encodedStr.substr(i + 1, 2);
      i += 2;
      encodedBytes.push(parseInt(byte, 16));
    } else if (c.charCodeAt(0) > 126) {
      c = textEncoder.encode(c);
      for (let j = 0; j < c.length; j++) {
        encodedBytes.push(c[j]);
      }
    } else {
      encodedBytes.push(c.charCodeAt(0));
    }
  }
  const byteStr = new ArrayBuffer(encodedBytes.length);
  const dataView = new DataView(byteStr);
  for (let i = 0, len = encodedBytes.length; i < len; i++) {
    dataView.setUint8(i, encodedBytes[i]);
  }
  return getDecoder(charset).decode(byteStr);
}
function decodeParameterValueContinuations(header) {
  let paramKeys = /* @__PURE__ */ new Map();
  Object.keys(header.params).forEach((key) => {
    let match2 = key.match(/\*((\d+)\*?)?$/);
    if (!match2) {
      return;
    }
    let actualKey = key.substr(0, match2.index).toLowerCase();
    let nr = Number(match2[2]) || 0;
    let paramVal;
    if (!paramKeys.has(actualKey)) {
      paramVal = {
        charset: false,
        values: []
      };
      paramKeys.set(actualKey, paramVal);
    } else {
      paramVal = paramKeys.get(actualKey);
    }
    let value = header.params[key];
    if (nr === 0 && match2[0].charAt(match2[0].length - 1) === "*" && (match2 = value.match(/^([^']*)'[^']*'(.*)$/))) {
      paramVal.charset = match2[1] || "utf-8";
      value = match2[2];
    }
    paramVal.values.push({ nr, value });
    delete header.params[key];
  });
  paramKeys.forEach((paramVal, key) => {
    header.params[key] = decodeURIComponentWithCharset(
      paramVal.values.sort((a, b) => a.nr - b.nr).map((a) => a.value).join(""),
      paramVal.charset
    );
  });
}
var textEncoder, base64Chars, base64Lookup, charsetAliases;
var init_decode_strings = __esm({
  "node_modules/postal-mime/src/decode-strings.js"() {
    textEncoder = new TextEncoder();
    base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    base64Lookup = new Uint8Array(256);
    for (let i = 0; i < base64Chars.length; i++) {
      base64Lookup[base64Chars.charCodeAt(i)] = i;
    }
    charsetAliases = /* @__PURE__ */ new Map([
      ["iso-8859-8-i", "iso-8859-8"],
      ["iso-8859-8-e", "iso-8859-8"]
    ]);
  }
});

// node_modules/postal-mime/src/pass-through-decoder.js
var PassThroughDecoder;
var init_pass_through_decoder = __esm({
  "node_modules/postal-mime/src/pass-through-decoder.js"() {
    init_decode_strings();
    PassThroughDecoder = class {
      constructor() {
        this.chunks = [];
      }
      update(line) {
        this.chunks.push(line);
        this.chunks.push("\n");
      }
      finalize() {
        return blobToArrayBuffer(new Blob(this.chunks, { type: "application/octet-stream" }));
      }
    };
  }
});

// node_modules/postal-mime/src/base64-decoder.js
var Base64Decoder;
var init_base64_decoder = __esm({
  "node_modules/postal-mime/src/base64-decoder.js"() {
    init_decode_strings();
    Base64Decoder = class {
      constructor(opts) {
        opts = opts || {};
        this.decoder = opts.decoder || new TextDecoder();
        this.maxChunkSize = 100 * 1024;
        this.chunks = [];
        this.remainder = "";
      }
      update(buffer) {
        let str2 = this.decoder.decode(buffer);
        str2 = str2.replace(/[^a-zA-Z0-9+\/]+/g, "");
        this.remainder += str2;
        if (this.remainder.length >= this.maxChunkSize) {
          let allowedBytes = Math.floor(this.remainder.length / 4) * 4;
          let base64Str;
          if (allowedBytes === this.remainder.length) {
            base64Str = this.remainder;
            this.remainder = "";
          } else {
            base64Str = this.remainder.substr(0, allowedBytes);
            this.remainder = this.remainder.substr(allowedBytes);
          }
          if (base64Str.length) {
            this.chunks.push(decodeBase64(base64Str));
          }
        }
      }
      finalize() {
        if (this.remainder && !/^=+$/.test(this.remainder)) {
          this.chunks.push(decodeBase64(this.remainder));
        }
        return blobToArrayBuffer(new Blob(this.chunks, { type: "application/octet-stream" }));
      }
    };
  }
});

// node_modules/postal-mime/src/qp-decoder.js
var VALID_QP_REGEX, QP_SPLIT_REGEX, SOFT_LINE_BREAK_REGEX, PARTIAL_QP_ENDING_REGEX, QPDecoder;
var init_qp_decoder = __esm({
  "node_modules/postal-mime/src/qp-decoder.js"() {
    init_decode_strings();
    VALID_QP_REGEX = /^=[a-f0-9]{2}$/i;
    QP_SPLIT_REGEX = /(?==[a-f0-9]{2})/i;
    SOFT_LINE_BREAK_REGEX = /=\r?\n/g;
    PARTIAL_QP_ENDING_REGEX = /=[a-fA-F0-9]?$/;
    QPDecoder = class {
      constructor(opts) {
        opts = opts || {};
        this.decoder = opts.decoder || new TextDecoder();
        this.maxChunkSize = 100 * 1024;
        this.remainder = "";
        this.chunks = [];
      }
      decodeQPBytes(encodedBytes) {
        let buf = new ArrayBuffer(encodedBytes.length);
        let dataView = new DataView(buf);
        for (let i = 0, len = encodedBytes.length; i < len; i++) {
          dataView.setUint8(i, parseInt(encodedBytes[i], 16));
        }
        return buf;
      }
      decodeChunks(str2) {
        str2 = str2.replace(SOFT_LINE_BREAK_REGEX, "");
        let list = str2.split(QP_SPLIT_REGEX);
        let encodedBytes = [];
        for (let part of list) {
          if (part.charAt(0) !== "=") {
            if (encodedBytes.length) {
              this.chunks.push(this.decodeQPBytes(encodedBytes));
              encodedBytes = [];
            }
            this.chunks.push(part);
            continue;
          }
          if (part.length === 3) {
            if (VALID_QP_REGEX.test(part)) {
              encodedBytes.push(part.substr(1));
            } else {
              if (encodedBytes.length) {
                this.chunks.push(this.decodeQPBytes(encodedBytes));
                encodedBytes = [];
              }
              this.chunks.push(part);
            }
            continue;
          }
          if (part.length > 3) {
            const firstThree = part.substr(0, 3);
            if (VALID_QP_REGEX.test(firstThree)) {
              encodedBytes.push(part.substr(1, 2));
              this.chunks.push(this.decodeQPBytes(encodedBytes));
              encodedBytes = [];
              part = part.substr(3);
              this.chunks.push(part);
            } else {
              if (encodedBytes.length) {
                this.chunks.push(this.decodeQPBytes(encodedBytes));
                encodedBytes = [];
              }
              this.chunks.push(part);
            }
          }
        }
        if (encodedBytes.length) {
          this.chunks.push(this.decodeQPBytes(encodedBytes));
        }
      }
      update(buffer) {
        let str2 = this.decoder.decode(buffer) + "\n";
        str2 = this.remainder + str2;
        if (str2.length < this.maxChunkSize) {
          this.remainder = str2;
          return;
        }
        this.remainder = "";
        let partialEnding = str2.match(PARTIAL_QP_ENDING_REGEX);
        if (partialEnding) {
          if (partialEnding.index === 0) {
            this.remainder = str2;
            return;
          }
          this.remainder = str2.substr(partialEnding.index);
          str2 = str2.substr(0, partialEnding.index);
        }
        this.decodeChunks(str2);
      }
      finalize() {
        if (this.remainder.length) {
          this.decodeChunks(this.remainder);
          this.remainder = "";
        }
        return blobToArrayBuffer(new Blob(this.chunks, { type: "application/octet-stream" }));
      }
    };
  }
});

// node_modules/postal-mime/src/mime-node.js
var defaultDecoder, MimeNode;
var init_mime_node = __esm({
  "node_modules/postal-mime/src/mime-node.js"() {
    init_decode_strings();
    init_pass_through_decoder();
    init_base64_decoder();
    init_qp_decoder();
    defaultDecoder = getDecoder();
    MimeNode = class {
      constructor(options) {
        this.options = options || {};
        this.postalMime = this.options.postalMime;
        this.root = !!this.options.parentNode;
        this.childNodes = [];
        if (this.options.parentNode) {
          this.parentNode = this.options.parentNode;
          this.depth = this.parentNode.depth + 1;
          if (this.depth > this.options.maxNestingDepth) {
            throw new Error(`Maximum MIME nesting depth of ${this.options.maxNestingDepth} levels exceeded`);
          }
          this.options.parentNode.childNodes.push(this);
        } else {
          this.depth = 0;
        }
        this.state = "header";
        this.headerLines = [];
        this.headerSize = 0;
        const parentMultipartType = this.options.parentMultipartType || null;
        const defaultContentType = parentMultipartType === "digest" ? "message/rfc822" : "text/plain";
        this.contentType = {
          value: defaultContentType,
          default: true
        };
        this.contentTransferEncoding = {
          value: "8bit"
        };
        this.contentDisposition = {
          value: ""
        };
        this.headers = [];
        this.contentDecoder = false;
      }
      setupContentDecoder(transferEncoding) {
        if (/base64/i.test(transferEncoding)) {
          this.contentDecoder = new Base64Decoder();
        } else if (/quoted-printable/i.test(transferEncoding)) {
          this.contentDecoder = new QPDecoder({ decoder: getDecoder(this.contentType.parsed.params.charset) });
        } else {
          this.contentDecoder = new PassThroughDecoder();
        }
      }
      async finalize() {
        if (this.state === "finished") {
          return;
        }
        if (this.state === "header") {
          this.processHeaders();
        }
        let boundaries = this.postalMime.boundaries;
        for (let i = boundaries.length - 1; i >= 0; i--) {
          let boundary = boundaries[i];
          if (boundary.node === this) {
            boundaries.splice(i, 1);
            break;
          }
        }
        await this.finalizeChildNodes();
        this.content = this.contentDecoder ? await this.contentDecoder.finalize() : null;
        this.contentDecoder = false;
        this.state = "finished";
      }
      async finalizeChildNodes() {
        for (let childNode of this.childNodes) {
          await childNode.finalize();
        }
      }
      // Strip RFC 822 comments (parenthesized text) from structured header values
      stripComments(str2) {
        let result = "";
        let depth = 0;
        let escaped = false;
        let inQuote = false;
        for (let i = 0; i < str2.length; i++) {
          const chr = str2.charAt(i);
          if (escaped) {
            if (depth === 0) {
              result += chr;
            }
            escaped = false;
            continue;
          }
          if (chr === "\\") {
            escaped = true;
            if (depth === 0) {
              result += chr;
            }
            continue;
          }
          if (chr === '"' && depth === 0) {
            inQuote = !inQuote;
            result += chr;
            continue;
          }
          if (!inQuote) {
            if (chr === "(") {
              depth++;
              continue;
            }
            if (chr === ")" && depth > 0) {
              depth--;
              continue;
            }
          }
          if (depth === 0) {
            result += chr;
          }
        }
        return result;
      }
      parseStructuredHeader(str2) {
        str2 = this.stripComments(str2);
        let response = {
          value: false,
          params: {}
        };
        let key = false;
        let value = "";
        let stage = "value";
        let quote = false;
        let escaped = false;
        let chr;
        for (let i = 0, len = str2.length; i < len; i++) {
          chr = str2.charAt(i);
          switch (stage) {
            case "key":
              if (chr === "=") {
                key = value.trim().toLowerCase();
                stage = "value";
                value = "";
                break;
              }
              value += chr;
              break;
            case "value":
              if (escaped) {
                value += chr;
              } else if (chr === "\\") {
                escaped = true;
                continue;
              } else if (quote && chr === quote) {
                quote = false;
              } else if (!quote && chr === '"') {
                quote = chr;
              } else if (!quote && chr === ";") {
                if (key === false) {
                  response.value = value.trim();
                } else {
                  response.params[key] = value.trim();
                }
                stage = "key";
                value = "";
              } else {
                value += chr;
              }
              escaped = false;
              break;
          }
        }
        value = value.trim();
        if (stage === "value") {
          if (key === false) {
            response.value = value;
          } else {
            response.params[key] = value;
          }
        } else if (value) {
          response.params[value.toLowerCase()] = "";
        }
        if (response.value) {
          response.value = response.value.toLowerCase();
        }
        decodeParameterValueContinuations(response);
        return response;
      }
      decodeFlowedText(str2, delSp) {
        return str2.split(/\r?\n/).reduce((previousValue, currentValue) => {
          if (previousValue.endsWith(" ") && previousValue !== "-- " && !previousValue.endsWith("\n-- ")) {
            if (delSp) {
              return previousValue.slice(0, -1) + currentValue;
            } else {
              return previousValue + currentValue;
            }
          } else {
            return previousValue + "\n" + currentValue;
          }
        }).replace(/^ /gm, "");
      }
      getTextContent() {
        if (!this.content) {
          return "";
        }
        let str2 = getDecoder(this.contentType.parsed.params.charset).decode(this.content);
        if (/^flowed$/i.test(this.contentType.parsed.params.format)) {
          str2 = this.decodeFlowedText(str2, /^yes$/i.test(this.contentType.parsed.params.delsp));
        }
        return str2;
      }
      processHeaders() {
        for (let i = this.headerLines.length - 1; i >= 0; i--) {
          let line = this.headerLines[i];
          if (i && /^\s/.test(line)) {
            this.headerLines[i - 1] += "\n" + line;
            this.headerLines.splice(i, 1);
          }
        }
        this.rawHeaderLines = [];
        for (let i = this.headerLines.length - 1; i >= 0; i--) {
          let rawLine = this.headerLines[i];
          let sep = rawLine.indexOf(":");
          let rawKey = sep < 0 ? rawLine.trim() : rawLine.substr(0, sep).trim();
          this.rawHeaderLines.push({
            key: rawKey.toLowerCase(),
            line: rawLine
          });
          let normalizedLine = rawLine.replace(/\s+/g, " ");
          sep = normalizedLine.indexOf(":");
          let key = sep < 0 ? normalizedLine.trim() : normalizedLine.substr(0, sep).trim();
          let value = sep < 0 ? "" : normalizedLine.substr(sep + 1).trim();
          this.headers.push({ key: key.toLowerCase(), originalKey: key, value });
          switch (key.toLowerCase()) {
            case "content-type":
              if (this.contentType.default) {
                this.contentType = { value, parsed: {} };
              }
              break;
            case "content-transfer-encoding":
              this.contentTransferEncoding = { value, parsed: {} };
              break;
            case "content-disposition":
              this.contentDisposition = { value, parsed: {} };
              break;
            case "content-id":
              this.contentId = value;
              break;
            case "content-description":
              this.contentDescription = value;
              break;
          }
        }
        this.contentType.parsed = this.parseStructuredHeader(this.contentType.value);
        this.contentType.multipart = /^multipart\//i.test(this.contentType.parsed.value) ? this.contentType.parsed.value.substr(this.contentType.parsed.value.indexOf("/") + 1) : false;
        if (this.contentType.multipart && this.contentType.parsed.params.boundary) {
          this.postalMime.boundaries.push({
            value: textEncoder.encode(this.contentType.parsed.params.boundary),
            node: this
          });
        }
        this.contentDisposition.parsed = this.parseStructuredHeader(this.contentDisposition.value);
        this.contentTransferEncoding.encoding = this.contentTransferEncoding.value.toLowerCase().split(/[^\w-]/).shift();
        this.setupContentDecoder(this.contentTransferEncoding.encoding);
      }
      feed(line) {
        switch (this.state) {
          case "header":
            if (!line.length) {
              this.state = "body";
              return this.processHeaders();
            }
            this.headerSize += line.length;
            if (this.headerSize > this.options.maxHeadersSize) {
              let error = new Error(`Maximum header size of ${this.options.maxHeadersSize} bytes exceeded`);
              throw error;
            }
            this.headerLines.push(defaultDecoder.decode(line));
            break;
          case "body": {
            this.contentDecoder.update(line);
          }
        }
      }
    };
  }
});

// node_modules/postal-mime/src/html-entities.js
var htmlEntities, html_entities_default;
var init_html_entities = __esm({
  "node_modules/postal-mime/src/html-entities.js"() {
    htmlEntities = {
      "&AElig": "\xC6",
      "&AElig;": "\xC6",
      "&AMP": "&",
      "&AMP;": "&",
      "&Aacute": "\xC1",
      "&Aacute;": "\xC1",
      "&Abreve;": "\u0102",
      "&Acirc": "\xC2",
      "&Acirc;": "\xC2",
      "&Acy;": "\u0410",
      "&Afr;": "\u{1D504}",
      "&Agrave": "\xC0",
      "&Agrave;": "\xC0",
      "&Alpha;": "\u0391",
      "&Amacr;": "\u0100",
      "&And;": "\u2A53",
      "&Aogon;": "\u0104",
      "&Aopf;": "\u{1D538}",
      "&ApplyFunction;": "\u2061",
      "&Aring": "\xC5",
      "&Aring;": "\xC5",
      "&Ascr;": "\u{1D49C}",
      "&Assign;": "\u2254",
      "&Atilde": "\xC3",
      "&Atilde;": "\xC3",
      "&Auml": "\xC4",
      "&Auml;": "\xC4",
      "&Backslash;": "\u2216",
      "&Barv;": "\u2AE7",
      "&Barwed;": "\u2306",
      "&Bcy;": "\u0411",
      "&Because;": "\u2235",
      "&Bernoullis;": "\u212C",
      "&Beta;": "\u0392",
      "&Bfr;": "\u{1D505}",
      "&Bopf;": "\u{1D539}",
      "&Breve;": "\u02D8",
      "&Bscr;": "\u212C",
      "&Bumpeq;": "\u224E",
      "&CHcy;": "\u0427",
      "&COPY": "\xA9",
      "&COPY;": "\xA9",
      "&Cacute;": "\u0106",
      "&Cap;": "\u22D2",
      "&CapitalDifferentialD;": "\u2145",
      "&Cayleys;": "\u212D",
      "&Ccaron;": "\u010C",
      "&Ccedil": "\xC7",
      "&Ccedil;": "\xC7",
      "&Ccirc;": "\u0108",
      "&Cconint;": "\u2230",
      "&Cdot;": "\u010A",
      "&Cedilla;": "\xB8",
      "&CenterDot;": "\xB7",
      "&Cfr;": "\u212D",
      "&Chi;": "\u03A7",
      "&CircleDot;": "\u2299",
      "&CircleMinus;": "\u2296",
      "&CirclePlus;": "\u2295",
      "&CircleTimes;": "\u2297",
      "&ClockwiseContourIntegral;": "\u2232",
      "&CloseCurlyDoubleQuote;": "\u201D",
      "&CloseCurlyQuote;": "\u2019",
      "&Colon;": "\u2237",
      "&Colone;": "\u2A74",
      "&Congruent;": "\u2261",
      "&Conint;": "\u222F",
      "&ContourIntegral;": "\u222E",
      "&Copf;": "\u2102",
      "&Coproduct;": "\u2210",
      "&CounterClockwiseContourIntegral;": "\u2233",
      "&Cross;": "\u2A2F",
      "&Cscr;": "\u{1D49E}",
      "&Cup;": "\u22D3",
      "&CupCap;": "\u224D",
      "&DD;": "\u2145",
      "&DDotrahd;": "\u2911",
      "&DJcy;": "\u0402",
      "&DScy;": "\u0405",
      "&DZcy;": "\u040F",
      "&Dagger;": "\u2021",
      "&Darr;": "\u21A1",
      "&Dashv;": "\u2AE4",
      "&Dcaron;": "\u010E",
      "&Dcy;": "\u0414",
      "&Del;": "\u2207",
      "&Delta;": "\u0394",
      "&Dfr;": "\u{1D507}",
      "&DiacriticalAcute;": "\xB4",
      "&DiacriticalDot;": "\u02D9",
      "&DiacriticalDoubleAcute;": "\u02DD",
      "&DiacriticalGrave;": "`",
      "&DiacriticalTilde;": "\u02DC",
      "&Diamond;": "\u22C4",
      "&DifferentialD;": "\u2146",
      "&Dopf;": "\u{1D53B}",
      "&Dot;": "\xA8",
      "&DotDot;": "\u20DC",
      "&DotEqual;": "\u2250",
      "&DoubleContourIntegral;": "\u222F",
      "&DoubleDot;": "\xA8",
      "&DoubleDownArrow;": "\u21D3",
      "&DoubleLeftArrow;": "\u21D0",
      "&DoubleLeftRightArrow;": "\u21D4",
      "&DoubleLeftTee;": "\u2AE4",
      "&DoubleLongLeftArrow;": "\u27F8",
      "&DoubleLongLeftRightArrow;": "\u27FA",
      "&DoubleLongRightArrow;": "\u27F9",
      "&DoubleRightArrow;": "\u21D2",
      "&DoubleRightTee;": "\u22A8",
      "&DoubleUpArrow;": "\u21D1",
      "&DoubleUpDownArrow;": "\u21D5",
      "&DoubleVerticalBar;": "\u2225",
      "&DownArrow;": "\u2193",
      "&DownArrowBar;": "\u2913",
      "&DownArrowUpArrow;": "\u21F5",
      "&DownBreve;": "\u0311",
      "&DownLeftRightVector;": "\u2950",
      "&DownLeftTeeVector;": "\u295E",
      "&DownLeftVector;": "\u21BD",
      "&DownLeftVectorBar;": "\u2956",
      "&DownRightTeeVector;": "\u295F",
      "&DownRightVector;": "\u21C1",
      "&DownRightVectorBar;": "\u2957",
      "&DownTee;": "\u22A4",
      "&DownTeeArrow;": "\u21A7",
      "&Downarrow;": "\u21D3",
      "&Dscr;": "\u{1D49F}",
      "&Dstrok;": "\u0110",
      "&ENG;": "\u014A",
      "&ETH": "\xD0",
      "&ETH;": "\xD0",
      "&Eacute": "\xC9",
      "&Eacute;": "\xC9",
      "&Ecaron;": "\u011A",
      "&Ecirc": "\xCA",
      "&Ecirc;": "\xCA",
      "&Ecy;": "\u042D",
      "&Edot;": "\u0116",
      "&Efr;": "\u{1D508}",
      "&Egrave": "\xC8",
      "&Egrave;": "\xC8",
      "&Element;": "\u2208",
      "&Emacr;": "\u0112",
      "&EmptySmallSquare;": "\u25FB",
      "&EmptyVerySmallSquare;": "\u25AB",
      "&Eogon;": "\u0118",
      "&Eopf;": "\u{1D53C}",
      "&Epsilon;": "\u0395",
      "&Equal;": "\u2A75",
      "&EqualTilde;": "\u2242",
      "&Equilibrium;": "\u21CC",
      "&Escr;": "\u2130",
      "&Esim;": "\u2A73",
      "&Eta;": "\u0397",
      "&Euml": "\xCB",
      "&Euml;": "\xCB",
      "&Exists;": "\u2203",
      "&ExponentialE;": "\u2147",
      "&Fcy;": "\u0424",
      "&Ffr;": "\u{1D509}",
      "&FilledSmallSquare;": "\u25FC",
      "&FilledVerySmallSquare;": "\u25AA",
      "&Fopf;": "\u{1D53D}",
      "&ForAll;": "\u2200",
      "&Fouriertrf;": "\u2131",
      "&Fscr;": "\u2131",
      "&GJcy;": "\u0403",
      "&GT": ">",
      "&GT;": ">",
      "&Gamma;": "\u0393",
      "&Gammad;": "\u03DC",
      "&Gbreve;": "\u011E",
      "&Gcedil;": "\u0122",
      "&Gcirc;": "\u011C",
      "&Gcy;": "\u0413",
      "&Gdot;": "\u0120",
      "&Gfr;": "\u{1D50A}",
      "&Gg;": "\u22D9",
      "&Gopf;": "\u{1D53E}",
      "&GreaterEqual;": "\u2265",
      "&GreaterEqualLess;": "\u22DB",
      "&GreaterFullEqual;": "\u2267",
      "&GreaterGreater;": "\u2AA2",
      "&GreaterLess;": "\u2277",
      "&GreaterSlantEqual;": "\u2A7E",
      "&GreaterTilde;": "\u2273",
      "&Gscr;": "\u{1D4A2}",
      "&Gt;": "\u226B",
      "&HARDcy;": "\u042A",
      "&Hacek;": "\u02C7",
      "&Hat;": "^",
      "&Hcirc;": "\u0124",
      "&Hfr;": "\u210C",
      "&HilbertSpace;": "\u210B",
      "&Hopf;": "\u210D",
      "&HorizontalLine;": "\u2500",
      "&Hscr;": "\u210B",
      "&Hstrok;": "\u0126",
      "&HumpDownHump;": "\u224E",
      "&HumpEqual;": "\u224F",
      "&IEcy;": "\u0415",
      "&IJlig;": "\u0132",
      "&IOcy;": "\u0401",
      "&Iacute": "\xCD",
      "&Iacute;": "\xCD",
      "&Icirc": "\xCE",
      "&Icirc;": "\xCE",
      "&Icy;": "\u0418",
      "&Idot;": "\u0130",
      "&Ifr;": "\u2111",
      "&Igrave": "\xCC",
      "&Igrave;": "\xCC",
      "&Im;": "\u2111",
      "&Imacr;": "\u012A",
      "&ImaginaryI;": "\u2148",
      "&Implies;": "\u21D2",
      "&Int;": "\u222C",
      "&Integral;": "\u222B",
      "&Intersection;": "\u22C2",
      "&InvisibleComma;": "\u2063",
      "&InvisibleTimes;": "\u2062",
      "&Iogon;": "\u012E",
      "&Iopf;": "\u{1D540}",
      "&Iota;": "\u0399",
      "&Iscr;": "\u2110",
      "&Itilde;": "\u0128",
      "&Iukcy;": "\u0406",
      "&Iuml": "\xCF",
      "&Iuml;": "\xCF",
      "&Jcirc;": "\u0134",
      "&Jcy;": "\u0419",
      "&Jfr;": "\u{1D50D}",
      "&Jopf;": "\u{1D541}",
      "&Jscr;": "\u{1D4A5}",
      "&Jsercy;": "\u0408",
      "&Jukcy;": "\u0404",
      "&KHcy;": "\u0425",
      "&KJcy;": "\u040C",
      "&Kappa;": "\u039A",
      "&Kcedil;": "\u0136",
      "&Kcy;": "\u041A",
      "&Kfr;": "\u{1D50E}",
      "&Kopf;": "\u{1D542}",
      "&Kscr;": "\u{1D4A6}",
      "&LJcy;": "\u0409",
      "&LT": "<",
      "&LT;": "<",
      "&Lacute;": "\u0139",
      "&Lambda;": "\u039B",
      "&Lang;": "\u27EA",
      "&Laplacetrf;": "\u2112",
      "&Larr;": "\u219E",
      "&Lcaron;": "\u013D",
      "&Lcedil;": "\u013B",
      "&Lcy;": "\u041B",
      "&LeftAngleBracket;": "\u27E8",
      "&LeftArrow;": "\u2190",
      "&LeftArrowBar;": "\u21E4",
      "&LeftArrowRightArrow;": "\u21C6",
      "&LeftCeiling;": "\u2308",
      "&LeftDoubleBracket;": "\u27E6",
      "&LeftDownTeeVector;": "\u2961",
      "&LeftDownVector;": "\u21C3",
      "&LeftDownVectorBar;": "\u2959",
      "&LeftFloor;": "\u230A",
      "&LeftRightArrow;": "\u2194",
      "&LeftRightVector;": "\u294E",
      "&LeftTee;": "\u22A3",
      "&LeftTeeArrow;": "\u21A4",
      "&LeftTeeVector;": "\u295A",
      "&LeftTriangle;": "\u22B2",
      "&LeftTriangleBar;": "\u29CF",
      "&LeftTriangleEqual;": "\u22B4",
      "&LeftUpDownVector;": "\u2951",
      "&LeftUpTeeVector;": "\u2960",
      "&LeftUpVector;": "\u21BF",
      "&LeftUpVectorBar;": "\u2958",
      "&LeftVector;": "\u21BC",
      "&LeftVectorBar;": "\u2952",
      "&Leftarrow;": "\u21D0",
      "&Leftrightarrow;": "\u21D4",
      "&LessEqualGreater;": "\u22DA",
      "&LessFullEqual;": "\u2266",
      "&LessGreater;": "\u2276",
      "&LessLess;": "\u2AA1",
      "&LessSlantEqual;": "\u2A7D",
      "&LessTilde;": "\u2272",
      "&Lfr;": "\u{1D50F}",
      "&Ll;": "\u22D8",
      "&Lleftarrow;": "\u21DA",
      "&Lmidot;": "\u013F",
      "&LongLeftArrow;": "\u27F5",
      "&LongLeftRightArrow;": "\u27F7",
      "&LongRightArrow;": "\u27F6",
      "&Longleftarrow;": "\u27F8",
      "&Longleftrightarrow;": "\u27FA",
      "&Longrightarrow;": "\u27F9",
      "&Lopf;": "\u{1D543}",
      "&LowerLeftArrow;": "\u2199",
      "&LowerRightArrow;": "\u2198",
      "&Lscr;": "\u2112",
      "&Lsh;": "\u21B0",
      "&Lstrok;": "\u0141",
      "&Lt;": "\u226A",
      "&Map;": "\u2905",
      "&Mcy;": "\u041C",
      "&MediumSpace;": "\u205F",
      "&Mellintrf;": "\u2133",
      "&Mfr;": "\u{1D510}",
      "&MinusPlus;": "\u2213",
      "&Mopf;": "\u{1D544}",
      "&Mscr;": "\u2133",
      "&Mu;": "\u039C",
      "&NJcy;": "\u040A",
      "&Nacute;": "\u0143",
      "&Ncaron;": "\u0147",
      "&Ncedil;": "\u0145",
      "&Ncy;": "\u041D",
      "&NegativeMediumSpace;": "\u200B",
      "&NegativeThickSpace;": "\u200B",
      "&NegativeThinSpace;": "\u200B",
      "&NegativeVeryThinSpace;": "\u200B",
      "&NestedGreaterGreater;": "\u226B",
      "&NestedLessLess;": "\u226A",
      "&NewLine;": "\n",
      "&Nfr;": "\u{1D511}",
      "&NoBreak;": "\u2060",
      "&NonBreakingSpace;": "\xA0",
      "&Nopf;": "\u2115",
      "&Not;": "\u2AEC",
      "&NotCongruent;": "\u2262",
      "&NotCupCap;": "\u226D",
      "&NotDoubleVerticalBar;": "\u2226",
      "&NotElement;": "\u2209",
      "&NotEqual;": "\u2260",
      "&NotEqualTilde;": "\u2242\u0338",
      "&NotExists;": "\u2204",
      "&NotGreater;": "\u226F",
      "&NotGreaterEqual;": "\u2271",
      "&NotGreaterFullEqual;": "\u2267\u0338",
      "&NotGreaterGreater;": "\u226B\u0338",
      "&NotGreaterLess;": "\u2279",
      "&NotGreaterSlantEqual;": "\u2A7E\u0338",
      "&NotGreaterTilde;": "\u2275",
      "&NotHumpDownHump;": "\u224E\u0338",
      "&NotHumpEqual;": "\u224F\u0338",
      "&NotLeftTriangle;": "\u22EA",
      "&NotLeftTriangleBar;": "\u29CF\u0338",
      "&NotLeftTriangleEqual;": "\u22EC",
      "&NotLess;": "\u226E",
      "&NotLessEqual;": "\u2270",
      "&NotLessGreater;": "\u2278",
      "&NotLessLess;": "\u226A\u0338",
      "&NotLessSlantEqual;": "\u2A7D\u0338",
      "&NotLessTilde;": "\u2274",
      "&NotNestedGreaterGreater;": "\u2AA2\u0338",
      "&NotNestedLessLess;": "\u2AA1\u0338",
      "&NotPrecedes;": "\u2280",
      "&NotPrecedesEqual;": "\u2AAF\u0338",
      "&NotPrecedesSlantEqual;": "\u22E0",
      "&NotReverseElement;": "\u220C",
      "&NotRightTriangle;": "\u22EB",
      "&NotRightTriangleBar;": "\u29D0\u0338",
      "&NotRightTriangleEqual;": "\u22ED",
      "&NotSquareSubset;": "\u228F\u0338",
      "&NotSquareSubsetEqual;": "\u22E2",
      "&NotSquareSuperset;": "\u2290\u0338",
      "&NotSquareSupersetEqual;": "\u22E3",
      "&NotSubset;": "\u2282\u20D2",
      "&NotSubsetEqual;": "\u2288",
      "&NotSucceeds;": "\u2281",
      "&NotSucceedsEqual;": "\u2AB0\u0338",
      "&NotSucceedsSlantEqual;": "\u22E1",
      "&NotSucceedsTilde;": "\u227F\u0338",
      "&NotSuperset;": "\u2283\u20D2",
      "&NotSupersetEqual;": "\u2289",
      "&NotTilde;": "\u2241",
      "&NotTildeEqual;": "\u2244",
      "&NotTildeFullEqual;": "\u2247",
      "&NotTildeTilde;": "\u2249",
      "&NotVerticalBar;": "\u2224",
      "&Nscr;": "\u{1D4A9}",
      "&Ntilde": "\xD1",
      "&Ntilde;": "\xD1",
      "&Nu;": "\u039D",
      "&OElig;": "\u0152",
      "&Oacute": "\xD3",
      "&Oacute;": "\xD3",
      "&Ocirc": "\xD4",
      "&Ocirc;": "\xD4",
      "&Ocy;": "\u041E",
      "&Odblac;": "\u0150",
      "&Ofr;": "\u{1D512}",
      "&Ograve": "\xD2",
      "&Ograve;": "\xD2",
      "&Omacr;": "\u014C",
      "&Omega;": "\u03A9",
      "&Omicron;": "\u039F",
      "&Oopf;": "\u{1D546}",
      "&OpenCurlyDoubleQuote;": "\u201C",
      "&OpenCurlyQuote;": "\u2018",
      "&Or;": "\u2A54",
      "&Oscr;": "\u{1D4AA}",
      "&Oslash": "\xD8",
      "&Oslash;": "\xD8",
      "&Otilde": "\xD5",
      "&Otilde;": "\xD5",
      "&Otimes;": "\u2A37",
      "&Ouml": "\xD6",
      "&Ouml;": "\xD6",
      "&OverBar;": "\u203E",
      "&OverBrace;": "\u23DE",
      "&OverBracket;": "\u23B4",
      "&OverParenthesis;": "\u23DC",
      "&PartialD;": "\u2202",
      "&Pcy;": "\u041F",
      "&Pfr;": "\u{1D513}",
      "&Phi;": "\u03A6",
      "&Pi;": "\u03A0",
      "&PlusMinus;": "\xB1",
      "&Poincareplane;": "\u210C",
      "&Popf;": "\u2119",
      "&Pr;": "\u2ABB",
      "&Precedes;": "\u227A",
      "&PrecedesEqual;": "\u2AAF",
      "&PrecedesSlantEqual;": "\u227C",
      "&PrecedesTilde;": "\u227E",
      "&Prime;": "\u2033",
      "&Product;": "\u220F",
      "&Proportion;": "\u2237",
      "&Proportional;": "\u221D",
      "&Pscr;": "\u{1D4AB}",
      "&Psi;": "\u03A8",
      "&QUOT": '"',
      "&QUOT;": '"',
      "&Qfr;": "\u{1D514}",
      "&Qopf;": "\u211A",
      "&Qscr;": "\u{1D4AC}",
      "&RBarr;": "\u2910",
      "&REG": "\xAE",
      "&REG;": "\xAE",
      "&Racute;": "\u0154",
      "&Rang;": "\u27EB",
      "&Rarr;": "\u21A0",
      "&Rarrtl;": "\u2916",
      "&Rcaron;": "\u0158",
      "&Rcedil;": "\u0156",
      "&Rcy;": "\u0420",
      "&Re;": "\u211C",
      "&ReverseElement;": "\u220B",
      "&ReverseEquilibrium;": "\u21CB",
      "&ReverseUpEquilibrium;": "\u296F",
      "&Rfr;": "\u211C",
      "&Rho;": "\u03A1",
      "&RightAngleBracket;": "\u27E9",
      "&RightArrow;": "\u2192",
      "&RightArrowBar;": "\u21E5",
      "&RightArrowLeftArrow;": "\u21C4",
      "&RightCeiling;": "\u2309",
      "&RightDoubleBracket;": "\u27E7",
      "&RightDownTeeVector;": "\u295D",
      "&RightDownVector;": "\u21C2",
      "&RightDownVectorBar;": "\u2955",
      "&RightFloor;": "\u230B",
      "&RightTee;": "\u22A2",
      "&RightTeeArrow;": "\u21A6",
      "&RightTeeVector;": "\u295B",
      "&RightTriangle;": "\u22B3",
      "&RightTriangleBar;": "\u29D0",
      "&RightTriangleEqual;": "\u22B5",
      "&RightUpDownVector;": "\u294F",
      "&RightUpTeeVector;": "\u295C",
      "&RightUpVector;": "\u21BE",
      "&RightUpVectorBar;": "\u2954",
      "&RightVector;": "\u21C0",
      "&RightVectorBar;": "\u2953",
      "&Rightarrow;": "\u21D2",
      "&Ropf;": "\u211D",
      "&RoundImplies;": "\u2970",
      "&Rrightarrow;": "\u21DB",
      "&Rscr;": "\u211B",
      "&Rsh;": "\u21B1",
      "&RuleDelayed;": "\u29F4",
      "&SHCHcy;": "\u0429",
      "&SHcy;": "\u0428",
      "&SOFTcy;": "\u042C",
      "&Sacute;": "\u015A",
      "&Sc;": "\u2ABC",
      "&Scaron;": "\u0160",
      "&Scedil;": "\u015E",
      "&Scirc;": "\u015C",
      "&Scy;": "\u0421",
      "&Sfr;": "\u{1D516}",
      "&ShortDownArrow;": "\u2193",
      "&ShortLeftArrow;": "\u2190",
      "&ShortRightArrow;": "\u2192",
      "&ShortUpArrow;": "\u2191",
      "&Sigma;": "\u03A3",
      "&SmallCircle;": "\u2218",
      "&Sopf;": "\u{1D54A}",
      "&Sqrt;": "\u221A",
      "&Square;": "\u25A1",
      "&SquareIntersection;": "\u2293",
      "&SquareSubset;": "\u228F",
      "&SquareSubsetEqual;": "\u2291",
      "&SquareSuperset;": "\u2290",
      "&SquareSupersetEqual;": "\u2292",
      "&SquareUnion;": "\u2294",
      "&Sscr;": "\u{1D4AE}",
      "&Star;": "\u22C6",
      "&Sub;": "\u22D0",
      "&Subset;": "\u22D0",
      "&SubsetEqual;": "\u2286",
      "&Succeeds;": "\u227B",
      "&SucceedsEqual;": "\u2AB0",
      "&SucceedsSlantEqual;": "\u227D",
      "&SucceedsTilde;": "\u227F",
      "&SuchThat;": "\u220B",
      "&Sum;": "\u2211",
      "&Sup;": "\u22D1",
      "&Superset;": "\u2283",
      "&SupersetEqual;": "\u2287",
      "&Supset;": "\u22D1",
      "&THORN": "\xDE",
      "&THORN;": "\xDE",
      "&TRADE;": "\u2122",
      "&TSHcy;": "\u040B",
      "&TScy;": "\u0426",
      "&Tab;": "	",
      "&Tau;": "\u03A4",
      "&Tcaron;": "\u0164",
      "&Tcedil;": "\u0162",
      "&Tcy;": "\u0422",
      "&Tfr;": "\u{1D517}",
      "&Therefore;": "\u2234",
      "&Theta;": "\u0398",
      "&ThickSpace;": "\u205F\u200A",
      "&ThinSpace;": "\u2009",
      "&Tilde;": "\u223C",
      "&TildeEqual;": "\u2243",
      "&TildeFullEqual;": "\u2245",
      "&TildeTilde;": "\u2248",
      "&Topf;": "\u{1D54B}",
      "&TripleDot;": "\u20DB",
      "&Tscr;": "\u{1D4AF}",
      "&Tstrok;": "\u0166",
      "&Uacute": "\xDA",
      "&Uacute;": "\xDA",
      "&Uarr;": "\u219F",
      "&Uarrocir;": "\u2949",
      "&Ubrcy;": "\u040E",
      "&Ubreve;": "\u016C",
      "&Ucirc": "\xDB",
      "&Ucirc;": "\xDB",
      "&Ucy;": "\u0423",
      "&Udblac;": "\u0170",
      "&Ufr;": "\u{1D518}",
      "&Ugrave": "\xD9",
      "&Ugrave;": "\xD9",
      "&Umacr;": "\u016A",
      "&UnderBar;": "_",
      "&UnderBrace;": "\u23DF",
      "&UnderBracket;": "\u23B5",
      "&UnderParenthesis;": "\u23DD",
      "&Union;": "\u22C3",
      "&UnionPlus;": "\u228E",
      "&Uogon;": "\u0172",
      "&Uopf;": "\u{1D54C}",
      "&UpArrow;": "\u2191",
      "&UpArrowBar;": "\u2912",
      "&UpArrowDownArrow;": "\u21C5",
      "&UpDownArrow;": "\u2195",
      "&UpEquilibrium;": "\u296E",
      "&UpTee;": "\u22A5",
      "&UpTeeArrow;": "\u21A5",
      "&Uparrow;": "\u21D1",
      "&Updownarrow;": "\u21D5",
      "&UpperLeftArrow;": "\u2196",
      "&UpperRightArrow;": "\u2197",
      "&Upsi;": "\u03D2",
      "&Upsilon;": "\u03A5",
      "&Uring;": "\u016E",
      "&Uscr;": "\u{1D4B0}",
      "&Utilde;": "\u0168",
      "&Uuml": "\xDC",
      "&Uuml;": "\xDC",
      "&VDash;": "\u22AB",
      "&Vbar;": "\u2AEB",
      "&Vcy;": "\u0412",
      "&Vdash;": "\u22A9",
      "&Vdashl;": "\u2AE6",
      "&Vee;": "\u22C1",
      "&Verbar;": "\u2016",
      "&Vert;": "\u2016",
      "&VerticalBar;": "\u2223",
      "&VerticalLine;": "|",
      "&VerticalSeparator;": "\u2758",
      "&VerticalTilde;": "\u2240",
      "&VeryThinSpace;": "\u200A",
      "&Vfr;": "\u{1D519}",
      "&Vopf;": "\u{1D54D}",
      "&Vscr;": "\u{1D4B1}",
      "&Vvdash;": "\u22AA",
      "&Wcirc;": "\u0174",
      "&Wedge;": "\u22C0",
      "&Wfr;": "\u{1D51A}",
      "&Wopf;": "\u{1D54E}",
      "&Wscr;": "\u{1D4B2}",
      "&Xfr;": "\u{1D51B}",
      "&Xi;": "\u039E",
      "&Xopf;": "\u{1D54F}",
      "&Xscr;": "\u{1D4B3}",
      "&YAcy;": "\u042F",
      "&YIcy;": "\u0407",
      "&YUcy;": "\u042E",
      "&Yacute": "\xDD",
      "&Yacute;": "\xDD",
      "&Ycirc;": "\u0176",
      "&Ycy;": "\u042B",
      "&Yfr;": "\u{1D51C}",
      "&Yopf;": "\u{1D550}",
      "&Yscr;": "\u{1D4B4}",
      "&Yuml;": "\u0178",
      "&ZHcy;": "\u0416",
      "&Zacute;": "\u0179",
      "&Zcaron;": "\u017D",
      "&Zcy;": "\u0417",
      "&Zdot;": "\u017B",
      "&ZeroWidthSpace;": "\u200B",
      "&Zeta;": "\u0396",
      "&Zfr;": "\u2128",
      "&Zopf;": "\u2124",
      "&Zscr;": "\u{1D4B5}",
      "&aacute": "\xE1",
      "&aacute;": "\xE1",
      "&abreve;": "\u0103",
      "&ac;": "\u223E",
      "&acE;": "\u223E\u0333",
      "&acd;": "\u223F",
      "&acirc": "\xE2",
      "&acirc;": "\xE2",
      "&acute": "\xB4",
      "&acute;": "\xB4",
      "&acy;": "\u0430",
      "&aelig": "\xE6",
      "&aelig;": "\xE6",
      "&af;": "\u2061",
      "&afr;": "\u{1D51E}",
      "&agrave": "\xE0",
      "&agrave;": "\xE0",
      "&alefsym;": "\u2135",
      "&aleph;": "\u2135",
      "&alpha;": "\u03B1",
      "&amacr;": "\u0101",
      "&amalg;": "\u2A3F",
      "&amp": "&",
      "&amp;": "&",
      "&and;": "\u2227",
      "&andand;": "\u2A55",
      "&andd;": "\u2A5C",
      "&andslope;": "\u2A58",
      "&andv;": "\u2A5A",
      "&ang;": "\u2220",
      "&ange;": "\u29A4",
      "&angle;": "\u2220",
      "&angmsd;": "\u2221",
      "&angmsdaa;": "\u29A8",
      "&angmsdab;": "\u29A9",
      "&angmsdac;": "\u29AA",
      "&angmsdad;": "\u29AB",
      "&angmsdae;": "\u29AC",
      "&angmsdaf;": "\u29AD",
      "&angmsdag;": "\u29AE",
      "&angmsdah;": "\u29AF",
      "&angrt;": "\u221F",
      "&angrtvb;": "\u22BE",
      "&angrtvbd;": "\u299D",
      "&angsph;": "\u2222",
      "&angst;": "\xC5",
      "&angzarr;": "\u237C",
      "&aogon;": "\u0105",
      "&aopf;": "\u{1D552}",
      "&ap;": "\u2248",
      "&apE;": "\u2A70",
      "&apacir;": "\u2A6F",
      "&ape;": "\u224A",
      "&apid;": "\u224B",
      "&apos;": "'",
      "&approx;": "\u2248",
      "&approxeq;": "\u224A",
      "&aring": "\xE5",
      "&aring;": "\xE5",
      "&ascr;": "\u{1D4B6}",
      "&ast;": "*",
      "&asymp;": "\u2248",
      "&asympeq;": "\u224D",
      "&atilde": "\xE3",
      "&atilde;": "\xE3",
      "&auml": "\xE4",
      "&auml;": "\xE4",
      "&awconint;": "\u2233",
      "&awint;": "\u2A11",
      "&bNot;": "\u2AED",
      "&backcong;": "\u224C",
      "&backepsilon;": "\u03F6",
      "&backprime;": "\u2035",
      "&backsim;": "\u223D",
      "&backsimeq;": "\u22CD",
      "&barvee;": "\u22BD",
      "&barwed;": "\u2305",
      "&barwedge;": "\u2305",
      "&bbrk;": "\u23B5",
      "&bbrktbrk;": "\u23B6",
      "&bcong;": "\u224C",
      "&bcy;": "\u0431",
      "&bdquo;": "\u201E",
      "&becaus;": "\u2235",
      "&because;": "\u2235",
      "&bemptyv;": "\u29B0",
      "&bepsi;": "\u03F6",
      "&bernou;": "\u212C",
      "&beta;": "\u03B2",
      "&beth;": "\u2136",
      "&between;": "\u226C",
      "&bfr;": "\u{1D51F}",
      "&bigcap;": "\u22C2",
      "&bigcirc;": "\u25EF",
      "&bigcup;": "\u22C3",
      "&bigodot;": "\u2A00",
      "&bigoplus;": "\u2A01",
      "&bigotimes;": "\u2A02",
      "&bigsqcup;": "\u2A06",
      "&bigstar;": "\u2605",
      "&bigtriangledown;": "\u25BD",
      "&bigtriangleup;": "\u25B3",
      "&biguplus;": "\u2A04",
      "&bigvee;": "\u22C1",
      "&bigwedge;": "\u22C0",
      "&bkarow;": "\u290D",
      "&blacklozenge;": "\u29EB",
      "&blacksquare;": "\u25AA",
      "&blacktriangle;": "\u25B4",
      "&blacktriangledown;": "\u25BE",
      "&blacktriangleleft;": "\u25C2",
      "&blacktriangleright;": "\u25B8",
      "&blank;": "\u2423",
      "&blk12;": "\u2592",
      "&blk14;": "\u2591",
      "&blk34;": "\u2593",
      "&block;": "\u2588",
      "&bne;": "=\u20E5",
      "&bnequiv;": "\u2261\u20E5",
      "&bnot;": "\u2310",
      "&bopf;": "\u{1D553}",
      "&bot;": "\u22A5",
      "&bottom;": "\u22A5",
      "&bowtie;": "\u22C8",
      "&boxDL;": "\u2557",
      "&boxDR;": "\u2554",
      "&boxDl;": "\u2556",
      "&boxDr;": "\u2553",
      "&boxH;": "\u2550",
      "&boxHD;": "\u2566",
      "&boxHU;": "\u2569",
      "&boxHd;": "\u2564",
      "&boxHu;": "\u2567",
      "&boxUL;": "\u255D",
      "&boxUR;": "\u255A",
      "&boxUl;": "\u255C",
      "&boxUr;": "\u2559",
      "&boxV;": "\u2551",
      "&boxVH;": "\u256C",
      "&boxVL;": "\u2563",
      "&boxVR;": "\u2560",
      "&boxVh;": "\u256B",
      "&boxVl;": "\u2562",
      "&boxVr;": "\u255F",
      "&boxbox;": "\u29C9",
      "&boxdL;": "\u2555",
      "&boxdR;": "\u2552",
      "&boxdl;": "\u2510",
      "&boxdr;": "\u250C",
      "&boxh;": "\u2500",
      "&boxhD;": "\u2565",
      "&boxhU;": "\u2568",
      "&boxhd;": "\u252C",
      "&boxhu;": "\u2534",
      "&boxminus;": "\u229F",
      "&boxplus;": "\u229E",
      "&boxtimes;": "\u22A0",
      "&boxuL;": "\u255B",
      "&boxuR;": "\u2558",
      "&boxul;": "\u2518",
      "&boxur;": "\u2514",
      "&boxv;": "\u2502",
      "&boxvH;": "\u256A",
      "&boxvL;": "\u2561",
      "&boxvR;": "\u255E",
      "&boxvh;": "\u253C",
      "&boxvl;": "\u2524",
      "&boxvr;": "\u251C",
      "&bprime;": "\u2035",
      "&breve;": "\u02D8",
      "&brvbar": "\xA6",
      "&brvbar;": "\xA6",
      "&bscr;": "\u{1D4B7}",
      "&bsemi;": "\u204F",
      "&bsim;": "\u223D",
      "&bsime;": "\u22CD",
      "&bsol;": "\\",
      "&bsolb;": "\u29C5",
      "&bsolhsub;": "\u27C8",
      "&bull;": "\u2022",
      "&bullet;": "\u2022",
      "&bump;": "\u224E",
      "&bumpE;": "\u2AAE",
      "&bumpe;": "\u224F",
      "&bumpeq;": "\u224F",
      "&cacute;": "\u0107",
      "&cap;": "\u2229",
      "&capand;": "\u2A44",
      "&capbrcup;": "\u2A49",
      "&capcap;": "\u2A4B",
      "&capcup;": "\u2A47",
      "&capdot;": "\u2A40",
      "&caps;": "\u2229\uFE00",
      "&caret;": "\u2041",
      "&caron;": "\u02C7",
      "&ccaps;": "\u2A4D",
      "&ccaron;": "\u010D",
      "&ccedil": "\xE7",
      "&ccedil;": "\xE7",
      "&ccirc;": "\u0109",
      "&ccups;": "\u2A4C",
      "&ccupssm;": "\u2A50",
      "&cdot;": "\u010B",
      "&cedil": "\xB8",
      "&cedil;": "\xB8",
      "&cemptyv;": "\u29B2",
      "&cent": "\xA2",
      "&cent;": "\xA2",
      "&centerdot;": "\xB7",
      "&cfr;": "\u{1D520}",
      "&chcy;": "\u0447",
      "&check;": "\u2713",
      "&checkmark;": "\u2713",
      "&chi;": "\u03C7",
      "&cir;": "\u25CB",
      "&cirE;": "\u29C3",
      "&circ;": "\u02C6",
      "&circeq;": "\u2257",
      "&circlearrowleft;": "\u21BA",
      "&circlearrowright;": "\u21BB",
      "&circledR;": "\xAE",
      "&circledS;": "\u24C8",
      "&circledast;": "\u229B",
      "&circledcirc;": "\u229A",
      "&circleddash;": "\u229D",
      "&cire;": "\u2257",
      "&cirfnint;": "\u2A10",
      "&cirmid;": "\u2AEF",
      "&cirscir;": "\u29C2",
      "&clubs;": "\u2663",
      "&clubsuit;": "\u2663",
      "&colon;": ":",
      "&colone;": "\u2254",
      "&coloneq;": "\u2254",
      "&comma;": ",",
      "&commat;": "@",
      "&comp;": "\u2201",
      "&compfn;": "\u2218",
      "&complement;": "\u2201",
      "&complexes;": "\u2102",
      "&cong;": "\u2245",
      "&congdot;": "\u2A6D",
      "&conint;": "\u222E",
      "&copf;": "\u{1D554}",
      "&coprod;": "\u2210",
      "&copy": "\xA9",
      "&copy;": "\xA9",
      "&copysr;": "\u2117",
      "&crarr;": "\u21B5",
      "&cross;": "\u2717",
      "&cscr;": "\u{1D4B8}",
      "&csub;": "\u2ACF",
      "&csube;": "\u2AD1",
      "&csup;": "\u2AD0",
      "&csupe;": "\u2AD2",
      "&ctdot;": "\u22EF",
      "&cudarrl;": "\u2938",
      "&cudarrr;": "\u2935",
      "&cuepr;": "\u22DE",
      "&cuesc;": "\u22DF",
      "&cularr;": "\u21B6",
      "&cularrp;": "\u293D",
      "&cup;": "\u222A",
      "&cupbrcap;": "\u2A48",
      "&cupcap;": "\u2A46",
      "&cupcup;": "\u2A4A",
      "&cupdot;": "\u228D",
      "&cupor;": "\u2A45",
      "&cups;": "\u222A\uFE00",
      "&curarr;": "\u21B7",
      "&curarrm;": "\u293C",
      "&curlyeqprec;": "\u22DE",
      "&curlyeqsucc;": "\u22DF",
      "&curlyvee;": "\u22CE",
      "&curlywedge;": "\u22CF",
      "&curren": "\xA4",
      "&curren;": "\xA4",
      "&curvearrowleft;": "\u21B6",
      "&curvearrowright;": "\u21B7",
      "&cuvee;": "\u22CE",
      "&cuwed;": "\u22CF",
      "&cwconint;": "\u2232",
      "&cwint;": "\u2231",
      "&cylcty;": "\u232D",
      "&dArr;": "\u21D3",
      "&dHar;": "\u2965",
      "&dagger;": "\u2020",
      "&daleth;": "\u2138",
      "&darr;": "\u2193",
      "&dash;": "\u2010",
      "&dashv;": "\u22A3",
      "&dbkarow;": "\u290F",
      "&dblac;": "\u02DD",
      "&dcaron;": "\u010F",
      "&dcy;": "\u0434",
      "&dd;": "\u2146",
      "&ddagger;": "\u2021",
      "&ddarr;": "\u21CA",
      "&ddotseq;": "\u2A77",
      "&deg": "\xB0",
      "&deg;": "\xB0",
      "&delta;": "\u03B4",
      "&demptyv;": "\u29B1",
      "&dfisht;": "\u297F",
      "&dfr;": "\u{1D521}",
      "&dharl;": "\u21C3",
      "&dharr;": "\u21C2",
      "&diam;": "\u22C4",
      "&diamond;": "\u22C4",
      "&diamondsuit;": "\u2666",
      "&diams;": "\u2666",
      "&die;": "\xA8",
      "&digamma;": "\u03DD",
      "&disin;": "\u22F2",
      "&div;": "\xF7",
      "&divide": "\xF7",
      "&divide;": "\xF7",
      "&divideontimes;": "\u22C7",
      "&divonx;": "\u22C7",
      "&djcy;": "\u0452",
      "&dlcorn;": "\u231E",
      "&dlcrop;": "\u230D",
      "&dollar;": "$",
      "&dopf;": "\u{1D555}",
      "&dot;": "\u02D9",
      "&doteq;": "\u2250",
      "&doteqdot;": "\u2251",
      "&dotminus;": "\u2238",
      "&dotplus;": "\u2214",
      "&dotsquare;": "\u22A1",
      "&doublebarwedge;": "\u2306",
      "&downarrow;": "\u2193",
      "&downdownarrows;": "\u21CA",
      "&downharpoonleft;": "\u21C3",
      "&downharpoonright;": "\u21C2",
      "&drbkarow;": "\u2910",
      "&drcorn;": "\u231F",
      "&drcrop;": "\u230C",
      "&dscr;": "\u{1D4B9}",
      "&dscy;": "\u0455",
      "&dsol;": "\u29F6",
      "&dstrok;": "\u0111",
      "&dtdot;": "\u22F1",
      "&dtri;": "\u25BF",
      "&dtrif;": "\u25BE",
      "&duarr;": "\u21F5",
      "&duhar;": "\u296F",
      "&dwangle;": "\u29A6",
      "&dzcy;": "\u045F",
      "&dzigrarr;": "\u27FF",
      "&eDDot;": "\u2A77",
      "&eDot;": "\u2251",
      "&eacute": "\xE9",
      "&eacute;": "\xE9",
      "&easter;": "\u2A6E",
      "&ecaron;": "\u011B",
      "&ecir;": "\u2256",
      "&ecirc": "\xEA",
      "&ecirc;": "\xEA",
      "&ecolon;": "\u2255",
      "&ecy;": "\u044D",
      "&edot;": "\u0117",
      "&ee;": "\u2147",
      "&efDot;": "\u2252",
      "&efr;": "\u{1D522}",
      "&eg;": "\u2A9A",
      "&egrave": "\xE8",
      "&egrave;": "\xE8",
      "&egs;": "\u2A96",
      "&egsdot;": "\u2A98",
      "&el;": "\u2A99",
      "&elinters;": "\u23E7",
      "&ell;": "\u2113",
      "&els;": "\u2A95",
      "&elsdot;": "\u2A97",
      "&emacr;": "\u0113",
      "&empty;": "\u2205",
      "&emptyset;": "\u2205",
      "&emptyv;": "\u2205",
      "&emsp13;": "\u2004",
      "&emsp14;": "\u2005",
      "&emsp;": "\u2003",
      "&eng;": "\u014B",
      "&ensp;": "\u2002",
      "&eogon;": "\u0119",
      "&eopf;": "\u{1D556}",
      "&epar;": "\u22D5",
      "&eparsl;": "\u29E3",
      "&eplus;": "\u2A71",
      "&epsi;": "\u03B5",
      "&epsilon;": "\u03B5",
      "&epsiv;": "\u03F5",
      "&eqcirc;": "\u2256",
      "&eqcolon;": "\u2255",
      "&eqsim;": "\u2242",
      "&eqslantgtr;": "\u2A96",
      "&eqslantless;": "\u2A95",
      "&equals;": "=",
      "&equest;": "\u225F",
      "&equiv;": "\u2261",
      "&equivDD;": "\u2A78",
      "&eqvparsl;": "\u29E5",
      "&erDot;": "\u2253",
      "&erarr;": "\u2971",
      "&escr;": "\u212F",
      "&esdot;": "\u2250",
      "&esim;": "\u2242",
      "&eta;": "\u03B7",
      "&eth": "\xF0",
      "&eth;": "\xF0",
      "&euml": "\xEB",
      "&euml;": "\xEB",
      "&euro;": "\u20AC",
      "&excl;": "!",
      "&exist;": "\u2203",
      "&expectation;": "\u2130",
      "&exponentiale;": "\u2147",
      "&fallingdotseq;": "\u2252",
      "&fcy;": "\u0444",
      "&female;": "\u2640",
      "&ffilig;": "\uFB03",
      "&fflig;": "\uFB00",
      "&ffllig;": "\uFB04",
      "&ffr;": "\u{1D523}",
      "&filig;": "\uFB01",
      "&fjlig;": "fj",
      "&flat;": "\u266D",
      "&fllig;": "\uFB02",
      "&fltns;": "\u25B1",
      "&fnof;": "\u0192",
      "&fopf;": "\u{1D557}",
      "&forall;": "\u2200",
      "&fork;": "\u22D4",
      "&forkv;": "\u2AD9",
      "&fpartint;": "\u2A0D",
      "&frac12": "\xBD",
      "&frac12;": "\xBD",
      "&frac13;": "\u2153",
      "&frac14": "\xBC",
      "&frac14;": "\xBC",
      "&frac15;": "\u2155",
      "&frac16;": "\u2159",
      "&frac18;": "\u215B",
      "&frac23;": "\u2154",
      "&frac25;": "\u2156",
      "&frac34": "\xBE",
      "&frac34;": "\xBE",
      "&frac35;": "\u2157",
      "&frac38;": "\u215C",
      "&frac45;": "\u2158",
      "&frac56;": "\u215A",
      "&frac58;": "\u215D",
      "&frac78;": "\u215E",
      "&frasl;": "\u2044",
      "&frown;": "\u2322",
      "&fscr;": "\u{1D4BB}",
      "&gE;": "\u2267",
      "&gEl;": "\u2A8C",
      "&gacute;": "\u01F5",
      "&gamma;": "\u03B3",
      "&gammad;": "\u03DD",
      "&gap;": "\u2A86",
      "&gbreve;": "\u011F",
      "&gcirc;": "\u011D",
      "&gcy;": "\u0433",
      "&gdot;": "\u0121",
      "&ge;": "\u2265",
      "&gel;": "\u22DB",
      "&geq;": "\u2265",
      "&geqq;": "\u2267",
      "&geqslant;": "\u2A7E",
      "&ges;": "\u2A7E",
      "&gescc;": "\u2AA9",
      "&gesdot;": "\u2A80",
      "&gesdoto;": "\u2A82",
      "&gesdotol;": "\u2A84",
      "&gesl;": "\u22DB\uFE00",
      "&gesles;": "\u2A94",
      "&gfr;": "\u{1D524}",
      "&gg;": "\u226B",
      "&ggg;": "\u22D9",
      "&gimel;": "\u2137",
      "&gjcy;": "\u0453",
      "&gl;": "\u2277",
      "&glE;": "\u2A92",
      "&gla;": "\u2AA5",
      "&glj;": "\u2AA4",
      "&gnE;": "\u2269",
      "&gnap;": "\u2A8A",
      "&gnapprox;": "\u2A8A",
      "&gne;": "\u2A88",
      "&gneq;": "\u2A88",
      "&gneqq;": "\u2269",
      "&gnsim;": "\u22E7",
      "&gopf;": "\u{1D558}",
      "&grave;": "`",
      "&gscr;": "\u210A",
      "&gsim;": "\u2273",
      "&gsime;": "\u2A8E",
      "&gsiml;": "\u2A90",
      "&gt": ">",
      "&gt;": ">",
      "&gtcc;": "\u2AA7",
      "&gtcir;": "\u2A7A",
      "&gtdot;": "\u22D7",
      "&gtlPar;": "\u2995",
      "&gtquest;": "\u2A7C",
      "&gtrapprox;": "\u2A86",
      "&gtrarr;": "\u2978",
      "&gtrdot;": "\u22D7",
      "&gtreqless;": "\u22DB",
      "&gtreqqless;": "\u2A8C",
      "&gtrless;": "\u2277",
      "&gtrsim;": "\u2273",
      "&gvertneqq;": "\u2269\uFE00",
      "&gvnE;": "\u2269\uFE00",
      "&hArr;": "\u21D4",
      "&hairsp;": "\u200A",
      "&half;": "\xBD",
      "&hamilt;": "\u210B",
      "&hardcy;": "\u044A",
      "&harr;": "\u2194",
      "&harrcir;": "\u2948",
      "&harrw;": "\u21AD",
      "&hbar;": "\u210F",
      "&hcirc;": "\u0125",
      "&hearts;": "\u2665",
      "&heartsuit;": "\u2665",
      "&hellip;": "\u2026",
      "&hercon;": "\u22B9",
      "&hfr;": "\u{1D525}",
      "&hksearow;": "\u2925",
      "&hkswarow;": "\u2926",
      "&hoarr;": "\u21FF",
      "&homtht;": "\u223B",
      "&hookleftarrow;": "\u21A9",
      "&hookrightarrow;": "\u21AA",
      "&hopf;": "\u{1D559}",
      "&horbar;": "\u2015",
      "&hscr;": "\u{1D4BD}",
      "&hslash;": "\u210F",
      "&hstrok;": "\u0127",
      "&hybull;": "\u2043",
      "&hyphen;": "\u2010",
      "&iacute": "\xED",
      "&iacute;": "\xED",
      "&ic;": "\u2063",
      "&icirc": "\xEE",
      "&icirc;": "\xEE",
      "&icy;": "\u0438",
      "&iecy;": "\u0435",
      "&iexcl": "\xA1",
      "&iexcl;": "\xA1",
      "&iff;": "\u21D4",
      "&ifr;": "\u{1D526}",
      "&igrave": "\xEC",
      "&igrave;": "\xEC",
      "&ii;": "\u2148",
      "&iiiint;": "\u2A0C",
      "&iiint;": "\u222D",
      "&iinfin;": "\u29DC",
      "&iiota;": "\u2129",
      "&ijlig;": "\u0133",
      "&imacr;": "\u012B",
      "&image;": "\u2111",
      "&imagline;": "\u2110",
      "&imagpart;": "\u2111",
      "&imath;": "\u0131",
      "&imof;": "\u22B7",
      "&imped;": "\u01B5",
      "&in;": "\u2208",
      "&incare;": "\u2105",
      "&infin;": "\u221E",
      "&infintie;": "\u29DD",
      "&inodot;": "\u0131",
      "&int;": "\u222B",
      "&intcal;": "\u22BA",
      "&integers;": "\u2124",
      "&intercal;": "\u22BA",
      "&intlarhk;": "\u2A17",
      "&intprod;": "\u2A3C",
      "&iocy;": "\u0451",
      "&iogon;": "\u012F",
      "&iopf;": "\u{1D55A}",
      "&iota;": "\u03B9",
      "&iprod;": "\u2A3C",
      "&iquest": "\xBF",
      "&iquest;": "\xBF",
      "&iscr;": "\u{1D4BE}",
      "&isin;": "\u2208",
      "&isinE;": "\u22F9",
      "&isindot;": "\u22F5",
      "&isins;": "\u22F4",
      "&isinsv;": "\u22F3",
      "&isinv;": "\u2208",
      "&it;": "\u2062",
      "&itilde;": "\u0129",
      "&iukcy;": "\u0456",
      "&iuml": "\xEF",
      "&iuml;": "\xEF",
      "&jcirc;": "\u0135",
      "&jcy;": "\u0439",
      "&jfr;": "\u{1D527}",
      "&jmath;": "\u0237",
      "&jopf;": "\u{1D55B}",
      "&jscr;": "\u{1D4BF}",
      "&jsercy;": "\u0458",
      "&jukcy;": "\u0454",
      "&kappa;": "\u03BA",
      "&kappav;": "\u03F0",
      "&kcedil;": "\u0137",
      "&kcy;": "\u043A",
      "&kfr;": "\u{1D528}",
      "&kgreen;": "\u0138",
      "&khcy;": "\u0445",
      "&kjcy;": "\u045C",
      "&kopf;": "\u{1D55C}",
      "&kscr;": "\u{1D4C0}",
      "&lAarr;": "\u21DA",
      "&lArr;": "\u21D0",
      "&lAtail;": "\u291B",
      "&lBarr;": "\u290E",
      "&lE;": "\u2266",
      "&lEg;": "\u2A8B",
      "&lHar;": "\u2962",
      "&lacute;": "\u013A",
      "&laemptyv;": "\u29B4",
      "&lagran;": "\u2112",
      "&lambda;": "\u03BB",
      "&lang;": "\u27E8",
      "&langd;": "\u2991",
      "&langle;": "\u27E8",
      "&lap;": "\u2A85",
      "&laquo": "\xAB",
      "&laquo;": "\xAB",
      "&larr;": "\u2190",
      "&larrb;": "\u21E4",
      "&larrbfs;": "\u291F",
      "&larrfs;": "\u291D",
      "&larrhk;": "\u21A9",
      "&larrlp;": "\u21AB",
      "&larrpl;": "\u2939",
      "&larrsim;": "\u2973",
      "&larrtl;": "\u21A2",
      "&lat;": "\u2AAB",
      "&latail;": "\u2919",
      "&late;": "\u2AAD",
      "&lates;": "\u2AAD\uFE00",
      "&lbarr;": "\u290C",
      "&lbbrk;": "\u2772",
      "&lbrace;": "{",
      "&lbrack;": "[",
      "&lbrke;": "\u298B",
      "&lbrksld;": "\u298F",
      "&lbrkslu;": "\u298D",
      "&lcaron;": "\u013E",
      "&lcedil;": "\u013C",
      "&lceil;": "\u2308",
      "&lcub;": "{",
      "&lcy;": "\u043B",
      "&ldca;": "\u2936",
      "&ldquo;": "\u201C",
      "&ldquor;": "\u201E",
      "&ldrdhar;": "\u2967",
      "&ldrushar;": "\u294B",
      "&ldsh;": "\u21B2",
      "&le;": "\u2264",
      "&leftarrow;": "\u2190",
      "&leftarrowtail;": "\u21A2",
      "&leftharpoondown;": "\u21BD",
      "&leftharpoonup;": "\u21BC",
      "&leftleftarrows;": "\u21C7",
      "&leftrightarrow;": "\u2194",
      "&leftrightarrows;": "\u21C6",
      "&leftrightharpoons;": "\u21CB",
      "&leftrightsquigarrow;": "\u21AD",
      "&leftthreetimes;": "\u22CB",
      "&leg;": "\u22DA",
      "&leq;": "\u2264",
      "&leqq;": "\u2266",
      "&leqslant;": "\u2A7D",
      "&les;": "\u2A7D",
      "&lescc;": "\u2AA8",
      "&lesdot;": "\u2A7F",
      "&lesdoto;": "\u2A81",
      "&lesdotor;": "\u2A83",
      "&lesg;": "\u22DA\uFE00",
      "&lesges;": "\u2A93",
      "&lessapprox;": "\u2A85",
      "&lessdot;": "\u22D6",
      "&lesseqgtr;": "\u22DA",
      "&lesseqqgtr;": "\u2A8B",
      "&lessgtr;": "\u2276",
      "&lesssim;": "\u2272",
      "&lfisht;": "\u297C",
      "&lfloor;": "\u230A",
      "&lfr;": "\u{1D529}",
      "&lg;": "\u2276",
      "&lgE;": "\u2A91",
      "&lhard;": "\u21BD",
      "&lharu;": "\u21BC",
      "&lharul;": "\u296A",
      "&lhblk;": "\u2584",
      "&ljcy;": "\u0459",
      "&ll;": "\u226A",
      "&llarr;": "\u21C7",
      "&llcorner;": "\u231E",
      "&llhard;": "\u296B",
      "&lltri;": "\u25FA",
      "&lmidot;": "\u0140",
      "&lmoust;": "\u23B0",
      "&lmoustache;": "\u23B0",
      "&lnE;": "\u2268",
      "&lnap;": "\u2A89",
      "&lnapprox;": "\u2A89",
      "&lne;": "\u2A87",
      "&lneq;": "\u2A87",
      "&lneqq;": "\u2268",
      "&lnsim;": "\u22E6",
      "&loang;": "\u27EC",
      "&loarr;": "\u21FD",
      "&lobrk;": "\u27E6",
      "&longleftarrow;": "\u27F5",
      "&longleftrightarrow;": "\u27F7",
      "&longmapsto;": "\u27FC",
      "&longrightarrow;": "\u27F6",
      "&looparrowleft;": "\u21AB",
      "&looparrowright;": "\u21AC",
      "&lopar;": "\u2985",
      "&lopf;": "\u{1D55D}",
      "&loplus;": "\u2A2D",
      "&lotimes;": "\u2A34",
      "&lowast;": "\u2217",
      "&lowbar;": "_",
      "&loz;": "\u25CA",
      "&lozenge;": "\u25CA",
      "&lozf;": "\u29EB",
      "&lpar;": "(",
      "&lparlt;": "\u2993",
      "&lrarr;": "\u21C6",
      "&lrcorner;": "\u231F",
      "&lrhar;": "\u21CB",
      "&lrhard;": "\u296D",
      "&lrm;": "\u200E",
      "&lrtri;": "\u22BF",
      "&lsaquo;": "\u2039",
      "&lscr;": "\u{1D4C1}",
      "&lsh;": "\u21B0",
      "&lsim;": "\u2272",
      "&lsime;": "\u2A8D",
      "&lsimg;": "\u2A8F",
      "&lsqb;": "[",
      "&lsquo;": "\u2018",
      "&lsquor;": "\u201A",
      "&lstrok;": "\u0142",
      "&lt": "<",
      "&lt;": "<",
      "&ltcc;": "\u2AA6",
      "&ltcir;": "\u2A79",
      "&ltdot;": "\u22D6",
      "&lthree;": "\u22CB",
      "&ltimes;": "\u22C9",
      "&ltlarr;": "\u2976",
      "&ltquest;": "\u2A7B",
      "&ltrPar;": "\u2996",
      "&ltri;": "\u25C3",
      "&ltrie;": "\u22B4",
      "&ltrif;": "\u25C2",
      "&lurdshar;": "\u294A",
      "&luruhar;": "\u2966",
      "&lvertneqq;": "\u2268\uFE00",
      "&lvnE;": "\u2268\uFE00",
      "&mDDot;": "\u223A",
      "&macr": "\xAF",
      "&macr;": "\xAF",
      "&male;": "\u2642",
      "&malt;": "\u2720",
      "&maltese;": "\u2720",
      "&map;": "\u21A6",
      "&mapsto;": "\u21A6",
      "&mapstodown;": "\u21A7",
      "&mapstoleft;": "\u21A4",
      "&mapstoup;": "\u21A5",
      "&marker;": "\u25AE",
      "&mcomma;": "\u2A29",
      "&mcy;": "\u043C",
      "&mdash;": "\u2014",
      "&measuredangle;": "\u2221",
      "&mfr;": "\u{1D52A}",
      "&mho;": "\u2127",
      "&micro": "\xB5",
      "&micro;": "\xB5",
      "&mid;": "\u2223",
      "&midast;": "*",
      "&midcir;": "\u2AF0",
      "&middot": "\xB7",
      "&middot;": "\xB7",
      "&minus;": "\u2212",
      "&minusb;": "\u229F",
      "&minusd;": "\u2238",
      "&minusdu;": "\u2A2A",
      "&mlcp;": "\u2ADB",
      "&mldr;": "\u2026",
      "&mnplus;": "\u2213",
      "&models;": "\u22A7",
      "&mopf;": "\u{1D55E}",
      "&mp;": "\u2213",
      "&mscr;": "\u{1D4C2}",
      "&mstpos;": "\u223E",
      "&mu;": "\u03BC",
      "&multimap;": "\u22B8",
      "&mumap;": "\u22B8",
      "&nGg;": "\u22D9\u0338",
      "&nGt;": "\u226B\u20D2",
      "&nGtv;": "\u226B\u0338",
      "&nLeftarrow;": "\u21CD",
      "&nLeftrightarrow;": "\u21CE",
      "&nLl;": "\u22D8\u0338",
      "&nLt;": "\u226A\u20D2",
      "&nLtv;": "\u226A\u0338",
      "&nRightarrow;": "\u21CF",
      "&nVDash;": "\u22AF",
      "&nVdash;": "\u22AE",
      "&nabla;": "\u2207",
      "&nacute;": "\u0144",
      "&nang;": "\u2220\u20D2",
      "&nap;": "\u2249",
      "&napE;": "\u2A70\u0338",
      "&napid;": "\u224B\u0338",
      "&napos;": "\u0149",
      "&napprox;": "\u2249",
      "&natur;": "\u266E",
      "&natural;": "\u266E",
      "&naturals;": "\u2115",
      "&nbsp": "\xA0",
      "&nbsp;": "\xA0",
      "&nbump;": "\u224E\u0338",
      "&nbumpe;": "\u224F\u0338",
      "&ncap;": "\u2A43",
      "&ncaron;": "\u0148",
      "&ncedil;": "\u0146",
      "&ncong;": "\u2247",
      "&ncongdot;": "\u2A6D\u0338",
      "&ncup;": "\u2A42",
      "&ncy;": "\u043D",
      "&ndash;": "\u2013",
      "&ne;": "\u2260",
      "&neArr;": "\u21D7",
      "&nearhk;": "\u2924",
      "&nearr;": "\u2197",
      "&nearrow;": "\u2197",
      "&nedot;": "\u2250\u0338",
      "&nequiv;": "\u2262",
      "&nesear;": "\u2928",
      "&nesim;": "\u2242\u0338",
      "&nexist;": "\u2204",
      "&nexists;": "\u2204",
      "&nfr;": "\u{1D52B}",
      "&ngE;": "\u2267\u0338",
      "&nge;": "\u2271",
      "&ngeq;": "\u2271",
      "&ngeqq;": "\u2267\u0338",
      "&ngeqslant;": "\u2A7E\u0338",
      "&nges;": "\u2A7E\u0338",
      "&ngsim;": "\u2275",
      "&ngt;": "\u226F",
      "&ngtr;": "\u226F",
      "&nhArr;": "\u21CE",
      "&nharr;": "\u21AE",
      "&nhpar;": "\u2AF2",
      "&ni;": "\u220B",
      "&nis;": "\u22FC",
      "&nisd;": "\u22FA",
      "&niv;": "\u220B",
      "&njcy;": "\u045A",
      "&nlArr;": "\u21CD",
      "&nlE;": "\u2266\u0338",
      "&nlarr;": "\u219A",
      "&nldr;": "\u2025",
      "&nle;": "\u2270",
      "&nleftarrow;": "\u219A",
      "&nleftrightarrow;": "\u21AE",
      "&nleq;": "\u2270",
      "&nleqq;": "\u2266\u0338",
      "&nleqslant;": "\u2A7D\u0338",
      "&nles;": "\u2A7D\u0338",
      "&nless;": "\u226E",
      "&nlsim;": "\u2274",
      "&nlt;": "\u226E",
      "&nltri;": "\u22EA",
      "&nltrie;": "\u22EC",
      "&nmid;": "\u2224",
      "&nopf;": "\u{1D55F}",
      "&not": "\xAC",
      "&not;": "\xAC",
      "&notin;": "\u2209",
      "&notinE;": "\u22F9\u0338",
      "&notindot;": "\u22F5\u0338",
      "&notinva;": "\u2209",
      "&notinvb;": "\u22F7",
      "&notinvc;": "\u22F6",
      "&notni;": "\u220C",
      "&notniva;": "\u220C",
      "&notnivb;": "\u22FE",
      "&notnivc;": "\u22FD",
      "&npar;": "\u2226",
      "&nparallel;": "\u2226",
      "&nparsl;": "\u2AFD\u20E5",
      "&npart;": "\u2202\u0338",
      "&npolint;": "\u2A14",
      "&npr;": "\u2280",
      "&nprcue;": "\u22E0",
      "&npre;": "\u2AAF\u0338",
      "&nprec;": "\u2280",
      "&npreceq;": "\u2AAF\u0338",
      "&nrArr;": "\u21CF",
      "&nrarr;": "\u219B",
      "&nrarrc;": "\u2933\u0338",
      "&nrarrw;": "\u219D\u0338",
      "&nrightarrow;": "\u219B",
      "&nrtri;": "\u22EB",
      "&nrtrie;": "\u22ED",
      "&nsc;": "\u2281",
      "&nsccue;": "\u22E1",
      "&nsce;": "\u2AB0\u0338",
      "&nscr;": "\u{1D4C3}",
      "&nshortmid;": "\u2224",
      "&nshortparallel;": "\u2226",
      "&nsim;": "\u2241",
      "&nsime;": "\u2244",
      "&nsimeq;": "\u2244",
      "&nsmid;": "\u2224",
      "&nspar;": "\u2226",
      "&nsqsube;": "\u22E2",
      "&nsqsupe;": "\u22E3",
      "&nsub;": "\u2284",
      "&nsubE;": "\u2AC5\u0338",
      "&nsube;": "\u2288",
      "&nsubset;": "\u2282\u20D2",
      "&nsubseteq;": "\u2288",
      "&nsubseteqq;": "\u2AC5\u0338",
      "&nsucc;": "\u2281",
      "&nsucceq;": "\u2AB0\u0338",
      "&nsup;": "\u2285",
      "&nsupE;": "\u2AC6\u0338",
      "&nsupe;": "\u2289",
      "&nsupset;": "\u2283\u20D2",
      "&nsupseteq;": "\u2289",
      "&nsupseteqq;": "\u2AC6\u0338",
      "&ntgl;": "\u2279",
      "&ntilde": "\xF1",
      "&ntilde;": "\xF1",
      "&ntlg;": "\u2278",
      "&ntriangleleft;": "\u22EA",
      "&ntrianglelefteq;": "\u22EC",
      "&ntriangleright;": "\u22EB",
      "&ntrianglerighteq;": "\u22ED",
      "&nu;": "\u03BD",
      "&num;": "#",
      "&numero;": "\u2116",
      "&numsp;": "\u2007",
      "&nvDash;": "\u22AD",
      "&nvHarr;": "\u2904",
      "&nvap;": "\u224D\u20D2",
      "&nvdash;": "\u22AC",
      "&nvge;": "\u2265\u20D2",
      "&nvgt;": ">\u20D2",
      "&nvinfin;": "\u29DE",
      "&nvlArr;": "\u2902",
      "&nvle;": "\u2264\u20D2",
      "&nvlt;": "<\u20D2",
      "&nvltrie;": "\u22B4\u20D2",
      "&nvrArr;": "\u2903",
      "&nvrtrie;": "\u22B5\u20D2",
      "&nvsim;": "\u223C\u20D2",
      "&nwArr;": "\u21D6",
      "&nwarhk;": "\u2923",
      "&nwarr;": "\u2196",
      "&nwarrow;": "\u2196",
      "&nwnear;": "\u2927",
      "&oS;": "\u24C8",
      "&oacute": "\xF3",
      "&oacute;": "\xF3",
      "&oast;": "\u229B",
      "&ocir;": "\u229A",
      "&ocirc": "\xF4",
      "&ocirc;": "\xF4",
      "&ocy;": "\u043E",
      "&odash;": "\u229D",
      "&odblac;": "\u0151",
      "&odiv;": "\u2A38",
      "&odot;": "\u2299",
      "&odsold;": "\u29BC",
      "&oelig;": "\u0153",
      "&ofcir;": "\u29BF",
      "&ofr;": "\u{1D52C}",
      "&ogon;": "\u02DB",
      "&ograve": "\xF2",
      "&ograve;": "\xF2",
      "&ogt;": "\u29C1",
      "&ohbar;": "\u29B5",
      "&ohm;": "\u03A9",
      "&oint;": "\u222E",
      "&olarr;": "\u21BA",
      "&olcir;": "\u29BE",
      "&olcross;": "\u29BB",
      "&oline;": "\u203E",
      "&olt;": "\u29C0",
      "&omacr;": "\u014D",
      "&omega;": "\u03C9",
      "&omicron;": "\u03BF",
      "&omid;": "\u29B6",
      "&ominus;": "\u2296",
      "&oopf;": "\u{1D560}",
      "&opar;": "\u29B7",
      "&operp;": "\u29B9",
      "&oplus;": "\u2295",
      "&or;": "\u2228",
      "&orarr;": "\u21BB",
      "&ord;": "\u2A5D",
      "&order;": "\u2134",
      "&orderof;": "\u2134",
      "&ordf": "\xAA",
      "&ordf;": "\xAA",
      "&ordm": "\xBA",
      "&ordm;": "\xBA",
      "&origof;": "\u22B6",
      "&oror;": "\u2A56",
      "&orslope;": "\u2A57",
      "&orv;": "\u2A5B",
      "&oscr;": "\u2134",
      "&oslash": "\xF8",
      "&oslash;": "\xF8",
      "&osol;": "\u2298",
      "&otilde": "\xF5",
      "&otilde;": "\xF5",
      "&otimes;": "\u2297",
      "&otimesas;": "\u2A36",
      "&ouml": "\xF6",
      "&ouml;": "\xF6",
      "&ovbar;": "\u233D",
      "&par;": "\u2225",
      "&para": "\xB6",
      "&para;": "\xB6",
      "&parallel;": "\u2225",
      "&parsim;": "\u2AF3",
      "&parsl;": "\u2AFD",
      "&part;": "\u2202",
      "&pcy;": "\u043F",
      "&percnt;": "%",
      "&period;": ".",
      "&permil;": "\u2030",
      "&perp;": "\u22A5",
      "&pertenk;": "\u2031",
      "&pfr;": "\u{1D52D}",
      "&phi;": "\u03C6",
      "&phiv;": "\u03D5",
      "&phmmat;": "\u2133",
      "&phone;": "\u260E",
      "&pi;": "\u03C0",
      "&pitchfork;": "\u22D4",
      "&piv;": "\u03D6",
      "&planck;": "\u210F",
      "&planckh;": "\u210E",
      "&plankv;": "\u210F",
      "&plus;": "+",
      "&plusacir;": "\u2A23",
      "&plusb;": "\u229E",
      "&pluscir;": "\u2A22",
      "&plusdo;": "\u2214",
      "&plusdu;": "\u2A25",
      "&pluse;": "\u2A72",
      "&plusmn": "\xB1",
      "&plusmn;": "\xB1",
      "&plussim;": "\u2A26",
      "&plustwo;": "\u2A27",
      "&pm;": "\xB1",
      "&pointint;": "\u2A15",
      "&popf;": "\u{1D561}",
      "&pound": "\xA3",
      "&pound;": "\xA3",
      "&pr;": "\u227A",
      "&prE;": "\u2AB3",
      "&prap;": "\u2AB7",
      "&prcue;": "\u227C",
      "&pre;": "\u2AAF",
      "&prec;": "\u227A",
      "&precapprox;": "\u2AB7",
      "&preccurlyeq;": "\u227C",
      "&preceq;": "\u2AAF",
      "&precnapprox;": "\u2AB9",
      "&precneqq;": "\u2AB5",
      "&precnsim;": "\u22E8",
      "&precsim;": "\u227E",
      "&prime;": "\u2032",
      "&primes;": "\u2119",
      "&prnE;": "\u2AB5",
      "&prnap;": "\u2AB9",
      "&prnsim;": "\u22E8",
      "&prod;": "\u220F",
      "&profalar;": "\u232E",
      "&profline;": "\u2312",
      "&profsurf;": "\u2313",
      "&prop;": "\u221D",
      "&propto;": "\u221D",
      "&prsim;": "\u227E",
      "&prurel;": "\u22B0",
      "&pscr;": "\u{1D4C5}",
      "&psi;": "\u03C8",
      "&puncsp;": "\u2008",
      "&qfr;": "\u{1D52E}",
      "&qint;": "\u2A0C",
      "&qopf;": "\u{1D562}",
      "&qprime;": "\u2057",
      "&qscr;": "\u{1D4C6}",
      "&quaternions;": "\u210D",
      "&quatint;": "\u2A16",
      "&quest;": "?",
      "&questeq;": "\u225F",
      "&quot": '"',
      "&quot;": '"',
      "&rAarr;": "\u21DB",
      "&rArr;": "\u21D2",
      "&rAtail;": "\u291C",
      "&rBarr;": "\u290F",
      "&rHar;": "\u2964",
      "&race;": "\u223D\u0331",
      "&racute;": "\u0155",
      "&radic;": "\u221A",
      "&raemptyv;": "\u29B3",
      "&rang;": "\u27E9",
      "&rangd;": "\u2992",
      "&range;": "\u29A5",
      "&rangle;": "\u27E9",
      "&raquo": "\xBB",
      "&raquo;": "\xBB",
      "&rarr;": "\u2192",
      "&rarrap;": "\u2975",
      "&rarrb;": "\u21E5",
      "&rarrbfs;": "\u2920",
      "&rarrc;": "\u2933",
      "&rarrfs;": "\u291E",
      "&rarrhk;": "\u21AA",
      "&rarrlp;": "\u21AC",
      "&rarrpl;": "\u2945",
      "&rarrsim;": "\u2974",
      "&rarrtl;": "\u21A3",
      "&rarrw;": "\u219D",
      "&ratail;": "\u291A",
      "&ratio;": "\u2236",
      "&rationals;": "\u211A",
      "&rbarr;": "\u290D",
      "&rbbrk;": "\u2773",
      "&rbrace;": "}",
      "&rbrack;": "]",
      "&rbrke;": "\u298C",
      "&rbrksld;": "\u298E",
      "&rbrkslu;": "\u2990",
      "&rcaron;": "\u0159",
      "&rcedil;": "\u0157",
      "&rceil;": "\u2309",
      "&rcub;": "}",
      "&rcy;": "\u0440",
      "&rdca;": "\u2937",
      "&rdldhar;": "\u2969",
      "&rdquo;": "\u201D",
      "&rdquor;": "\u201D",
      "&rdsh;": "\u21B3",
      "&real;": "\u211C",
      "&realine;": "\u211B",
      "&realpart;": "\u211C",
      "&reals;": "\u211D",
      "&rect;": "\u25AD",
      "&reg": "\xAE",
      "&reg;": "\xAE",
      "&rfisht;": "\u297D",
      "&rfloor;": "\u230B",
      "&rfr;": "\u{1D52F}",
      "&rhard;": "\u21C1",
      "&rharu;": "\u21C0",
      "&rharul;": "\u296C",
      "&rho;": "\u03C1",
      "&rhov;": "\u03F1",
      "&rightarrow;": "\u2192",
      "&rightarrowtail;": "\u21A3",
      "&rightharpoondown;": "\u21C1",
      "&rightharpoonup;": "\u21C0",
      "&rightleftarrows;": "\u21C4",
      "&rightleftharpoons;": "\u21CC",
      "&rightrightarrows;": "\u21C9",
      "&rightsquigarrow;": "\u219D",
      "&rightthreetimes;": "\u22CC",
      "&ring;": "\u02DA",
      "&risingdotseq;": "\u2253",
      "&rlarr;": "\u21C4",
      "&rlhar;": "\u21CC",
      "&rlm;": "\u200F",
      "&rmoust;": "\u23B1",
      "&rmoustache;": "\u23B1",
      "&rnmid;": "\u2AEE",
      "&roang;": "\u27ED",
      "&roarr;": "\u21FE",
      "&robrk;": "\u27E7",
      "&ropar;": "\u2986",
      "&ropf;": "\u{1D563}",
      "&roplus;": "\u2A2E",
      "&rotimes;": "\u2A35",
      "&rpar;": ")",
      "&rpargt;": "\u2994",
      "&rppolint;": "\u2A12",
      "&rrarr;": "\u21C9",
      "&rsaquo;": "\u203A",
      "&rscr;": "\u{1D4C7}",
      "&rsh;": "\u21B1",
      "&rsqb;": "]",
      "&rsquo;": "\u2019",
      "&rsquor;": "\u2019",
      "&rthree;": "\u22CC",
      "&rtimes;": "\u22CA",
      "&rtri;": "\u25B9",
      "&rtrie;": "\u22B5",
      "&rtrif;": "\u25B8",
      "&rtriltri;": "\u29CE",
      "&ruluhar;": "\u2968",
      "&rx;": "\u211E",
      "&sacute;": "\u015B",
      "&sbquo;": "\u201A",
      "&sc;": "\u227B",
      "&scE;": "\u2AB4",
      "&scap;": "\u2AB8",
      "&scaron;": "\u0161",
      "&sccue;": "\u227D",
      "&sce;": "\u2AB0",
      "&scedil;": "\u015F",
      "&scirc;": "\u015D",
      "&scnE;": "\u2AB6",
      "&scnap;": "\u2ABA",
      "&scnsim;": "\u22E9",
      "&scpolint;": "\u2A13",
      "&scsim;": "\u227F",
      "&scy;": "\u0441",
      "&sdot;": "\u22C5",
      "&sdotb;": "\u22A1",
      "&sdote;": "\u2A66",
      "&seArr;": "\u21D8",
      "&searhk;": "\u2925",
      "&searr;": "\u2198",
      "&searrow;": "\u2198",
      "&sect": "\xA7",
      "&sect;": "\xA7",
      "&semi;": ";",
      "&seswar;": "\u2929",
      "&setminus;": "\u2216",
      "&setmn;": "\u2216",
      "&sext;": "\u2736",
      "&sfr;": "\u{1D530}",
      "&sfrown;": "\u2322",
      "&sharp;": "\u266F",
      "&shchcy;": "\u0449",
      "&shcy;": "\u0448",
      "&shortmid;": "\u2223",
      "&shortparallel;": "\u2225",
      "&shy": "\xAD",
      "&shy;": "\xAD",
      "&sigma;": "\u03C3",
      "&sigmaf;": "\u03C2",
      "&sigmav;": "\u03C2",
      "&sim;": "\u223C",
      "&simdot;": "\u2A6A",
      "&sime;": "\u2243",
      "&simeq;": "\u2243",
      "&simg;": "\u2A9E",
      "&simgE;": "\u2AA0",
      "&siml;": "\u2A9D",
      "&simlE;": "\u2A9F",
      "&simne;": "\u2246",
      "&simplus;": "\u2A24",
      "&simrarr;": "\u2972",
      "&slarr;": "\u2190",
      "&smallsetminus;": "\u2216",
      "&smashp;": "\u2A33",
      "&smeparsl;": "\u29E4",
      "&smid;": "\u2223",
      "&smile;": "\u2323",
      "&smt;": "\u2AAA",
      "&smte;": "\u2AAC",
      "&smtes;": "\u2AAC\uFE00",
      "&softcy;": "\u044C",
      "&sol;": "/",
      "&solb;": "\u29C4",
      "&solbar;": "\u233F",
      "&sopf;": "\u{1D564}",
      "&spades;": "\u2660",
      "&spadesuit;": "\u2660",
      "&spar;": "\u2225",
      "&sqcap;": "\u2293",
      "&sqcaps;": "\u2293\uFE00",
      "&sqcup;": "\u2294",
      "&sqcups;": "\u2294\uFE00",
      "&sqsub;": "\u228F",
      "&sqsube;": "\u2291",
      "&sqsubset;": "\u228F",
      "&sqsubseteq;": "\u2291",
      "&sqsup;": "\u2290",
      "&sqsupe;": "\u2292",
      "&sqsupset;": "\u2290",
      "&sqsupseteq;": "\u2292",
      "&squ;": "\u25A1",
      "&square;": "\u25A1",
      "&squarf;": "\u25AA",
      "&squf;": "\u25AA",
      "&srarr;": "\u2192",
      "&sscr;": "\u{1D4C8}",
      "&ssetmn;": "\u2216",
      "&ssmile;": "\u2323",
      "&sstarf;": "\u22C6",
      "&star;": "\u2606",
      "&starf;": "\u2605",
      "&straightepsilon;": "\u03F5",
      "&straightphi;": "\u03D5",
      "&strns;": "\xAF",
      "&sub;": "\u2282",
      "&subE;": "\u2AC5",
      "&subdot;": "\u2ABD",
      "&sube;": "\u2286",
      "&subedot;": "\u2AC3",
      "&submult;": "\u2AC1",
      "&subnE;": "\u2ACB",
      "&subne;": "\u228A",
      "&subplus;": "\u2ABF",
      "&subrarr;": "\u2979",
      "&subset;": "\u2282",
      "&subseteq;": "\u2286",
      "&subseteqq;": "\u2AC5",
      "&subsetneq;": "\u228A",
      "&subsetneqq;": "\u2ACB",
      "&subsim;": "\u2AC7",
      "&subsub;": "\u2AD5",
      "&subsup;": "\u2AD3",
      "&succ;": "\u227B",
      "&succapprox;": "\u2AB8",
      "&succcurlyeq;": "\u227D",
      "&succeq;": "\u2AB0",
      "&succnapprox;": "\u2ABA",
      "&succneqq;": "\u2AB6",
      "&succnsim;": "\u22E9",
      "&succsim;": "\u227F",
      "&sum;": "\u2211",
      "&sung;": "\u266A",
      "&sup1": "\xB9",
      "&sup1;": "\xB9",
      "&sup2": "\xB2",
      "&sup2;": "\xB2",
      "&sup3": "\xB3",
      "&sup3;": "\xB3",
      "&sup;": "\u2283",
      "&supE;": "\u2AC6",
      "&supdot;": "\u2ABE",
      "&supdsub;": "\u2AD8",
      "&supe;": "\u2287",
      "&supedot;": "\u2AC4",
      "&suphsol;": "\u27C9",
      "&suphsub;": "\u2AD7",
      "&suplarr;": "\u297B",
      "&supmult;": "\u2AC2",
      "&supnE;": "\u2ACC",
      "&supne;": "\u228B",
      "&supplus;": "\u2AC0",
      "&supset;": "\u2283",
      "&supseteq;": "\u2287",
      "&supseteqq;": "\u2AC6",
      "&supsetneq;": "\u228B",
      "&supsetneqq;": "\u2ACC",
      "&supsim;": "\u2AC8",
      "&supsub;": "\u2AD4",
      "&supsup;": "\u2AD6",
      "&swArr;": "\u21D9",
      "&swarhk;": "\u2926",
      "&swarr;": "\u2199",
      "&swarrow;": "\u2199",
      "&swnwar;": "\u292A",
      "&szlig": "\xDF",
      "&szlig;": "\xDF",
      "&target;": "\u2316",
      "&tau;": "\u03C4",
      "&tbrk;": "\u23B4",
      "&tcaron;": "\u0165",
      "&tcedil;": "\u0163",
      "&tcy;": "\u0442",
      "&tdot;": "\u20DB",
      "&telrec;": "\u2315",
      "&tfr;": "\u{1D531}",
      "&there4;": "\u2234",
      "&therefore;": "\u2234",
      "&theta;": "\u03B8",
      "&thetasym;": "\u03D1",
      "&thetav;": "\u03D1",
      "&thickapprox;": "\u2248",
      "&thicksim;": "\u223C",
      "&thinsp;": "\u2009",
      "&thkap;": "\u2248",
      "&thksim;": "\u223C",
      "&thorn": "\xFE",
      "&thorn;": "\xFE",
      "&tilde;": "\u02DC",
      "&times": "\xD7",
      "&times;": "\xD7",
      "&timesb;": "\u22A0",
      "&timesbar;": "\u2A31",
      "&timesd;": "\u2A30",
      "&tint;": "\u222D",
      "&toea;": "\u2928",
      "&top;": "\u22A4",
      "&topbot;": "\u2336",
      "&topcir;": "\u2AF1",
      "&topf;": "\u{1D565}",
      "&topfork;": "\u2ADA",
      "&tosa;": "\u2929",
      "&tprime;": "\u2034",
      "&trade;": "\u2122",
      "&triangle;": "\u25B5",
      "&triangledown;": "\u25BF",
      "&triangleleft;": "\u25C3",
      "&trianglelefteq;": "\u22B4",
      "&triangleq;": "\u225C",
      "&triangleright;": "\u25B9",
      "&trianglerighteq;": "\u22B5",
      "&tridot;": "\u25EC",
      "&trie;": "\u225C",
      "&triminus;": "\u2A3A",
      "&triplus;": "\u2A39",
      "&trisb;": "\u29CD",
      "&tritime;": "\u2A3B",
      "&trpezium;": "\u23E2",
      "&tscr;": "\u{1D4C9}",
      "&tscy;": "\u0446",
      "&tshcy;": "\u045B",
      "&tstrok;": "\u0167",
      "&twixt;": "\u226C",
      "&twoheadleftarrow;": "\u219E",
      "&twoheadrightarrow;": "\u21A0",
      "&uArr;": "\u21D1",
      "&uHar;": "\u2963",
      "&uacute": "\xFA",
      "&uacute;": "\xFA",
      "&uarr;": "\u2191",
      "&ubrcy;": "\u045E",
      "&ubreve;": "\u016D",
      "&ucirc": "\xFB",
      "&ucirc;": "\xFB",
      "&ucy;": "\u0443",
      "&udarr;": "\u21C5",
      "&udblac;": "\u0171",
      "&udhar;": "\u296E",
      "&ufisht;": "\u297E",
      "&ufr;": "\u{1D532}",
      "&ugrave": "\xF9",
      "&ugrave;": "\xF9",
      "&uharl;": "\u21BF",
      "&uharr;": "\u21BE",
      "&uhblk;": "\u2580",
      "&ulcorn;": "\u231C",
      "&ulcorner;": "\u231C",
      "&ulcrop;": "\u230F",
      "&ultri;": "\u25F8",
      "&umacr;": "\u016B",
      "&uml": "\xA8",
      "&uml;": "\xA8",
      "&uogon;": "\u0173",
      "&uopf;": "\u{1D566}",
      "&uparrow;": "\u2191",
      "&updownarrow;": "\u2195",
      "&upharpoonleft;": "\u21BF",
      "&upharpoonright;": "\u21BE",
      "&uplus;": "\u228E",
      "&upsi;": "\u03C5",
      "&upsih;": "\u03D2",
      "&upsilon;": "\u03C5",
      "&upuparrows;": "\u21C8",
      "&urcorn;": "\u231D",
      "&urcorner;": "\u231D",
      "&urcrop;": "\u230E",
      "&uring;": "\u016F",
      "&urtri;": "\u25F9",
      "&uscr;": "\u{1D4CA}",
      "&utdot;": "\u22F0",
      "&utilde;": "\u0169",
      "&utri;": "\u25B5",
      "&utrif;": "\u25B4",
      "&uuarr;": "\u21C8",
      "&uuml": "\xFC",
      "&uuml;": "\xFC",
      "&uwangle;": "\u29A7",
      "&vArr;": "\u21D5",
      "&vBar;": "\u2AE8",
      "&vBarv;": "\u2AE9",
      "&vDash;": "\u22A8",
      "&vangrt;": "\u299C",
      "&varepsilon;": "\u03F5",
      "&varkappa;": "\u03F0",
      "&varnothing;": "\u2205",
      "&varphi;": "\u03D5",
      "&varpi;": "\u03D6",
      "&varpropto;": "\u221D",
      "&varr;": "\u2195",
      "&varrho;": "\u03F1",
      "&varsigma;": "\u03C2",
      "&varsubsetneq;": "\u228A\uFE00",
      "&varsubsetneqq;": "\u2ACB\uFE00",
      "&varsupsetneq;": "\u228B\uFE00",
      "&varsupsetneqq;": "\u2ACC\uFE00",
      "&vartheta;": "\u03D1",
      "&vartriangleleft;": "\u22B2",
      "&vartriangleright;": "\u22B3",
      "&vcy;": "\u0432",
      "&vdash;": "\u22A2",
      "&vee;": "\u2228",
      "&veebar;": "\u22BB",
      "&veeeq;": "\u225A",
      "&vellip;": "\u22EE",
      "&verbar;": "|",
      "&vert;": "|",
      "&vfr;": "\u{1D533}",
      "&vltri;": "\u22B2",
      "&vnsub;": "\u2282\u20D2",
      "&vnsup;": "\u2283\u20D2",
      "&vopf;": "\u{1D567}",
      "&vprop;": "\u221D",
      "&vrtri;": "\u22B3",
      "&vscr;": "\u{1D4CB}",
      "&vsubnE;": "\u2ACB\uFE00",
      "&vsubne;": "\u228A\uFE00",
      "&vsupnE;": "\u2ACC\uFE00",
      "&vsupne;": "\u228B\uFE00",
      "&vzigzag;": "\u299A",
      "&wcirc;": "\u0175",
      "&wedbar;": "\u2A5F",
      "&wedge;": "\u2227",
      "&wedgeq;": "\u2259",
      "&weierp;": "\u2118",
      "&wfr;": "\u{1D534}",
      "&wopf;": "\u{1D568}",
      "&wp;": "\u2118",
      "&wr;": "\u2240",
      "&wreath;": "\u2240",
      "&wscr;": "\u{1D4CC}",
      "&xcap;": "\u22C2",
      "&xcirc;": "\u25EF",
      "&xcup;": "\u22C3",
      "&xdtri;": "\u25BD",
      "&xfr;": "\u{1D535}",
      "&xhArr;": "\u27FA",
      "&xharr;": "\u27F7",
      "&xi;": "\u03BE",
      "&xlArr;": "\u27F8",
      "&xlarr;": "\u27F5",
      "&xmap;": "\u27FC",
      "&xnis;": "\u22FB",
      "&xodot;": "\u2A00",
      "&xopf;": "\u{1D569}",
      "&xoplus;": "\u2A01",
      "&xotime;": "\u2A02",
      "&xrArr;": "\u27F9",
      "&xrarr;": "\u27F6",
      "&xscr;": "\u{1D4CD}",
      "&xsqcup;": "\u2A06",
      "&xuplus;": "\u2A04",
      "&xutri;": "\u25B3",
      "&xvee;": "\u22C1",
      "&xwedge;": "\u22C0",
      "&yacute": "\xFD",
      "&yacute;": "\xFD",
      "&yacy;": "\u044F",
      "&ycirc;": "\u0177",
      "&ycy;": "\u044B",
      "&yen": "\xA5",
      "&yen;": "\xA5",
      "&yfr;": "\u{1D536}",
      "&yicy;": "\u0457",
      "&yopf;": "\u{1D56A}",
      "&yscr;": "\u{1D4CE}",
      "&yucy;": "\u044E",
      "&yuml": "\xFF",
      "&yuml;": "\xFF",
      "&zacute;": "\u017A",
      "&zcaron;": "\u017E",
      "&zcy;": "\u0437",
      "&zdot;": "\u017C",
      "&zeetrf;": "\u2128",
      "&zeta;": "\u03B6",
      "&zfr;": "\u{1D537}",
      "&zhcy;": "\u0436",
      "&zigrarr;": "\u21DD",
      "&zopf;": "\u{1D56B}",
      "&zscr;": "\u{1D4CF}",
      "&zwj;": "\u200D",
      "&zwnj;": "\u200C"
    };
    html_entities_default = htmlEntities;
  }
});

// node_modules/postal-mime/src/text-format.js
function decodeHTMLEntities(str2) {
  return str2.replace(/&(#\d+|#x[a-f0-9]+|[a-z]+\d*);?/gi, (match2, entity) => {
    if (typeof html_entities_default[match2] === "string") {
      return html_entities_default[match2];
    }
    if (entity.charAt(0) !== "#" || match2.charAt(match2.length - 1) !== ";") {
      return match2;
    }
    let codePoint;
    if (entity.charAt(1) === "x") {
      codePoint = parseInt(entity.substr(2), 16);
    } else {
      codePoint = parseInt(entity.substr(1), 10);
    }
    let output = "";
    if (codePoint >= 55296 && codePoint <= 57343 || codePoint > 1114111) {
      return "\uFFFD";
    }
    if (codePoint > 65535) {
      codePoint -= 65536;
      output += String.fromCharCode(codePoint >>> 10 & 1023 | 55296);
      codePoint = 56320 | codePoint & 1023;
    }
    output += String.fromCharCode(codePoint);
    return output;
  });
}
function escapeHtml(str2) {
  return str2.trim().replace(/[<>"'?&]/g, (c) => {
    let hex = c.charCodeAt(0).toString(16);
    if (hex.length < 2) {
      hex = "0" + hex;
    }
    return "&#x" + hex.toUpperCase() + ";";
  });
}
function textToHtml(str2) {
  let html = escapeHtml(str2).replace(/\n/g, "<br />");
  return "<div>" + html + "</div>";
}
function htmlToText(str2) {
  str2 = str2.replace(/\r?\n/g, "").replace(/<\!\-\-.*?\-\->/gi, " ").replace(/<br\b[^>]*>/gi, "\n").replace(/<\/?(p|div|table|tr|td|th)\b[^>]*>/gi, "\n\n").replace(/<script\b[^>]*>.*?<\/script\b[^>]*>/gi, " ").replace(/^.*<body\b[^>]*>/i, "").replace(/^.*<\/head\b[^>]*>/i, "").replace(/^.*<\!doctype\b[^>]*>/i, "").replace(/<\/body\b[^>]*>.*$/i, "").replace(/<\/html\b[^>]*>.*$/i, "").replace(/<a\b[^>]*href\s*=\s*["']?([^\s"']+)[^>]*>/gi, " ($1) ").replace(/<\/?(span|em|i|strong|b|u|a)\b[^>]*>/gi, "").replace(/<li\b[^>]*>[\n\u0001\s]*/gi, "* ").replace(/<hr\b[^>]*>/g, "\n-------------\n").replace(/<[^>]*>/g, " ").replace(/\u0001/g, "\n").replace(/[ \t]+/g, " ").replace(/^\s+$/gm, "").replace(/\n\n+/g, "\n\n").replace(/^\n+/, "\n").replace(/\n+$/, "\n");
  str2 = decodeHTMLEntities(str2);
  return str2;
}
function formatTextAddress(address) {
  return [].concat(address.name || []).concat(address.name ? `<${address.address}>` : address.address).join(" ");
}
function formatTextAddresses(addresses) {
  let parts = [];
  let processAddress = (address, partCounter) => {
    if (partCounter) {
      parts.push(", ");
    }
    if (address.group) {
      let groupStart = `${address.name}:`;
      let groupEnd = `;`;
      parts.push(groupStart);
      address.group.forEach(processAddress);
      parts.push(groupEnd);
    } else {
      parts.push(formatTextAddress(address));
    }
  };
  addresses.forEach(processAddress);
  return parts.join("");
}
function formatHtmlAddress(address) {
  return `<a href="mailto:${escapeHtml(address.address)}" class="postal-email-address">${escapeHtml(address.name || `<${address.address}>`)}</a>`;
}
function formatHtmlAddresses(addresses) {
  let parts = [];
  let processAddress = (address, partCounter) => {
    if (partCounter) {
      parts.push('<span class="postal-email-address-separator">, </span>');
    }
    if (address.group) {
      let groupStart = `<span class="postal-email-address-group">${escapeHtml(address.name)}:</span>`;
      let groupEnd = `<span class="postal-email-address-group">;</span>`;
      parts.push(groupStart);
      address.group.forEach(processAddress);
      parts.push(groupEnd);
    } else {
      parts.push(formatHtmlAddress(address));
    }
  };
  addresses.forEach(processAddress);
  return parts.join(" ");
}
function foldLines(str2, lineLength, afterSpace) {
  str2 = (str2 || "").toString();
  lineLength = lineLength || 76;
  let pos = 0, len = str2.length, result = "", line, match2;
  while (pos < len) {
    line = str2.substr(pos, lineLength);
    if (line.length < lineLength) {
      result += line;
      break;
    }
    if (match2 = line.match(/^[^\n\r]*(\r?\n|\r)/)) {
      line = match2[0];
      result += line;
      pos += line.length;
      continue;
    } else if ((match2 = line.match(/(\s+)[^\s]*$/)) && match2[0].length - (afterSpace ? (match2[1] || "").length : 0) < line.length) {
      line = line.substr(0, line.length - (match2[0].length - (afterSpace ? (match2[1] || "").length : 0)));
    } else if (match2 = str2.substr(pos + line.length).match(/^[^\s]+(\s*)/)) {
      line = line + match2[0].substr(0, match2[0].length - (!afterSpace ? (match2[1] || "").length : 0));
    }
    result += line;
    pos += line.length;
    if (pos < len) {
      result += "\r\n";
    }
  }
  return result;
}
function formatTextHeader(message) {
  let rows = [];
  if (message.from) {
    rows.push({ key: "From", val: formatTextAddress(message.from) });
  }
  if (message.subject) {
    rows.push({ key: "Subject", val: message.subject });
  }
  if (message.date) {
    let dateOptions = {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false
    };
    let dateStr = typeof Intl === "undefined" ? message.date : new Intl.DateTimeFormat("default", dateOptions).format(new Date(message.date));
    rows.push({ key: "Date", val: dateStr });
  }
  if (message.to && message.to.length) {
    rows.push({ key: "To", val: formatTextAddresses(message.to) });
  }
  if (message.cc && message.cc.length) {
    rows.push({ key: "Cc", val: formatTextAddresses(message.cc) });
  }
  if (message.bcc && message.bcc.length) {
    rows.push({ key: "Bcc", val: formatTextAddresses(message.bcc) });
  }
  let maxKeyLength = rows.map((r) => r.key.length).reduce((acc, cur) => {
    return cur > acc ? cur : acc;
  }, 0);
  rows = rows.flatMap((row) => {
    let sepLen = maxKeyLength - row.key.length;
    let prefix = `${row.key}: ${" ".repeat(sepLen)}`;
    let emptyPrefix = `${" ".repeat(row.key.length + 1)} ${" ".repeat(sepLen)}`;
    let foldedLines = foldLines(row.val, 80, true).split(/\r?\n/).map((line) => line.trim());
    return foldedLines.map((line, i) => `${i ? emptyPrefix : prefix}${line}`);
  });
  let maxLineLength = rows.map((r) => r.length).reduce((acc, cur) => {
    return cur > acc ? cur : acc;
  }, 0);
  let lineMarker = "-".repeat(maxLineLength);
  let template = `
${lineMarker}
${rows.join("\n")}
${lineMarker}
`;
  return template;
}
function formatHtmlHeader(message) {
  let rows = [];
  if (message.from) {
    rows.push(
      `<div class="postal-email-header-key">From</div><div class="postal-email-header-value">${formatHtmlAddress(message.from)}</div>`
    );
  }
  if (message.subject) {
    rows.push(
      `<div class="postal-email-header-key">Subject</div><div class="postal-email-header-value postal-email-header-subject">${escapeHtml(
        message.subject
      )}</div>`
    );
  }
  if (message.date) {
    let dateOptions = {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false
    };
    let dateStr = typeof Intl === "undefined" ? message.date : new Intl.DateTimeFormat("default", dateOptions).format(new Date(message.date));
    rows.push(
      `<div class="postal-email-header-key">Date</div><div class="postal-email-header-value postal-email-header-date" data-date="${escapeHtml(
        message.date
      )}">${escapeHtml(dateStr)}</div>`
    );
  }
  if (message.to && message.to.length) {
    rows.push(
      `<div class="postal-email-header-key">To</div><div class="postal-email-header-value">${formatHtmlAddresses(message.to)}</div>`
    );
  }
  if (message.cc && message.cc.length) {
    rows.push(
      `<div class="postal-email-header-key">Cc</div><div class="postal-email-header-value">${formatHtmlAddresses(message.cc)}</div>`
    );
  }
  if (message.bcc && message.bcc.length) {
    rows.push(
      `<div class="postal-email-header-key">Bcc</div><div class="postal-email-header-value">${formatHtmlAddresses(message.bcc)}</div>`
    );
  }
  let template = `<div class="postal-email-header">${rows.length ? '<div class="postal-email-header-row">' : ""}${rows.join(
    '</div>\n<div class="postal-email-header-row">'
  )}${rows.length ? "</div>" : ""}</div>`;
  return template;
}
var init_text_format = __esm({
  "node_modules/postal-mime/src/text-format.js"() {
    init_html_entities();
  }
});

// node_modules/postal-mime/src/address-parser.js
function _handleAddress(tokens, depth) {
  let isGroup = false;
  let state = "text";
  let address;
  let addresses = [];
  let data = {
    address: [],
    comment: [],
    group: [],
    text: [],
    textWasQuoted: []
    // Track which text tokens came from inside quotes
  };
  let i;
  let len;
  let insideQuotes = false;
  for (i = 0, len = tokens.length; i < len; i++) {
    let token = tokens[i];
    let prevToken = i ? tokens[i - 1] : null;
    if (token.type === "operator") {
      switch (token.value) {
        case "<":
          state = "address";
          insideQuotes = false;
          break;
        case "(":
          state = "comment";
          insideQuotes = false;
          break;
        case ":":
          state = "group";
          isGroup = true;
          insideQuotes = false;
          break;
        case '"':
          insideQuotes = !insideQuotes;
          state = "text";
          break;
        default:
          state = "text";
          insideQuotes = false;
          break;
      }
    } else if (token.value) {
      if (state === "address") {
        token.value = token.value.replace(/^[^<]*<\s*/, "");
      }
      if (prevToken && prevToken.noBreak && data[state].length) {
        data[state][data[state].length - 1] += token.value;
        if (state === "text" && insideQuotes) {
          data.textWasQuoted[data.textWasQuoted.length - 1] = true;
        }
      } else {
        data[state].push(token.value);
        if (state === "text") {
          data.textWasQuoted.push(insideQuotes);
        }
      }
    }
  }
  if (!data.text.length && data.comment.length) {
    data.text = data.comment;
    data.comment = [];
  }
  if (isGroup) {
    data.text = data.text.join(" ");
    let groupMembers = [];
    if (data.group.length) {
      let parsedGroup = addressParser(data.group.join(","), { _depth: depth + 1 });
      parsedGroup.forEach((member) => {
        if (member.group) {
          groupMembers = groupMembers.concat(member.group);
        } else {
          groupMembers.push(member);
        }
      });
    }
    addresses.push({
      name: decodeWords(data.text || address && address.name),
      group: groupMembers
    });
  } else {
    if (!data.address.length && data.text.length) {
      for (i = data.text.length - 1; i >= 0; i--) {
        if (!data.textWasQuoted[i] && data.text[i].match(/^[^@\s]+@[^@\s]+$/)) {
          data.address = data.text.splice(i, 1);
          data.textWasQuoted.splice(i, 1);
          break;
        }
      }
      let _regexHandler = function(address2) {
        if (!data.address.length) {
          data.address = [address2.trim()];
          return " ";
        } else {
          return address2;
        }
      };
      if (!data.address.length) {
        for (i = data.text.length - 1; i >= 0; i--) {
          if (!data.textWasQuoted[i]) {
            data.text[i] = data.text[i].replace(/\s*\b[^@\s]+@[^\s]+\b\s*/, _regexHandler).trim();
            if (data.address.length) {
              break;
            }
          }
        }
      }
    }
    if (!data.text.length && data.comment.length) {
      data.text = data.comment;
      data.comment = [];
    }
    if (data.address.length > 1) {
      data.text = data.text.concat(data.address.splice(1));
    }
    data.text = data.text.join(" ");
    data.address = data.address.join(" ");
    if (!data.address && /^=\?[^=]+?=$/.test(data.text.trim())) {
      const decodedText = decodeWords(data.text);
      if (/<[^<>]+@[^<>]+>/.test(decodedText)) {
        const parsedSubAddresses = addressParser(decodedText);
        if (parsedSubAddresses && parsedSubAddresses.length) {
          return parsedSubAddresses;
        }
      }
      return [{ address: "", name: decodedText }];
    }
    address = {
      address: data.address || data.text || "",
      name: decodeWords(data.text || data.address || "")
    };
    if (address.address === address.name) {
      if ((address.address || "").match(/@/)) {
        address.name = "";
      } else {
        address.address = "";
      }
    }
    addresses.push(address);
  }
  return addresses;
}
function addressParser(str2, options) {
  options = options || {};
  let depth = options._depth || 0;
  if (depth > MAX_NESTED_GROUP_DEPTH) {
    return [];
  }
  let tokenizer = new Tokenizer(str2);
  let tokens = tokenizer.tokenize();
  let addresses = [];
  let address = [];
  let parsedAddresses = [];
  tokens.forEach((token) => {
    if (token.type === "operator" && (token.value === "," || token.value === ";")) {
      if (address.length) {
        addresses.push(address);
      }
      address = [];
    } else {
      address.push(token);
    }
  });
  if (address.length) {
    addresses.push(address);
  }
  addresses.forEach((address2) => {
    address2 = _handleAddress(address2, depth);
    if (address2.length) {
      parsedAddresses = parsedAddresses.concat(address2);
    }
  });
  if (options.flatten) {
    let addresses2 = [];
    let walkAddressList = (list) => {
      list.forEach((address2) => {
        if (address2.group) {
          return walkAddressList(address2.group);
        } else {
          addresses2.push(address2);
        }
      });
    };
    walkAddressList(parsedAddresses);
    return addresses2;
  }
  return parsedAddresses;
}
var Tokenizer, MAX_NESTED_GROUP_DEPTH, address_parser_default;
var init_address_parser = __esm({
  "node_modules/postal-mime/src/address-parser.js"() {
    init_decode_strings();
    Tokenizer = class {
      constructor(str2) {
        this.str = (str2 || "").toString();
        this.operatorCurrent = "";
        this.operatorExpecting = "";
        this.node = null;
        this.escaped = false;
        this.list = [];
        this.operators = {
          '"': '"',
          "(": ")",
          "<": ">",
          ",": "",
          ":": ";",
          // Semicolons are not a legal delimiter per the RFC2822 grammar other
          // than for terminating a group, but they are also not valid for any
          // other use in this context.  Given that some mail clients have
          // historically allowed the semicolon as a delimiter equivalent to the
          // comma in their UI, it makes sense to treat them the same as a comma
          // when used outside of a group.
          ";": ""
        };
      }
      /**
       * Tokenizes the original input string
       *
       * @return {Array} An array of operator|text tokens
       */
      tokenize() {
        let list = [];
        for (let i = 0, len = this.str.length; i < len; i++) {
          let chr = this.str.charAt(i);
          let nextChr = i < len - 1 ? this.str.charAt(i + 1) : null;
          this.checkChar(chr, nextChr);
        }
        this.list.forEach((node) => {
          node.value = (node.value || "").toString().trim();
          if (node.value) {
            list.push(node);
          }
        });
        return list;
      }
      /**
       * Checks if a character is an operator or text and acts accordingly
       *
       * @param {String} chr Character from the address field
       */
      checkChar(chr, nextChr) {
        if (this.escaped) {
        } else if (chr === this.operatorExpecting) {
          this.node = {
            type: "operator",
            value: chr
          };
          if (nextChr && ![" ", "	", "\r", "\n", ",", ";"].includes(nextChr)) {
            this.node.noBreak = true;
          }
          this.list.push(this.node);
          this.node = null;
          this.operatorExpecting = "";
          this.escaped = false;
          return;
        } else if (!this.operatorExpecting && chr in this.operators) {
          this.node = {
            type: "operator",
            value: chr
          };
          this.list.push(this.node);
          this.node = null;
          this.operatorExpecting = this.operators[chr];
          this.escaped = false;
          return;
        } else if (this.operatorExpecting === '"' && chr === "\\") {
          this.escaped = true;
          return;
        }
        if (!this.node) {
          this.node = {
            type: "text",
            value: ""
          };
          this.list.push(this.node);
        }
        if (chr === "\n") {
          chr = " ";
        }
        if (chr.charCodeAt(0) >= 33 || [" ", "	"].includes(chr)) {
          this.node.value += chr;
        }
        this.escaped = false;
      }
    };
    MAX_NESTED_GROUP_DEPTH = 50;
    address_parser_default = addressParser;
  }
});

// node_modules/postal-mime/src/base64-encoder.js
function base64ArrayBuffer(arrayBuffer) {
  var base64 = "";
  var encodings = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var bytes = new Uint8Array(arrayBuffer);
  var byteLength = bytes.byteLength;
  var byteRemainder = byteLength % 3;
  var mainLength = byteLength - byteRemainder;
  var a, b, c, d;
  var chunk;
  for (var i = 0; i < mainLength; i = i + 3) {
    chunk = bytes[i] << 16 | bytes[i + 1] << 8 | bytes[i + 2];
    a = (chunk & 16515072) >> 18;
    b = (chunk & 258048) >> 12;
    c = (chunk & 4032) >> 6;
    d = chunk & 63;
    base64 += encodings[a] + encodings[b] + encodings[c] + encodings[d];
  }
  if (byteRemainder == 1) {
    chunk = bytes[mainLength];
    a = (chunk & 252) >> 2;
    b = (chunk & 3) << 4;
    base64 += encodings[a] + encodings[b] + "==";
  } else if (byteRemainder == 2) {
    chunk = bytes[mainLength] << 8 | bytes[mainLength + 1];
    a = (chunk & 64512) >> 10;
    b = (chunk & 1008) >> 4;
    c = (chunk & 15) << 2;
    base64 += encodings[a] + encodings[b] + encodings[c] + "=";
  }
  return base64;
}
var init_base64_encoder = __esm({
  "node_modules/postal-mime/src/base64-encoder.js"() {
  }
});

// node_modules/postal-mime/src/postal-mime.js
function toCamelCase(key) {
  return key.replace(/-(.)/g, (o, c) => c.toUpperCase());
}
function parseLimitOption(value, defaultValue, name) {
  if (value === void 0 || value === null) {
    return defaultValue;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
  return value;
}
var MAX_NESTING_DEPTH, MAX_HEADERS_SIZE, MAX_RFC822_NESTING_DEPTH, PostalMime;
var init_postal_mime = __esm({
  "node_modules/postal-mime/src/postal-mime.js"() {
    init_mime_node();
    init_text_format();
    init_address_parser();
    init_decode_strings();
    init_base64_encoder();
    MAX_NESTING_DEPTH = 256;
    MAX_HEADERS_SIZE = 2 * 1024 * 1024;
    MAX_RFC822_NESTING_DEPTH = 10;
    PostalMime = class {
      // async so that an invalid option rejects the returned promise instead of throwing
      // synchronously, which would escape a `.catch()` chain
      static async parse(buf, options) {
        const parser = new PostalMime(options);
        return parser.parse(buf);
      }
      // rfc822NestingDepth is internal state that nested parsers receive from their parent.
      // It is deliberately a separate argument rather than an option, so that forwarding a
      // caller supplied options object can not seed it and switch the recursion limit off.
      constructor(options, rfc822NestingDepth = 0) {
        this.options = options || {};
        this.mimeOptions = {
          maxNestingDepth: parseLimitOption(this.options.maxNestingDepth, MAX_NESTING_DEPTH, "maxNestingDepth"),
          maxHeadersSize: parseLimitOption(this.options.maxHeadersSize, MAX_HEADERS_SIZE, "maxHeadersSize")
        };
        this.maxRfc822NestingDepth = parseLimitOption(
          this.options.maxRfc822NestingDepth,
          MAX_RFC822_NESTING_DEPTH,
          "maxRfc822NestingDepth"
        );
        this.rfc822NestingDepth = rfc822NestingDepth;
        this.root = this.currentNode = new MimeNode({
          postalMime: this,
          ...this.mimeOptions
        });
        this.boundaries = [];
        this.textContent = {};
        this.attachments = [];
        this.attachmentEncoding = (this.options.attachmentEncoding || "").toString().replace(/[-_\s]/g, "").trim().toLowerCase() || "arraybuffer";
        this.started = false;
      }
      async finalize() {
        await this.root.finalize();
      }
      async processLine(line, isFinal) {
        let boundaries = this.boundaries;
        if (boundaries.length && line.length > 2 && line[0] === 45 && line[1] === 45) {
          for (let i = boundaries.length - 1; i >= 0; i--) {
            let boundary = boundaries[i];
            if (line.length < boundary.value.length + 2) {
              continue;
            }
            let boundaryMatches = true;
            for (let j = 0; j < boundary.value.length; j++) {
              if (line[j + 2] !== boundary.value[j]) {
                boundaryMatches = false;
                break;
              }
            }
            if (!boundaryMatches) {
              continue;
            }
            let boundaryEnd = boundary.value.length + 2;
            let isTerminator = false;
            if (line.length >= boundary.value.length + 4 && line[boundary.value.length + 2] === 45 && line[boundary.value.length + 3] === 45) {
              isTerminator = true;
              boundaryEnd = boundary.value.length + 4;
            }
            let hasValidTrailing = true;
            for (let j = boundaryEnd; j < line.length; j++) {
              if (line[j] !== 32 && line[j] !== 9) {
                hasValidTrailing = false;
                break;
              }
            }
            if (!hasValidTrailing) {
              continue;
            }
            if (isTerminator) {
              await boundary.node.finalize();
              this.currentNode = boundary.node.parentNode || this.root;
            } else {
              await boundary.node.finalizeChildNodes();
              this.currentNode = new MimeNode({
                postalMime: this,
                parentNode: boundary.node,
                parentMultipartType: boundary.node.contentType.multipart,
                ...this.mimeOptions
              });
            }
            if (isFinal) {
              return this.finalize();
            }
            return;
          }
        }
        this.currentNode.feed(line);
        if (isFinal) {
          return this.finalize();
        }
      }
      readLine() {
        let startPos = this.readPos;
        let endPos = this.readPos;
        while (this.readPos < this.av.length) {
          const c = this.av[this.readPos++];
          if (c !== 13 && c !== 10) {
            endPos = this.readPos;
          }
          if (c === 10) {
            return {
              bytes: new Uint8Array(this.buf, startPos, endPos - startPos),
              done: this.readPos >= this.av.length
            };
          }
        }
        return {
          bytes: new Uint8Array(this.buf, startPos, endPos - startPos),
          done: this.readPos >= this.av.length
        };
      }
      async processNodeTree() {
        let textContent = {};
        let textTypes = /* @__PURE__ */ new Set();
        let textMap = this.textMap = /* @__PURE__ */ new Map();
        let forceRfc822Attachments = this.forceRfc822Attachments();
        let walk = async (node, alternative, related) => {
          alternative = alternative || false;
          related = related || false;
          if (!node.contentType.multipart) {
            const inlineRfc822 = this.isInlineMessageRfc822(node) && !forceRfc822Attachments;
            const rfc822DepthExceeded = inlineRfc822 && this.rfc822NestingDepth >= this.maxRfc822NestingDepth;
            if (inlineRfc822 && !rfc822DepthExceeded) {
              const subParser = new PostalMime(
                {
                  // Only the limits are inherited. Options that decide how a part
                  // is classified stay with the parser that was configured.
                  ...this.mimeOptions,
                  maxRfc822NestingDepth: this.maxRfc822NestingDepth,
                  // attachments are encoded by the parent parser, keep raw buffers here
                  attachmentEncoding: "arraybuffer"
                },
                this.rfc822NestingDepth + 1
              );
              node.subMessage = await subParser.parse(node.content);
              if (!textMap.has(node)) {
                textMap.set(node, {});
              }
              let textEntry = textMap.get(node);
              if (node.subMessage.text || !node.subMessage.html) {
                textEntry.plain = textEntry.plain || [];
                textEntry.plain.push({ type: "subMessage", value: node.subMessage });
                textTypes.add("plain");
              }
              if (node.subMessage.html) {
                textEntry.html = textEntry.html || [];
                textEntry.html.push({ type: "subMessage", value: node.subMessage });
                textTypes.add("html");
              }
              if (subParser.textMap) {
                subParser.textMap.forEach((subTextEntry, subTextNode) => {
                  textMap.set(subTextNode, subTextEntry);
                });
              }
              for (let attachment of node.subMessage.attachments || []) {
                this.attachments.push(attachment);
              }
            } else if (this.isInlineTextNode(node)) {
              let textType = node.contentType.parsed.value.substr(node.contentType.parsed.value.indexOf("/") + 1);
              let selectorNode = alternative || node;
              if (!textMap.has(selectorNode)) {
                textMap.set(selectorNode, {});
              }
              let textEntry = textMap.get(selectorNode);
              textEntry[textType] = textEntry[textType] || [];
              textEntry[textType].push({ type: "text", value: node.getTextContent() });
              textTypes.add(textType);
            } else if (node.content) {
              const filename = node.contentDisposition?.parsed?.params?.filename || node.contentType.parsed.params.name || null;
              const attachment = {
                filename: filename ? decodeWords(filename) : null,
                mimeType: node.contentType.parsed.value,
                disposition: node.contentDisposition?.parsed?.value || null
              };
              if (related && node.contentId && !rfc822DepthExceeded) {
                attachment.related = true;
              }
              if (rfc822DepthExceeded) {
                attachment.rfc822DepthExceeded = true;
              }
              if (node.contentDescription) {
                attachment.description = node.contentDescription;
              }
              if (node.contentId) {
                attachment.contentId = node.contentId;
              }
              switch (node.contentType.parsed.value) {
                case "text/calendar":
                case "application/ics": {
                  if (node.contentType.parsed.params.method) {
                    attachment.method = node.contentType.parsed.params.method.toString().toUpperCase().trim();
                  }
                  const decodedText = node.getTextContent().replace(/\r?\n/g, "\n").replace(/\n*$/, "\n");
                  attachment.content = textEncoder.encode(decodedText);
                  break;
                }
                default:
                  attachment.content = node.content;
              }
              this.attachments.push(attachment);
            }
          } else if (node.contentType.multipart === "alternative") {
            alternative = node;
          } else if (node.contentType.multipart === "related") {
            related = node;
          }
          for (let childNode of node.childNodes) {
            await walk(childNode, alternative, related);
          }
        };
        await walk(this.root, false, false);
        textMap.forEach((mapEntry) => {
          textTypes.forEach((textType) => {
            if (!textContent[textType]) {
              textContent[textType] = [];
            }
            if (mapEntry[textType]) {
              mapEntry[textType].forEach((textEntry) => {
                switch (textEntry.type) {
                  case "text":
                    textContent[textType].push(textEntry.value);
                    break;
                  case "subMessage":
                    {
                      switch (textType) {
                        case "html":
                          textContent[textType].push(formatHtmlHeader(textEntry.value));
                          break;
                        case "plain":
                          textContent[textType].push(formatTextHeader(textEntry.value));
                          break;
                      }
                    }
                    break;
                }
              });
            } else {
              let alternativeType;
              switch (textType) {
                case "html":
                  alternativeType = "plain";
                  break;
                case "plain":
                  alternativeType = "html";
                  break;
              }
              (mapEntry[alternativeType] || []).forEach((textEntry) => {
                switch (textEntry.type) {
                  case "text":
                    switch (textType) {
                      case "html":
                        textContent[textType].push(textToHtml(textEntry.value));
                        break;
                      case "plain":
                        textContent[textType].push(htmlToText(textEntry.value));
                        break;
                    }
                    break;
                  case "subMessage":
                    {
                      switch (textType) {
                        case "html":
                          textContent[textType].push(formatHtmlHeader(textEntry.value));
                          break;
                        case "plain":
                          textContent[textType].push(formatTextHeader(textEntry.value));
                          break;
                      }
                    }
                    break;
                }
              });
            }
          });
        });
        Object.keys(textContent).forEach((textType) => {
          textContent[textType] = textContent[textType].join("\n");
        });
        this.textContent = textContent;
      }
      isInlineTextNode(node) {
        if (node.contentDisposition?.parsed?.value === "attachment") {
          return false;
        }
        switch (node.contentType.parsed?.value) {
          case "text/html":
          case "text/plain":
            return true;
          case "text/calendar":
          case "text/csv":
          default:
            return false;
        }
      }
      isInlineMessageRfc822(node) {
        if (node.contentType.parsed?.value !== "message/rfc822") {
          return false;
        }
        let disposition = node.contentDisposition?.parsed?.value || (this.options.rfc822Attachments ? "attachment" : "inline");
        return disposition === "inline";
      }
      // Check if this is a specially crafted report email where message/rfc822 content should not be inlined
      forceRfc822Attachments() {
        if (this.options.forceRfc822Attachments) {
          return true;
        }
        let forceRfc822Attachments = false;
        let walk = (node) => {
          if (!node.contentType.multipart) {
            if (node.contentType.parsed && ["message/delivery-status", "message/feedback-report"].includes(node.contentType.parsed.value)) {
              forceRfc822Attachments = true;
            }
          }
          for (let childNode of node.childNodes) {
            walk(childNode);
          }
        };
        walk(this.root);
        return forceRfc822Attachments;
      }
      async resolveStream(stream) {
        let chunkLen = 0;
        let chunks = [];
        const reader = stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          chunks.push(value);
          chunkLen += value.length;
        }
        const result = new Uint8Array(chunkLen);
        let chunkPointer = 0;
        for (let chunk of chunks) {
          result.set(chunk, chunkPointer);
          chunkPointer += chunk.length;
        }
        return result;
      }
      async parse(buf) {
        if (this.started) {
          throw new Error("Can not reuse parser, create a new PostalMime object");
        }
        this.started = true;
        if (buf && typeof buf.getReader === "function") {
          buf = await this.resolveStream(buf);
        }
        buf = buf || new ArrayBuffer(0);
        if (typeof buf === "string") {
          buf = textEncoder.encode(buf);
        }
        if (buf instanceof Blob || Object.prototype.toString.call(buf) === "[object Blob]") {
          buf = await blobToArrayBuffer(buf);
        }
        if (buf.buffer instanceof ArrayBuffer) {
          buf = new Uint8Array(buf).buffer;
        }
        this.buf = buf;
        this.av = new Uint8Array(buf);
        this.readPos = 0;
        while (this.readPos < this.av.length) {
          const line = this.readLine();
          await this.processLine(line.bytes, line.done);
        }
        await this.processNodeTree();
        const message = {
          headers: this.root.headers.map((entry) => ({ key: entry.key, originalKey: entry.originalKey, value: entry.value })).reverse()
        };
        for (const key of ["from", "sender"]) {
          const addressHeader = this.root.headers.find((line) => line.key === key);
          if (addressHeader && addressHeader.value) {
            const addresses = address_parser_default(addressHeader.value);
            if (addresses && addresses.length) {
              message[key] = addresses[0];
            }
          }
        }
        for (const key of ["delivered-to", "return-path"]) {
          const addressHeader = this.root.headers.find((line) => line.key === key);
          if (addressHeader && addressHeader.value) {
            const addresses = address_parser_default(addressHeader.value);
            if (addresses && addresses.length && addresses[0].address) {
              const camelKey = toCamelCase(key);
              message[camelKey] = addresses[0].address;
            }
          }
        }
        for (const key of ["to", "cc", "bcc", "reply-to"]) {
          const addressHeaders = this.root.headers.filter((line) => line.key === key);
          let addresses = [];
          addressHeaders.filter((entry) => entry && entry.value).map((entry) => address_parser_default(entry.value)).forEach((parsed) => addresses = addresses.concat(parsed || []));
          if (addresses && addresses.length) {
            const camelKey = toCamelCase(key);
            message[camelKey] = addresses;
          }
        }
        for (const key of ["subject", "message-id", "in-reply-to", "references"]) {
          const header = this.root.headers.find((line) => line.key === key);
          if (header && header.value) {
            const camelKey = toCamelCase(key);
            message[camelKey] = decodeWords(header.value);
          }
        }
        let dateHeader = this.root.headers.find((line) => line.key === "date");
        if (dateHeader) {
          let date = new Date(dateHeader.value);
          if (date.toString() === "Invalid Date") {
            date = dateHeader.value;
          } else {
            date = date.toISOString();
          }
          message.date = date;
        }
        if (this.textContent?.html) {
          message.html = this.textContent.html;
        }
        if (this.textContent?.plain) {
          message.text = this.textContent.plain;
        }
        message.attachments = this.attachments;
        message.headerLines = (this.root.rawHeaderLines || []).slice().reverse();
        switch (this.attachmentEncoding) {
          case "arraybuffer":
            break;
          case "base64":
            for (let attachment of message.attachments || []) {
              if (attachment?.content) {
                attachment.content = base64ArrayBuffer(attachment.content);
                attachment.encoding = "base64";
              }
            }
            break;
          case "utf8":
            let attachmentDecoder = new TextDecoder("utf8");
            for (let attachment of message.attachments || []) {
              if (attachment?.content) {
                attachment.content = attachmentDecoder.decode(attachment.content);
                attachment.encoding = "utf8";
              }
            }
            break;
          default:
            throw new Error("Unknown attachment encoding");
        }
        return message;
      }
    };
  }
});

// src/emailin.ts
var emailin_exports = {};
__export(emailin_exports, {
  firstAdminId: () => firstAdminId,
  handleEmail: () => handleEmail,
  scheduledCleanup: () => scheduledCleanup
});
async function handleEmail(message, env) {
  const to = message.to.toLowerCase();
  const [local, domainName] = to.split("@");
  if (!local || !domainName)
    return;
  const db = env.DB;
  const domain = await db.prepare("SELECT id, catch_all, active FROM domains WHERE name = ?").bind(domainName).first();
  let addr = await db.prepare("SELECT id, user_id, expires_at, forward_to, kind FROM addresses WHERE address = ?").bind(to).first();
  if (!addr && domain && domain.active && domain.catch_all) {
    const owner = await firstAdminId(env);
    if (owner) {
      const ttlHours = parseInt((await db.prepare("SELECT value FROM settings WHERE key='temp_ttl_default'").first())?.value ?? "24", 10) || 24;
      let localSafe = local.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 32);
      if (!localSafe || !/^[a-z0-9]/.test(localSafe))
        localSafe = randomLocalPart();
      let full = `${localSafe}@${domainName}`;
      const exists = await db.prepare("SELECT id FROM addresses WHERE address = ?").bind(full).first();
      if (exists) {
        addr = await db.prepare("SELECT id, user_id, expires_at, forward_to, kind FROM addresses WHERE address = ?").bind(full).first();
      } else {
        const id = uid("adr_");
        await db.prepare(
          "INSERT INTO addresses (id, user_id, domain_id, address, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(id, owner, domain.id, full, "temp", now() + ttlHours * 36e5, now()).run();
        addr = { id, user_id: owner, expires_at: now() + ttlHours * 36e5, forward_to: null, kind: "temp" };
      }
    }
  }
  if (!addr)
    return;
  const raw2 = new Uint8Array(await new Response(message.raw).arrayBuffer());
  let parsed;
  try {
    parsed = await PostalMime.parse(raw2);
  } catch {
    parsed = { subject: "(unparsable message)", text: "", html: "", from: { address: message.from }, attachments: [] };
  }
  const fromName = parsed.from?.name ?? null;
  const fromAddr = parsed.from?.address ?? message.from;
  const subject = parsed.subject ?? "(no subject)";
  const text = (parsed.text ?? "").slice(0, MAX_TEXT);
  const html = (parsed.html ?? "").slice(0, MAX_HTML);
  const preview = previewOf(text || stripHtml(html), 180);
  const emailId = uid("eml_");
  await db.prepare(
    `INSERT INTO emails (id, address_id, user_id, from_name, from_addr, to_addr, subject, preview, text_body, html_body, size, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    emailId,
    addr.id,
    addr.user_id,
    fromName,
    fromAddr,
    to,
    subject,
    preview,
    text,
    html,
    raw2.length,
    now()
  ).run();
  for (const att of (parsed.attachments ?? []).slice(0, 8)) {
    let bytes = null;
    const c0 = att.content;
    if (c0 instanceof Uint8Array)
      bytes = c0;
    else if (typeof c0 === "string")
      bytes = new TextEncoder().encode(c0);
    else if (c0 instanceof ArrayBuffer)
      bytes = new Uint8Array(c0);
    const b642 = bytes ? arrToB64(bytes) : null;
    await db.prepare(
      "INSERT INTO attachments (id, email_id, filename, content_type, size, content_b64) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(
      uid("att_"),
      emailId,
      att.filename ?? "attachment",
      att.mimeType ?? "application/octet-stream",
      bytes?.length ?? 0,
      b642 && b642.length <= MAX_ATTACHMENT_B64 ? b642 : null
    ).run();
  }
  await db.prepare("UPDATE addresses SET last_mail_at = ? WHERE id = ?").bind(now(), addr.id).run();
  const fwd = addr.forward_to;
  if (fwd) {
    try {
      await message.forward(fwd);
    } catch {
    }
  }
}
function arrToB64(u8) {
  let s = "";
  const chunk = 32768;
  for (let i = 0; i < u8.length; i += chunk) {
    s += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(s);
}
function stripHtml(html) {
  return html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
async function firstAdminId(env) {
  const row = await env.DB.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1").first();
  return row?.id ?? null;
}
async function scheduledCleanup(env) {
  const t = now();
  await env.DB.prepare(
    `DELETE FROM emails WHERE address_id IN (SELECT id FROM addresses WHERE kind='temp' AND expires_at IS NOT NULL AND expires_at < ?)`
  ).bind(t).run();
  await env.DB.prepare(`DELETE FROM addresses WHERE kind='temp' AND expires_at IS NOT NULL AND expires_at < ?`).bind(t).run();
  const days = parseInt((await env.DB.prepare("SELECT value FROM settings WHERE key='retention_days'").first())?.value ?? "0", 10);
  if (days > 0) {
    await env.DB.prepare("DELETE FROM emails WHERE received_at < ?").bind(t - days * 864e5).run();
  }
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(t).run();
  await env.DB.prepare("DELETE FROM auth_attempts WHERE window_start < ?").bind(t - 36e5).run();
}
var MAX_HTML, MAX_TEXT, MAX_ATTACHMENT_B64;
var init_emailin = __esm({
  "src/emailin.ts"() {
    "use strict";
    init_postal_mime();
    init_util();
    MAX_HTML = 9e5;
    MAX_TEXT = 4e5;
    MAX_ATTACHMENT_B64 = 9e5;
  }
});

// node_modules/hono/dist/request/constants.js
var GET_MATCH_RESULT = Symbol();

// node_modules/hono/dist/utils/buffer.js
var bufferToFormData = (arrayBuffer, contentType) => {
  return new Response(arrayBuffer, { headers: { "Content-Type": contentType.replace(/^[^;]+/, (mediaType) => mediaType.toLowerCase()) } }).formData();
};

// node_modules/hono/dist/utils/body.js
var MAX_NESTED_OBJECTS = 1e4;
var isRawRequest = (request) => "headers" in request;
var parseBody = async (request, options = /* @__PURE__ */ Object.create(null)) => {
  const { all = false, dot = false } = options;
  const mediaType = (isRawRequest(request) ? request.headers : request.raw.headers).get("Content-Type")?.split(";")[0].trim().toLowerCase();
  if (mediaType === "multipart/form-data" || mediaType === "application/x-www-form-urlencoded")
    return parseFormData(request, {
      all,
      dot
    });
  return {};
};
async function parseFormData(request, options) {
  if (!isRawRequest(request) && request.bodyCache.formData)
    return convertFormDataToBodyData(await request.bodyCache.formData, options);
  const headers = isRawRequest(request) ? request.headers : request.raw.headers;
  const arrayBuffer = await request.arrayBuffer();
  const formDataPromise = bufferToFormData(arrayBuffer, headers.get("Content-Type") || "");
  if (!isRawRequest(request))
    request.bodyCache.formData = formDataPromise;
  const formData = await formDataPromise;
  if (formData)
    return convertFormDataToBodyData(formData, options);
  return {};
}
function convertFormDataToBodyData(formData, options) {
  const form = /* @__PURE__ */ Object.create(null);
  const nestingState = { count: 0 };
  formData.forEach((value, key) => {
    if (!(options.all || key.endsWith("[]")))
      form[key] = value;
    else
      handleParsingAllValues(form, key, value);
  });
  if (options.dot)
    Object.entries(form).forEach(([key, value]) => {
      if (key.includes(".")) {
        handleParsingNestedValues(form, key, value, nestingState);
        delete form[key];
      }
    });
  return form;
}
var handleParsingAllValues = (form, key, value) => {
  if (form[key] !== void 0) {
    if (Array.isArray(form[key]))
      form[key].push(value);
    else
      form[key] = [form[key], value];
  } else if (!key.endsWith("[]"))
    form[key] = value;
  else
    form[key] = [value];
};
var handleParsingNestedValues = (form, key, value, state) => {
  if (/(?:^|\.)__proto__\./.test(key))
    return;
  let nestedForm = form;
  const keys = key.split(".", 34);
  if (keys.length > 33)
    throwNestingLimitExceeded();
  keys.forEach((key2, index) => {
    if (index === keys.length - 1)
      nestedForm[key2] = value;
    else {
      if (!nestedForm[key2] || typeof nestedForm[key2] !== "object" || Array.isArray(nestedForm[key2]) || nestedForm[key2] instanceof File) {
        if (state.count++ >= MAX_NESTED_OBJECTS)
          throwNestingLimitExceeded();
        nestedForm[key2] = /* @__PURE__ */ Object.create(null);
      }
      nestedForm = nestedForm[key2];
    }
  });
};
var throwNestingLimitExceeded = () => {
  throw new Error("Nesting limit exceeded");
};

// node_modules/hono/dist/utils/url.js
var splitPath = (path) => {
  const paths = path.split("/");
  if (paths[0] === "")
    paths.shift();
  return paths;
};
var splitRoutingPath = (routePath) => {
  const { groups, path } = extractGroupsFromPath(routePath);
  const paths = splitPath(path);
  return replaceGroupMarks(paths, groups);
};
var extractGroupsFromPath = (path) => {
  const groups = [];
  path = path.replace(/\{[^}]+\}/g, (match2, index) => {
    const mark = `@${index}`;
    groups.push([mark, match2]);
    return mark;
  });
  return {
    groups,
    path
  };
};
var replaceGroupMarks = (paths, groups) => {
  for (let i = groups.length - 1; i >= 0; i--) {
    const [mark] = groups[i];
    for (let j = paths.length - 1; j >= 0; j--)
      if (paths[j].includes(mark)) {
        paths[j] = paths[j].replace(mark, groups[i][1]);
        break;
      }
  }
  return paths;
};
var patternCache = {};
var getPattern = (label, next) => {
  if (label === "*")
    return "*";
  const match2 = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (match2) {
    const cacheKey = `${label}#${next}`;
    if (!patternCache[cacheKey]) {
      if (match2[2])
        patternCache[cacheKey] = next && next[0] !== ":" && next[0] !== "*" ? [
          cacheKey,
          match2[1],
          new RegExp(`^${match2[2]}(?=/${next})`)
        ] : [
          label,
          match2[1],
          new RegExp(`^${match2[2]}$`)
        ];
      else
        patternCache[cacheKey] = [
          label,
          match2[1],
          true
        ];
    }
    return patternCache[cacheKey];
  }
  return null;
};
var tryDecode = (str2, decoder) => {
  try {
    return decoder(str2);
  } catch {
    return str2.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match2) => {
      try {
        return decoder(match2);
      } catch {
        return match2;
      }
    });
  }
};
var tryDecodeURI = (str2) => tryDecode(str2, decodeURI);
var getPath = (request) => {
  const url = request.url;
  const start = url.indexOf("/", url.indexOf(":") + 4);
  let i = start;
  for (; i < url.length; i++) {
    const charCode = url.charCodeAt(i);
    if (charCode === 37) {
      const queryIndex = url.indexOf("?", i);
      const hashIndex = url.indexOf("#", i);
      const end = queryIndex === -1 ? hashIndex === -1 ? void 0 : hashIndex : hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex);
      const path = url.slice(start, end);
      return tryDecodeURI(path.includes("%25") ? path.replace(/%25/g, "%2525") : path);
    } else if (charCode === 63 || charCode === 35)
      break;
  }
  return url.slice(start, i);
};
var getPathNoStrict = (request) => {
  const result = getPath(request);
  return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
};
var mergePath = (base, sub, ...rest) => {
  if (rest.length)
    sub = mergePath(sub, ...rest);
  return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
};
var checkOptionalParameter = (path) => {
  if (path.charCodeAt(path.length - 1) !== 63 || !path.includes(":"))
    return null;
  const segments = path.split("/");
  const results = [];
  let basePath = "";
  segments.forEach((segment) => {
    if (segment !== "" && !/\:/.test(segment))
      basePath += "/" + segment;
    else if (/\:/.test(segment)) {
      if (segment.charCodeAt(segment.length - 1) === 63) {
        if (results.length === 0 && basePath === "")
          results.push("/");
        else
          results.push(basePath);
        const optionalSegment = segment.slice(0, -1);
        basePath += "/" + optionalSegment;
        results.push(basePath);
      } else
        basePath += "/" + segment;
    }
  });
  return results.filter((v, i, a) => a.indexOf(v) === i);
};
var tryDecodeURIComponent = (str2) => str2.indexOf("%") !== -1 ? tryDecode(str2, decodeURIComponent_) : str2;
var _decodeURI = (value) => {
  if (value.indexOf("+") !== -1)
    value = value.replace(/\+/g, " ");
  return tryDecodeURIComponent(value);
};
var _getQueryParam = (url, key, multiple) => {
  const hashIndex = url.indexOf("#", 8);
  if (hashIndex !== -1)
    url = url.slice(0, hashIndex);
  let encoded;
  if (!multiple && key && key.indexOf("%") === -1 && key.indexOf("+") === -1) {
    let keyIndex2 = url.indexOf("?", 8);
    if (keyIndex2 === -1)
      return;
    if (!url.startsWith(key, keyIndex2 + 1))
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    while (keyIndex2 !== -1) {
      const trailingKeyCode = url.charCodeAt(keyIndex2 + key.length + 1);
      if (trailingKeyCode === 61) {
        const valueIndex = keyIndex2 + key.length + 2;
        const endIndex = url.indexOf("&", valueIndex);
        return _decodeURI(url.slice(valueIndex, endIndex === -1 ? void 0 : endIndex));
      } else if (trailingKeyCode == 38 || isNaN(trailingKeyCode))
        return "";
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    encoded = /[%+]/.test(url);
    if (!encoded)
      return;
  }
  const results = /* @__PURE__ */ Object.create(null);
  encoded ??= /[%+]/.test(url);
  let keyIndex = url.indexOf("?", 8);
  while (keyIndex !== -1) {
    const nextKeyIndex = url.indexOf("&", keyIndex + 1);
    let valueIndex = url.indexOf("=", keyIndex);
    if (valueIndex > nextKeyIndex && nextKeyIndex !== -1)
      valueIndex = -1;
    let name = url.slice(keyIndex + 1, valueIndex === -1 ? nextKeyIndex === -1 ? void 0 : nextKeyIndex : valueIndex);
    if (encoded)
      name = _decodeURI(name);
    keyIndex = nextKeyIndex;
    if (name === "")
      continue;
    let value;
    if (valueIndex === -1)
      value = "";
    else {
      value = url.slice(valueIndex + 1, nextKeyIndex === -1 ? void 0 : nextKeyIndex);
      if (encoded)
        value = _decodeURI(value);
    }
    if (multiple) {
      if (!(results[name] && Array.isArray(results[name])))
        results[name] = [];
      results[name].push(value);
    } else
      results[name] ??= value;
  }
  return key ? results[key] : results;
};
var getQueryParam = _getQueryParam;
var getQueryParams = (url, key) => {
  return _getQueryParam(url, key, true);
};
var decodeURIComponent_ = decodeURIComponent;

// node_modules/hono/dist/request.js
var HonoRequest = class {
  /**
  * `.raw` can get the raw Request object.
  *
  * @see {@link https://hono.dev/docs/api/request#raw}
  *
  * @example
  * ```ts
  * // For Cloudflare Workers
  * app.post('/', async (c) => {
  *   const metadata = c.req.raw.cf?.hostMetadata?
  *   ...
  * })
  * ```
  */
  raw;
  #validatedData;
  #matchResult;
  routeIndex = 0;
  /**
  * `.path` can get the pathname of the request.
  *
  * @see {@link https://hono.dev/docs/api/request#path}
  *
  * @example
  * ```ts
  * app.get('/about/me', (c) => {
  *   const pathname = c.req.path // `/about/me`
  * })
  * ```
  */
  path;
  bodyCache = {};
  constructor(request, path = "/", matchResult = [[]]) {
    this.raw = request;
    this.path = path;
    this.#matchResult = matchResult;
  }
  param(key) {
    return key ? this.#getDecodedParam(key) : this.#getAllDecodedParams();
  }
  #getDecodedParam(key) {
    const paramKey = this.#matchResult[0][this.routeIndex]?.[1][key];
    const param = this.#getParamValue(paramKey);
    return param && tryDecodeURIComponent(param);
  }
  #getAllDecodedParams() {
    const decoded = {};
    const keys = Object.keys(this.#matchResult[0][this.routeIndex]?.[1] ?? {});
    for (const key of keys) {
      const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key]);
      if (value !== void 0)
        decoded[key] = tryDecodeURIComponent(value);
    }
    return decoded;
  }
  #getParamValue(paramKey) {
    return this.#matchResult[1] ? this.#matchResult[1][paramKey] : paramKey;
  }
  query(key) {
    return getQueryParam(this.url, key);
  }
  queries(key) {
    return getQueryParams(this.url, key);
  }
  header(name) {
    if (name)
      return this.raw.headers.get(name) ?? void 0;
    const headerData = /* @__PURE__ */ Object.create(null);
    this.raw.headers.forEach((value, key) => {
      headerData[key] = value;
    });
    return headerData;
  }
  async parseBody(options) {
    return parseBody(this, options);
  }
  #cachedBody = (key) => {
    const { bodyCache, raw: raw2 } = this;
    const cachedBody = bodyCache[key];
    if (cachedBody)
      return cachedBody;
    for (const anyCachedKey in bodyCache)
      return bodyCache[anyCachedKey].then((body) => {
        if (anyCachedKey === "json")
          body = JSON.stringify(body);
        const contentType = anyCachedKey === "formData" ? void 0 : raw2.headers.get("content-type");
        return new Response(body, { headers: contentType ? { "Content-Type": contentType } : void 0 })[key]();
      });
    return bodyCache[key] = raw2[key]();
  };
  /**
  * `.json()` can parse Request body of type `application/json`
  *
  * @see {@link https://hono.dev/docs/api/request#json}
  *
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.json()
  * })
  * ```
  */
  json() {
    return this.#cachedBody("text").then((text) => JSON.parse(text));
  }
  /**
  * `.text()` can parse Request body of type `text/plain`
  *
  * @see {@link https://hono.dev/docs/api/request#text}
  *
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.text()
  * })
  * ```
  */
  text() {
    return this.#cachedBody("text");
  }
  /**
  * `.arrayBuffer()` parse Request body as an `ArrayBuffer`
  *
  * @see {@link https://hono.dev/docs/api/request#arraybuffer}
  *
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.arrayBuffer()
  * })
  * ```
  */
  arrayBuffer() {
    return this.#cachedBody("arrayBuffer");
  }
  /**
  * `.bytes()` parses the request body as a `Uint8Array`.
  *
  * @see {@link https://hono.dev/docs/api/request#bytes}
  *
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.bytes()
  * })
  * ```
  */
  bytes() {
    return this.#cachedBody("arrayBuffer").then((buffer) => new Uint8Array(buffer));
  }
  /**
  * Parses the request body as a `Blob`.
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.blob();
  * });
  * ```
  * @see https://hono.dev/docs/api/request#blob
  */
  blob() {
    return this.#cachedBody("blob");
  }
  /**
  * Parses the request body as `FormData`.
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.formData();
  * });
  * ```
  * @see https://hono.dev/docs/api/request#formdata
  */
  formData() {
    return this.#cachedBody("formData");
  }
  /**
  * Adds validated data to the request.
  *
  * @param target - The target of the validation.
  * @param data - The validated data to add.
  */
  addValidatedData(target, data) {
    (this.#validatedData ??= {})[target] = data;
  }
  valid(target) {
    return this.#validatedData?.[target];
  }
  /**
  * `.url` can get the request url strings.
  *
  * @see {@link https://hono.dev/docs/api/request#url}
  *
  * @example
  * ```ts
  * app.get('/about/me', (c) => {
  *   const url = c.req.url // `http://localhost:8787/about/me`
  *   ...
  * })
  * ```
  */
  get url() {
    return this.raw.url;
  }
  /**
  * `.method` can get the method name of the request.
  *
  * @see {@link https://hono.dev/docs/api/request#method}
  *
  * @example
  * ```ts
  * app.get('/about/me', (c) => {
  *   const method = c.req.method // `GET`
  * })
  * ```
  */
  get method() {
    return this.raw.method;
  }
  get [GET_MATCH_RESULT]() {
    return this.#matchResult;
  }
  /**
  * `.matchedRoutes` can return a matched route in the handler
  *
  * @deprecated
  *
  * Use matchedRoutes helper defined in "hono/route" instead.
  *
  * @see {@link https://hono.dev/docs/api/request#matchedroutes}
  *
  * @example
  * ```ts
  * app.use('*', async function logger(c, next) {
  *   await next()
  *   c.req.matchedRoutes.forEach(({ handler, method, path }, i) => {
  *     const name = handler.name || (handler.length < 2 ? '[handler]' : '[middleware]')
  *     console.log(
  *       method,
  *       ' ',
  *       path,
  *       ' '.repeat(Math.max(10 - path.length, 0)),
  *       name,
  *       i === c.req.routeIndex ? '<- respond from here' : ''
  *     )
  *   })
  * })
  * ```
  */
  get matchedRoutes() {
    return this.#matchResult[0].map(([[, route]]) => route);
  }
  /**
  * `.routePath` can retrieve the path registered within the handler
  *
  * @deprecated
  *
  * Use routePath helper defined in "hono/route" instead.
  *
  * @see {@link https://hono.dev/docs/api/request#routepath}
  *
  * @example
  * ```ts
  * app.get('/posts/:id', (c) => {
  *   return c.json({ path: c.req.routePath })
  * })
  * ```
  */
  get routePath() {
    return this.#matchResult[0].map(([[, route]]) => route)[this.routeIndex].path;
  }
};

// node_modules/hono/dist/utils/html.js
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw = (value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
};
var resolveCallback = async (str2, phase, preserveCallbacks, context, buffer) => {
  if (typeof str2 === "object" && !(str2 instanceof String)) {
    if (!(str2 instanceof Promise))
      str2 = str2.toString();
    if (str2 instanceof Promise)
      str2 = await str2;
  }
  const callbacks = str2.callbacks;
  if (!callbacks?.length)
    return Promise.resolve(str2);
  if (buffer)
    buffer[0] += str2;
  else
    buffer = [str2];
  const resStr = Promise.all(callbacks.map((c) => c({
    phase,
    buffer,
    context
  }))).then((res) => Promise.all(res.filter(Boolean).map((str3) => resolveCallback(str3, phase, false, context, buffer))).then(() => buffer[0]));
  if (preserveCallbacks)
    return raw(await resStr, callbacks);
  else
    return resStr;
};

// node_modules/hono/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8";
var setDefaultContentType = (contentType, headers) => {
  return {
    "Content-Type": contentType,
    ...headers
  };
};
var createResponseInstance = (body, init) => new Response(body, init);
var Context = class {
  #rawRequest;
  #req;
  /**
  * `.env` can get bindings (environment variables, secrets, KV namespaces, D1 database, R2 bucket etc.) in Cloudflare Workers.
  *
  * @see {@link https://hono.dev/docs/api/context#env}
  *
  * @example
  * ```ts
  * // Environment object for Cloudflare Workers
  * app.get('*', async c => {
  *   const counter = c.env.COUNTER
  * })
  * ```
  */
  env = {};
  #var;
  finalized = false;
  /**
  * `.error` can get the error object from the middleware if the Handler throws an error.
  *
  * @see {@link https://hono.dev/docs/api/context#error}
  *
  * @example
  * ```ts
  * app.use('*', async (c, next) => {
  *   await next()
  *   if (c.error) {
  *     // do something...
  *   }
  * })
  * ```
  */
  error;
  #status;
  #executionCtx;
  #res;
  #layout;
  #renderer;
  #notFoundHandler;
  #preparedHeaders;
  #matchResult;
  #path;
  /**
  * Creates an instance of the Context class.
  *
  * @param req - The Request object.
  * @param options - Optional configuration options for the context.
  */
  constructor(req, options) {
    this.#rawRequest = req;
    if (options) {
      this.#executionCtx = options.executionCtx;
      this.env = options.env;
      this.#notFoundHandler = options.notFoundHandler;
      this.#path = options.path;
      this.#matchResult = options.matchResult;
    }
  }
  /**
  * `.req` is the instance of {@link HonoRequest}.
  */
  get req() {
    this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult);
    return this.#req;
  }
  /**
  * @see {@link https://hono.dev/docs/api/context#event}
  * The FetchEvent associated with the current request.
  *
  * @throws Will throw an error if the context does not have a FetchEvent.
  */
  get event() {
    if (this.#executionCtx && "respondWith" in this.#executionCtx)
      return this.#executionCtx;
    else
      throw Error("This context has no FetchEvent");
  }
  /**
  * @see {@link https://hono.dev/docs/api/context#executionctx}
  * The ExecutionContext associated with the current request.
  *
  * @throws Will throw an error if the context does not have an ExecutionContext.
  */
  get executionCtx() {
    if (this.#executionCtx)
      return this.#executionCtx;
    else
      throw Error("This context has no ExecutionContext");
  }
  /**
  * @see {@link https://hono.dev/docs/api/context#res}
  * The Response object for the current request.
  */
  get res() {
    return this.#res ||= createResponseInstance(null, { headers: this.#preparedHeaders ??= new Headers() });
  }
  /**
  * Sets the Response object for the current request.
  *
  * @param _res - The Response object to set.
  */
  set res(_res) {
    if (this.#res && _res) {
      _res = createResponseInstance(_res.body, _res);
      for (const [k, v] of this.#res.headers.entries()) {
        if (k === "content-type")
          continue;
        if (k === "set-cookie") {
          const cookies = this.#res.headers.getSetCookie();
          _res.headers.delete("set-cookie");
          for (const cookie of cookies)
            _res.headers.append("set-cookie", cookie);
        } else
          _res.headers.set(k, v);
      }
    }
    this.#res = _res;
    this.finalized = true;
  }
  /**
  * `.render()` can create a response within a layout.
  *
  * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
  *
  * @example
  * ```ts
  * app.get('/', (c) => {
  *   return c.render('Hello!')
  * })
  * ```
  */
  render = (...args) => {
    this.#renderer ??= (content) => this.html(content);
    return this.#renderer(...args);
  };
  /**
  * Sets the layout for the response.
  *
  * @param layout - The layout to set.
  * @returns The layout function.
  */
  setLayout = (layout) => this.#layout = layout;
  /**
  * Gets the current layout for the response.
  *
  * @returns The current layout function.
  */
  getLayout = () => this.#layout;
  /**
  * `.setRenderer()` can set the layout in the custom middleware.
  *
  * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
  *
  * @example
  * ```tsx
  * app.use('*', async (c, next) => {
  *   c.setRenderer((content) => {
  *     return c.html(
  *       <html>
  *         <body>
  *           <p>{content}</p>
  *         </body>
  *       </html>
  *     )
  *   })
  *   await next()
  * })
  * ```
  */
  setRenderer = (renderer) => {
    this.#renderer = renderer;
  };
  /**
  * `.header()` can set headers.
  *
  * @see {@link https://hono.dev/docs/api/context#header}
  *
  * @example
  * ```ts
  * app.get('/welcome', (c) => {
  *   // Set headers
  *   c.header('X-Message', 'Hello!')
  *   c.header('Content-Type', 'text/plain')
  *
  *   // Append multiple headers using the append option (e.g. Vary)
  *   c.header('Vary', 'Accept-Encoding', { append: true })
  *   c.header('Vary', 'User-Agent', { append: true })
  *
  *   return c.body('Thank you for coming')
  * })
  * ```
  */
  header = (name, value, options) => {
    if (this.finalized)
      this.#res = createResponseInstance(this.#res.body, this.#res);
    const headers = this.#res ? this.#res.headers : this.#preparedHeaders ??= new Headers();
    if (value === void 0)
      headers.delete(name);
    else if (options?.append)
      headers.append(name, value);
    else
      headers.set(name, value);
  };
  status = (status) => {
    this.#status = status;
  };
  /**
  * `.set()` can set the value specified by the key.
  *
  * @see {@link https://hono.dev/docs/api/context#set-get}
  *
  * @example
  * ```ts
  * app.use('*', async (c, next) => {
  *   c.set('message', 'Hono is hot!!')
  *   await next()
  * })
  * ```
  */
  set = (key, value) => {
    this.#var ??= /* @__PURE__ */ new Map();
    this.#var.set(key, value);
  };
  /**
  * `.get()` can use the value specified by the key.
  *
  * @see {@link https://hono.dev/docs/api/context#set-get}
  *
  * @example
  * ```ts
  * app.get('/', (c) => {
  *   const message = c.get('message')
  *   return c.text(`The message is "${message}"`)
  * })
  * ```
  */
  get = (key) => {
    return this.#var ? this.#var.get(key) : void 0;
  };
  /**
  * `.var` can access the value of a variable.
  *
  * @see {@link https://hono.dev/docs/api/context#var}
  *
  * @example
  * ```ts
  * const result = c.var.client.oneMethod()
  * ```
  */
  get var() {
    if (!this.#var)
      return {};
    return Object.fromEntries(this.#var);
  }
  #newResponse(data, arg, headers) {
    let responseHeaders = this.#res ? new Headers(this.#res.headers) : this.#preparedHeaders;
    if (typeof arg === "object" && arg.headers) {
      responseHeaders ??= new Headers();
      for (const [key, value] of new Headers(arg.headers))
        if (key === "set-cookie")
          responseHeaders.append(key, value);
        else
          responseHeaders.set(key, value);
    }
    if (headers) {
      if (!responseHeaders) {
        let count = 0;
        for (const k in headers)
          if (++count > 1 || typeof headers[k] !== "string") {
            responseHeaders = new Headers();
            break;
          }
      }
      if (responseHeaders)
        for (const k in headers) {
          const v = headers[k];
          if (typeof v === "string")
            responseHeaders.set(k, v);
          else {
            responseHeaders.delete(k);
            for (const v2 of v)
              responseHeaders.append(k, v2);
          }
        }
    }
    const status = typeof arg === "number" ? arg : arg?.status ?? this.#status;
    return createResponseInstance(data, {
      status,
      headers: responseHeaders ?? headers
    });
  }
  newResponse = (...args) => this.#newResponse(...args);
  /**
  * `.body()` can return the HTTP response.
  * You can set headers with `.header()` and set HTTP status code with `.status`.
  * This can also be set in `.text()`, `.json()` and so on.
  *
  * @see {@link https://hono.dev/docs/api/context#body}
  *
  * @example
  * ```ts
  * app.get('/welcome', (c) => {
  *   // Set headers
  *   c.header('X-Message', 'Hello!')
  *   c.header('Content-Type', 'text/plain')
  *   // Set HTTP status code
  *   c.status(201)
  *
  *   // Return the response body
  *   return c.body('Thank you for coming')
  * })
  * ```
  */
  body = (data, arg, headers) => this.#newResponse(data, arg, headers);
  /**
  * `.text()` can render text as `Content-Type:text/plain`.
  *
  * @see {@link https://hono.dev/docs/api/context#text}
  *
  * @example
  * ```ts
  * app.get('/say', (c) => {
  *   return c.text('Hello!')
  * })
  * ```
  */
  text = (text, arg, headers) => {
    return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized ? new Response(text) : this.#newResponse(text, arg, setDefaultContentType(TEXT_PLAIN, headers));
  };
  /**
  * `.json()` can render JSON as `Content-Type:application/json`.
  *
  * @see {@link https://hono.dev/docs/api/context#json}
  *
  * @example
  * ```ts
  * app.get('/api', (c) => {
  *   return c.json({ message: 'Hello!' })
  * })
  * ```
  */
  json = (object, arg, headers) => {
    return this.#newResponse(JSON.stringify(object), arg, setDefaultContentType("application/json", headers));
  };
  html = (html, arg, headers) => {
    const res = (html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers));
    return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
  };
  /**
  * `.redirect()` can Redirect, default status code is 302.
  *
  * @see {@link https://hono.dev/docs/api/context#redirect}
  *
  * @example
  * ```ts
  * app.get('/redirect', (c) => {
  *   return c.redirect('/')
  * })
  * app.get('/redirect-permanently', (c) => {
  *   return c.redirect('/', 301)
  * })
  * ```
  */
  redirect = (location, status) => {
    const locationString = String(location);
    this.header("Location", !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString));
    return this.newResponse(null, status ?? 302);
  };
  /**
  * `.notFound()` can return the Not Found Response.
  *
  * @see {@link https://hono.dev/docs/api/context#notfound}
  *
  * @example
  * ```ts
  * app.get('/notfound', (c) => {
  *   return c.notFound()
  * })
  * ```
  */
  notFound = () => {
    this.#notFoundHandler ??= () => createResponseInstance();
    return this.#notFoundHandler(this);
  };
};

// node_modules/hono/dist/compose.js
var compose = (middleware, onError, onNotFound) => {
  return (context, next) => {
    let index = -1;
    return dispatch(0);
    async function dispatch(i) {
      if (i <= index)
        throw new Error("next() called multiple times");
      index = i;
      let res;
      let isError = false;
      let handler;
      if (middleware[i]) {
        handler = middleware[i][0][0];
        context.req.routeIndex = i;
      } else
        handler = i === middleware.length && next || void 0;
      if (handler)
        try {
          res = await handler(context, () => dispatch(i + 1));
        } catch (err) {
          if (err instanceof Error && onError) {
            context.error = err;
            res = await onError(err, context);
            isError = true;
          } else
            throw err;
        }
      else if (context.finalized === false && onNotFound)
        res = await onNotFound(context);
      if (res && (context.finalized === false || isError))
        context.res = res;
      return context;
    }
  };
};

// node_modules/hono/dist/router.js
var METHODS = [
  "get",
  "post",
  "put",
  "delete",
  "options",
  "patch",
  "query"
];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = class extends Error {
};

// node_modules/hono/dist/utils/constants.js
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";

// node_modules/hono/dist/hono-base.js
var notFoundHandler = (c) => {
  return c.text("404 Not Found", 404);
};
var errorHandler = (err, c) => {
  if ("getResponse" in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text("Internal Server Error", 500);
};
var Hono = class Hono2 {
  get;
  post;
  put;
  delete;
  options;
  patch;
  query;
  all;
  on;
  use;
  router;
  getPath;
  _basePath = "/";
  #path = "/";
  routes = [];
  constructor(options = {}) {
    [...METHODS, "all"].forEach((method) => {
      this[method] = (args1, ...args) => {
        const methodName = method.toUpperCase();
        if (typeof args1 === "string")
          this.#path = args1;
        else
          this.#addRoute(methodName, this.#path, args1);
        args.forEach((handler) => {
          this.#addRoute(methodName, this.#path, handler);
        });
        return this;
      };
    });
    this.on = (method, path, ...handlers) => {
      for (const p of [path].flat()) {
        this.#path = p;
        for (const m of [method].flat()) {
          const methodName = m.toUpperCase();
          for (const handler of handlers)
            this.#addRoute(methodName, this.#path, handler);
        }
      }
      return this;
    };
    this.use = (arg1, ...handlers) => {
      if (typeof arg1 === "string")
        this.#path = arg1;
      else {
        this.#path = "*";
        handlers.unshift(arg1);
      }
      handlers.forEach((handler) => {
        this.#addRoute("ALL", this.#path, handler);
      });
      return this;
    };
    const { strict, ...optionsWithoutStrict } = options;
    Object.assign(this, optionsWithoutStrict);
    this.getPath = strict ?? true ? options.getPath ?? getPath : getPathNoStrict;
  }
  #clone() {
    const clone = new Hono2({
      router: this.router,
      getPath: this.getPath
    });
    clone.errorHandler = this.errorHandler;
    clone.#notFoundHandler = this.#notFoundHandler;
    clone.routes = this.routes;
    return clone;
  }
  #notFoundHandler = notFoundHandler;
  errorHandler = errorHandler;
  /**
  * `.route()` allows grouping other Hono instance in routes.
  *
  * @see {@link https://hono.dev/docs/api/routing#grouping}
  *
  * @param {string} path - base Path
  * @param {Hono} app - other Hono instance
  * @returns {Hono} routed Hono instance
  *
  * @example
  * ```ts
  * const app = new Hono()
  * const app2 = new Hono()
  *
  * app2.get("/user", (c) => c.text("user"))
  * app.route("/api", app2) // GET /api/user
  * ```
  */
  route(path, app8) {
    const subApp = this.basePath(path);
    app8.routes.map((r) => {
      let handler;
      if (app8.errorHandler === errorHandler)
        handler = r.handler;
      else {
        handler = async (c, next) => (await compose([], app8.errorHandler)(c, () => r.handler(c, next))).res;
        handler[COMPOSED_HANDLER] = r.handler;
      }
      subApp.#addRoute(r.method, r.path, handler, r.basePath);
    });
    return this;
  }
  /**
  * `.basePath()` allows base paths to be specified.
  *
  * @see {@link https://hono.dev/docs/api/routing#base-path}
  *
  * @param {string} path - base Path
  * @returns {Hono} changed Hono instance
  *
  * @example
  * ```ts
  * const api = new Hono().basePath('/api')
  * ```
  */
  basePath(path) {
    const subApp = this.#clone();
    subApp._basePath = mergePath(this._basePath, path);
    return subApp;
  }
  /**
  * `.onError()` handles an error and returns a customized Response.
  *
  * @see {@link https://hono.dev/docs/api/hono#error-handling}
  *
  * @param {ErrorHandler} handler - request Handler for error
  * @returns {Hono} changed Hono instance
  *
  * @example
  * ```ts
  * app.onError((err, c) => {
  *   console.error(`${err}`)
  *   return c.text('Custom Error Message', 500)
  * })
  * ```
  */
  onError = (handler) => {
    this.errorHandler = handler;
    return this;
  };
  /**
  * `.notFound()` allows you to customize a Not Found Response.
  *
  * @see {@link https://hono.dev/docs/api/hono#not-found}
  *
  * @param {NotFoundHandler} handler - request handler for not-found
  * @returns {Hono} changed Hono instance
  *
  * @example
  * ```ts
  * app.notFound((c) => {
  *   return c.text('Custom 404 Message', 404)
  * })
  * ```
  */
  notFound = (handler) => {
    this.#notFoundHandler = handler;
    return this;
  };
  /**
  * `.mount()` allows you to mount applications built with other frameworks into your Hono application.
  *
  * @deprecated Use `mount()` from `hono/mount` instead. `.mount()` will be removed in v5.
  *
  * @see {@link https://hono.dev/docs/api/hono#mount}
  *
  * @param {string} path - base Path
  * @param {Function} applicationHandler - other Request Handler
  * @param {MountOptions} [options] - options of `.mount()`
  * @returns {Hono} mounted Hono instance
  *
  * @example
  * ```ts
  * import { Router as IttyRouter } from 'itty-router'
  * import { Hono } from 'hono'
  * // Create itty-router application
  * const ittyRouter = IttyRouter()
  * // GET /itty-router/hello
  * ittyRouter.get('/hello', () => new Response('Hello from itty-router'))
  *
  * const app = new Hono()
  * app.mount('/itty-router', ittyRouter.handle)
  * ```
  *
  * @example
  * ```ts
  * const app = new Hono()
  * // Send the request to another application without modification.
  * app.mount('/app', anotherApp, {
  *   replaceRequest: (req) => req,
  * })
  * ```
  */
  mount(path, applicationHandler, options) {
    let replaceRequest;
    let optionHandler;
    if (options) {
      if (typeof options === "function")
        optionHandler = options;
      else {
        optionHandler = options.optionHandler;
        if (options.replaceRequest === false)
          replaceRequest = (request) => request;
        else
          replaceRequest = options.replaceRequest;
      }
    }
    const getOptions = optionHandler ? (c) => {
      const options2 = optionHandler(c);
      return Array.isArray(options2) ? options2 : [options2];
    } : (c) => {
      let executionContext = void 0;
      try {
        executionContext = c.executionCtx;
      } catch {
      }
      return [c.env, executionContext];
    };
    replaceRequest ||= (() => {
      const mergedPath = mergePath(this._basePath, path);
      const pathPrefixLength = mergedPath === "/" ? 0 : mergedPath.length;
      return (request) => {
        const url = new URL(request.url);
        url.pathname = this.getPath(request).slice(pathPrefixLength) || "/";
        return new Request(url, request);
      };
    })();
    const handler = async (c, next) => {
      const res = await applicationHandler(replaceRequest(c.req.raw), ...getOptions(c));
      if (res)
        return res;
      await next();
    };
    this.#addRoute("ALL", mergePath(path, "*"), handler);
    return this;
  }
  #addRoute(method, path, handler, baseRoutePath) {
    path = mergePath(this._basePath, path);
    const r = {
      basePath: baseRoutePath !== void 0 ? mergePath(this._basePath, baseRoutePath) : this._basePath,
      path,
      method,
      handler
    };
    this.router.add(method, path, [handler, r]);
    this.routes.push(r);
  }
  #handleError(err, c) {
    if (err instanceof Error)
      return this.errorHandler(err, c);
    throw err;
  }
  #dispatch(request, executionCtx, env, method) {
    if (method === "HEAD")
      return (async () => new Response(null, await this.#dispatch(request, executionCtx, env, "GET")))();
    const path = this.getPath(request, { env });
    const matchResult = this.router.match(method, path);
    const c = new Context(request, {
      path,
      matchResult,
      env,
      executionCtx,
      notFoundHandler: this.#notFoundHandler
    });
    if (matchResult[0].length === 1) {
      let res;
      try {
        res = matchResult[0][0][0][0](c, async () => {
          c.res = await this.#notFoundHandler(c);
        });
      } catch (err) {
        return this.#handleError(err, c);
      }
      return res instanceof Promise ? res.then((resolved) => resolved || (c.finalized ? c.res : this.#notFoundHandler(c))).catch((err) => this.#handleError(err, c)) : res ?? this.#notFoundHandler(c);
    }
    const composed = compose(matchResult[0], this.errorHandler, this.#notFoundHandler);
    return (async () => {
      try {
        const context = await composed(c);
        if (!context.finalized)
          throw new Error("Context is not finalized. Did you forget to return a Response object or `await next()`?");
        return context.res;
      } catch (err) {
        return this.#handleError(err, c);
      }
    })();
  }
  /**
  * `.fetch()` will be entry point of your app.
  *
  * @see {@link https://hono.dev/docs/api/hono#fetch}
  *
  * @param {Request} request - request Object of request
  * @param {Env} env - env Object
  * @param {ExecutionContext} executionCtx - context of execution
  * @returns {Response | Promise<Response>} response of request
  *
  */
  fetch = (request, ...rest) => {
    return this.#dispatch(request, rest[1], rest[0], request.method);
  };
  /**
  * `.request()` is a useful method for testing.
  * You can pass a URL or pathname to send a GET request.
  * app will return a Response object.
  * ```ts
  * test('GET /hello is ok', async () => {
  *   const res = await app.request('/hello')
  *   expect(res.status).toBe(200)
  * })
  * ```
  * @see https://hono.dev/docs/api/hono#request
  */
  request = (input, requestInit, Env, executionCtx) => {
    if (input instanceof Request)
      return this.fetch(requestInit ? new Request(input, requestInit) : input, Env, executionCtx);
    input = input.toString();
    return this.fetch(new Request(/^https?:\/\//.test(input) ? input : `http://localhost${mergePath("/", input)}`, requestInit), Env, executionCtx);
  };
  /**
  * `.fire()` automatically adds a global fetch event listener.
  * This can be useful for environments that adhere to the Service Worker API, such as non-ES module Cloudflare Workers.
  * @deprecated
  * Use `fire` from `hono/service-worker` instead.
  * ```ts
  * import { Hono } from 'hono'
  * import { fire } from 'hono/service-worker'
  *
  * const app = new Hono()
  * // ...
  * fire(app)
  * ```
  * @see https://hono.dev/docs/api/hono#fire
  * @see https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
  * @see https://developers.cloudflare.com/workers/reference/migrate-to-module-workers/
  */
  fire = () => {
    addEventListener("fetch", (event) => {
      event.respondWith(this.#dispatch(event.request, event, void 0, event.request.method));
    });
  };
};

// node_modules/hono/dist/router/utils.js
var createNullObject = () => /* @__PURE__ */ Object.create(null);

// node_modules/hono/dist/router/reg-exp-router/matcher.js
var emptyParam = [];
function match(method, path) {
  const matchers = this.buildAllMatchers();
  const match2 = (method2, path2) => {
    const matcher = matchers[method2] || matchers["ALL"];
    const staticMatch = matcher[2][path2];
    if (staticMatch)
      return staticMatch;
    const match3 = path2.match(matcher[0]);
    if (!match3)
      return [[], emptyParam];
    const index = match3.indexOf("", 1);
    return [matcher[1][index], match3];
  };
  this.match = match2;
  return match2(method, path);
}

// node_modules/hono/dist/router/reg-exp-router/node.js
var LABEL_REG_EXP_STR = "[^/]+";
var TAIL_WILDCARD_REG_EXP_STR = "(?:|/.*)";
var PATH_ERROR = Symbol();
var regExpMetaChars = /* @__PURE__ */ new Set(".\\+*[^]$()");
function compareKey(a, b) {
  if (a.length === 1)
    return b.length === 1 ? a < b ? -1 : 1 : -1;
  if (b.length === 1)
    return 1;
  if (a === ".*" || a === "(?:|/.*)")
    return b === "(?:|/.*)" ? -1 : 1;
  else if (b === ".*" || b === "(?:|/.*)")
    return -1;
  if (a === "[^/]+")
    return 1;
  else if (b === "[^/]+")
    return -1;
  return a.length === b.length ? a < b ? -1 : 1 : b.length - a.length;
}
var Node = class Node2 {
  #index;
  #varIndex;
  #children = createNullObject();
  insert(tokens, index, paramMap, context, isStatic) {
    let node = this;
    for (let i = 0, len = tokens.length; i < len; i++) {
      const token = tokens[i];
      const pattern = token.length === 1 ? token === "*" ? i === len - 1 ? [
        "",
        "",
        ".*"
      ] : [
        "",
        "",
        LABEL_REG_EXP_STR
      ] : null : token === "/*" ? [
        "",
        "",
        TAIL_WILDCARD_REG_EXP_STR
      ] : token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
      let nextNode;
      if (pattern) {
        const name = pattern[1];
        let regexpStr = pattern[2] || "[^/]+";
        if (name && pattern[2]) {
          if (regexpStr === ".*")
            throw PATH_ERROR;
          regexpStr = regexpStr.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:");
          if (/\((?!\?:)/.test(regexpStr))
            throw PATH_ERROR;
          if (regexpStr.length === 1 && regExpMetaChars.has(regexpStr))
            throw PATH_ERROR;
        }
        nextNode = node.#children[regexpStr];
        if (!nextNode) {
          if (regexpStr !== ".*" && regexpStr !== "(?:|/.*)") {
            for (const k in node.#children)
              if ((regexpStr.length > 1 || k.length > 1) && k !== ".*" && k !== "(?:|/.*)")
                throw PATH_ERROR;
          }
          nextNode = node.#children[regexpStr] = new Node2();
        }
        if (name !== "") {
          nextNode.#varIndex ??= context.varIndex++;
          paramMap.push([name, nextNode.#varIndex]);
        }
      } else {
        nextNode = node.#children[token];
        if (!nextNode) {
          for (const k in node.#children)
            if (k.length > 1 && k !== ".*" && k !== "(?:|/.*)")
              throw PATH_ERROR;
          nextNode = node.#children[token] = new Node2();
        }
      }
      node = nextNode;
    }
    if (node.#index !== void 0)
      throw PATH_ERROR;
    node.#index = isStatic ? -1 : index;
  }
  buildRegExpStr() {
    const strList = Object.keys(this.#children).sort(compareKey).map((k) => {
      const c = this.#children[k];
      const childStr = c.buildRegExpStr();
      return childStr === "" ? "" : (typeof c.#varIndex === "number" ? `(${k})@${c.#varIndex}` : regExpMetaChars.has(k) ? `\\${k}` : k) + childStr;
    }).filter(Boolean);
    if (typeof this.#index === "number" && this.#index !== -1)
      strList.unshift(`#${this.#index}`);
    if (strList.length === 0)
      return "";
    if (strList.length === 1)
      return strList[0];
    return "(?:" + strList.join("|") + ")";
  }
};

// node_modules/hono/dist/router/reg-exp-router/trie.js
var Trie = class {
  #context = { varIndex: 0 };
  #root = new Node();
  #index = 0;
  paths = createNullObject();
  insert(path, isStatic) {
    if (isStatic) {
      this.#root.insert(path.split(""), 0, [], this.#context, true);
      return;
    }
    const paramAssoc = [];
    const groups = [];
    let markedPath = path;
    for (let i = 0; ; ) {
      let replaced = false;
      markedPath = markedPath.replace(/\{[^}]+\}/g, (m) => {
        const mark = `@\\${i}`;
        groups[i] = [mark, m];
        i++;
        replaced = true;
        return mark;
      });
      if (!replaced)
        break;
    }
    const tokens = markedPath.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const [mark] = groups[i];
      for (let j = tokens.length - 1; j >= 0; j--)
        if (tokens[j].indexOf(mark) !== -1) {
          tokens[j] = tokens[j].replace(mark, groups[i][1]);
          break;
        }
    }
    this.#root.insert(tokens, this.#index, paramAssoc, this.#context, false);
    this.paths[path] = [this.#index++, paramAssoc];
  }
  buildRegExp() {
    let regexp = this.#root.buildRegExpStr();
    if (regexp === "")
      return [
        /^$/,
        [],
        []
      ];
    let captureIndex = 0;
    const indexReplacementMap = [];
    const paramReplacementMap = [];
    regexp = regexp.replace(/#(\d+)|@(\d+)|\.\*\$/g, (_, handlerIndex, paramIndex) => {
      if (handlerIndex !== void 0) {
        indexReplacementMap[++captureIndex] = Number(handlerIndex);
        return "$()";
      }
      if (paramIndex !== void 0) {
        paramReplacementMap[Number(paramIndex)] = ++captureIndex;
        return "";
      }
      return "";
    });
    return [
      new RegExp(`^${regexp}`),
      indexReplacementMap,
      paramReplacementMap
    ];
  }
};

// node_modules/hono/dist/router/reg-exp-router/router.js
var wildcardRegExpCache = createNullObject();
function buildWildcardRegExp(path) {
  return wildcardRegExpCache[path] ??= new RegExp(`^${path.replace(/\/:[^/{}]+(?:\{\[\^\/]\+})?(?=[/{]|$)|\/?\*$|([.\\+*[^\]$()?{}|])/g, (match2, metaChar) => metaChar ? `\\${metaChar}` : match2 === "/*" ? TAIL_WILDCARD_REG_EXP_STR : match2 === "*" ? ".*" : `/:${LABEL_REG_EXP_STR}`)}$`);
}
function findMiddleware(middleware, path) {
  for (const k of Object.keys(middleware).sort((a, b) => b.length - a.length))
    if (buildWildcardRegExp(k).test(path))
      return [...middleware[k]];
}
var RegExpRouter = class {
  name = "RegExpRouter";
  #middleware;
  #routes;
  #tries;
  constructor() {
    this.#middleware = { ["ALL"]: createNullObject() };
    this.#routes = { ["ALL"]: createNullObject() };
    this.#tries = { ["ALL"]: new Trie() };
  }
  #insertPath(method, path) {
    try {
      this.#tries[method].insert(path, !/\*|\/:/.test(path));
    } catch (e) {
      throw e === PATH_ERROR ? new UnsupportedPathError(path) : e;
    }
  }
  add(method, path, handler) {
    const middleware = this.#middleware;
    const routes = this.#routes;
    if (!middleware)
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    if (!middleware[method]) {
      this.#tries[method] = new Trie();
      for (const handlerMap of [middleware, routes]) {
        handlerMap[method] = createNullObject();
        for (const p in handlerMap["ALL"]) {
          handlerMap[method][p] = [...handlerMap["ALL"][p]];
          this.#insertPath(method, p);
        }
      }
    }
    if (path === "/*")
      path = "*";
    const methods = method === "ALL" ? Object.keys(middleware) : [method];
    if (/\*$/.test(path)) {
      const re = buildWildcardRegExp(path);
      for (const m of methods)
        if (!middleware[m][path]) {
          this.#insertPath(m, path);
          middleware[m][path] = findMiddleware(middleware[m], path) || findMiddleware(middleware["ALL"], path) || [];
        }
      for (const handlerMap of [middleware, routes])
        for (const m of methods)
          for (const p in handlerMap[m])
            re.test(p) && handlerMap[m][p].push([handler, path]);
      return;
    }
    const paths = checkOptionalParameter(path) || [path];
    for (const path2 of paths)
      for (const m of methods) {
        if (!routes[m][path2]) {
          this.#insertPath(m, path2);
          routes[m][path2] = findMiddleware(middleware[m], path2) || findMiddleware(middleware["ALL"], path2) || [];
        }
        routes[m][path2].push([handler, path2]);
      }
  }
  match = match;
  buildAllMatchers() {
    const matchers = createNullObject();
    for (const method of Object.keys(this.#routes))
      matchers[method] = this.#buildMatcher(method);
    this.#middleware = this.#routes = this.#tries = void 0;
    wildcardRegExpCache = createNullObject();
    return matchers;
  }
  #buildMatcher(method) {
    const middleware = this.#middleware[method];
    const routes = this.#routes[method];
    const trie = this.#tries[method];
    const staticMap = createNullObject();
    const handlerData = [];
    const [regexp, indexReplacementMap, paramReplacementMap] = trie.buildRegExp();
    for (const r of [middleware, routes])
      for (const path in r) {
        const handlers = r[path];
        const pathData = trie.paths[path];
        if (!pathData) {
          staticMap[path] = [handlers.map(([h]) => [h, createNullObject()]), emptyParam];
          continue;
        }
        handlerData[pathData[0]] = handlers.map(([h, handlerPath]) => [h, trie.paths[handlerPath][1].reduceRight((map, [key], i) => {
          map[key] = paramReplacementMap[pathData[1][i][1]];
          return map;
        }, createNullObject())]);
      }
    return [
      regexp,
      indexReplacementMap.map((i) => handlerData[i]),
      staticMap
    ];
  }
};

// node_modules/hono/dist/router/smart-router/router.js
var SmartRouter = class {
  name = "SmartRouter";
  #routers = [];
  #routes = [];
  constructor(init) {
    this.#routers = init.routers;
  }
  add(method, path, handler) {
    if (!this.#routes)
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    this.#routes.push([
      method,
      path,
      handler
    ]);
  }
  match(method, path) {
    if (!this.#routes)
      throw new Error("Fatal error");
    const routers = this.#routers;
    const routes = this.#routes;
    const len = routers.length;
    let i = 0;
    let res;
    for (; i < len; i++) {
      const router = routers[i];
      try {
        for (let i2 = 0, len2 = routes.length; i2 < len2; i2++)
          router.add(...routes[i2]);
        res = router.match(method, path);
      } catch (e) {
        if (e instanceof UnsupportedPathError)
          continue;
        throw e;
      }
      this.match = router.match.bind(router);
      this.#routers = [router];
      this.#routes = void 0;
      break;
    }
    if (i === len)
      throw new Error("Fatal error");
    this.name = `SmartRouter + ${this.activeRouter.name}`;
    return res;
  }
  get activeRouter() {
    if (this.#routes || this.#routers.length !== 1)
      throw new Error("No active router has been determined yet.");
    return this.#routers[0];
  }
};

// node_modules/hono/dist/router/trie-router/node.js
var emptyParams = createNullObject();
var order = 0;
var Node3 = class Node4 {
  #methods = [];
  #children = createNullObject();
  #patterns = [];
  #pattern;
  #params = emptyParams;
  insert(method, path, handler) {
    let curNode = this;
    const parts = splitRoutingPath(path);
    const possibleKeys = /* @__PURE__ */ new Set();
    let i = 0;
    for (const p of parts) {
      const nextP = parts[++i];
      const pattern = getPattern(p, nextP) || (nextP === void 0 && p && p.indexOf("*") === p.length - 1 ? p : null);
      const isParam = Array.isArray(pattern);
      const key = isParam ? pattern[0] : pattern || p;
      const child = curNode.#children[key] ||= new Node4();
      if (pattern && !child.#pattern) {
        child.#pattern = pattern;
        curNode.#patterns.push(child);
      }
      curNode = child;
      if (isParam)
        possibleKeys.add(pattern[1]);
    }
    curNode.#methods.push({ [method]: {
      handler,
      possibleKeys: [...possibleKeys],
      score: ++order
    } });
  }
  #pushHandlerSets(handlerSets, node, method, nodeParams, params) {
    for (let i = 0, len = node.#methods.length; i < len; i++) {
      const m = node.#methods[i];
      const handlerSet = m[method] || m["ALL"];
      if (handlerSet) {
        handlerSet.params = createNullObject();
        handlerSets.push(handlerSet);
        for (let i2 = 0, len2 = handlerSet.possibleKeys.length; i2 < len2; i2++) {
          const key = handlerSet.possibleKeys[i2];
          handlerSet.params[key] = params?.[key] && !i2 ? params[key] : nodeParams[key] ?? params?.[key];
        }
      }
    }
  }
  search(method, path) {
    const handlerSets = [];
    this.#params = emptyParams;
    let curNodes = [this];
    const parts = splitPath(path);
    const curNodesQueue = [];
    const len = parts.length;
    let partOffsets = null;
    for (let i = 0; i < len; i++) {
      const part = parts[i];
      const isLast = i === len - 1;
      const tempNodes = [];
      for (let j = 0, len2 = curNodes.length; j < len2; j++) {
        const node = curNodes[j];
        const nextNode = node.#children[part];
        if (nextNode) {
          nextNode.#params = node.#params;
          if (isLast) {
            if (nextNode.#children["*"])
              this.#pushHandlerSets(handlerSets, nextNode.#children["*"], method, node.#params);
            this.#pushHandlerSets(handlerSets, nextNode, method, node.#params);
          } else
            tempNodes.push(nextNode);
        }
        for (const child of node.#patterns) {
          const pattern = child.#pattern;
          const params = node.#params === emptyParams ? {} : { ...node.#params };
          if (typeof pattern === "string") {
            if (pattern === "*" || part.startsWith(pattern.slice(0, -1))) {
              this.#pushHandlerSets(handlerSets, child, method, node.#params);
              if (pattern === "*") {
                child.#params = params;
                tempNodes.push(child);
              }
            }
            continue;
          }
          const [, name, matcher] = pattern;
          if (!part && matcher === true)
            continue;
          if (matcher !== true) {
            if (!partOffsets) {
              partOffsets = [];
              let offset = path[0] === "/" ? 1 : 0;
              for (let p = 0; p < len; p++) {
                partOffsets[p] = offset;
                offset += parts[p].length + 1;
              }
            }
            const restPathString = path.slice(partOffsets[i]);
            const m = matcher.exec(restPathString);
            if (m) {
              params[name] = m[0];
              this.#pushHandlerSets(handlerSets, child, method, node.#params, params);
              if (m[0].length === restPathString.length && child.#children["*"])
                this.#pushHandlerSets(handlerSets, child.#children["*"], method, node.#params, params);
              for (const _ in child.#children) {
                child.#params = params;
                const componentCount = m[0].match(/\//g)?.length ?? 0;
                (curNodesQueue[componentCount] ||= []).push(child);
                break;
              }
              continue;
            }
          }
          if (matcher === true || matcher.test(part)) {
            params[name] = part;
            if (isLast) {
              this.#pushHandlerSets(handlerSets, child, method, params, node.#params);
              if (child.#children["*"])
                this.#pushHandlerSets(handlerSets, child.#children["*"], method, params, node.#params);
            } else {
              child.#params = params;
              tempNodes.push(child);
            }
          }
        }
      }
      const shifted = curNodesQueue.shift();
      curNodes = shifted ? tempNodes.concat(shifted) : tempNodes;
    }
    if (handlerSets[1])
      handlerSets.sort((a, b) => {
        return a.score - b.score;
      });
    return [handlerSets.map(({ handler, params }) => [handler, params])];
  }
};

// node_modules/hono/dist/router/trie-router/router.js
var TrieRouter = class {
  name = "TrieRouter";
  #node = new Node3();
  add(method, path, handler) {
    for (const result of checkOptionalParameter(path) || [path])
      this.#node.insert(method, result, handler);
  }
  match(method, path) {
    return this.#node.search(method, path);
  }
};

// node_modules/hono/dist/hono.js
var Hono3 = class extends Hono {
  /**
  * Creates an instance of the Hono class.
  *
  * @param options - Optional configuration options for the Hono instance.
  */
  constructor(options = {}) {
    super(options);
    this.router = options.router ?? new SmartRouter({ routers: [new RegExpRouter(), new TrieRouter()] });
  }
};

// node_modules/hono/dist/utils/cookie.js
var validCookieNameRegEx = /^[\w!#$%&'*.^`|~+-]+$/;
var relaxedCookieNameRegEx = /^[!#-:<>-[\]-~]+$/;
var validCookieValueRegEx = /^[ !#-:<-[\]-~]*$/;
var trimCookieWhitespace = (value) => {
  let start = 0;
  let end = value.length;
  while (start < end) {
    const charCode = value.charCodeAt(start);
    if (charCode !== 32 && charCode !== 9)
      break;
    start++;
  }
  while (end > start) {
    const charCode = value.charCodeAt(end - 1);
    if (charCode !== 32 && charCode !== 9)
      break;
    end--;
  }
  return start === 0 && end === value.length ? value : value.slice(start, end);
};
var parse = (cookie, name) => {
  if (name && cookie.indexOf(name) === -1)
    return {};
  const pairs = cookie.split(";");
  const parsedCookie = /* @__PURE__ */ Object.create(null);
  for (const pairStr of pairs) {
    const valueStartPos = pairStr.indexOf("=");
    if (valueStartPos === -1)
      continue;
    const cookieName = trimCookieWhitespace(pairStr.substring(0, valueStartPos));
    if (name && name !== cookieName || !relaxedCookieNameRegEx.test(cookieName) || cookieName in parsedCookie)
      continue;
    let cookieValue = trimCookieWhitespace(pairStr.substring(valueStartPos + 1));
    if (cookieValue.startsWith('"') && cookieValue.endsWith('"'))
      cookieValue = cookieValue.slice(1, -1);
    if (validCookieValueRegEx.test(cookieValue)) {
      parsedCookie[cookieName] = tryDecodeURIComponent(cookieValue);
      if (name)
        break;
    }
  }
  return parsedCookie;
};
var _serialize = (name, value, opt = {}) => {
  if (!validCookieNameRegEx.test(name))
    throw new Error("Invalid cookie name");
  let cookie = `${name}=${value}`;
  if (name.startsWith("__Secure-") && !opt.secure)
    throw new Error("__Secure- Cookie must have Secure attributes");
  if (name.startsWith("__Host-")) {
    if (!opt.secure)
      throw new Error("__Host- Cookie must have Secure attributes");
    if (opt.path !== "/")
      throw new Error('__Host- Cookie must have Path attributes with "/"');
    if (opt.domain)
      throw new Error("__Host- Cookie must not have Domain attributes");
  }
  for (const key of [
    "domain",
    "path",
    "sameSite",
    "priority"
  ])
    if (opt[key] && /[;\r\n]/.test(opt[key]))
      throw new Error(`${key} must not contain ";", "\\r", or "\\n"`);
  if (opt && typeof opt.maxAge === "number" && opt.maxAge >= 0) {
    if (opt.maxAge > 3456e4)
      throw new Error("Cookies Max-Age SHOULD NOT be greater than 400 days (34560000 seconds) in duration.");
    cookie += `; Max-Age=${opt.maxAge | 0}`;
  }
  if (opt.domain && opt.prefix !== "host")
    cookie += `; Domain=${opt.domain}`;
  if (opt.path)
    cookie += `; Path=${opt.path}`;
  if (opt.expires) {
    if (opt.expires.getTime() - Date.now() > 3456e7)
      throw new Error("Cookies Expires SHOULD NOT be greater than 400 days (34560000 seconds) in the future.");
    cookie += `; Expires=${opt.expires.toUTCString()}`;
  }
  if (opt.httpOnly)
    cookie += "; HttpOnly";
  if (opt.secure)
    cookie += "; Secure";
  if (opt.sameSite)
    cookie += `; SameSite=${opt.sameSite.charAt(0).toUpperCase() + opt.sameSite.slice(1)}`;
  if (opt.priority)
    cookie += `; Priority=${opt.priority.charAt(0).toUpperCase() + opt.priority.slice(1)}`;
  if (opt.partitioned) {
    if (!opt.secure)
      throw new Error("Partitioned Cookie must have Secure attributes");
    cookie += "; Partitioned";
  }
  return cookie;
};
var serialize = (name, value, opt) => {
  value = encodeURIComponent(value);
  return _serialize(name, value, opt);
};

// node_modules/hono/dist/helper/cookie/index.js
var getCookie = (c, key, prefix) => {
  const cookie = c.req.raw.headers.get("Cookie");
  if (typeof key === "string") {
    if (!cookie)
      return;
    let finalKey = key;
    if (prefix === "secure")
      finalKey = "__Secure-" + key;
    else if (prefix === "host")
      finalKey = "__Host-" + key;
    return parse(cookie, finalKey)[finalKey];
  }
  if (!cookie)
    return {};
  return parse(cookie);
};
var generateCookie = (name, value, opt) => {
  let cookie;
  if (opt?.prefix === "secure")
    cookie = serialize("__Secure-" + name, value, {
      path: "/",
      ...opt,
      secure: true
    });
  else if (opt?.prefix === "host")
    cookie = serialize("__Host-" + name, value, {
      ...opt,
      path: "/",
      secure: true,
      domain: void 0
    });
  else
    cookie = serialize(name, value, {
      path: "/",
      ...opt
    });
  return cookie;
};
var setCookie = (c, name, value, opt) => {
  const cookie = generateCookie(name, value, opt);
  c.header("Set-Cookie", cookie, { append: true });
};
var deleteCookie = (c, name, opt) => {
  const deletedCookie = getCookie(c, name, opt?.prefix);
  setCookie(c, name, "", {
    ...opt,
    maxAge: 0
  });
  return deletedCookie;
};

// src/auth.ts
init_util();
var SESSION_COOKIE = "cmail_session";
async function createSession(env, userId, ua, ip) {
  const token = randomToken(36);
  const days = parseInt((await env.DB.prepare("SELECT value FROM settings WHERE key='session_days'").first())?.value ?? "30", 10) || 30;
  await env.DB.prepare(
    "INSERT INTO sessions (token, user_id, created_at, expires_at, ua, ip) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(token, userId, now(), now() + days * 864e5, (ua ?? "").slice(0, 200), (ip ?? "").slice(0, 64)).run();
  return token;
}
function setSessionCookie(c, token) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
}
function clearSessionCookie(c) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}
async function getUserFromToken(env, token) {
  if (!token)
    return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.role, u.display_name, u.totp_enabled, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`
  ).bind(token).first();
  if (!row)
    return null;
  if (row.expires_at < now()) {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    return null;
  }
  return { id: row.id, username: row.username, role: row.role, display_name: row.display_name, totp_enabled: row.totp_enabled };
}
function tokenFrom(c) {
  const cookie = getCookie(c, SESSION_COOKIE);
  if (cookie)
    return cookie;
  const auth = c.req.header("Authorization");
  if (auth?.startsWith("Bearer "))
    return auth.slice(7);
  return void 0;
}
async function attachUser(c, next) {
  const user = await getUserFromToken(c.env, tokenFrom(c));
  c.set("user", user);
  await next();
}
async function requireUser(c, next) {
  const user = c.get("user");
  if (!user)
    return c.json({ ok: false, error: "unauthorized" }, 401);
  await next();
}
async function requireAdmin(c, next) {
  const user = c.get("user");
  if (!user)
    return c.json({ ok: false, error: "unauthorized" }, 401);
  if (user.role !== "admin")
    return c.json({ ok: false, error: "forbidden" }, 403);
  await next();
}
async function destroySession(env, token) {
  if (!token)
    return;
  await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
}
async function rateLimit(env, ip, route, max = 10, windowMs = 10 * 6e4) {
  const key = `${route}:${ip}`;
  const t = now();
  const row = await env.DB.prepare("SELECT count, window_start FROM auth_attempts WHERE key = ?").bind(key).first();
  if (!row || t - row.window_start > windowMs) {
    await env.DB.prepare(
      "INSERT INTO auth_attempts (key, count, window_start) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start"
    ).bind(key, t).run();
    return true;
  }
  if (row.count >= max)
    return false;
  await env.DB.prepare("UPDATE auth_attempts SET count = count + 1 WHERE key = ?").bind(key).run();
  return true;
}
async function rateLimitClear(env, ip, route) {
  await env.DB.prepare("DELETE FROM auth_attempts WHERE key = ?").bind(`${route}:${ip}`).run();
}
function clientIp(c) {
  return c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For")?.split(",")[0].trim() || "0.0.0.0";
}

// src/worker.ts
init_emailin();

// src/routes/setup.ts
init_util();
init_util();
var app = new Hono3();
app.get("/status", async (c) => {
  const env = c.env;
  let database = false;
  try {
    await env.DB.prepare("SELECT 1").first();
    database = true;
  } catch {
    database = false;
  }
  let admin_created = false;
  let domain = false;
  const settings = {};
  if (database) {
    try {
      const [adminCount, domainCount, s] = await Promise.all([
        env.DB.prepare("SELECT COUNT(*) AS n FROM users").first(),
        env.DB.prepare("SELECT COUNT(*) AS n FROM domains WHERE active = 1").first(),
        getSettings(env, ["sending_provider", "sending_api_key", "sending_from_email", "login_username", "app_name"])
      ]);
      admin_created = (adminCount?.n ?? 0) > 0;
      domain = (domainCount?.n ?? 0) > 0;
      Object.assign(settings, s);
    } catch {
    }
  }
  const sendingProvider = settings.sending_provider || "none";
  const sending = (sendingProvider === "brevo" || sendingProvider === "resend") && !!settings.sending_api_key && !!settings.sending_from_email;
  const checks = [
    { id: "database", ok: database },
    { id: "admin", ok: admin_created },
    { id: "domain", ok: domain },
    { id: "sending", ok: sending }
  ];
  const ready = checks.every((x) => x.ok);
  return c.json({
    ok: true,
    ready,
    checks,
    admin_created,
    login_username: (settings.login_username ?? "1") !== "0",
    domains_configured: domain,
    sending_provider: sendingProvider,
    sending_from: settings.sending_from_email || "",
    sending_ready: sending,
    app_name: settings.app_name || "Cmail",
    version: c.env.APP_VERSION || ""
  });
});
app.post("/admin", async (c) => {
  const ip = clientIp(c);
  if (!await rateLimit(c.env, ip, "setup", 5))
    return c.json({ ok: false, error: "rate_limited" }, 429);
  const existing = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
  if ((existing?.n ?? 0) > 0)
    return c.json({ ok: false, error: "already_setup" }, 409);
  const body = await c.req.json().catch(() => null);
  const username = (body?.username ?? "").trim();
  const password = body?.password ?? "";
  if (!usernameValid(username))
    return c.json({ ok: false, error: "invalid_username" }, 400);
  if (!passwordStrong(password))
    return c.json({ ok: false, error: "weak_password" }, 400);
  const id = uid("usr_");
  const hash = await hashPassword(password);
  await c.env.DB.prepare(
    "INSERT INTO users (id, username, password_hash, role, display_name, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(id, username, hash, "admin", (body?.display_name ?? "").slice(0, 60) || null, now()).run();
  await setSetting(c.env, "setup_done", "1");
  const token = await createSession(c.env, id, c.req.header("User-Agent"), ip);
  setSessionCookie(c, token);
  return c.json({ ok: true, user: { id, username, role: "admin" } });
});
app.post("/domain", requireUser, async (c) => {
  const user = c.get("user");
  if (user.role !== "admin")
    return c.json({ ok: false, error: "forbidden" }, 403);
  const body = await c.req.json().catch(() => null);
  const name = (body?.name ?? "").toLowerCase().trim();
  if (!RE_DOMAIN.test(name))
    return c.json({ ok: false, error: "invalid_domain" }, 400);
  const exists = await c.env.DB.prepare("SELECT id FROM domains WHERE name = ?").bind(name).first();
  if (exists)
    return c.json({ ok: false, error: "domain_exists" }, 409);
  const id = uid("dom_");
  await c.env.DB.prepare("INSERT INTO domains (id, name, label, created_at) VALUES (?, ?, ?, ?)").bind(id, name, (body?.label ?? "").slice(0, 80) || null, now()).run();
  return c.json({ ok: true, id, name });
});
var setup_default = app;

// src/routes/auth.ts
init_util();

// src/totp.ts
init_util();
var B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(s) {
  const clean2 = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean2) {
    const idx = B32.indexOf(ch);
    if (idx === -1)
      throw new Error("invalid base32");
    value = value << 5 | idx;
    bits += 5;
    if (bits >= 8) {
      out.push(value >>> bits - 8 & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}
function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = value << 8 | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[value >>> bits - 5 & 31];
      bits -= 5;
    }
  }
  if (bits > 0)
    out += B32[value << 5 - bits & 31];
  return out;
}
function randomSecret(bytes = 20) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base32Encode(buf);
}
async function hmac(algo, keyBytes, msg) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: algo }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, msg);
  return new Uint8Array(sig);
}
async function hotp(secretB32, counter, algo = "SHA1", digits = 6) {
  const key = base32Decode(secretB32);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 255;
    c = Math.floor(c / 256);
  }
  const map = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" };
  const h = await hmac(map[algo] ?? "SHA-1", key, msg);
  const off = h[h.length - 1] & 15;
  const bin = (h[off] & 127) << 24 | h[off + 1] << 16 | h[off + 2] << 8 | h[off + 3];
  const code = (bin % 10 ** digits).toString().padStart(digits, "0");
  return code;
}
async function totp(secretB32, algo = "SHA1", digits = 6, period = 30, at = Date.now()) {
  return hotp(secretB32, Math.floor(at / 1e3 / period), algo, digits);
}
async function totpRemaining(period = 30, at = Date.now()) {
  return period - Math.floor(at / 1e3) % period;
}
async function verifyTotp(secretB32, code, algo = "SHA1", digits = 6, period = 30, window = 1) {
  const counter = Math.floor(Date.now() / 1e3 / period);
  for (let i = -window; i <= window; i++) {
    const c = await hotp(secretB32, counter + i, algo, digits);
    if (c === code.trim())
      return true;
  }
  return false;
}
function parseOtpauthUri(uri) {
  try {
    if (!uri.startsWith("otpauth://totp/"))
      return null;
    const u = new URL(uri);
    const label = decodeURIComponent(u.pathname.replace("/totp/", ""));
    const [issuerFromLabel, name] = label.includes(":") && !label.includes("@") ? [label.split(":")[0], label.split(":").slice(1).join(":")] : [u.searchParams.get("issuer") ?? void 0, label.includes("@") ? label.split("@")[0] : label];
    const secret = u.searchParams.get("secret");
    if (!secret)
      return null;
    base32Decode(secret);
    return {
      secret: secret.toUpperCase().replace(/\s/g, ""),
      issuer: issuerFromLabel ?? u.searchParams.get("issuer") ?? void 0,
      name: name ?? void 0,
      algo: (u.searchParams.get("algorithm") ?? "SHA1").toUpperCase(),
      digits: Math.min(10, Math.max(6, parseInt(u.searchParams.get("digits") ?? "6", 10) || 6)),
      period: Math.min(120, Math.max(15, parseInt(u.searchParams.get("period") ?? "30", 10) || 30))
    };
  } catch {
    return null;
  }
}
function buildOtpauthUri(cfg) {
  const label = `${cfg.issuer ?? "Cmail"}:${cfg.name ?? "code"}`;
  const p = new URLSearchParams({ secret: cfg.secret, issuer: cfg.issuer ?? "Cmail", algorithm: cfg.algo, digits: String(cfg.digits), period: String(cfg.period) });
  return `otpauth://totp/${encodeURIComponent(label)}?${p.toString()}`;
}
function normalizeSecret(raw2) {
  return raw2.toUpperCase().replace(/[\s-]/g, "").replace(/0/g, "O").replace(/1/g, "L").split("").map((ch) => B32.includes(ch) ? ch : "").join("");
}

// node_modules/uqr/dist/index.mjs
var QrCodeDataType = /* @__PURE__ */ ((QrCodeDataType2) => {
  QrCodeDataType2[QrCodeDataType2["Border"] = -1] = "Border";
  QrCodeDataType2[QrCodeDataType2["Data"] = 0] = "Data";
  QrCodeDataType2[QrCodeDataType2["Function"] = 1] = "Function";
  QrCodeDataType2[QrCodeDataType2["Position"] = 2] = "Position";
  QrCodeDataType2[QrCodeDataType2["Timing"] = 3] = "Timing";
  QrCodeDataType2[QrCodeDataType2["Alignment"] = 4] = "Alignment";
  return QrCodeDataType2;
})(QrCodeDataType || {});
var LOW = [0, 1];
var MEDIUM = [1, 0];
var QUARTILE = [2, 3];
var HIGH = [3, 2];
var EccMap = {
  L: LOW,
  M: MEDIUM,
  Q: QUARTILE,
  H: HIGH
};
var NUMERIC_REGEX = /^\d*$/;
var ALPHANUMERIC_REGEX = /^[A-Z0-9 $%*+./:-]*$/;
var ALPHANUMERIC_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
var MIN_VERSION = 1;
var MAX_VERSION = 40;
var PENALTY_N1 = 3;
var PENALTY_N2 = 3;
var PENALTY_N3 = 40;
var PENALTY_N4 = 10;
var ECC_CODEWORDS_PER_BLOCK = [
  // Version: (note that index 0 is for padding, and is set to an illegal value)
  // 0,  1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40    Error correction level
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  // Low
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  // Medium
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  // Quartile
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  // High
];
var NUM_ERROR_CORRECTION_BLOCKS = [
  // Version: (note that index 0 is for padding, and is set to an illegal value)
  // 0, 1, 2, 3, 4, 5, 6, 7, 8, 9,10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40    Error correction level
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  // Low
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  // Medium
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  // Quartile
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  // High
];
var QrCode = class {
  /* -- Constructor (low level) and fields -- */
  // Creates a new QR Code with the given version number,
  // error correction level, data codeword bytes, and mask number.
  // This is a low-level API that most users should not use directly.
  // A mid-level API is the encodeSegments() function.
  constructor(version, ecc, dataCodewords, msk) {
    this.version = version;
    this.ecc = ecc;
    if (version < MIN_VERSION || version > MAX_VERSION)
      throw new RangeError("Version value out of range");
    if (msk < -1 || msk > 7)
      throw new RangeError("Mask value out of range");
    this.size = version * 4 + 17;
    const row = Array.from({ length: this.size }).fill(false);
    for (let i = 0; i < this.size; i++) {
      this.modules.push(row.slice());
      this.types.push(row.map(() => 0));
    }
    this.drawFunctionPatterns();
    const allCodewords = this.addEccAndInterleave(dataCodewords);
    this.drawCodewords(allCodewords);
    if (msk === -1) {
      let minPenalty = 1e9;
      for (let i = 0; i < 8; i++) {
        this.applyMask(i);
        this.drawFormatBits(i);
        const penalty = this.getPenaltyScore();
        if (penalty < minPenalty) {
          msk = i;
          minPenalty = penalty;
        }
        this.applyMask(i);
      }
    }
    this.mask = msk;
    this.applyMask(msk);
    this.drawFormatBits(msk);
  }
  /* -- Fields -- */
  // The width and height of this QR Code, measured in modules, between
  // 21 and 177 (inclusive). This is equal to version * 4 + 17.
  size;
  // The index of the mask pattern used in this QR Code, which is between 0 and 7 (inclusive).
  // Even if a QR Code is created with automatic masking requested (mask = -1),
  // the resulting object still has a mask value between 0 and 7.
  mask;
  // The modules of this QR Code (false = light, true = dark).
  // Immutable after constructor finishes. Accessed through getModule().
  modules = [];
  types = [];
  /* -- Accessor methods -- */
  // Returns the color of the module (pixel) at the given coordinates, which is false
  // for light or true for dark. The top left corner has the coordinates (x=0, y=0).
  // If the given coordinates are out of bounds, then false (light) is returned.
  getModule(x, y) {
    return x >= 0 && x < this.size && y >= 0 && y < this.size && this.modules[y][x];
  }
  /* -- Private helper methods for constructor: Drawing function modules -- */
  // Reads this object's version field, and draws and marks all function modules.
  drawFunctionPatterns() {
    for (let i = 0; i < this.size; i++) {
      this.setFunctionModule(6, i, i % 2 === 0, QrCodeDataType.Timing);
      this.setFunctionModule(i, 6, i % 2 === 0, QrCodeDataType.Timing);
    }
    this.drawFinderPattern(3, 3);
    this.drawFinderPattern(this.size - 4, 3);
    this.drawFinderPattern(3, this.size - 4);
    const alignPatPos = this.getAlignmentPatternPositions();
    const numAlign = alignPatPos.length;
    for (let i = 0; i < numAlign; i++) {
      for (let j = 0; j < numAlign; j++) {
        if (!(i === 0 && j === 0 || i === 0 && j === numAlign - 1 || i === numAlign - 1 && j === 0))
          this.drawAlignmentPattern(alignPatPos[i], alignPatPos[j]);
      }
    }
    this.drawFormatBits(0);
    this.drawVersion();
  }
  // Draws two copies of the format bits (with its own error correction code)
  // based on the given mask and this object's error correction level field.
  drawFormatBits(mask) {
    const data = this.ecc[1] << 3 | mask;
    let rem = data;
    for (let i = 0; i < 10; i++)
      rem = rem << 1 ^ (rem >>> 9) * 1335;
    const bits = (data << 10 | rem) ^ 21522;
    for (let i = 0; i <= 5; i++)
      this.setFunctionModule(8, i, getBit(bits, i));
    this.setFunctionModule(8, 7, getBit(bits, 6));
    this.setFunctionModule(8, 8, getBit(bits, 7));
    this.setFunctionModule(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++)
      this.setFunctionModule(14 - i, 8, getBit(bits, i));
    for (let i = 0; i < 8; i++)
      this.setFunctionModule(this.size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++)
      this.setFunctionModule(8, this.size - 15 + i, getBit(bits, i));
    this.setFunctionModule(8, this.size - 8, true);
  }
  // Draws two copies of the version bits (with its own error correction code),
  // based on this object's version field, iff 7 <= version <= 40.
  drawVersion() {
    if (this.version < 7)
      return;
    let rem = this.version;
    for (let i = 0; i < 12; i++)
      rem = rem << 1 ^ (rem >>> 11) * 7973;
    const bits = this.version << 12 | rem;
    for (let i = 0; i < 18; i++) {
      const color = getBit(bits, i);
      const a = this.size - 11 + i % 3;
      const b = Math.floor(i / 3);
      this.setFunctionModule(a, b, color);
      this.setFunctionModule(b, a, color);
    }
  }
  // Draws a 9*9 finder pattern including the border separator,
  // with the center module at (x, y). Modules can be out of bounds.
  drawFinderPattern(x, y) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size)
          this.setFunctionModule(xx, yy, dist !== 2 && dist !== 4, QrCodeDataType.Position);
      }
    }
  }
  // Draws a 5*5 alignment pattern, with the center module
  // at (x, y). All modules must be in bounds.
  drawAlignmentPattern(x, y) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFunctionModule(
          x + dx,
          y + dy,
          Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
          QrCodeDataType.Alignment
        );
      }
    }
  }
  // Sets the color of a module and marks it as a function module.
  // Only used by the constructor. Coordinates must be in bounds.
  setFunctionModule(x, y, isDark, type = QrCodeDataType.Function) {
    this.modules[y][x] = isDark;
    this.types[y][x] = type;
  }
  /* -- Private helper methods for constructor: Codewords and masking -- */
  // Returns a new byte string representing the given data with the appropriate error correction
  // codewords appended to it, based on this object's version and error correction level.
  addEccAndInterleave(data) {
    const ver = this.version;
    const ecl = this.ecc;
    if (data.length !== getNumDataCodewords(ver, ecl))
      throw new RangeError("Invalid argument");
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl[0]][ver];
    const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl[0]][ver];
    const rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
    const numShortBlocks = numBlocks - rawCodewords % numBlocks;
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);
    const blocks = [];
    const rsDiv = reedSolomonComputeDivisor(blockEccLen);
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
      k += dat.length;
      const ecc = reedSolomonComputeRemainder(dat, rsDiv);
      if (i < numShortBlocks)
        dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const result = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((block, j) => {
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks)
          result.push(block[i]);
      });
    }
    return result;
  }
  // Draws the given sequence of 8-bit codewords (data and error correction) onto the entire
  // data area of this QR Code. Function modules need to be marked off before this is called.
  drawCodewords(data) {
    if (data.length !== Math.floor(getNumRawDataModules(this.version) / 8))
      throw new RangeError("Invalid argument");
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6)
        right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = (right + 1 & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.types[y][x] && i < data.length * 8) {
            this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }
  // XORs the codeword modules in this QR Code with the given mask pattern.
  // The function modules must be marked and the codeword bits must be drawn
  // before masking. Due to the arithmetic of XOR, calling applyMask() with
  // the same mask value a second time will undo the mask. A final well-formed
  // QR Code needs exactly one (not zero, two, etc.) mask applied.
  applyMask(mask) {
    if (mask < 0 || mask > 7)
      throw new RangeError("Mask value out of range");
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        let invert;
        switch (mask) {
          case 0:
            invert = (x + y) % 2 === 0;
            break;
          case 1:
            invert = y % 2 === 0;
            break;
          case 2:
            invert = x % 3 === 0;
            break;
          case 3:
            invert = (x + y) % 3 === 0;
            break;
          case 4:
            invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
            break;
          case 5:
            invert = x * y % 2 + x * y % 3 === 0;
            break;
          case 6:
            invert = (x * y % 2 + x * y % 3) % 2 === 0;
            break;
          case 7:
            invert = ((x + y) % 2 + x * y % 3) % 2 === 0;
            break;
          default:
            throw new Error("Unreachable");
        }
        if (!this.types[y][x] && invert)
          this.modules[y][x] = !this.modules[y][x];
      }
    }
  }
  // Calculates and returns the penalty score based on state of this QR Code's current modules.
  // This is used by the automatic mask choice algorithm to find the mask pattern that yields the lowest score.
  getPenaltyScore() {
    let result = 0;
    for (let y = 0; y < this.size; y++) {
      let runColor = false;
      let runX = 0;
      const runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (let x = 0; x < this.size; x++) {
        if (this.modules[y][x] === runColor) {
          runX++;
          if (runX === 5)
            result += PENALTY_N1;
          else if (runX > 5)
            result++;
        } else {
          this.finderPenaltyAddHistory(runX, runHistory);
          if (!runColor)
            result += this.finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
          runColor = this.modules[y][x];
          runX = 1;
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runX, runHistory) * PENALTY_N3;
    }
    for (let x = 0; x < this.size; x++) {
      let runColor = false;
      let runY = 0;
      const runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (let y = 0; y < this.size; y++) {
        if (this.modules[y][x] === runColor) {
          runY++;
          if (runY === 5)
            result += PENALTY_N1;
          else if (runY > 5)
            result++;
        } else {
          this.finderPenaltyAddHistory(runY, runHistory);
          if (!runColor)
            result += this.finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
          runColor = this.modules[y][x];
          runY = 1;
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runY, runHistory) * PENALTY_N3;
    }
    for (let y = 0; y < this.size - 1; y++) {
      for (let x = 0; x < this.size - 1; x++) {
        const color = this.modules[y][x];
        if (color === this.modules[y][x + 1] && color === this.modules[y + 1][x] && color === this.modules[y + 1][x + 1]) {
          result += PENALTY_N2;
        }
      }
    }
    let dark = 0;
    for (const row of this.modules)
      dark = row.reduce((sum, color) => sum + (color ? 1 : 0), dark);
    const total = this.size * this.size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * PENALTY_N4;
    return result;
  }
  /* -- Private helper functions -- */
  // Returns an ascending list of positions of alignment patterns for this version number.
  // Each position is in the range [0,177), and are used on both the x and y axes.
  // This could be implemented as lookup table of 40 variable-length lists of integers.
  getAlignmentPatternPositions() {
    if (this.version === 1) {
      return [];
    } else {
      const numAlign = Math.floor(this.version / 7) + 2;
      const step = this.version === 32 ? 26 : Math.ceil((this.version * 4 + 4) / (numAlign * 2 - 2)) * 2;
      const result = [6];
      for (let pos = this.size - 7; result.length < numAlign; pos -= step)
        result.splice(1, 0, pos);
      return result;
    }
  }
  // Can only be called immediately after a light run is added, and
  // returns either 0, 1, or 2. A helper function for getPenaltyScore().
  finderPenaltyCountPatterns(runHistory) {
    const n = runHistory[1];
    const core = n > 0 && runHistory[2] === n && runHistory[3] === n * 3 && runHistory[4] === n && runHistory[5] === n;
    return (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0) + (core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0);
  }
  // Must be called at the end of a line (row or column) of modules. A helper function for getPenaltyScore().
  finderPenaltyTerminateAndCount(currentRunColor, currentRunLength, runHistory) {
    if (currentRunColor) {
      this.finderPenaltyAddHistory(currentRunLength, runHistory);
      currentRunLength = 0;
    }
    currentRunLength += this.size;
    this.finderPenaltyAddHistory(currentRunLength, runHistory);
    return this.finderPenaltyCountPatterns(runHistory);
  }
  // Pushes the given value to the front and drops the last value. A helper function for getPenaltyScore().
  finderPenaltyAddHistory(currentRunLength, runHistory) {
    if (runHistory[0] === 0)
      currentRunLength += this.size;
    runHistory.pop();
    runHistory.unshift(currentRunLength);
  }
};
function appendBits(val, len, bb) {
  if (len < 0 || len > 31 || val >>> len !== 0)
    throw new RangeError("Value out of range");
  for (let i = len - 1; i >= 0; i--)
    bb.push(val >>> i & 1);
}
function getBit(x, i) {
  return (x >>> i & 1) !== 0;
}
var QrSegment = class {
  // Creates a new QR Code segment with the given attributes and data.
  // The character count (numChars) must agree with the mode and the bit buffer length,
  // but the constraint isn't checked. The given bit buffer is cloned and stored.
  constructor(mode, numChars, bitData) {
    this.mode = mode;
    this.numChars = numChars;
    this.bitData = bitData;
    if (numChars < 0)
      throw new RangeError("Invalid argument");
    this.bitData = bitData.slice();
  }
  /* -- Methods -- */
  // Returns a new copy of the data bits of this segment.
  getData() {
    return this.bitData.slice();
  }
};
var MODE_NUMERIC = [1, 10, 12, 14];
var MODE_ALPHANUMERIC = [2, 9, 11, 13];
var MODE_BYTE = [4, 8, 16, 16];
function numCharCountBits(mode, ver) {
  return mode[Math.floor((ver + 7) / 17) + 1];
}
function makeBytes(data) {
  const bb = [];
  for (const b of data)
    appendBits(b, 8, bb);
  return new QrSegment(MODE_BYTE, data.length, bb);
}
function makeNumeric(digits) {
  if (!isNumeric(digits))
    throw new RangeError("String contains non-numeric characters");
  const bb = [];
  for (let i = 0; i < digits.length; ) {
    const n = Math.min(digits.length - i, 3);
    appendBits(Number.parseInt(digits.substring(i, i + n), 10), n * 3 + 1, bb);
    i += n;
  }
  return new QrSegment(MODE_NUMERIC, digits.length, bb);
}
function makeAlphanumeric(text) {
  if (!isAlphanumeric(text))
    throw new RangeError("String contains unencodable characters in alphanumeric mode");
  const bb = [];
  let i;
  for (i = 0; i + 2 <= text.length; i += 2) {
    let temp = ALPHANUMERIC_CHARSET.indexOf(text.charAt(i)) * 45;
    temp += ALPHANUMERIC_CHARSET.indexOf(text.charAt(i + 1));
    appendBits(temp, 11, bb);
  }
  if (i < text.length)
    appendBits(ALPHANUMERIC_CHARSET.indexOf(text.charAt(i)), 6, bb);
  return new QrSegment(MODE_ALPHANUMERIC, text.length, bb);
}
function makeSegments(text) {
  if (text === "")
    return [];
  else if (isNumeric(text))
    return [makeNumeric(text)];
  else if (isAlphanumeric(text))
    return [makeAlphanumeric(text)];
  else
    return [makeBytes(toUtf8ByteArray(text))];
}
function isNumeric(text) {
  return NUMERIC_REGEX.test(text);
}
function isAlphanumeric(text) {
  return ALPHANUMERIC_REGEX.test(text);
}
function getTotalBits(segs, version) {
  let result = 0;
  for (const seg of segs) {
    const ccbits = numCharCountBits(seg.mode, version);
    if (seg.numChars >= 1 << ccbits)
      return Number.POSITIVE_INFINITY;
    result += 4 + ccbits + seg.bitData.length;
  }
  return result;
}
function toUtf8ByteArray(str2) {
  str2 = encodeURI(str2);
  const result = [];
  for (let i = 0; i < str2.length; i++) {
    if (str2.charAt(i) !== "%") {
      result.push(str2.charCodeAt(i));
    } else {
      result.push(Number.parseInt(str2.substring(i + 1, i + 3), 16));
      i += 2;
    }
  }
  return result;
}
function getNumRawDataModules(ver) {
  if (ver < MIN_VERSION || ver > MAX_VERSION)
    throw new RangeError("Version number out of range");
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7)
      result -= 36;
  }
  return result;
}
function getNumDataCodewords(ver, ecl) {
  return Math.floor(getNumRawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[ecl[0]][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecl[0]][ver];
}
function reedSolomonComputeDivisor(degree) {
  if (degree < 1 || degree > 255)
    throw new RangeError("Degree out of range");
  const result = [];
  for (let i = 0; i < degree - 1; i++)
    result.push(0);
  result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = reedSolomonMultiply(result[j], root);
      if (j + 1 < result.length)
        result[j] ^= result[j + 1];
    }
    root = reedSolomonMultiply(root, 2);
  }
  return result;
}
function reedSolomonComputeRemainder(data, divisor) {
  const result = divisor.map((_) => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => result[i] ^= reedSolomonMultiply(coef, factor));
  }
  return result;
}
function reedSolomonMultiply(x, y) {
  if (x >>> 8 !== 0 || y >>> 8 !== 0)
    throw new RangeError("Byte out of range");
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = z << 1 ^ (z >>> 7) * 285;
    z ^= (y >>> i & 1) * x;
  }
  return z;
}
function encodeSegments(segs, ecl, minVersion = 1, maxVersion = 40, mask = -1, boostEcl = true) {
  if (!(MIN_VERSION <= minVersion && minVersion <= maxVersion && maxVersion <= MAX_VERSION) || mask < -1 || mask > 7) {
    throw new RangeError("Invalid value");
  }
  let version;
  let dataUsedBits;
  for (version = minVersion; ; version++) {
    const dataCapacityBits2 = getNumDataCodewords(version, ecl) * 8;
    const usedBits = getTotalBits(segs, version);
    if (usedBits <= dataCapacityBits2) {
      dataUsedBits = usedBits;
      break;
    }
    if (version >= maxVersion)
      throw new RangeError("Data too long");
  }
  for (const newEcl of [MEDIUM, QUARTILE, HIGH]) {
    if (boostEcl && dataUsedBits <= getNumDataCodewords(version, newEcl) * 8)
      ecl = newEcl;
  }
  const bb = [];
  for (const seg of segs) {
    appendBits(seg.mode[0], 4, bb);
    appendBits(seg.numChars, numCharCountBits(seg.mode, version), bb);
    for (const b of seg.getData())
      bb.push(b);
  }
  const dataCapacityBits = getNumDataCodewords(version, ecl) * 8;
  appendBits(0, Math.min(4, dataCapacityBits - bb.length), bb);
  appendBits(0, (8 - bb.length % 8) % 8, bb);
  for (let padByte = 236; bb.length < dataCapacityBits; padByte ^= 236 ^ 17)
    appendBits(padByte, 8, bb);
  const dataCodewords = Array.from({ length: Math.ceil(bb.length / 8) }, () => 0);
  bb.forEach((b, i) => dataCodewords[i >>> 3] |= b << 7 - (i & 7));
  return new QrCode(version, ecl, dataCodewords, mask);
}
function encode(data, options) {
  const {
    ecc = "L",
    boostEcc = false,
    minVersion = 1,
    maxVersion = 40,
    maskPattern = -1,
    border = 1
  } = options || {};
  const segment = typeof data === "string" ? makeSegments(data) : Array.isArray(data) ? [makeBytes(data)] : void 0;
  if (!segment)
    throw new Error(`uqr only supports encoding string and binary data, but got: ${typeof data}`);
  const qr = encodeSegments(
    segment,
    EccMap[ecc],
    minVersion,
    maxVersion,
    maskPattern,
    boostEcc
  );
  const result = addBorder({
    version: qr.version,
    maskPattern: qr.mask,
    size: qr.size,
    data: qr.modules,
    types: qr.types
  }, border);
  if (options?.invert)
    result.data = result.data.map((row) => row.map((mod) => !mod));
  options?.onEncoded?.(result);
  return result;
}
function addBorder(input, border = 1) {
  if (!border)
    return input;
  const { size } = input;
  const newSize = size + border * 2;
  input.size = newSize;
  input.data.forEach((row) => {
    for (let i = 0; i < border; i++) {
      row.unshift(false);
      row.push(false);
    }
  });
  for (let i = 0; i < border; i++) {
    input.data.unshift(Array.from({ length: newSize }, (_) => false));
    input.data.push(Array.from({ length: newSize }, (_) => false));
  }
  const b = QrCodeDataType.Border;
  input.types.forEach((row) => {
    for (let i = 0; i < border; i++) {
      row.unshift(b);
      row.push(b);
    }
  });
  for (let i = 0; i < border; i++) {
    input.types.unshift(Array.from({ length: newSize }, (_) => b));
    input.types.push(Array.from({ length: newSize }, (_) => b));
  }
  return input;
}
function escapeAttr(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function renderSVG(data, options = {}) {
  const result = encode(data, options);
  const {
    pixelSize = 10,
    whiteColor = "white",
    blackColor = "black"
  } = options;
  const height = result.size * pixelSize;
  const width = result.size * pixelSize;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">`;
  const paths = [];
  for (let row = 0; row < result.size; row++) {
    for (let col = 0; col < result.size; col++) {
      const x = col * pixelSize;
      const y = row * pixelSize;
      if (result.data[row][col])
        paths.push(`M${x},${y}h${pixelSize}v${pixelSize}h-${pixelSize}z`);
    }
  }
  svg += `<rect fill="${escapeAttr(whiteColor)}" width="${width}" height="${height}"/>`;
  svg += `<path fill="${escapeAttr(blackColor)}" d="${paths.join("")}"/>`;
  svg += "</svg>";
  return svg;
}

// src/routes/auth.ts
var app2 = new Hono3();
app2.get("/me", requireUser, async (c) => {
  const u = c.get("user");
  const unread = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM emails WHERE user_id = ? AND is_read = 0"
  ).bind(u.id).first();
  return c.json({ ok: true, user: u, unread: unread?.n ?? 0 });
});
app2.post("/login", async (c) => {
  const ip = clientIp(c);
  if (!await rateLimit(c.env, ip, "login", 10))
    return c.json({ ok: false, error: "rate_limited" }, 429);
  const body = await c.req.json().catch(() => null);
  const username = (body?.username ?? "").trim();
  const password = body?.password ?? "";
  const withUsername = await getSetting(c.env, "login_username") !== "0";
  const user = withUsername && username ? await c.env.DB.prepare("SELECT id, username, role, password_hash, totp_enabled FROM users WHERE username = ?").bind(username).first() : await c.env.DB.prepare("SELECT id, username, role, password_hash, totp_enabled FROM users ORDER BY created_at LIMIT 1").first();
  if (!user || !await verifyPassword(password, user.password_hash)) {
    return c.json({ ok: false, error: "invalid_credentials" }, 401);
  }
  await rateLimitClear(c.env, ip, "login");
  if (user.totp_enabled) {
    const pending = randomToken(24);
    await setSetting(c.env, `pending2fa:${pending}`, `${user.id}.${now() + 5 * 6e4}`);
    return c.json({ ok: true, totp_required: true, pending });
  }
  await c.env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(now(), user.id).run();
  const token = await createSession(c.env, user.id, c.req.header("User-Agent"), ip);
  setSessionCookie(c, token);
  return c.json({ ok: true, user: { id: user.id, username: user.username, role: user.role } });
});
app2.post("/login/totp", async (c) => {
  const ip = clientIp(c);
  if (!await rateLimit(c.env, ip, "totp", 10))
    return c.json({ ok: false, error: "rate_limited" }, 429);
  const body = await c.req.json().catch(() => null);
  const pending = body?.pending ?? "";
  const code = (body?.code ?? "").trim();
  if (!pending || !/^\d{6,8}$/.test(code))
    return c.json({ ok: false, error: "invalid_request" }, 400);
  const val = await getSetting(c.env, `pending2fa:${pending}`);
  if (!val)
    return c.json({ ok: false, error: "pending_expired" }, 401);
  const [userId, expStr] = val.split(".");
  if (Number(expStr) < now()) {
    await c.env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(`pending2fa:${pending}`).run();
    return c.json({ ok: false, error: "pending_expired" }, 401);
  }
  const user = await c.env.DB.prepare("SELECT id, username, role, totp_secret FROM users WHERE id = ?").bind(userId).first();
  if (!user || !user.totp_secret)
    return c.json({ ok: false, error: "invalid_request" }, 400);
  const secret = await openText(c.env, user.totp_secret);
  if (!await verifyTotp(secret, code))
    return c.json({ ok: false, error: "invalid_code" }, 401);
  await c.env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(`pending2fa:${pending}`).run();
  await c.env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(now(), user.id).run();
  const token = await createSession(c.env, user.id, c.req.header("User-Agent"), ip);
  setSessionCookie(c, token);
  return c.json({ ok: true, user: { id: user.id, username: user.username, role: user.role } });
});
app2.post("/logout", async (c) => {
  await destroySession(c.env, tokenFrom(c));
  clearSessionCookie(c);
  return c.json({ ok: true });
});
app2.post("/password", requireUser, async (c) => {
  const u = c.get("user");
  const body = await c.req.json().catch(() => null);
  const row = await c.env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(u.id).first();
  if (!row || !await verifyPassword(body?.current ?? "", row.password_hash)) {
    return c.json({ ok: false, error: "invalid_credentials" }, 401);
  }
  if (!passwordStrong(body?.next ?? ""))
    return c.json({ ok: false, error: "weak_password" }, 400);
  await c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(body.next), u.id).run();
  return c.json({ ok: true });
});
app2.post("/totp/start", requireUser, async (c) => {
  const u = c.get("user");
  if (u.totp_enabled)
    return c.json({ ok: false, error: "totp_enabled" }, 409);
  const secret = randomSecret();
  const uri = buildOtpauthUri({ secret, issuer: "Cmail", name: u.username, algo: "SHA1", digits: 6, period: 30 });
  return c.json({ ok: true, secret, uri });
});
app2.post("/totp/enable", requireUser, async (c) => {
  const u = c.get("user");
  const body = await c.req.json().catch(() => null);
  const secret = (body?.secret ?? "").trim();
  const code = (body?.code ?? "").trim();
  if (!secret || !/^\d{6,8}$/.test(code))
    return c.json({ ok: false, error: "invalid_request" }, 400);
  if (!await verifyTotp(secret, code))
    return c.json({ ok: false, error: "invalid_code" }, 401);
  const sealed = await sealText(c.env, secret);
  await c.env.DB.prepare("UPDATE users SET totp_enabled = 1, totp_secret = ? WHERE id = ?").bind(sealed, u.id).run();
  return c.json({ ok: true });
});
app2.post("/totp/qr", requireUser, async (c) => {
  const body = await c.req.json().catch(() => null);
  const secret = (body?.secret ?? "").trim();
  if (!secret)
    return c.json({ ok: false, error: "invalid_request" }, 400);
  const u = c.get("user");
  const uri = buildOtpauthUri({ secret, issuer: "Cmail", name: body?.name ?? u.username, algo: "SHA1", digits: 6, period: 30 });
  const svg = renderSVG(uri, { border: 1 });
  return c.body(svg, 200, { "content-type": "image/svg+xml", "cache-control": "no-store" });
});
app2.post("/totp/disable", requireUser, async (c) => {
  const u = c.get("user");
  const body = await c.req.json().catch(() => null);
  const row = await c.env.DB.prepare("SELECT totp_secret FROM users WHERE id = ?").bind(u.id).first();
  if (row?.totp_secret) {
    const secret = await openText(c.env, row.totp_secret);
    if (!await verifyTotp(secret, (body?.code ?? "").trim()))
      return c.json({ ok: false, error: "invalid_code" }, 401);
  }
  await c.env.DB.prepare("UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?").bind(u.id).run();
  return c.json({ ok: true });
});
var auth_default = app2;

// src/routes/addresses.ts
init_util();
var app3 = new Hono3();
app3.get("/domains", requireUser, async (c) => {
  const u = c.get("user");
  const admin = u.role === "admin";
  const { results } = admin ? await c.env.DB.prepare("SELECT * FROM domains ORDER BY created_at DESC").all() : await c.env.DB.prepare("SELECT id, name, label FROM domains WHERE active = 1 ORDER BY created_at").all();
  const counts = await c.env.DB.prepare(
    `SELECT d.id, COUNT(a.id) AS n FROM domains d LEFT JOIN addresses a ON a.domain_id = d.id GROUP BY d.id`
  ).all();
  const countMap = new Map((counts.results ?? []).map((r) => [r.id, r.n]));
  const lasts = await c.env.DB.prepare(
    `SELECT d.id AS id, MAX(e.received_at) AS last_mail
     FROM domains d
     LEFT JOIN addresses a ON a.domain_id = d.id
     LEFT JOIN emails e ON e.address_id = a.id
     GROUP BY d.id`
  ).all();
  const lastMap = new Map((lasts.results ?? []).map((r) => [r.id, r.last_mail]));
  return c.json({ ok: true, domains: (results ?? []).map((d) => ({ ...d, address_count: countMap.get(d.id) ?? 0, last_mail: lastMap.get(d.id) ?? null })) });
});
app3.post("/domains", requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => null);
  const name = (body?.name ?? "").toLowerCase().trim();
  if (!RE_DOMAIN.test(name))
    return c.json({ ok: false, error: "invalid_domain" }, 400);
  const exists = await c.env.DB.prepare("SELECT id FROM domains WHERE name = ?").bind(name).first();
  if (exists)
    return c.json({ ok: false, error: "domain_exists" }, 409);
  const id = uid("dom_");
  await c.env.DB.prepare("INSERT INTO domains (id, name, label, catch_all, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, name, clean(body?.label, 80) || null, body?.catch_all === false ? 0 : 1, now()).run();
  return c.json({ ok: true, domain: { id, name } });
});
app3.patch("/domains/:id", requireAdmin, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const dom = await c.env.DB.prepare("SELECT id FROM domains WHERE id = ?").bind(id).first();
  if (!dom)
    return c.json({ ok: false, error: "not_found" }, 404);
  if (body?.label !== void 0)
    await c.env.DB.prepare("UPDATE domains SET label = ? WHERE id = ?").bind(clean(body.label, 80) || null, id).run();
  if (body?.active !== void 0)
    await c.env.DB.prepare("UPDATE domains SET active = ? WHERE id = ?").bind(body.active ? 1 : 0, id).run();
  if (body?.catch_all !== void 0)
    await c.env.DB.prepare("UPDATE domains SET catch_all = ? WHERE id = ?").bind(body.catch_all ? 1 : 0, id).run();
  return c.json({ ok: true });
});
app3.delete("/domains/:id", requireAdmin, async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM domains WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});
app3.get("/", requireUser, async (c) => {
  const u = c.get("user");
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.address, a.label, a.kind, a.expires_at, a.forward_to, a.notes, a.created_at, a.last_mail_at, d.name AS domain,
       (SELECT COUNT(*) FROM emails e WHERE e.address_id = a.id AND e.is_read = 0) AS unread,
       (SELECT COUNT(*) FROM emails e WHERE e.address_id = a.id) AS total
     FROM addresses a LEFT JOIN domains d ON d.id = a.domain_id
     WHERE a.user_id = ? ORDER BY a.created_at DESC`
  ).bind(u.id).all();
  return c.json({ ok: true, addresses: results ?? [] });
});
app3.post("/", requireUser, async (c) => {
  const u = c.get("user");
  const body = await c.req.json().catch(() => null);
  const kind = body?.kind === "temp" ? "temp" : "permanent";
  const domainName = (body?.domain ?? "").toLowerCase().trim();
  const domain = await c.env.DB.prepare("SELECT id, name, active FROM domains WHERE name = ?").bind(domainName).first();
  if (!domain || !domain.active)
    return c.json({ ok: false, error: "invalid_domain" }, 400);
  let local = (body?.local ?? "").toLowerCase().trim();
  if (local === "__random__" || !local)
    local = randomLocalPart();
  if (!RE_LOCAL_PART.test(local))
    return c.json({ ok: false, error: "invalid_local_part" }, 400);
  const cap = parseInt(await getSetting(c.env, "max_addresses") ?? "50", 10) || 50;
  const cnt = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM addresses WHERE user_id = ?").bind(u.id).first();
  if ((cnt?.n ?? 0) >= cap)
    return c.json({ ok: false, error: "address_limit" }, 409);
  const address = `${local}@${domain.name}`;
  const exists = await c.env.DB.prepare("SELECT id FROM addresses WHERE address = ?").bind(address).first();
  if (exists)
    return c.json({ ok: false, error: "address_taken" }, 409);
  let expiresAt = null;
  if (kind === "temp") {
    const ttl = Math.min(8760, Math.max(1, body?.ttl_hours ?? (parseInt(await getSetting(c.env, "temp_ttl_default") ?? "24", 10) || 24)));
    expiresAt = now() + ttl * 36e5;
  }
  const id = uid("adr_");
  await c.env.DB.prepare(
    "INSERT INTO addresses (id, user_id, domain_id, address, label, notes, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, u.id, domain.id, address, clean(body?.label, 80) || null, clean(body?.notes, 4e3) || "", kind, expiresAt, now()).run();
  return c.json({ ok: true, address: { id, address, kind, expires_at: expiresAt, label: clean(body?.label, 80) || null } });
});
app3.patch("/:id", requireUser, async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  const addr = await c.env.DB.prepare("SELECT id, user_id, kind, expires_at FROM addresses WHERE id = ? AND user_id = ?").bind(id, u.id).first();
  if (!addr)
    return c.json({ ok: false, error: "not_found" }, 404);
  const body = await c.req.json().catch(() => null);
  if (body?.label !== void 0)
    await c.env.DB.prepare("UPDATE addresses SET label = ? WHERE id = ?").bind(clean(body.label, 80) || null, id).run();
  if (body?.notes !== void 0)
    await c.env.DB.prepare("UPDATE addresses SET notes = ? WHERE id = ?").bind(clean(body.notes, 4e3) ?? "", id).run();
  if (body?.forward_to !== void 0) {
    const fwd = clean(body.forward_to, 120);
    if (fwd && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fwd))
      return c.json({ ok: false, error: "invalid_email" }, 400);
    await c.env.DB.prepare("UPDATE addresses SET forward_to = ? WHERE id = ?").bind(fwd || null, id).run();
  }
  if (body?.extend_hours && addr.kind === "temp") {
    const base = Math.max(now(), addr.expires_at ?? now());
    const hours = Math.min(8760, Math.max(1, body.extend_hours));
    await c.env.DB.prepare("UPDATE addresses SET expires_at = ? WHERE id = ?").bind(base + hours * 36e5, id).run();
  }
  return c.json({ ok: true });
});
app3.delete("/:id", requireUser, async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM addresses WHERE id = ? AND user_id = ?").bind(id, u.id).run();
  return c.json({ ok: true });
});
app3.post("/:id/purge", requireUser, async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  const addr = await c.env.DB.prepare("SELECT id FROM addresses WHERE id = ? AND user_id = ?").bind(id, u.id).first();
  if (!addr)
    return c.json({ ok: false, error: "not_found" }, 404);
  await c.env.DB.prepare("DELETE FROM emails WHERE address_id = ?").bind(id).run();
  return c.json({ ok: true });
});
var addresses_default = app3;

// src/routes/emails.ts
init_util();

// src/emailout.ts
init_util();
async function sendViaProvider(env, opts) {
  const cfg = await getSettings(env, ["sending_provider", "sending_api_key", "sending_from_email", "sending_from_name"]);
  const provider = cfg.sending_provider ?? "none";
  const apiKey = cfg.sending_api_key ?? "";
  const fromEmail = cfg.sending_from_email ?? "";
  const fromName = cfg.sending_from_name ?? "Cmail";
  if (provider === "none")
    return { ok: false, error: "sending_not_configured" };
  if (!apiKey || !fromEmail)
    return { ok: false, error: "sending_not_configured" };
  try {
    if (provider === "brevo") {
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender: { email: fromEmail, name: fromName },
          to: [{ email: opts.to, name: opts.toName ?? opts.to }],
          subject: opts.subject,
          textContent: opts.text,
          htmlContent: opts.html || `<pre style="font:14px/1.6 sans-serif;white-space:pre-wrap">${escapeHtml2(opts.text)}</pre>`,
          replyTo: opts.replyTo ? { email: opts.replyTo } : void 0
        })
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, error: `brevo_${res.status}: ${body.slice(0, 300)}` };
      }
      const data = await res.json();
      return { ok: true, id: data.messageId };
    }
    if (provider === "resend") {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
          to: [opts.to],
          subject: opts.subject,
          text: opts.text,
          html: opts.html,
          reply_to: opts.replyTo
        })
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, error: `resend_${res.status}: ${body.slice(0, 300)}` };
      }
      const data = await res.json();
      return { ok: true, id: data.id };
    }
    return { ok: false, error: "unknown_provider" };
  } catch (e) {
    return { ok: false, error: `network: ${e.message.slice(0, 200)}` };
  }
}
async function testProvider(env, to) {
  return sendViaProvider(env, {
    to,
    subject: "\u2709\uFE0F Cmail \u2014 test message",
    text: "This is a test message from your Cmail instance. If you received it, outgoing mail works!",
    html: '<div style="font:15px/1.7 sans-serif">This is a <b>test message</b> from your Cmail instance.<br>If you received it, outgoing mail works! \u2709\uFE0F</div>'
  });
}
function escapeHtml2(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// src/routes/emails.ts
var app4 = new Hono3();
var LIST_FIELDS = "e.id, e.address_id, e.from_name, e.from_addr, e.to_addr, e.subject, e.preview, e.size, e.is_read, e.starred, e.has_note, e.received_at, a.address, a.label AS address_label, a.kind AS address_kind";
app4.get("/", requireUser, async (c) => {
  const u = c.get("user");
  const q = c.req.query();
  const addressId = q.address_id ?? "";
  const box = q.box ?? "inbox";
  const search = (q.q ?? "").trim();
  const limit = Math.min(100, Math.max(10, parseInt(q.limit ?? "50", 10)));
  const offset = Math.max(0, parseInt(q.offset ?? "0", 10));
  const where = ["e.user_id = ?"];
  const binds = [u.id];
  if (addressId) {
    where.push("e.address_id = ?");
    binds.push(addressId);
  }
  if (box === "starred")
    where.push("e.starred = 1");
  if (box === "unread")
    where.push("e.is_read = 0");
  if (box === "noted")
    where.push("e.has_note = 1");
  if (search) {
    where.push("(e.subject LIKE ? OR e.from_addr LIKE ? OR e.from_name LIKE ? OR e.preview LIKE ?)");
    const like = `%${search}%`;
    binds.push(like, like, like, like);
  }
  const sql = `SELECT ${LIST_FIELDS} FROM emails e JOIN addresses a ON a.id = e.address_id
     WHERE ${where.join(" AND ")} ORDER BY e.received_at DESC LIMIT ${limit} OFFSET ${offset}`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  const cntSql = `SELECT COUNT(*) AS n FROM emails e WHERE ${where.join(" AND ")}`;
  const total = await c.env.DB.prepare(cntSql).bind(...binds).first();
  return c.json({ ok: true, emails: results ?? [], total: total?.n ?? 0, limit, offset });
});
app4.get("/stats", requireUser, async (c) => {
  const u = c.get("user");
  const [total, unread, starred, noted, addresses] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM emails WHERE user_id = ?").bind(u.id).first(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM emails WHERE user_id = ? AND is_read = 0").bind(u.id).first(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM emails WHERE user_id = ? AND starred = 1").bind(u.id).first(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM emails WHERE user_id = ? AND has_note = 1").bind(u.id).first(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM addresses WHERE user_id = ?").bind(u.id).first()
  ]);
  return c.json({
    ok: true,
    stats: {
      total: total?.n ?? 0,
      unread: unread?.n ?? 0,
      starred: starred?.n ?? 0,
      noted: noted?.n ?? 0,
      addresses: addresses?.n ?? 0
    }
  });
});
app4.get("/:id", requireUser, async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  const email = await c.env.DB.prepare(
    `SELECT e.*, a.address, a.label AS address_label FROM emails e JOIN addresses a ON a.id = e.address_id
     WHERE e.id = ? AND e.user_id = ?`
  ).bind(id, u.id).first();
  if (!email)
    return c.json({ ok: false, error: "not_found" }, 404);
  const atts = await c.env.DB.prepare(
    "SELECT id, filename, content_type, size, (content_b64 IS NOT NULL) AS available FROM attachments WHERE email_id = ?"
  ).bind(id).all();
  const note = await c.env.DB.prepare("SELECT body, color, pinned, updated_at FROM email_notes WHERE email_id = ?").bind(id).first();
  if (!email.is_read)
    await c.env.DB.prepare("UPDATE emails SET is_read = 1 WHERE id = ?").bind(id).run();
  return c.json({ ok: true, email: { ...email, is_read: 1 }, attachments: atts.results ?? [], note: note ?? null });
});
app4.patch("/:id", requireUser, async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const own = await c.env.DB.prepare("SELECT id FROM emails WHERE id = ? AND user_id = ?").bind(id, u.id).first();
  if (!own)
    return c.json({ ok: false, error: "not_found" }, 404);
  if (body?.is_read !== void 0)
    await c.env.DB.prepare("UPDATE emails SET is_read = ? WHERE id = ?").bind(body.is_read ? 1 : 0, id).run();
  if (body?.starred !== void 0)
    await c.env.DB.prepare("UPDATE emails SET starred = ? WHERE id = ?").bind(body.starred ? 1 : 0, id).run();
  return c.json({ ok: true });
});
app4.delete("/:id", requireUser, async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM emails WHERE id = ? AND user_id = ?").bind(id, u.id).run();
  return c.json({ ok: true });
});
app4.post("/bulk", requireUser, async (c) => {
  const u = c.get("user");
  const body = await c.req.json().catch(() => null);
  const ids = (body?.ids ?? []).slice(0, 500);
  const action = body?.action ?? "";
  if (!ids.length)
    return c.json({ ok: false, error: "no_ids" }, 400);
  const ph = ids.map(() => "?").join(",");
  switch (action) {
    case "read":
      await c.env.DB.prepare(`UPDATE emails SET is_read = 1 WHERE user_id = ? AND id IN (${ph})`).bind(u.id, ...ids).run();
      break;
    case "unread":
      await c.env.DB.prepare(`UPDATE emails SET is_read = 0 WHERE user_id = ? AND id IN (${ph})`).bind(u.id, ...ids).run();
      break;
    case "star":
      await c.env.DB.prepare(`UPDATE emails SET starred = 1 WHERE user_id = ? AND id IN (${ph})`).bind(u.id, ...ids).run();
      break;
    case "unstar":
      await c.env.DB.prepare(`UPDATE emails SET starred = 0 WHERE user_id = ? AND id IN (${ph})`).bind(u.id, ...ids).run();
      break;
    case "delete":
      await c.env.DB.prepare(`DELETE FROM emails WHERE user_id = ? AND id IN (${ph})`).bind(u.id, ...ids).run();
      break;
    default:
      return c.json({ ok: false, error: "unknown_action" }, 400);
  }
  return c.json({ ok: true });
});
app4.put("/:id/note", requireUser, async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const own = await c.env.DB.prepare("SELECT id FROM emails WHERE id = ? AND user_id = ?").bind(id, u.id).first();
  if (!own)
    return c.json({ ok: false, error: "not_found" }, 404);
  const text = typeof body?.body === "string" ? body.body.slice(0, 1e4) : "";
  const color = ["amber", "mint", "sky", "rose", "violet"].includes(body?.color ?? "") ? body.color : "amber";
  if (!text.trim()) {
    await c.env.DB.prepare("DELETE FROM email_notes WHERE email_id = ?").bind(id).run();
    await c.env.DB.prepare("UPDATE emails SET has_note = 0 WHERE id = ?").bind(id).run();
    return c.json({ ok: true, note: null });
  }
  await c.env.DB.prepare(
    `INSERT INTO email_notes (email_id, user_id, body, color, pinned, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(email_id) DO UPDATE SET body = excluded.body, color = excluded.color, pinned = excluded.pinned, updated_at = excluded.updated_at`
  ).bind(id, u.id, text, color, body?.pinned ? 1 : 0, now()).run();
  await c.env.DB.prepare("UPDATE emails SET has_note = 1 WHERE id = ?").bind(id).run();
  return c.json({ ok: true, note: { email_id: id, body: text, color, pinned: !!body?.pinned, updated_at: now() } });
});
app4.get("/attachment/:attId", requireUser, async (c) => {
  const u = c.get("user");
  const attId = c.req.param("attId");
  const row = await c.env.DB.prepare(
    `SELECT at.filename, at.content_type, at.content_b64, at.email_id FROM attachments at
     JOIN emails e ON e.id = at.email_id WHERE at.id = ? AND e.user_id = ?`
  ).bind(attId, u.id).first();
  if (!row)
    return c.json({ ok: false, error: "not_found" }, 404);
  if (!row.content_b64)
    return c.json({ ok: false, error: "attachment_too_large" }, 413);
  const buf = Uint8Array.from(atob(row.content_b64), (ch) => ch.charCodeAt(0));
  return new Response(buf.buffer, {
    headers: {
      "content-type": row.content_type || "application/octet-stream",
      "content-disposition": `attachment; filename="${(row.filename || "attachment").replace(/[^\w.\- ]/g, "_")}"`
    }
  });
});
app4.post("/send", requireUser, async (c) => {
  const u = c.get("user");
  const body = await c.req.json().catch(() => null);
  const to = clean(body?.to, 120);
  const subject = clean(body?.subject, 200) || "(no subject)";
  const text = typeof body?.text === "string" ? body.text.slice(0, 1e5) : "";
  const html = typeof body?.html === "string" ? body.html.slice(0, 3e5) : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))
    return c.json({ ok: false, error: "invalid_recipient" }, 400);
  if (!text && !html)
    return c.json({ ok: false, error: "empty_body" }, 400);
  const from = await c.env.DB.prepare("SELECT address FROM addresses WHERE id = ? AND user_id = ?").bind(body?.from_address_id ?? "", u.id).first();
  if (!from)
    return c.json({ ok: false, error: "invalid_sender" }, 400);
  const provider = await getSetting(c.env, "sending_provider") ?? "none";
  if (provider === "none")
    return c.json({ ok: false, error: "sending_not_configured" }, 409);
  const res = await sendViaProvider(c.env, { to, subject, text, html, replyTo: from.address });
  if (!res.ok)
    return c.json({ ok: false, error: "send_failed", detail: res.error }, 502);
  return c.json({ ok: true });
});
var emails_default = app4;

// src/routes/totp.ts
init_util();
var app5 = new Hono3();
app5.get("/folders", requireUser, async (c) => {
  const u = c.get("user");
  const { results } = await c.env.DB.prepare(
    `SELECT f.id, f.name, f.icon, f.color, f.created_at,
       (SELECT COUNT(*) FROM totp_entries e WHERE e.folder_id = f.id) AS count
     FROM totp_folders f WHERE f.user_id = ? ORDER BY f.created_at`
  ).bind(u.id).all();
  return c.json({ ok: true, folders: results ?? [] });
});
app5.post("/folders", requireUser, async (c) => {
  const u = c.get("user");
  const body = await c.req.json().catch(() => null);
  const name = clean(body?.name, 40);
  if (!name)
    return c.json({ ok: false, error: "name_required" }, 400);
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM totp_folders WHERE user_id = ?").bind(u.id).first();
  if ((count?.n ?? 0) >= 30)
    return c.json({ ok: false, error: "folder_limit" }, 409);
  const id = uid("fld_");
  await c.env.DB.prepare("INSERT INTO totp_folders (id, user_id, name, icon, color, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, u.id, name, clean(body?.icon, 40) || null, clean(body?.color, 20) || null, now()).run();
  return c.json({ ok: true, folder: { id, name, icon: clean(body?.icon, 40) || null, color: clean(body?.color, 20) || null, count: 0 } });
});
app5.patch("/folders/:id", requireUser, async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  const own = await c.env.DB.prepare("SELECT id FROM totp_folders WHERE id = ? AND user_id = ?").bind(id, u.id).first();
  if (!own)
    return c.json({ ok: false, error: "not_found" }, 404);
  const body = await c.req.json().catch(() => null);
  if (body?.name !== void 0)
    await c.env.DB.prepare("UPDATE totp_folders SET name = ? WHERE id = ?").bind(clean(body.name, 40) || "unnamed", id).run();
  if (body?.icon !== void 0)
    await c.env.DB.prepare("UPDATE totp_folders SET icon = ? WHERE id = ?").bind(clean(body.icon, 40) || null, id).run();
  if (body?.color !== void 0)
    await c.env.DB.prepare("UPDATE totp_folders SET color = ? WHERE id = ?").bind(clean(body.color, 20) || null, id).run();
  return c.json({ ok: true });
});
app5.delete("/folders/:id", requireUser, async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  await c.env.DB.prepare("UPDATE totp_entries SET folder_id = NULL WHERE folder_id = ? AND user_id = ?").bind(id, u.id).run();
  await c.env.DB.prepare("DELETE FROM totp_folders WHERE id = ? AND user_id = ?").bind(id, u.id).run();
  return c.json({ ok: true });
});
app5.get("/", requireUser, async (c) => {
  const u = c.get("user");
  const scope = (c.req.query("address_id") ?? "").trim();
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, issuer, algo, digits, period, color, sort, created_at, icon, address_id, folder_id FROM totp_entries
     WHERE user_id = ? ${scope ? "AND address_id = ?" : ""} ORDER BY sort, created_at`
  ).bind(...scope ? [u.id, scope] : [u.id]).all();
  const entries = results ?? [];
  const t = Date.now();
  const withCodes = await Promise.all(entries.map(async (e) => {
    try {
      const row = await c.env.DB.prepare("SELECT secret_enc FROM totp_entries WHERE id = ? AND user_id = ?").bind(e.id, u.id).first();
      const secret = await openText(c.env, row.secret_enc);
      const code = await totp(secret, e.algo, e.digits, e.period, t);
      const remaining = await totpRemaining(e.period, t);
      return { ...e, code, remaining };
    } catch {
      return { ...e, code: null, remaining: e.period };
    }
  }));
  return c.json({ ok: true, entries: withCodes, server_time: t });
});
app5.get("/codes", requireUser, async (c) => {
  const u = c.get("user");
  const { results } = await c.env.DB.prepare("SELECT id, algo, digits, period, secret_enc FROM totp_entries WHERE user_id = ?").bind(u.id).all();
  const t = Date.now();
  const codes = await Promise.all((results ?? []).map(async (e) => {
    try {
      const secret = await openText(c.env, e.secret_enc);
      return { id: e.id, code: await totp(secret, e.algo, e.digits, e.period, t), remaining: await totpRemaining(e.period, t) };
    } catch {
      return { id: e.id, code: null, remaining: 0 };
    }
  }));
  return c.json({ ok: true, codes, server_time: t });
});
app5.post("/", requireUser, async (c) => {
  const u = c.get("user");
  const body = await c.req.json().catch(() => null);
  let name = clean(body?.name, 60);
  let issuer = clean(body?.issuer, 60);
  let secret = "";
  let algo = ["SHA1", "SHA256", "SHA512"].includes(body?.algo ?? "") ? body.algo : "SHA1";
  let digits = Math.min(8, Math.max(6, body?.digits ?? 6));
  let period = Math.min(120, Math.max(15, body?.period ?? 30));
  if (body?.uri) {
    const cfg = parseOtpauthUri(body.uri.trim());
    if (!cfg)
      return c.json({ ok: false, error: "invalid_uri" }, 400);
    secret = cfg.secret;
    name = name || cfg.name || "";
    issuer = issuer || cfg.issuer || "";
    algo = ["SHA1", "SHA256", "SHA512"].includes(cfg.algo) ? cfg.algo : algo;
    digits = cfg.digits;
    period = cfg.period;
  } else {
    secret = normalizeSecret(body?.secret ?? "");
  }
  if (!secret || secret.length < 8)
    return c.json({ ok: false, error: "invalid_secret" }, 400);
  if (!name)
    return c.json({ ok: false, error: "name_required" }, 400);
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM totp_entries WHERE user_id = ?").bind(u.id).first();
  if ((count?.n ?? 0) >= 100)
    return c.json({ ok: false, error: "vault_limit" }, 409);
  const id = uid("tfa_");
  const sealed = await sealText(c.env, secret);
  let addressId = null;
  if (body?.address_id) {
    const own = await c.env.DB.prepare("SELECT id FROM addresses WHERE id = ? AND user_id = ?").bind(body.address_id, u.id).first();
    if (own)
      addressId = body.address_id;
  }
  const icon = clean(body?.icon, 40) || null;
  let folderId = null;
  if (body?.folder_id) {
    const fown = await c.env.DB.prepare("SELECT id FROM totp_folders WHERE id = ? AND user_id = ?").bind(body.folder_id, u.id).first();
    if (fown)
      folderId = body.folder_id;
  }
  await c.env.DB.prepare(
    "INSERT INTO totp_entries (id, user_id, name, issuer, secret_enc, algo, digits, period, color, sort, created_at, icon, address_id, folder_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, u.id, name, issuer || null, sealed, algo, digits, period, clean(body?.color, 20) || null, count?.n ?? 0, now(), icon, addressId, folderId).run();
  const code = await totp(secret, algo, digits, period);
  return c.json({ ok: true, entry: { id, name, issuer, algo, digits, period, color: body?.color ?? null, icon, address_id: addressId, code, remaining: await totpRemaining(period) } });
});
app5.get("/:id/qr", requireUser, async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT name, issuer, secret_enc, algo, digits, period FROM totp_entries WHERE id = ? AND user_id = ?").bind(id, u.id).first();
  if (!row)
    return c.json({ ok: false, error: "not_found" }, 404);
  const secret = await openText(c.env, row.secret_enc);
  const label = `${row.issuer ?? "Cmail"}:${row.name}`;
  const p = new URLSearchParams({ secret, issuer: row.issuer ?? "Cmail", algorithm: row.algo, digits: String(row.digits), period: String(row.period) });
  const uri = `otpauth://totp/${encodeURIComponent(label)}?${p.toString()}`;
  const svg = renderSVG(uri, { border: 1 });
  return c.body(svg, 200, { "content-type": "image/svg+xml", "cache-control": "no-store" });
});
app5.get("/:id/secret", requireUser, async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT secret_enc, name FROM totp_entries WHERE id = ? AND user_id = ?").bind(id, u.id).first();
  if (!row)
    return c.json({ ok: false, error: "not_found" }, 404);
  const secret = await openText(c.env, row.secret_enc);
  return c.json({ ok: true, secret, name: row.name });
});
app5.patch("/:id", requireUser, async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const row = await c.env.DB.prepare("SELECT id FROM totp_entries WHERE id = ? AND user_id = ?").bind(id, u.id).first();
  if (!row)
    return c.json({ ok: false, error: "not_found" }, 404);
  if (body?.name !== void 0)
    await c.env.DB.prepare("UPDATE totp_entries SET name = ? WHERE id = ?").bind(clean(body.name, 60) || "unnamed", id).run();
  if (body?.issuer !== void 0)
    await c.env.DB.prepare("UPDATE totp_entries SET issuer = ? WHERE id = ?").bind(clean(body.issuer, 60) || null, id).run();
  if (body?.color !== void 0)
    await c.env.DB.prepare("UPDATE totp_entries SET color = ? WHERE id = ?").bind(clean(body.color, 20) || null, id).run();
  if (body?.sort !== void 0)
    await c.env.DB.prepare("UPDATE totp_entries SET sort = ? WHERE id = ?").bind(Math.max(0, Math.min(9999, body.sort)), id).run();
  if (body?.icon !== void 0)
    await c.env.DB.prepare("UPDATE totp_entries SET icon = ? WHERE id = ?").bind(clean(body.icon, 40) || null, id).run();
  if (body?.address_id !== void 0) {
    let addressId = null;
    if (body.address_id) {
      const own = await c.env.DB.prepare("SELECT id FROM addresses WHERE id = ? AND user_id = ?").bind(body.address_id, u.id).first();
      if (own)
        addressId = body.address_id;
    }
    await c.env.DB.prepare("UPDATE totp_entries SET address_id = ? WHERE id = ?").bind(addressId, id).run();
  }
  if (body?.folder_id !== void 0) {
    let folderId = null;
    if (body.folder_id) {
      const fown = await c.env.DB.prepare("SELECT id FROM totp_folders WHERE id = ? AND user_id = ?").bind(body.folder_id, u.id).first();
      if (fown)
        folderId = body.folder_id;
    }
    await c.env.DB.prepare("UPDATE totp_entries SET folder_id = ? WHERE id = ?").bind(folderId, id).run();
  }
  return c.json({ ok: true });
});
app5.delete("/:id", requireUser, async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM totp_entries WHERE id = ? AND user_id = ?").bind(id, u.id).run();
  return c.json({ ok: true });
});
app5.post("/:id/verify", requireUser, async (c) => {
  const u = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const row = await c.env.DB.prepare("SELECT secret_enc, algo, digits, period FROM totp_entries WHERE id = ? AND user_id = ?").bind(id, u.id).first();
  if (!row)
    return c.json({ ok: false, error: "not_found" }, 404);
  const secret = await openText(c.env, row.secret_enc);
  const valid = await verifyTotp(secret, (body?.code ?? "").trim(), row.algo, row.digits, row.period);
  return c.json({ ok: true, valid });
});
var totp_default = app5;

// src/routes/admin.ts
init_util();
var app6 = new Hono3();
app6.get("/overview", requireAdmin, async (c) => {
  const [users, addresses, emails, temp, storage, domains, notes, totp2] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM addresses").first(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM emails").first(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM addresses WHERE kind='temp'").first(),
    c.env.DB.prepare("SELECT COALESCE(SUM(size),0) AS n FROM emails").first(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM domains WHERE active=1").first(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM email_notes").first(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM totp_entries").first()
  ]);
  return c.json({
    ok: true,
    overview: {
      users: users?.n ?? 0,
      addresses: addresses?.n ?? 0,
      emails: emails?.n ?? 0,
      temp_addresses: temp?.n ?? 0,
      storage_bytes: storage?.n ?? 0,
      domains: domains?.n ?? 0,
      notes: notes?.n ?? 0,
      totp_entries: totp2?.n ?? 0
    }
  });
});
app6.get("/users", requireAdmin, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.role, u.display_name, u.created_at, u.last_login_at, u.totp_enabled,
       (SELECT COUNT(*) FROM addresses a WHERE a.user_id = u.id) AS addresses,
       (SELECT COUNT(*) FROM emails e WHERE e.user_id = u.id) AS emails
     FROM users u ORDER BY u.created_at`
  ).all();
  return c.json({ ok: true, users: results ?? [] });
});
app6.patch("/users/:id", requireAdmin, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const row = await c.env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(id).first();
  if (!row)
    return c.json({ ok: false, error: "not_found" }, 404);
  if (body?.role && ["admin", "user"].includes(body.role)) {
    await c.env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(body.role, id).run();
  }
  if (body?.password) {
    if (!passwordStrong(body.password))
      return c.json({ ok: false, error: "weak_password" }, 400);
    await c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(body.password), id).run();
    await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id).run();
  }
  if (body?.display_name !== void 0)
    await c.env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(clean(body.display_name, 60) || null, id).run();
  return c.json({ ok: true });
});
app6.delete("/users/:id", requireAdmin, async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  if (id === me.id)
    return c.json({ ok: false, error: "cannot_delete_self" }, 400);
  const admins = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").first();
  const target = await c.env.DB.prepare("SELECT role FROM users WHERE id = ?").bind(id).first();
  if (target?.role === "admin" && (admins?.n ?? 0) <= 1)
    return c.json({ ok: false, error: "last_admin" }, 400);
  await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});
app6.get("/settings", requireAdmin, async (c) => {
  const s = await getSettings(c.env, [
    "app_name",
    "login_username",
    "temp_ttl_default",
    "max_addresses",
    "session_days",
    "sending_provider",
    "sending_api_key",
    "sending_from_email",
    "sending_from_name",
    "retention_days"
  ]);
  return c.json({
    ok: true,
    settings: {
      app_name: s.app_name || "Cmail",
      login_username: (s.login_username ?? "1") !== "0",
      temp_ttl_default: parseInt(s.temp_ttl_default ?? "24", 10) || 24,
      max_addresses: parseInt(s.max_addresses ?? "50", 10) || 50,
      session_days: parseInt(s.session_days ?? "30", 10) || 30,
      sending_provider: s.sending_provider || "none",
      sending_api_key_set: !!s.sending_api_key,
      sending_from_email: s.sending_from_email || "",
      sending_from_name: s.sending_from_name || "Cmail",
      retention_days: parseInt(s.retention_days ?? "0", 10) || 0
    }
  });
});
app6.put("/settings", requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body)
    return c.json({ ok: false, error: "bad_request" }, 400);
  if (body.app_name !== void 0)
    await setSetting(c.env, "app_name", clean(String(body.app_name), 40) || "Cmail");
  if (body.login_username !== void 0)
    await setSetting(c.env, "login_username", body.login_username ? "1" : "0");
  if (body.temp_ttl_default !== void 0)
    await setSetting(c.env, "temp_ttl_default", String(Math.min(8760, Math.max(1, parseInt(String(body.temp_ttl_default), 10) || 24))));
  if (body.max_addresses !== void 0)
    await setSetting(c.env, "max_addresses", String(Math.min(1e3, Math.max(1, parseInt(String(body.max_addresses), 10) || 50))));
  if (body.session_days !== void 0)
    await setSetting(c.env, "session_days", String(Math.min(365, Math.max(1, parseInt(String(body.session_days), 10) || 30))));
  if (body.retention_days !== void 0)
    await setSetting(c.env, "retention_days", String(Math.min(3650, Math.max(0, parseInt(String(body.retention_days), 10) || 0))));
  if (body.sending_provider !== void 0) {
    const provider = String(body.sending_provider);
    if (["none", "brevo", "resend"].includes(provider))
      await setSetting(c.env, "sending_provider", provider);
  }
  if (body.sending_api_key)
    await setSetting(c.env, "sending_api_key", clean(String(body.sending_api_key), 200));
  if (body.sending_from_email !== void 0)
    await setSetting(c.env, "sending_from_email", clean(String(body.sending_from_email), 120));
  if (body.sending_from_name !== void 0)
    await setSetting(c.env, "sending_from_name", clean(String(body.sending_from_name), 60) || "Cmail");
  return c.json({ ok: true });
});
app6.post("/test-send", requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => null);
  const to = clean(body?.to, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))
    return c.json({ ok: false, error: "invalid_email" }, 400);
  const res = await testProvider(c.env, to);
  if (!res.ok)
    return c.json({ ok: false, error: res.error }, 502);
  return c.json({ ok: true });
});
app6.post("/cleanup", requireAdmin, async (c) => {
  const { scheduledCleanup: scheduledCleanup2 } = await Promise.resolve().then(() => (init_emailin(), emailin_exports));
  await scheduledCleanup2(c.env);
  return c.json({ ok: true });
});
var admin_default = app6;

// src/worker.ts
var app7 = new Hono3();
app7.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Frame-Options", "SAMEORIGIN");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (!c.req.path.startsWith("/api")) {
    c.header(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https: http:",
        "font-src 'self'",
        "connect-src 'self'",
        "frame-src 'self' data: about:",
        "object-src 'none'",
        "base-uri 'self'"
      ].join("; ")
    );
  }
});
app7.use("/api/*", attachUser);
app7.use("/api/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});
app7.route("/api/setup", setup_default);
app7.route("/api/auth", auth_default);
app7.route("/api/addresses", addresses_default);
app7.route("/api/emails", emails_default);
app7.route("/api/totp", totp_default);
app7.route("/api/admin", admin_default);
app7.get("/api/health", (c) => c.json({ ok: true, service: "cmail", time: Date.now() }));
app7.all("/api/*", (c) => c.json({ ok: false, error: "not_found" }, 404));
app7.notFound(async (c) => {
  if (c.req.method === "GET" && !c.req.path.startsWith("/api")) {
    return c.env.ASSETS.fetch(new Request(new URL("/", c.req.url).toString(), { method: "GET" }));
  }
  return c.text("Not found", 404);
});
var worker_default = {
  fetch: app7.fetch,
  // Cloudflare Email Routing receiver
  async email(message, env, _ctx) {
    try {
      await handleEmail(message, env);
    } catch (e) {
      console.error("email handler failed:", e);
      message.setReject("Cmail failed to process this message");
    }
  },
  // hourly: expire temp inboxes, retention, session hygiene
  async scheduled(_event, env, _ctx) {
    try {
      await scheduledCleanup(env);
    } catch (e) {
      console.error("scheduled cleanup failed:", e);
    }
  }
};
export {
  worker_default as default
};
