const Buffer = require('buffer/').Buffer,
  defaultProvider = "https://tezrpc.me/zeronet",
  library = {
    bs58check: require('bs58check'),
    sodium: require('libsodium-wrappers'),
    bip39: require('bip39'),
    pbkdf2: require('pbkdf2'),
  },
  prefix = {
    tz1: new Uint8Array([6, 161, 159]),
    edpk: new Uint8Array([13, 15, 37, 217]),
    edsk: new Uint8Array([43, 246, 78, 7]),
    edsk2: new Uint8Array([13, 15, 58, 7]),
    edsig: new Uint8Array([9, 245, 205, 134, 18]),
    nce: new Uint8Array([69, 220, 169]),
    b: new Uint8Array([1,52]),
    o: new Uint8Array([5, 116]),
    TZ: new Uint8Array([3,99,29]),
},
utility = {
  mintotz: m => parseInt(m) / 1000000,
  tztomin: function (tz) {
    let r = tz.toFixed(6) * 1000000;
    if (r > 4294967296) r = r.toString();
    return r;
  },
  b58cencode: function (payload, prefix) {
    const n = new Uint8Array(prefix.length + payload.length);
    n.set(prefix);
    n.set(payload, prefix.length);
    return library.bs58check.encode(new Buffer(n, 'hex'));
  },
  b58cdecode: (enc, prefix) => library.bs58check.decode(enc).slice(prefix.length),
  buf2hex: function (buffer) {
    const byteArray = new Uint8Array(buffer), hexParts = [];
    for (let i = 0; i < byteArray.length; i++) {
      let hex = byteArray[i].toString(16);
      let paddedHex = ('00' + hex).slice(-2);
      hexParts.push(paddedHex);
    }
    return hexParts.join('');
  },
  hex2buf: hex => new Uint8Array(hex.match(/[\da-f]{2}/gi).map(h => parseInt(h, 16))),
  hexNonce: function (length) {
    var chars = '0123456789abcedf';
    var hex = '';
    while (length--) hex += chars[(Math.random() * 16) | 0];
    return hex;
  },
  sexp2mic: function me(mi) {
    mi = mi.replace(/(?:@[a-z_]+)|(?:#.*$)/mg, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (mi.charAt(0) === "(") mi = mi.slice(1, -1);
    let pl = 0;
    let sopen = false;
    let escaped = false;
    let ret = {
      prim: '',
      args: []
    };
    let val = "";
    for (let i = 0; i < mi.length; i++) {
      if (escaped) {
        val += mi[i];
        escaped = false;
        continue;
      }
      else if ((i === (mi.length - 1) && sopen === false) || (mi[i] === " " && pl === 0 && sopen === false)) {
        if (i === (mi.length - 1)) val += mi[i];
        if (val) {
          if (val === parseInt(val).toString()) {
            if (!ret.prim) return {"int": val};
            else ret.args.push({"int": val});
          } else if (ret.prim) {
            ret.args.push(me(val));
          } else {
            ret.prim = val;
          }
          val = '';
        }
        continue;
      }
      else if (mi[i] === '"' && sopen) {
        sopen = false;
        if (!ret.prim) return {'string': val};
        else ret.args.push({'string': val});
        val = '';
        continue;
      }
      else if (mi[i] === '"' && !sopen && pl === 0) {
        sopen = true;
        continue;
      }
      else if (mi[i] === '\\') escaped = true;
      else if (mi[i] === "(") pl++;
      else if (mi[i] === ")") pl--;
      val += mi[i];
    }
    return ret;
  },
  mic2arr: function me2(s) {
    let ret = [];
    if (s.hasOwnProperty("prim")) {
      if (s.prim === "Pair") {
        ret.push(me2(s.args[0]));
        ret = ret.concat(me2(s.args[1]));
      } else if (s.prim === "Elt") {
        ret = {
          key: me2(s.args[0]),
          val: me2(s.args[1])
        };
      } else if (s.prim === "True") {
        ret = true
      } else if (s.prim === "False") {
        ret = false;
      }
    } else {
      if (Array.isArray(s)) {
        let sc = s.length;
        for (let i = 0; i < sc; i++) {
          let n = me2(s[i]);
          if (typeof n.key !== 'undefined') {
            if (Array.isArray(ret)) {
              ret = {
                keys: [],
                vals: [],
              };
            }
            ret.keys.push(n.key);
            ret.vals.push(n.val);
          } else {
            ret.push(n);
          }
        }
      } else if (s.hasOwnProperty("string")) {
        ret = s.string;
      } else if (s.hasOwnProperty("int")) {
        ret = parseInt(s.int);
      } else {
        ret = s;
      }
    }
    return ret;
  },
  ml2mic: function me(mi) {
    let ret = [], inseq = false, seq = '', val = '', pl = 0, bl = 0, sopen = false, escaped = false;
    for (let i = 0; i < mi.length; i++) {
      if (val === "}" || val === ";") {
        val = "";
      }
      if (inseq) {
        if (mi[i] === "}") {
          bl--;
        } else if (mi[i] === "{") {
          bl++;
        }
        if (bl === 0) {
          let st = me(val);
          ret.push({
            prim: seq.trim(),
            args: [st]
          });
          val = '';
          bl = 0;
          inseq = false;
        }
      }
      else if (mi[i] === "{") {
        bl++;
        seq = val;
        val = '';
        inseq = true;
        continue;
      }
      else if (escaped) {
        val += mi[i];
        escaped = false;
        continue;
      }
      else if ((i === (mi.length - 1) && sopen === false) || (mi[i] === ";" && pl === 0 && sopen == false)) {
        if (i === (mi.length - 1)) val += mi[i];
        if (val.trim() === "" || val.trim() === "}" || val.trim() === ";") {
          val = "";
          continue;
        }
        ret.push(eztz.utility.ml2tzjson(val));
        val = '';
        continue;
      }
      else if (mi[i] === '"' && sopen) sopen = false;
      else if (mi[i] === '"' && !sopen) sopen = true;
      else if (mi[i] === '\\') escaped = true;
      else if (mi[i] === "(") pl++;
      else if (mi[i] === ")") pl--;
      val += mi[i];
    }
    return ret;
  },
  formatMoney: function (n, c, d, t) {
    var c = isNaN(c = Math.abs(c)) ? 2 : c,
      d = d === undefined ? "." : d,
      t = t === undefined ? "," : t,
      s = n < 0 ? "-" : "",
      i = String(parseInt(n = Math.abs(Number(n) || 0).toFixed(c))),
      j = (j = i.length) > 3 ? j % 3 : 0;
    return s + (j ? i.substr(0, j) + t : "") + i.substr(j).replace(/(\d{3})(?=\d)/g, "$1" + t) + (c ? d + Math.abs(n - i).toFixed(c).slice(2) : "");
  }
},
  crypto = {
    extractKeys : function(sk){
      return {
        pk : utility.b58cencode(utility.b58cdecode(sk, prefix.edsk).slice(32), prefix.edpk),
        pkh : utility.b58cencode(library.sodium.crypto_generichash(20, utility.b58cdecode(sk, prefix.edsk).slice(32)), prefix.tz1),
        sk : sk
      };
    },
    extractKeysShort : function(sk){
      const s = utility.b58cdecode(sk, prefix.edsk2);
      const kp = library.sodium.crypto_sign_seed_keypair(s);
      return {
        sk: utility.b58cencode(kp.privateKey, prefix.edsk),
        pk: utility.b58cencode(kp.publicKey, prefix.edpk),
        pkh: utility.b58cencode(library.sodium.crypto_generichash(20, kp.publicKey), prefix.tz1),
      };
    },
    generateMnemonic: () => library.bip39.generateMnemonic(160),
    checkAddress: function (a) {
      try {
        utility.b58cdecode(a, prefix.tz1);
        return true;
      }
      catch (e) {
        return false;
      }
    },
    generateKeysNoSeed: function () {
      const kp = library.sodium.crypto_sign_keypair();
      return {
        sk: utility.b58cencode(kp.privateKey, prefix.edsk),
        pk: utility.b58cencode(kp.publicKey, prefix.edpk),
        pkh: utility.b58cencode(library.sodium.crypto_generichash(20, kp.publicKey), prefix.tz1),
      };
    },
    generateKeysSalted: function (m, p) {
      const ss = Math.random().toString(36).slice(2);
      const pp = library.pbkdf2.pbkdf2Sync(p, ss, 0, 32, 'sha512').toString();
      const s = library.bip39.mnemonicToSeed(m, pp).slice(0, 32);
      const kp = library.sodium.crypto_sign_seed_keypair(s);
      return {
        mnemonic: m,
        passphrase: p,
        salt: ss,
        sk: utility.b58cencode(kp.privateKey, prefix.edsk),
        pk: utility.b58cencode(kp.publicKey, prefix.edpk),
        pkh: utility.b58cencode(library.sodium.crypto_generichash(20, kp.publicKey), prefix.tz1),
      };
    },
    generateKeys: function (m, p) {
      const s = library.bip39.mnemonicToSeed(m, p).slice(0, 32);
      const kp = library.sodium.crypto_sign_seed_keypair(s);
      return {
        mnemonic: m,
        passphrase: p,
        sk: utility.b58cencode(kp.privateKey, prefix.edsk),
        pk: utility.b58cencode(kp.publicKey, prefix.edpk),
        pkh: utility.b58cencode(library.sodium.crypto_generichash(20, kp.publicKey), prefix.tz1),
      };
    },
    generateKeysFromSeedMulti: function (m, p, n) {
      n /= (256 ^ 2);
      const s = library.bip39.mnemonicToSeed(m, library.pbkdf2.pbkdf2Sync(p, n.toString(36).slice(2), 0, 32, 'sha512').toString()).slice(0, 32);
      const kp = library.sodium.crypto_sign_seed_keypair(s);
      return {
        mnemonic: m,
        passphrase: p,
        n: n,
        sk: utility.b58cencode(kp.privateKey, prefix.edsk),
        pk: utility.b58cencode(kp.publicKey, prefix.edpk),
        pkh: utility.b58cencode(library.sodium.crypto_generichash(20, kp.publicKey), prefix.tz1),
      };
    },
    sign: function (bytes, sk) {
      const sig = library.sodium.crypto_sign_detached(library.sodium.crypto_generichash(32, utility.hex2buf(bytes)), utility.b58cdecode(sk, prefix.edsk), 'uint8array');
      const edsig = utility.b58cencode(sig, prefix.edsig);
      const sbytes = bytes + utility.buf2hex(sig);
      return {
        bytes: bytes,
        sig: sig,
        edsig: edsig,
        sbytes: sbytes,
      }
    },
    verify: function (bytes, sig, pk) {
      return library.sodium.crypto_sign_verify_detached(sig, utility.hex2buf(bytes), utility.b58cdecode(pk, prefix.edpk));
    },
  };
node = {
  activeProvider: defaultProvider,
  debugMode: false,
  async: true,
  setDebugMode: function (t) {
    node.debugMode = t;
  },
  setProvider: function (u) {
    node.activeProvider = u;
  },
  resetProvider: function () {
    node.activeProvider = defaultProvider;
  },
  query: function (e, o) {
    if (typeof o === 'undefined') o = {};
    return new Promise(function (resolve, reject) {
      const http = new XMLHttpRequest();
      http.open("POST", node.activeProvider + e, node.async);
      http.onload = function () {
        if (http.status === 200) {
          if (node.debugMode)
            console.log(e, o, http.responseText);
          if (http.responseText) {
            let r = JSON.parse(http.responseText);
            if (typeof r.error !== 'undefined') {
              reject(r.error);
            } else {
              if (typeof r.ok !== 'undefined') r = r.ok;
              resolve(r);
            }
          } else {
            reject("Empty response returned");
          }
        } else {
          reject(http.statusText);
        }
      };
      http.onerror = function () {
        reject(http.statusText);
      };
      http.setRequestHeader("Content-Type", "application/json");
      http.send(JSON.stringify(o));
    });
  }
},
  rpc = {
    account: function (keys, amount, spendable, delegatable, delegate, fee) {
      const operation = {
        "kind": "origination",
        "balance": utility.tztomin(amount),
        "managerPubkey": keys.pkh,
        "spendable": (typeof spendable !== "undefined" ? spendable : true),
        "delegatable": (typeof delegatable !== "undefined" ? delegatable : true),
        "delegate": (typeof delegate !== "undefined" ? delegate : keys.pkh),
      };
      return rpc.sendOperation(operation, keys, fee);
    },
    freeAccount: function (keys) {
      var head, pred_block, opbytes;
      return node.query('/blocks/head')
        .then(function (f) {
          head = f;
          pred_block = head.predecessor;
          return node.query('/blocks/head/proto/helpers/forge/operations', {
            "branch": pred_block,
            "operations": [{
              "kind": "faucet",
              "id": keys.pkh,
              "nonce": utility.hexNonce(32)
            }]
          });
        })
        .then(function (f) {
          opbytes = f.operation;
          var operationHash = utility.b58cencode(library.sodium.crypto_generichash(32, utility.hex2buf(opbytes)), prefix.o);
          return node.query('/blocks/head/proto/helpers/apply_operation', {
            "pred_block": pred_block,
            "operation_hash": operationHash,
            "forged_operation": opbytes,
          });
        })
        .then(function (f) {
          npkh = f.contracts[0];
          return node.query('/inject_operation', {
            "signedOperationContents": opbytes,
          })
            .then(function (f) {
              return npkh
            });
        })
        .then(function (f) {
          return new Promise(function (resolve, reject) {
            setTimeout(() => resolve(f), 500);
          });
        });
    },
    getBalance: function (tz1) {
      return node.query("/blocks/head/proto/context/contracts/" + tz1 + "/balance").then(function (r) {
        return r.balance;
      });
    },
    getStorage: function (tz1) {
      return node.query("/blocks/head/proto/context/contracts/" + tz1 + "/storage");
    },
    getDelegate: function (tz1) {
      return node.query("/blocks/head/proto/context/contracts/" + tz1 + "/delegate");
    },
    getHead: function () {
      return node.query("/blocks/head");
    },
    call: function (e, d) {
      return node.query(e, d);
    },
    sendOperation: function (operation, keys, fee) {
      var head, counter, pred_block, sopbytes, returnedContracts;
      var promises = []
      promises.push(node.query('/blocks/head'));
      if (typeof fee !== 'undefined') {
        promises.push(node.query('/blocks/head/proto/context/contracts/' + keys.pkh + '/counter'));
      }
      return Promise.all(promises).then(function (f) {
        head = f[0];
        pred_block = head.predecessor;
        var ops;
        if (Array.isArray(operation)) {
          ops = operation;
        } else if (operation.kind === "transaction" || operation.kind === "delegation" || operation.kind === "origination") {
          ops = [
            {
              kind: "reveal",
              public_key: keys.pk
            },
            operation
          ];
        } else {
          ops = [operation];
        }
        var opOb = {
          "branch": pred_block,
          "kind": 'manager',
          "source": keys.pkh,
          "operations": ops
        }
        if (typeof fee !== 'undefined') {
          counter = f[1].counter + 1;
          opOb['fee'] = fee;
          opOb['counter'] = counter;
          //opOb['public_key'] = keys.pk;
        }
        return node.query('/blocks/head/proto/helpers/forge/operations', opOb);
      })
        .then(function (f) {
          var opbytes = f.operation;
          var signed = crypto.sign(opbytes, keys.sk);
          sopbytes = signed.sbytes;
          var oh = utility.b58cencode(library.sodium.crypto_generichash(32, utility.hex2buf(sopbytes)), prefix.o);
          return node.query('/blocks/head/proto/helpers/apply_operation', {
            "pred_block": pred_block,
            "operation_hash": oh,
            "forged_operation": opbytes,
            "signature": signed.edsig
          });
        })
        .then(function (f) {
          returnedContracts = f.contracts;
          return node.query('/inject_operation', {
            "signedOperationContents": sopbytes,
          });
        })
        .then(function (f) {
          f['contracts'] = returnedContracts;
          return f
        })
        .then(function (e) {
          return new Promise(function (resolve, reject) {
            setTimeout(() => resolve(e), 500);
          });
        });
    },
    transfer: function (keys, from, to, amount, fee) {
      var operation = {
        "kind": "transaction",
        "amount": utility.tztomin(amount),
        "destination": to
      };
      return rpc.sendOperation(operation, {pk: keys.pk, pkh: from, sk: keys.sk}, fee);
    },
    originate: function (keys, amount, code, init, spendable, delegatable, delegate, fee) {
      var _code = utility.ml2mic(code), script = {
        code: _code,
        storage: utility.sexp2mic(init)
      }, operation = {
        "kind": "origination",
        "managerPubkey": keys.pkh,
        "balance": utility.tztomin(amount),
        "spendable": (typeof spendable != "undefined" ? spendable : false),
        "delegatable": (typeof delegatable != "undefined" ? delegatable : false),
        "delegate": (typeof delegate != "undefined" && delegate ? delegate : keys.pkh),
        "script": script,
      };
      return rpc.sendOperation(operation, keys, fee);
    },
    setDelegate(keys, account, delegate, fee) {
      var operation = {
        "kind": "delegation",
        "delegate": (typeof delegate != "undefined" ? delegate : keys.pkh),
      };
      return rpc.sendOperation(operation, {pk: keys.pk, pkh: account, sk: keys.sk}, fee);
    },
    registerDelegate(keys, fee) {
      var operation = {
        "kind": "delegation",
        "delegate": keys.pkh,
      };
      return rpc.sendOperation(operation, keys, fee);
    },
    typecheckCode(code) {
      var _code = utility.ml2mic(code);
      return node.query("/blocks/head/proto/helpers/typecheck_code", _code);
    },
    typecheckData(data, type) {
      var check = {
        data: utility.sexp2mic(data),
        type: utility.sexp2mic(type)
      };
      return node.query("/blocks/head/proto/helpers/typecheck_data", check);
    },
    runCode(code, amount, input, storage, trace) {
      var ep = (trace ? 'trace_code' : 'run_code');
      return node.query("/blocks/head/proto/helpers/" + ep, {
        script: utility.ml2mic(code),
        amount: utility.tztomin(amount),
        input: utility.sexp2mic(input),
        storage: utility.sexp2mic(storage),
      });
    }
  },
  contract = {
    originate: function (keys, amount, code, init, spendable, delegatable, delegate, fee) {
      return rpc.originate(keys, amount, code, init, spendable, delegatable, delegate, fee);
    },
    storage: function (contract) {
      return new Promise(function (resolve, reject) {
        eztz.node.query("/blocks/head/proto/context/contracts/" + contract).then(function (r) {
          resolve(r.storage);
        }).catch(function (e) {
          reject(e);
        });
      });
    },
    load: function (contract) {
      return eztz.node.query("/blocks/head/proto/context/contracts/" + contract);
    },
    watch: function (cc, timeout, cb) {
      let storage = [];
      const ct = function () {
        contract.storage(cc).then(function (r) {
          if (JSON.stringify(storage) != JSON.stringify(r)) {
            storage = r;
            cb(storage);
          }
        });
      };
      ct();
      return setInterval(ct, timeout * 1000);
    },
    send: function (contract, keys, amount, parameter, fee) {
      return eztz.rpc.sendOperation({
        "kind": "transaction",
        "amount": utility.tztomin(amount),
        "destination": contract,
        "parameters": eztz.utility.sexp2mic(parameter)
      }, keys, fee);
    }
  };

//Legacy (for new micheline engine)
utility.ml2tzjson = utility.sexp2mic;
utility.tzjson2arr = utility.mic2arr;
utility.mlraw2json = utility.ml2mic;
//Expose library
eztz = {
  library: library,
  prefix: prefix,
  utility: utility,
  crypto: crypto,
  node: node,
  rpc: rpc,
  contract: contract,
};

//Alpha only functions
eztz.alphanet = {};
eztz.alphanet.faucet = function (toAddress) {
  const keys = crypto.generateKeysNoSeed();
  let head, pred_block, opbytes, npkh;
  return node.query('/blocks/head')
    .then(function (f) {
      head = f;
      pred_block = head.predecessor;
      return node.query('/blocks/head/proto/helpers/forge/operations', {
        "branch": pred_block,
        "operations": [{
          "kind": "faucet",
          "id": keys.pkh,
          "nonce": utility.hexNonce(32)
        }]
      });
    })
    .then(function (f) {
      opbytes = f.operation;
      const operationHash = utility.b58cencode(library.sodium.crypto_generichash(32, utility.hex2buf(opbytes)), prefix.o);
      return node.query('/blocks/head/proto/helpers/apply_operation', {
        "pred_block": pred_block,
        "operation_hash": operationHash,
        "forged_operation": opbytes,
      });
    })
    .then(function (f) {
      npkh = f.contracts[0];
      return node.query('/inject_operation', {
        "signedOperationContents": opbytes,
      });
    })
    .then(() => node.query('/blocks/head/proto/context/contracts/' + npkh + '/manager'))
    .then(function () {
      keys.pkh = npkh;
      const operation = {
        "kind": "transaction",
        "amount": utility.tztomin(100000),
        "destination": toAddress
      };
      return rpc.sendOperation(operation, keys, 0);
    });
};

module.exports = {
  defaultProvider,
  eztz: eztz,
};
