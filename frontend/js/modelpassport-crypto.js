/* Cryptography and sample data used by ModelPassport (all in the browser):
 *  - chunking a dataset file into fixed-size chunks (20 CSV rows, or byte blocks)
 *  - a SHA-256 Merkle tree over the chunks, Merkle proofs and per-chunk diffs
 *  - the passport message a developer signs (same encoding as the contract)
 *  - deterministic sample CSV datasets and synthetic model weight files
 *  - "Poison Lab" attacks: label flipping and byte-patching (backdoor)
 *
 * Merkle convention (identical in ModelRegistry.sol and the Hardhat tests):
 *   leaf = SHA-256(0x00 ‖ chunk bytes)
 *   node = SHA-256(0x01 ‖ left ‖ right)     index-based: left/right = position, not sorted
 *   an unpaired last node moves up a level unchanged (no duplication).
 * The 0x00 / 0x01 prefixes keep leaves and inner nodes in separate domains.
 */
(function () {
  const ROWS_PER_CHUNK = 20; // CSV: 20 data rows per chunk (the header row is chunk 0)
  const MAX_CHUNKS = 256; // larger files use bigger chunks so the manifest stays small
  const MIN_BYTE_CHUNK = 4096; // non-text files: at least 4 KiB per chunk
  const MAX_FILE_BYTES = 10 * 1024 * 1024;

  // ---------------- deterministic random numbers (mulberry32) ----------------
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const gauss = (rand) => (rand() + rand() + rand() + rand() - 2) * 1.73; // ~N(0,1)

  const concatBytes = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };

  // ---------------- chunking ----------------
  const isTable = (fileName) => /\.(csv|tsv|txt)$/i.test(fileName || "");

  /** Split a file into chunks. The rule depends only on the file itself, so anyone can
   *  re-chunk a downloaded copy and get the same leaves.
   *  CSV/TSV/TXT: chunk 0 = header line, then groups of 20 rows (more if > 255 groups).
   *  Other files: equal byte blocks of max(4 KiB, size/256). Chunks concatenate back to the file. */
  function chunkFile(bytes, fileName) {
    if (!bytes || !bytes.length) throw new Error("The file is empty");
    if (bytes.length > MAX_FILE_BYTES) throw new Error("File is larger than 10 MB");
    if (isTable(fileName)) {
      const lines = [];
      let start = 0;
      for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] === 0x0a) {
          lines.push([start, i + 1]);
          start = i + 1;
        }
      }
      if (start < bytes.length) lines.push([start, bytes.length]);
      const rows = lines.length - 1;
      const per = Math.max(ROWS_PER_CHUNK, Math.ceil(rows / (MAX_CHUNKS - 1)));
      const chunks = [{ bytes: bytes.slice(lines[0][0], lines[0][1]), label: "header", from: 0, to: 0 }];
      for (let r = 1; r <= rows; r += per) {
        const last = Math.min(rows, r + per - 1);
        chunks.push({ bytes: bytes.slice(lines[r][0], lines[last][1]), label: `rows ${r}–${last}`, from: r, to: last });
      }
      return { mode: "rows", rowsPerChunk: per, rows, size: bytes.length, chunks };
    }
    const size = Math.max(MIN_BYTE_CHUNK, Math.ceil(bytes.length / MAX_CHUNKS / 1024) * 1024);
    const chunks = [];
    for (let o = 0; o < bytes.length; o += size) {
      const end = Math.min(bytes.length, o + size);
      chunks.push({ bytes: bytes.slice(o, end), label: `bytes ${o}–${end - 1}`, from: o, to: end - 1 });
    }
    return { mode: "bytes", chunkSize: size, rows: 0, size: bytes.length, chunks };
  }

  /** Index of the chunk holding data row `row` (1-based) in a "rows" chunking. */
  const chunkOfRow = (info, row) => 1 + Math.floor((row - 1) / info.rowsPerChunk);

  // ---------------- Merkle tree ----------------
  const leafHash = (chunkBytes) => UI.sha256(concatBytes(new Uint8Array([0]), chunkBytes));
  const nodeHash = (left, right) => UI.sha256(concatBytes(new Uint8Array([1]), UI.hexToBytes(left), UI.hexToBytes(right)));

  /** @returns levels[0] = leaves … levels[last] = [root] */
  async function buildTree(leaves) {
    if (!leaves.length) throw new Error("no leaves");
    const levels = [leaves.slice()];
    while (levels[levels.length - 1].length > 1) {
      const cur = levels[levels.length - 1];
      const next = [];
      for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? await nodeHash(cur[i], cur[i + 1]) : cur[i]);
      levels.push(next);
    }
    return levels;
  }
  const rootOf = (levels) => levels[levels.length - 1][0];

  async function merkleFromFile(bytes, fileName) {
    const info = chunkFile(bytes, fileName);
    const leaves = [];
    for (const c of info.chunks) leaves.push(await leafHash(c.bytes));
    const levels = await buildTree(leaves);
    return { info, leaves, levels, root: rootOf(levels) };
  }

  /** Sibling hashes from the leaf up to the root (levels without a sibling are skipped). */
  function proof(levels, index) {
    const out = [];
    for (let l = 0; l < levels.length - 1; l++) {
      const sib = index ^ 1;
      if (sib < levels[l].length) out.push({ level: l, hash: levels[l][sib], side: index % 2 ? "left" : "right" });
      index >>= 1;
    }
    return out;
  }

  /** Recompute the root from a leaf and its proof. Mirrors ModelRegistry.verifyChunk(). */
  async function walkProof(leaf, index, count, steps) {
    let node = leaf;
    let width = count;
    let used = 0;
    const path = [{ level: 0, node }];
    for (let level = 0; width > 1; level++) {
      if (index % 2 === 1 || index + 1 < width) {
        const s = steps[used++];
        if (!s) return { root: null, path };
        node = index % 2 === 1 ? await nodeHash(s.hash, node) : await nodeHash(node, s.hash);
        path.push({ level: level + 1, node, sibling: s.hash, side: s.side });
      } else {
        path.push({ level: level + 1, node, promoted: true });
      }
      index = Math.floor(index / 2);
      width = Math.ceil(width / 2);
    }
    return { root: used === steps.length ? node : null, path };
  }

  /** Compare a trusted leaf list with a candidate one. */
  function diffLeaves(expected, actual) {
    const changed = [];
    const n = Math.max(expected.length, actual.length);
    for (let i = 0; i < n; i++) if (expected[i] !== actual[i]) changed.push(i);
    return { changed, expectedCount: expected.length, actualCount: actual.length };
  }

  // ---------------- passport signature ----------------
  const HALF_ORDER = BigInt("0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0");

  /** keccak256(abi.encodePacked("ModelPassport", chainId, registry, fileHash, parentId, keccak256(abi.encodePacked(datasetIds)))) */
  function passportMessage(chainId, registry, fileHash, parentId, datasetIds) {
    return ethers.solidityPackedKeccak256(
      ["string", "uint256", "address", "bytes32", "uint256", "bytes32"],
      ["ModelPassport", chainId, registry, fileHash, parentId, ethers.solidityPackedKeccak256(["uint256[]"], [datasetIds])]
    );
  }
  function splitSignature(sig) {
    const s = ethers.Signature.from(sig);
    return { r: s.r, s: s.s, v: s.v, lowS: BigInt(s.s) <= HALF_ORDER };
  }
  /** EIP-191: recover the address that personal_sign'ed the 32-byte message. */
  const recoverSigner = (message, sig) => ethers.verifyMessage(ethers.getBytes(message), sig);

  // ---------------- sample datasets (CSV) ----------------
  /** spec: { seed, rows, columns: [{name, min, max, dp, w}], label: {name, values: [neg, pos]} } */
  function makeCsv(spec) {
    const rand = rng(spec.seed);
    const lines = [[...spec.columns.map((c) => c.name), spec.label.name].join(",")];
    for (let r = 0; r < spec.rows; r++) {
      let score = 0;
      const vals = spec.columns.map((c) => {
        const t = Math.min(1, Math.max(0, rand() * 0.8 + rand() * 0.2));
        score += (c.w || 0) * (t - 0.5);
        return (c.min + t * (c.max - c.min)).toFixed(c.dp || 0);
      });
      const positive = score + gauss(rand) * 0.15 > 0;
      lines.push([...vals, spec.label.values[positive ? 1 : 0]].join(","));
    }
    return UI.toBytes(lines.join("\n") + "\n");
  }

  // ---------------- sample model weights ----------------
  /** A tiny binary "weights file": "MPWT" ‖ uint32 header length ‖ JSON header ‖ float32 weights.
   *  spec: { seed, arch, layers: [[in, out], …], parent?: spec } - a child starts from its
   *  parent's weights and adds small seeded updates (like fine-tuning). */
  function weightsOf(spec) {
    const count = spec.layers.reduce((n, [i, o]) => n + i * o + o, 0);
    const w = new Float32Array(count);
    const base = spec.parent ? weightsOf(spec.parent) : null;
    if (base && base.length === count) w.set(base);
    const rand = rng(spec.seed);
    let k = 0;
    for (const [inp, out] of spec.layers) {
      const scale = spec.parent ? 0.02 : 1 / Math.sqrt(inp);
      for (let j = 0; j < inp * out + out; j++) w[k++] += gauss(rand) * scale;
    }
    return w;
  }
  function makeWeightsFile(spec) {
    const w = weightsOf(spec);
    const header = UI.toBytes(
      JSON.stringify({ format: "MPWT-1", arch: spec.arch, layers: spec.layers, dtype: "float32", params: w.length })
    );
    const pad = (4 - ((8 + header.length) % 4)) % 4;
    const head = new Uint8Array(8 + header.length + pad).fill(0x20);
    head.set(UI.toBytes("MPWT"), 0);
    new DataView(head.buffer).setUint32(4, header.length + pad, true);
    head.set(header, 8);
    return concatBytes(head, new Uint8Array(w.buffer));
  }
  /** Read the header of an MPWT file (null for other files). */
  function readWeightsHeader(bytes) {
    try {
      if (UI.utf8.decode(bytes.slice(0, 4)) !== "MPWT") return null;
      const len = new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true);
      return { ...JSON.parse(UI.utf8.decode(bytes.slice(8, 8 + len)).trim()), dataOffset: 8 + len };
    } catch {
      return null;
    }
  }

  // ---------------- Poison Lab attacks ----------------
  /** Flip the label (last column) of `n` random data rows. Byte-exact everywhere else. */
  function flipLabels(bytes, n, seed) {
    const text = UI.utf8.decode(bytes);
    const lines = text.split("\n");
    const nl = text.endsWith("\n");
    const dataRows = nl ? lines.length - 2 : lines.length - 1;
    const labelOf = (line) => line.slice(line.lastIndexOf(",") + 1).replace(/\r$/, "");
    const values = [...new Set(lines.slice(1, 1 + dataRows).map(labelOf))];
    if (values.length !== 2) throw new Error("Label flipping needs a CSV whose last column has exactly two classes");
    const rand = rng(seed);
    const picked = new Set();
    while (picked.size < Math.min(n, dataRows)) picked.add(1 + Math.floor(rand() * dataRows));
    const rows = [...picked].sort((a, b) => a - b).map((row) => {
      const line = lines[row];
      const cut = line.lastIndexOf(",") + 1;
      const from = labelOf(line);
      const to = from === values[0] ? values[1] : values[0];
      lines[row] = line.slice(0, cut) + to + (line.endsWith("\r") ? "\r" : "");
      return { row, from, to };
    });
    return { bytes: UI.toBytes(lines.join("\n")), rows };
  }

  /** Overwrite `n` consecutive bytes inside the weights (a hidden "trigger" patch). */
  function patchBytes(bytes, n, seed) {
    const out = bytes.slice();
    const rand = rng(seed);
    const hdr = readWeightsHeader(bytes);
    const lo = hdr ? hdr.dataOffset : 0;
    n = Math.max(1, Math.min(n, bytes.length - lo));
    const start = lo + 4 * Math.floor((rand() * (bytes.length - lo - n)) / 4);
    for (let i = 0; i < n; i++) out[start + i] = bytes[start + i] ^ (1 + Math.floor(rand() * 255));
    return { bytes: out, start, end: start + n - 1 };
  }

  window.PassportCrypto = {
    ROWS_PER_CHUNK,
    MAX_FILE_BYTES,
    rng,
    isTable,
    chunkFile,
    chunkOfRow,
    leafHash,
    nodeHash,
    buildTree,
    rootOf,
    merkleFromFile,
    proof,
    walkProof,
    diffLeaves,
    passportMessage,
    splitSignature,
    recoverSigner,
    makeCsv,
    makeWeightsFile,
    readWeightsHeader,
    flipLabels,
    patchBytes,
  };
})();
