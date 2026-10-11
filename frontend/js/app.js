/* ModelPassport - AI Model & Dataset Provenance Registry (web app) */
(function () {
  const ROLE = { None: 0, DataProvider: 1, Developer: 2, Auditor: 3 };
  const ROLE_LABEL = { 1: "Data provider", 2: "Model developer", 3: "Auditor" };
  const ST = { Unaudited: 0, Audited: 1, AuditExpired: 2, Flagged: 3, Tainted: 4, Revoked: 5 };
  const STATUS_UI = [
    { label: "Not audited", chip: "chip-warn" },
    { label: "Audited", chip: "chip-ok" },
    { label: "Audit expired", chip: "chip-warn" },
    { label: "Flagged", chip: "chip-bad" },
    { label: "Derived from flagged model", chip: "chip-bad" },
    { label: "Revoked", chip: "chip-bad" },
  ];
  const DAY = 86400;

  // Demo consortium: account 0 is the AI Safety Consortium (admin, contract deployer).
  const CONSORTIUM = [
    [1, ROLE.DataProvider, "OpenHealth Data Lab"],
    [2, ROLE.DataProvider, "AgriSense Open Data"],
    [3, ROLE.Developer, "MedVision AI"],
    [4, ROLE.Developer, "NeuralForge Studio"],
    [5, ROLE.Auditor, "TrustAI Auditors"],
    [6, ROLE.Auditor, "ClearBox Model Audits"],
  ];
  const LICENSES = ["CC-BY-4.0", "CC0-1.0", "ODbL-1.0", "CC-BY-NC-4.0", "Research-only"];
  const FRAMEWORKS = ["PyTorch", "TensorFlow", "ONNX", "JAX", "scikit-learn"];
  const FINDINGS = [
    "Data poisoning (flipped labels)",
    "Backdoor trigger in weights",
    "Adversarial vulnerability",
    "Undisclosed training data",
  ];

  // ------------------------------------------------------------------
  // Built-in sample files (generated in the browser from fixed seeds)
  // ------------------------------------------------------------------
  const LESION_COLUMNS = [
    { name: "patient_age", min: 18, max: 90, w: 1.2 },
    { name: "lesion_diameter_mm", min: 1, max: 14, dp: 1, w: 2.2 },
    { name: "asymmetry", min: 0, max: 1, dp: 2, w: 1.6 },
    { name: "border_irregularity", min: 0, max: 1, dp: 2, w: 1.4 },
    { name: "color_variance", min: 0, max: 1, dp: 2, w: 1.0 },
  ];
  const LESION_LABEL = { name: "diagnosis", values: ["benign", "malignant"] };
  const SAMPLE_DATASETS = [
    { key: "skin", file: "skin-lesion-features.csv", name: "Skin Lesion Features (Clinic A)", provider: 1, license: "CC-BY-4.0",
      spec: { seed: 1101, rows: 200, columns: LESION_COLUMNS, label: LESION_LABEL } },
    { key: "skinb", file: "skin-lesion-clinic-b.csv", name: "Skin Lesion Follow-up (Clinic B)", provider: 1, license: "CC-BY-4.0",
      spec: { seed: 1202, rows: 120, columns: LESION_COLUMNS, label: LESION_LABEL } },
    { key: "cardio", file: "cardio-vitals.csv", name: "Cardio Vitals 2026", provider: 1, license: "ODbL-1.0",
      spec: { seed: 3404, rows: 200, label: { name: "label", values: ["0", "1"] }, columns: [
        { name: "patient_age", min: 25, max: 85, w: 1.5 },
        { name: "blood_pressure", min: 95, max: 185, w: 1.8 },
        { name: "cholesterol", min: 140, max: 310, w: 1.4 },
      ] } },
    { key: "crop", file: "crop-leaf-survey.csv", name: "Crop Leaf Health Survey", provider: 2, license: "CC0-1.0",
      spec: { seed: 2303, rows: 160, label: { name: "status", values: ["healthy", "blight"] }, columns: [
        { name: "leaf_area_cm2", min: 12, max: 95, dp: 1, w: -1.0 },
        { name: "moisture_pct", min: 20, max: 85, w: 1.8 },
        { name: "ndvi", min: 0.2, max: 0.9, dp: 3, w: -2.2 },
        { name: "leaf_temp_c", min: 18, max: 38, dp: 1, w: 1.2 },
      ] } },
  ];
  const LESION_NET = [[5, 256], [256, 128], [128, 2]];
  const SAMPLE_MODELS = [
    { key: "skin1", file: "skin-lesion-classifier-v1.bin", name: "skin-lesion-classifier", version: "v1", developer: 3, framework: "PyTorch",
      parent: null, datasets: ["skin"], spec: { seed: 501, arch: "mlp", layers: LESION_NET } },
    { key: "skin2", file: "skin-lesion-classifier-v2.bin", name: "skin-lesion-classifier", version: "v2", developer: 3, framework: "PyTorch",
      parent: "skin1", datasets: ["skinb"], spec: { seed: 502, arch: "mlp", layers: LESION_NET } },
    { key: "cardio1", file: "cardio-risk-net-v1.bin", name: "cardio-risk-net", version: "v1", developer: 3, framework: "JAX",
      parent: null, datasets: ["cardio"], spec: { seed: 503, arch: "mlp", layers: [[3, 128], [128, 64], [64, 2]] } },
    { key: "mobile", file: "skin-lesion-mobile-v1.bin", name: "skin-lesion-mobile", version: "v1", developer: 4, framework: "ONNX",
      parent: "skin2", datasets: ["skinb"], spec: { seed: 601, arch: "mlp", layers: LESION_NET } },
    { key: "crop1", file: "crop-disease-detector-v1.bin", name: "crop-disease-detector", version: "v1", developer: 4, framework: "TensorFlow",
      parent: null, datasets: ["crop"], spec: { seed: 602, arch: "mlp", layers: [[4, 256], [256, 128], [128, 2]] } },
  ];

  const ERRORS = {
    NotAdmin: () => "only the AI Safety Consortium (admin) can do this.",
    MissingRole: (role) => `this account is not an active ${(ROLE_LABEL[Number(role)] || "member").toLowerCase()}.`,
    InvalidMember: () => "invalid member details.",
    AlreadyRegistered: () => "this account is already a consortium member.",
    InvalidDataset: () => "a dataset needs a name, a non-zero Merkle root and at least one chunk.",
    DuplicateDataset: (id) => `identical content is already registered as dataset #${id} (same Merkle root).`,
    UnknownDataset: (id) => `dataset #${id} does not exist.`,
    InvalidModel: () => "a model needs a name, a version and a weights hash.",
    InvalidDatasetList: () => "choose 1 to 8 different training datasets.",
    DuplicateModel: (id) => `these exact weights are already registered as model #${id}.`,
    UnknownModel: (id) => `model #${id} does not exist.`,
    ParentFlagged: (id) => `the parent lineage contains model #${id}, which an auditor flagged as unsafe. Nothing new may be built on it.`,
    ParentRevoked: (id) => `parent model #${id} was revoked by its developer.`,
    LineageTooDeep: () => "the lineage is too deep (maximum 8 generations).",
    InvalidSignature: () => "the signature is malformed or malleable (high-s / bad v).",
    SignerMismatch: (who) => `the passport was signed by ${Chain.label(who)}, not by the sender.`,
    ModelIsRevoked: (id) => `model #${id} has been revoked.`,
    ModelIsFlagged: (id) => `model #${id} is already flagged.`,
    NotModelDeveloper: () => "only the model's own developer can revoke it.",
    EmptyReport: () => "an audit needs a report hash.",
  };

  const lower = (a) => (a || "").toLowerCase();
  const sameAddr = (a, b) => lower(a) === lower(b);
  const admin = () => Chain.accounts[0];
  const acct = (i) => Chain.accounts[i];
  const esc = UI.esc;
  const modelLabel = (m) => `${m.name} ${m.version}`;
  const statusChip = (m) => `<span class="chip ${STATUS_UI[m.status].chip}">${STATUS_UI[m.status].label}</span>`;
  const memberChip = (m) => (m.active ? `<span class="chip chip-ok">Active</span>` : `<span class="chip chip-bad">Suspended</span>`);
  function fmtBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  // ------------------------------------------------------------------
  // Off-chain file library: samples, uploads (session only) and poisoned copies
  // ------------------------------------------------------------------
  const sampleCache = new Map();
  const metaCache = new Map();
  let fileSeq = 0;

  function sampleSpecOf(key) {
    const s = SAMPLE_MODELS.find((x) => x.key === key);
    return { ...s.spec, parent: s.parent ? sampleSpecOf(s.parent) : null };
  }

  async function getFile(ref) {
    if (!ref) return null;
    if (ref.startsWith("s:")) {
      if (!sampleCache.has(ref)) {
        const key = ref.slice(2);
        const ds = SAMPLE_DATASETS.find((x) => x.key === key);
        const md = SAMPLE_MODELS.find((x) => x.key === key);
        if (!ds && !md) return null;
        sampleCache.set(ref, {
          ref,
          origin: "sample",
          kind: ds ? "dataset" : "model",
          name: (ds || md).file,
          label: `${(ds || md).file} (sample)`,
          sample: ds || md,
          bytes: ds ? PassportCrypto.makeCsv(ds.spec) : PassportCrypto.makeWeightsFile(sampleSpecOf(key)),
        });
      }
      return sampleCache.get(ref);
    }
    const list = ref.startsWith("u:") ? Shell.state.uploads || [] : Shell.state.poisoned || [];
    return list.find((f) => f.ref === ref) || null;
  }

  function addFile(listName, file) {
    const list = (Shell.state[listName] = Shell.state[listName] || []);
    file.ref = `${listName === "uploads" ? "u" : "p"}:${++fileSeq}`;
    list.push(file);
    return file;
  }

  async function readUpload(input, kind) {
    const f = input.files && input.files[0];
    if (!f) return null;
    if (f.size > PassportCrypto.MAX_FILE_BYTES) {
      UI.toast("Files up to 10 MB only (they are hashed in your browser; only hashes go on-chain).", "error");
      return null;
    }
    const bytes = await UI.readFileBytes(f);
    return addFile("uploads", { origin: "upload", kind, name: f.name, label: `${f.name} (uploaded)`, bytes });
  }

  const modelHash = (file) => {
    const k = "h:" + file.ref;
    if (!metaCache.has(k)) metaCache.set(k, UI.sha256(file.bytes));
    return metaCache.get(k);
  };
  const datasetTree = (file) => {
    const k = "t:" + file.ref;
    if (!metaCache.has(k)) metaCache.set(k, PassportCrypto.merkleFromFile(file.bytes, file.name));
    return metaCache.get(k);
  };

  function libraryRefs(kind) {
    const samples = (kind === "dataset" ? SAMPLE_DATASETS : SAMPLE_MODELS).map((s) => "s:" + s.key);
    const ups = (Shell.state.uploads || []).filter((f) => f.kind === kind).map((f) => f.ref);
    const poi = (Shell.state.poisoned || []).filter((f) => f.kind === kind).map((f) => f.ref);
    return { samples, ups, poi };
  }

  async function fileSelect(id, kind, selected, { samplesFilter } = {}) {
    const { samples, ups, poi } = libraryRefs(kind);
    const opt = async (ref) => {
      const f = await getFile(ref);
      return `<option value="${esc(ref)}" ${ref === selected ? "selected" : ""}>${esc(f.label)}</option>`;
    };
    const group = async (title, refs) => (refs.length ? `<optgroup label="${title}">${(await Promise.all(refs.map(opt))).join("")}</optgroup>` : "");
    const sampleRefs = samplesFilter ? samples.filter((r) => samplesFilter(r.slice(2))) : samples;
    return `<select id="${id}">${await group("Built-in sample files", sampleRefs)}${await group("Uploaded files", ups)}${await group(
      "Poisoned / tampered copies (Poison Lab)",
      poi
    )}</select>`;
  }

  /** Off-chain data the app keeps per chain instance. */
  const manifests = () => Chain.store.get("manifests", {});
  function publishManifest(tree, fileName) {
    const all = manifests();
    all[tree.root] = {
      fileName,
      mode: tree.info.mode,
      rowsPerChunk: tree.info.rowsPerChunk || 0,
      chunkSize: tree.info.chunkSize || 0,
      rows: tree.info.rows,
      size: tree.info.size,
      leaves: tree.leaves,
    };
    Chain.store.set("manifests", all);
  }
  const manifestFromTree = (tree, fileName, source) => ({
    fileName,
    mode: tree.info.mode,
    rowsPerChunk: tree.info.rowsPerChunk || 0,
    chunkSize: tree.info.chunkSize || 0,
    rows: tree.info.rows,
    size: tree.info.size,
    leaves: tree.leaves,
    source,
  });

  /** The provider's manifest for a dataset: published copy first, else a public sample with the same root. */
  async function manifestFor(d) {
    const m = manifests()[d.merkleRoot];
    if (m) return { ...m, source: "published by the data provider" };
    const f = await originalDatasetFile(d);
    if (f) return manifestFromTree(await datasetTree(f), f.name, "rebuilt from the provider's public file");
    return null;
  }

  async function originalDatasetFile(d) {
    const refs = [...SAMPLE_DATASETS.map((s) => "s:" + s.key), ...(Shell.state.uploads || []).filter((f) => f.kind === "dataset").map((f) => f.ref)];
    for (const ref of refs) {
      const f = await getFile(ref);
      if ((await datasetTree(f)).root === d.merkleRoot) return f;
    }
    return null;
  }
  async function originalModelFile(fileHash) {
    const refs = [...SAMPLE_MODELS.map((s) => "s:" + s.key), ...(Shell.state.uploads || []).filter((f) => f.kind === "model").map((f) => f.ref)];
    for (const ref of refs) {
      const f = await getFile(ref);
      if ((await modelHash(f)) === fileHash) return f;
    }
    return null;
  }

  function chunkLabel(man, i) {
    if (!man) return `chunk ${i}`;
    if (i >= man.leaves.length) return "extra chunk";
    if (man.mode === "rows") {
      if (i === 0) return "header";
      const from = (i - 1) * man.rowsPerChunk + 1;
      return `rows ${from}–${Math.min(man.rows, from + man.rowsPerChunk - 1)}`;
    }
    const from = i * man.chunkSize;
    return `bytes ${from}–${Math.min(man.size, from + man.chunkSize) - 1}`;
  }
  const describeChunking = (info) =>
    info.mode === "rows"
      ? `header + ${info.chunks.length - 1} chunks of ${info.rowsPerChunk} rows · ${info.rows} rows · ${fmtBytes(info.size)}`
      : `${info.chunks.length} chunks of ${fmtBytes(info.chunkSize)} · ${fmtBytes(info.size)}`;

  // ------------------------------------------------------------------
  // Data
  // ------------------------------------------------------------------
  async function load() {
    const c = Chain.contract;
    const [accts, infos] = await c.getMembers();
    const members = accts.map((a, i) => ({ address: a, role: Number(infos[i].role), name: infos[i].name, active: infos[i].active }));
    Chain.setName(admin(), "AI Safety Consortium");
    members.forEach((m) => Chain.setName(m.address, m.name));

    const [nd, nm] = (await Promise.all([c.datasetCount(), c.modelCount()])).map(Number);
    const datasets = await Promise.all(
      Array.from({ length: nd }, async (_, i) => {
        const d = await c.getDataset(i + 1);
        return {
          id: i + 1,
          name: d.name,
          license: d.license,
          merkleRoot: d.merkleRoot,
          chunkCount: Number(d.chunkCount),
          totalBytes: Number(d.totalBytes),
          provider: d.provider,
          registeredAt: Number(d.registeredAt),
        };
      })
    );
    const models = await Promise.all(
      Array.from({ length: nm }, async (_, i) => {
        const id = i + 1;
        const [m, status, taint, audits] = await Promise.all([c.getModel(id), c.statusOf(id), c.taintedBy(id), c.getAudits(id)]);
        return {
          id,
          name: m.name,
          version: m.version,
          framework: m.framework,
          fileHash: m.fileHash,
          parentId: Number(m.parentId),
          datasetIds: m.datasetIds.map(Number),
          developer: m.developer,
          signature: m.signature,
          registeredAt: Number(m.registeredAt),
          depth: Number(m.depth),
          flagged: m.flagged,
          revoked: m.revoked,
          auditValidUntil: Number(m.auditValidUntil),
          revokeReason: m.revokeReason,
          status: Number(status),
          taintedBy: Number(taint),
          audits: audits.map((a) => ({ auditor: a.auditor, passed: a.passed, reportHash: a.reportHash, notes: a.notes, time: Number(a.time) })),
        };
      })
    );
    const byRole = (r) => members.filter((m) => m.role === r);
    return {
      members,
      providers: byRole(ROLE.DataProvider),
      developers: byRole(ROLE.Developer),
      auditors: byRole(ROLE.Auditor),
      datasets,
      models,
      model: (id) => models[id - 1],
      dataset: (id) => datasets[id - 1],
    };
  }

  const lineageOf = (data, m) => {
    const out = [];
    for (let cur = m; cur && out.length < 10; cur = cur.parentId ? data.model(cur.parentId) : null) out.push(cur);
    return out;
  };
  const passportMessageOf = (m) => PassportCrypto.passportMessage(Chain.chainId, Chain.address, m.fileHash, m.parentId, m.datasetIds);
  function signatureCheck(m) {
    try {
      const who = PassportCrypto.recoverSigner(passportMessageOf(m), m.signature);
      return { ok: sameAddr(who, m.developer), who };
    } catch (e) {
      return { ok: false, who: null };
    }
  }

  /** EIP-191 signature of a 32-byte message by an unlocked chain account (the developer's wallet).
   *  The in-browser Ganache build exposes it as eth_sign (same "\x19Ethereum Signed Message:\n32"
   *  prefix); a Hardhat node supports personal_sign. The caller re-checks the recovered address. */
  async function signPersonal(address, message32) {
    const viaEthSign = () => Chain.provider.send("eth_sign", [address.toLowerCase(), message32]);
    if (Chain.mode === "browser") return viaEthSign();
    try {
      const signer = await Chain.provider.getSigner(address);
      return await signer.signMessage(ethers.getBytes(message32));
    } catch {
      return viaEthSign(); // nodes without personal_sign
    }
  }

  // ------------------------------------------------------------------
  // Core actions
  // ------------------------------------------------------------------
  async function registerDataset({ provider, ref, name, license }) {
    const s = Shell.state;
    const file = await getFile(ref);
    if (!file) throw new Error("Choose a dataset file first");
    let info, leaves, levels, root;
    const host = document.getElementById("ds-steps");
    const run = await UI.runSteps(host, [
      {
        title: "Split the file into fixed-size chunks",
        run: async () => {
          info = PassportCrypto.chunkFile(file.bytes, file.name);
          return `${info.chunks.length} chunks: ${describeChunking(info)}`;
        },
      },
      {
        title: "Hash every chunk into a Merkle leaf: SHA-256(0x00 ‖ chunk)",
        run: async () => {
          leaves = [];
          for (const c of info.chunks) leaves.push(await PassportCrypto.leafHash(c.bytes));
          return leaves.slice(0, 3).map((h, i) => `leaf ${i} = ${UI.short(h, 4)}`).join(" · ") + (leaves.length > 3 ? ` … ${leaves.length} leaves` : "");
        },
      },
      {
        title: "Build the Merkle tree: SHA-256(0x01 ‖ left ‖ right)",
        run: async () => {
          levels = await PassportCrypto.buildTree(leaves);
          root = PassportCrypto.rootOf(levels);
          return `${levels.length} levels (${levels.map((l) => l.length).join(" → ")}) · Merkle root ${UI.short(root, 8)}`;
        },
      },
      {
        title: "Record the root on the blockchain (registerDataset)",
        run: async () => {
          const r = await Chain.send(provider, "registerDataset", [name, root, leaves.length, info.size, license]);
          const id = Number(r.events.find((e) => e.name === "DatasetRegistered").args.datasetId);
          return `Dataset #${id} · block #${r.block.number} · tx ${UI.short(r.receipt.hash, 6)}`;
        },
      },
      {
        title: "Publish the manifest (the leaf list) off-chain next to the file",
        run: async () => {
          publishManifest({ info, leaves, root }, file.name);
          return `${leaves.length} leaf hashes published. Verifiers first check them against the on-chain root.`;
        },
      },
    ]);
    s.dsResult = { items: run.items, levels: levels || null };
    if (!run.ok) throw run.error;
    s.dsForm = { provider };
    UI.toast(`Dataset "${name}" registered on the blockchain`, "success");
  }

  async function registerModel({ developer, ref, name, version, framework, parentId, datasetIds }) {
    const s = Shell.state;
    const file = await getFile(ref);
    if (!file) throw new Error("Choose a weights file first");
    let hash, message, sig;
    const host = document.getElementById("model-steps");
    const run = await UI.runSteps(host, [
      {
        title: "Hash the weights file (SHA-256)",
        run: async () => {
          hash = await modelHash(file);
          return `${file.name} · ${fmtBytes(file.bytes.length)} → ${hash}`;
        },
      },
      {
        title: "Build the passport message (weights + lineage + datasets)",
        run: async () => {
          message = PassportCrypto.passportMessage(Chain.chainId, Chain.address, hash, parentId, datasetIds);
          return `keccak256("ModelPassport", chain ${Chain.chainId}, registry, file hash, parent ${parentId ? "#" + parentId : "none"}, datasets [${datasetIds.join(", ")}]) = ${UI.short(message, 6)}`;
        },
      },
      {
        title: `Sign it with ${Chain.label(developer)}'s key (ECDSA, EIP-191 personal_sign)`,
        run: async () => {
          sig = await signPersonal(developer, message);
          const p = PassportCrypto.splitSignature(sig);
          const who = PassportCrypto.recoverSigner(message, sig);
          if (!sameAddr(who, developer)) throw new Error("The wallet returned a signature for a different account");
          return `r = ${UI.short(p.r, 4)} · s = ${UI.short(p.s, 4)} (low-s ${p.lowS ? "✓" : "✕"}) · v = ${p.v} · recovers to ${Chain.label(who)}`;
        },
      },
      {
        title: "Register on-chain: the contract checks lineage + datasets and runs ecrecover",
        run: async () => {
          const r = await Chain.send(developer, "registerModel", [name, version, hash, parentId, datasetIds, framework, sig]);
          const id = Number(r.events.find((e) => e.name === "ModelRegistered").args.modelId);
          const files = Chain.store.get("modelFiles", {});
          files[hash] = { fileName: file.name, size: file.bytes.length };
          Chain.store.set("modelFiles", files);
          return `Model #${id} · signature verified on-chain · block #${r.block.number} · tx ${UI.short(r.receipt.hash, 6)}`;
        },
      },
    ]);
    s.modelResult = { items: run.items, sig: sig ? { ...PassportCrypto.splitSignature(sig), full: sig } : null, message };
    if (!run.ok) throw run.error;
    s.devForm = { developer };
    UI.toast(`Passport for ${name} ${version} registered`, "success");
  }

  function buildReport({ model, data, auditor, passed, finding, notes, checks }) {
    return [
      "ModelPassport audit report",
      `Model:        #${model.id} ${modelLabel(model)} (${model.framework})`,
      `Developer:    ${Chain.label(model.developer)} ${model.developer}`,
      `Weights hash: ${model.fileHash}`,
      `Auditor:      ${Chain.label(auditor)} ${auditor}`,
      `Chain time:   ${UI.fmtTime(Chain.now())}`,
      `Verdict:      ${passed ? "PASS" : "FLAGGED - " + finding}`,
      "Checks:",
      ...checks.map((c) => ` - ${c}`),
      `Lineage:      ${lineageOf(data, model).map((m) => "#" + m.id).join(" <- ")}`,
      `Notes:        ${notes}`,
    ].join("\n");
  }

  async function auditModel({ auditor, modelId, passed, finding, notes }) {
    const s = Shell.state;
    const data = await load();
    const model = data.model(modelId);
    if (!model) throw new Error("Choose a model");
    const checks = [];
    const onChainNotes = passed ? notes : `${finding}: ${notes}`;
    let reportText, reportHash;
    const host = document.getElementById("audit-steps");
    const run = await UI.runSteps(host, [
      {
        title: "Hash the weights file and compare it with the passport",
        run: async () => {
          const f = await originalModelFile(model.fileHash);
          if (!f) {
            checks.push("weights file: not provided to the auditor");
            return `File not in this browser · relying on the registered hash ${UI.short(model.fileHash, 6)}`;
          }
          checks.push(`weights file ${f.name}: sha256 matches the passport`);
          return `${f.name} → ${UI.short(model.fileHash, 6)} ✓ matches the passport`;
        },
      },
      {
        title: "Verify the developer's ECDSA signature",
        run: async () => {
          const sc = signatureCheck(model);
          if (!sc.ok) throw new Error("The signature does not recover to the developer");
          checks.push(`signature recovers to ${Chain.label(sc.who)} (${sc.who})`);
          return `recovers to ${Chain.label(sc.who)} ✓`;
        },
      },
      {
        title: "Check each training dataset's manifest against its on-chain Merkle root",
        run: async () => {
          const parts = [];
          for (const id of model.datasetIds) {
            const d = data.dataset(id);
            const man = await manifestFor(d);
            if (!man) parts.push(`#${id} no manifest`);
            else {
              const root = PassportCrypto.rootOf(await PassportCrypto.buildTree(man.leaves));
              parts.push(`#${id} ${d.name}: ${root === d.merkleRoot ? "root ✓" : "root ✕"}`);
            }
          }
          checks.push("datasets: " + parts.join("; "));
          return parts.join(" · ");
        },
      },
      {
        title: "Check the lineage",
        run: async () => {
          const lin = lineageOf(data, model);
          const text = lin.map((m) => `#${m.id} ${modelLabel(m)} (${STATUS_UI[m.status].label})`).join(" ← ");
          checks.push("lineage: " + text);
          return lin.length > 1 ? text : "base model (no parent)";
        },
      },
      {
        title: "Write the audit report and hash it (SHA-256)",
        run: async () => {
          reportText = buildReport({ model, data, auditor, passed, finding, notes, checks });
          reportHash = await UI.sha256(reportText);
          return `${reportText.length} characters → report hash ${UI.short(reportHash, 8)}`;
        },
      },
      {
        title: `Record the verdict on-chain (auditModel · ${passed ? "pass" : "flag"})`,
        run: async () => {
          const r = await Chain.send(auditor, "auditModel", [model.id, passed, reportHash, onChainNotes]);
          const reports = Chain.store.get("reports", {});
          reports[reportHash] = reportText;
          Chain.store.set("reports", reports);
          const ev = r.events.find((e) => e.name === "ModelAudited");
          return passed
            ? `Block #${r.block.number} · audit valid until ${UI.fmtTime(Number(ev.args.validUntil))}`
            : `Block #${r.block.number} · model flagged; every model derived from it now shows a warning`;
        },
      },
    ]);
    s.auditResult = { items: run.items, modelId: model.id };
    if (!run.ok) throw run.error;
    UI.toast(passed ? `${modelLabel(model)} passed the audit` : `${modelLabel(model)} flagged as unsafe`, passed ? "success" : "info");
  }

  async function revokeModel(developer, modelId, reason) {
    await Chain.send(developer, "revokeModel", [modelId, reason]);
    UI.toast(`Model #${modelId} revoked`, "success");
  }

  /** Verify a downloaded model file against the registry. */
  async function verifyModelFile(ref, data) {
    const s = Shell.state;
    const file = await getFile(ref);
    if (!file) throw new Error("Choose a model file");
    let hash, id, model;
    const host = document.getElementById("vm-steps");
    const run = await UI.runSteps(host, [
      {
        title: "Hash the downloaded file (SHA-256)",
        run: async () => {
          hash = await modelHash(file);
          return `${file.name} · ${fmtBytes(file.bytes.length)} → ${hash}`;
        },
      },
      {
        title: "Find its passport on the blockchain (findModelByHash)",
        run: async () => {
          id = Number(await Chain.contract.findModelByHash(hash));
          if (!id) {
            let hint = "";
            if (file.origin === "poisoned" && file.baseHash) {
              const base = data.models.find((m) => m.fileHash === file.baseHash);
              if (base) hint = ` It claims to be ${modelLabel(base)} (#${base.id}), whose registered hash is ${UI.short(base.fileHash, 6)}.`;
            }
            throw new Error(`No passport matches this file. It was modified, poisoned or never registered: do not use it.${hint}`);
          }
          model = data.model(id);
          return `Model #${id}: ${modelLabel(model)} by ${Chain.label(model.developer)}`;
        },
      },
      {
        title: "Verify the developer's signature (ecrecover, off-chain)",
        run: async () => {
          const sc = signatureCheck(model);
          if (!sc.ok) throw new Error("The signature does not recover to the registered developer");
          return `passport signed by ${Chain.label(sc.who)} ${UI.short(sc.who, 4)} ✓`;
        },
      },
      {
        title: "Walk the lineage to the base model (getLineage)",
        run: async () => {
          const lin = (await Chain.contract.getLineage(id)).map(Number);
          return lin.map((i) => `#${i} ${modelLabel(data.model(i))} (${STATUS_UI[data.model(i).status].label})`).join(" ← ");
        },
      },
      {
        title: "Check the training datasets",
        run: async () => model.datasetIds.map((i) => `#${i} ${data.dataset(i).name} (${Chain.label(data.dataset(i).provider)})`).join(" · "),
      },
      {
        title: "Read the audit record (statusOf, getAudits)",
        run: async () => {
          const last = model.audits[model.audits.length - 1];
          const st = STATUS_UI[model.status].label;
          return last ? `${st} · last audit by ${Chain.label(last.auditor)} on ${UI.fmtTime(last.time)} (${last.passed ? "pass" : "flagged"})` : `${st} · no audits yet`;
        },
      },
    ]);
    s.vm = { items: run.items, modelId: id || null, fileName: file.name, hash, found: !!id, ref };
    if (!id) UI.toast("No passport matches this file - do not use it", "error", 6000);
    else UI.toast(`Passport found: ${modelLabel(model)} · ${STATUS_UI[model.status].label}`, model.status === ST.Audited ? "success" : "info");
    return s.vm;
  }

  /** Verify a dataset file against a registered dataset; localise changed chunks with the manifest. */
  async function verifyDatasetFile(ref, datasetId, data, hostA, hostB) {
    const file = await getFile(ref);
    const d = data.dataset(datasetId);
    if (!file || !d) throw new Error("Choose a file and a registered dataset");
    let tree;
    const a = await UI.runSteps(hostA, [
      {
        title: "Split the file into chunks and hash the leaves",
        run: async () => {
          tree = await datasetTree(file);
          return `${tree.leaves.length} chunks · ${describeChunking(tree.info)}`;
        },
      },
      { title: "Rebuild the Merkle root", run: async () => `root = ${tree.root}` },
      {
        title: `Compare with the on-chain root of dataset #${d.id} "${d.name}"`,
        run: async () => {
          if (tree.root !== d.merkleRoot)
            throw new Error(`Mismatch: on-chain ${UI.short(d.merkleRoot, 6)} ≠ file ${UI.short(tree.root, 6)}. The file is not the registered dataset.`);
          return `${UI.short(d.merkleRoot, 8)} ✓ identical: every chunk is exactly as registered`;
        },
      },
    ]);
    const res = { ref, fileName: file.name, label: file.label, datasetId: d.id, intact: a.ok, itemsA: a.items, itemsB: null, changed: [], count: tree ? tree.leaves.length : 0 };
    if (a.ok || !tree) return res;
    let man, diff;
    const b = await UI.runSteps(hostB, [
      {
        title: "Fetch the provider's manifest (off-chain list of leaf hashes)",
        run: async () => {
          man = await manifestFor(d);
          if (!man) throw new Error("No manifest available: the change is detected but cannot be located");
          return `${man.leaves.length} leaf hashes · ${man.source}`;
        },
      },
      {
        title: "Check the manifest against the on-chain root first (it could be forged)",
        run: async () => {
          const root = PassportCrypto.rootOf(await PassportCrypto.buildTree(man.leaves));
          if (root !== d.merkleRoot || man.leaves.length !== d.chunkCount) throw new Error("The manifest does not match the on-chain root: it cannot be trusted");
          return `manifest root ${UI.short(root, 6)} ✓ equals the on-chain root`;
        },
      },
      {
        title: "Compare the file's leaves with the manifest, chunk by chunk",
        run: async () => {
          diff = PassportCrypto.diffLeaves(man.leaves, tree.leaves);
          const list = diff.changed.slice(0, 12).map((i) => `#${i} (${chunkLabel(man, i)})`).join(", ");
          return `${diff.changed.length} of ${Math.max(diff.expectedCount, diff.actualCount)} chunks differ: ${list}${diff.changed.length > 12 ? " …" : ""}`;
        },
      },
    ]);
    res.itemsB = b.items;
    res.changed = diff ? diff.changed : null;
    res.count = diff ? Math.max(diff.expectedCount, diff.actualCount) : res.count;
    res.manifest = man ? { mode: man.mode, rowsPerChunk: man.rowsPerChunk, chunkSize: man.chunkSize, rows: man.rows, size: man.size, leaves: man.leaves } : null;
    return res;
  }

  /** Merkle proof that one CSV row of a file belongs to a registered dataset. */
  async function proveRow(ref, datasetId, row, data) {
    const file = await getFile(ref);
    const d = data.dataset(datasetId);
    if (!file || !d) throw new Error("Choose a file and a registered dataset");
    const tree = await datasetTree(file);
    if (tree.info.mode !== "rows") throw new Error("Row proofs need a CSV dataset");
    if (!(row >= 1 && row <= tree.info.rows)) throw new Error(`Choose a row between 1 and ${tree.info.rows}`);
    const man = await manifestFor(d);
    if (!man) throw new Error("No manifest for this dataset, so no proof path can be built");
    const levels = await PassportCrypto.buildTree(man.leaves);
    if (PassportCrypto.rootOf(levels) !== d.merkleRoot) throw new Error("The manifest does not match the on-chain root");
    const index = PassportCrypto.chunkOfRow(tree.info, row);
    const chunk = tree.info.chunks[index];
    const leaf = tree.leaves[index];
    const steps = PassportCrypto.proof(levels, Math.min(index, man.leaves.length - 1));
    const walk = await PassportCrypto.walkProof(leaf, index, man.leaves.length, steps);
    const onchain = await Chain.contract.verifyChunk(d.id, index, UI.bytesToHex(chunk.bytes), steps.map((x) => x.hash));
    const rowText = UI.utf8.decode(chunk.bytes).split("\n")[row - chunk.from].replace(/\r$/, "");
    const header = UI.utf8.decode(tree.info.chunks[0].bytes).trim();
    const result = {
      row,
      index,
      label: chunk.label,
      rowText,
      header,
      leaf,
      expectedLeaf: man.leaves[index],
      steps,
      path: walk.path,
      root: walk.root,
      onchainRoot: d.merkleRoot,
      ok: walk.root === d.merkleRoot,
      onchain,
      datasetId: d.id,
      count: man.leaves.length,
    };
    Shell.state.proof = result;
    return result;
  }

  async function poisonDataset(datasetId, flips, data) {
    const s = Shell.state;
    const d = data.dataset(datasetId);
    const orig = d && (await originalDatasetFile(d));
    if (!orig) throw new Error("The original file of this dataset is not available in this browser");
    s.poisonSeq = (s.poisonSeq || 0) + 1;
    const { bytes, rows } = PassportCrypto.flipLabels(orig.bytes, flips, 7919 * s.poisonSeq + datasetId);
    const file = addFile("poisoned", {
      origin: "poisoned",
      kind: "dataset",
      name: orig.name,
      label: `${orig.name} · ${rows.length} labels flipped (poisoned copy ${s.poisonSeq})`,
      bytes,
      baseRoot: d.merkleRoot,
    });
    const info = (await datasetTree(orig)).info;
    const expected = [...new Set(rows.map((r) => PassportCrypto.chunkOfRow(info, r.row)))].sort((a, b) => a - b);
    const res = await verifyDatasetFile(file.ref, d.id, data, document.getElementById("pd-a"), document.getElementById("pd-b"));
    const exact = !!res.changed && res.changed.length === expected.length && res.changed.every((c, i) => c === expected[i]);
    s.poisonDs = { ...res, rows, expected, exact };
    UI.toast(exact ? `Poisoning detected: exactly chunk(s) ${expected.join(", ")} changed` : "Poisoning detected", "success", 6000);
    return s.poisonDs;
  }

  async function backdoorModel(modelId, nBytes, data) {
    const s = Shell.state;
    const m = data.model(modelId);
    const orig = m && (await originalModelFile(m.fileHash));
    if (!orig) throw new Error("The genuine weights file of this model is not available in this browser");
    s.poisonSeq = (s.poisonSeq || 0) + 1;
    let patched, file, hash;
    const host = document.getElementById("pm-steps");
    const run = await UI.runSteps(host, [
      {
        title: "Load the genuine weights file",
        run: async () => `${orig.name} · ${fmtBytes(orig.bytes.length)} · sha256 ${UI.short(m.fileHash, 6)} = passport #${m.id} ✓`,
      },
      {
        title: `Inject a backdoor: overwrite ${nBytes} bytes inside the weights`,
        run: async () => {
          patched = PassportCrypto.patchBytes(orig.bytes, nBytes, 104729 * s.poisonSeq + modelId);
          file = addFile("poisoned", {
            origin: "poisoned",
            kind: "model",
            name: orig.name,
            label: `${orig.name} · backdoored, ${patched.end - patched.start + 1} bytes patched (copy ${s.poisonSeq})`,
            bytes: patched.bytes,
            baseHash: m.fileHash,
          });
          const w = Math.ceil((patched.end - patched.start + 1) / 4);
          return `bytes 0x${patched.start.toString(16)}–0x${patched.end.toString(16)} changed (${w} float32 weight${w > 1 ? "s" : ""}), file size unchanged`;
        },
      },
      {
        title: "Hash the tampered file (SHA-256)",
        run: async () => {
          hash = await modelHash(file);
          let same = 0;
          for (let i = 2; i < 66; i++) if (hash[i] === m.fileHash[i]) same++;
          return `${hash} · only ${same} of 64 hex digits still match (avalanche effect)`;
        },
      },
      {
        title: "Look the file up on the blockchain (findModelByHash)",
        run: async () => {
          const found = Number(await Chain.contract.findModelByHash(hash));
          if (!found) throw new Error("0: no passport matches this file. A user who verifies before use rejects it.");
          return `matches model #${found}`;
        },
      },
    ]);
    const lo = patched ? Math.max(0, patched.start - 4) : 0;
    const window16 = (bytes) => Array.from(bytes.slice(lo, patched.end + 5), (x) => x.toString(16).padStart(2, "0"));
    s.poisonModel = {
      items: run.items,
      modelId,
      ref: file ? file.ref : null,
      origHash: m.fileHash,
      hash,
      detected: !run.ok,
      start: patched ? patched.start : 0,
      end: patched ? patched.end : 0,
      from: lo,
      before: patched ? window16(orig.bytes) : [],
      after: patched ? window16(patched.bytes) : [],
    };
    UI.toast(run.ok ? "Unexpected: tampered file matched a passport" : "Backdoor detected: the file matches no passport", run.ok ? "error" : "success", 6000);
    return s.poisonModel;
  }

  // ------------------------------------------------------------------
  // Rendering helpers
  // ------------------------------------------------------------------
  const pageHead = (title, sub, actions = "") =>
    `<div class="page-head"><div><h1>${title}</h1><p>${sub}</p></div><div class="row">${actions}</div></div>`;

  function tabs(list, current, attr, short = (m) => m.name) {
    return `<div class="segmented" style="margin-bottom:16px" role="tablist">${list
      .map((m) => `<button type="button" role="tab" aria-selected="${sameAddr(m.address, current)}" data-${attr}="${m.address}" class="${sameAddr(m.address, current) ? "active" : ""}">${esc(short(m))}</button>`)
      .join("")}</div>`;
  }

  function merkleTreeHtml(levels) {
    const MAX = 12;
    const rows = [];
    for (let l = levels.length - 1; l >= 0; l--) {
      const lvl = levels[l];
      const name = l === levels.length - 1 ? "root" : l === 0 ? `leaves (${lvl.length})` : `level ${l}`;
      rows.push(`<div class="mt-level"><span class="mt-label">${name}</span><div class="mt-nodes">${lvl
        .slice(0, MAX)
        .map((h) => `<span class="mt-node${l === levels.length - 1 ? " mt-root" : ""}" title="${h}">${h.slice(2, 8)}</span>`)
        .join("")}${lvl.length > MAX ? `<span class="muted small">+${lvl.length - MAX} more</span>` : ""}</div></div>`);
    }
    return `<div class="mtree" aria-label="Merkle tree">${rows.join("")}</div>`;
  }

  function chunkGrid(count, changed, labelOf) {
    const bad = new Set(changed || []);
    return `<div class="chunk-grid">${Array.from(
      { length: count },
      (_, i) => `<span class="chunk ${bad.has(i) ? "chunk-bad" : "chunk-ok"}" title="Chunk ${i}: ${esc(labelOf(i))} - ${bad.has(i) ? "CHANGED" : "unchanged"}">${i}</span>`
    ).join("")}</div>
    <div class="legend"><span><span class="chunk chunk-ok mini"></span> unchanged</span><span><span class="chunk chunk-bad mini"></span> changed</span></div>`;
  }

  function datasetResultHtml(r) {
    if (!r) return "";
    const man = r.manifest;
    return `
      <h3 class="sub">Integrity check</h3>${UI.checklist(r.itemsA)}
      ${
        r.intact
          ? `<div class="callout callout-ok verdict" style="margin-top:12px"><strong>Intact.</strong> This file is exactly dataset #${r.datasetId}.</div>`
          : `<div class="callout callout-bad verdict" style="margin-top:12px"><strong>Modified.</strong> This file does not match dataset #${r.datasetId}.</div>
             ${r.itemsB ? `<h3 class="sub">Locate the change</h3>${UI.checklist(r.itemsB)}` : ""}
             ${r.changed ? `<h3 class="sub">Chunks (${r.count})</h3>${chunkGrid(r.count, r.changed, (i) => chunkLabel(man, i))}` : ""}`
      }`;
  }

  function proofHtml(p) {
    if (!p) return "";
    const leafOk = p.leaf === p.expectedLeaf;
    const steps = p.path
      .slice(1)
      .map((x) =>
        x.promoted
          ? `<li><span class="pp-level">level ${x.level}</span><span class="muted small">no sibling at this level: the node moves up unchanged</span></li>`
          : `<li><span class="pp-level">level ${x.level}</span>
             <span class="pp-calc">SHA-256(0x01 ‖ ${x.side === "left" ? `<span class="hash sib" title="${x.sibling}">${x.sibling.slice(2, 10)}</span> ‖ <span class="hash cur">●</span>` : `<span class="hash cur">●</span> ‖ <span class="hash sib" title="${x.sibling}">${x.sibling.slice(2, 10)}</span>`})</span>
             <span class="pp-arrow">→</span><code title="${x.node}">${x.node.slice(0, 12)}…</code></li>`
      )
      .join("");
    return `
      <div class="proof">
        <div class="kv"><span>Row ${p.row}</span><code class="wrap">${esc(p.rowText)}</code></div>
        <div class="kv"><span>Columns</span><span class="muted small">${esc(p.header)}</span></div>
        <div class="kv"><span>In chunk</span><span>#${p.index} (${esc(p.label)})</span></div>
        <ol class="proof-path">
          <li><span class="pp-level">leaf</span><span class="pp-calc">SHA-256(0x00 ‖ chunk #${p.index})</span><span class="pp-arrow">→</span><code title="${p.leaf}">${p.leaf.slice(0, 12)}…</code>
            <span class="chip ${leafOk ? "chip-ok" : "chip-bad"}">${leafOk ? "matches manifest" : "differs from manifest"}</span></li>
          ${steps}
          <li class="pp-root"><span class="pp-level">root</span><span class="pp-calc">computed</span><code title="${p.root || ""}">${p.root ? p.root.slice(0, 12) + "…" : "-"}</code>
            <span class="pp-arrow">vs on-chain</span><code title="${p.onchainRoot}">${p.onchainRoot.slice(0, 12)}…</code></li>
        </ol>
        <p class="small muted" style="margin:8px 0 0">● = the hash computed at the level below. Proof size: ${p.steps.length} sibling hashes (${p.steps.length * 32} bytes) for a dataset of ${p.count} chunks, instead of the whole file.</p>
        ${UI.checklist([
          { title: "Verified in the browser (walk the proof to the root)", status: p.ok ? "ok" : "bad", detail: p.ok ? "computed root = on-chain Merkle root" : "computed root ≠ on-chain root: this row's chunk was changed" },
          { title: "Verified by the smart contract (verifyChunk, read-only call)", status: p.onchain ? "ok" : "bad", detail: p.onchain ? "verifyChunk() returned true" : "verifyChunk() returned false" },
        ])}
      </div>`;
  }

  function lineageChainHtml(data, m) {
    return `<ol class="lineage-chain">${lineageOf(data, m)
      .map(
        (x, i) => `<li class="${x.status === ST.Flagged ? "is-flagged" : x.status === ST.Tainted ? "is-tainted" : ""}">
          <div><strong>${esc(modelLabel(x))}</strong> <span class="muted small">#${x.id}</span> ${statusChip(x)}${i === 0 ? ` <span class="chip chip-accent">this model</span>` : ""}</div>
          <div class="muted small">${esc(Chain.label(x.developer))} · ${esc(x.framework)} · sha256 <code title="${x.fileHash}">${UI.short(x.fileHash, 4)}</code>${x.parentId ? " · fine-tuned from #" + x.parentId : " · base model"}</div>
        </li>`
      )
      .join("")}</ol>`;
  }

  function verdictHtml(data, m) {
    const last = m.audits[m.audits.length - 1];
    switch (m.status) {
      case ST.Audited:
        return `<div class="callout callout-ok verdict"><strong>Trusted.</strong> Audited by ${esc(Chain.label(last.auditor))}; audit valid until ${UI.fmtTime(m.auditValidUntil)}. No flagged model in its lineage.</div>`;
      case ST.Unaudited:
        return `<div class="callout callout-warn verdict"><strong>Registered but not audited.</strong> The origin is proven, but no independent auditor has checked it yet. Use with caution.</div>`;
      case ST.AuditExpired:
        return `<div class="callout callout-warn verdict"><strong>Audit expired</strong> on ${UI.fmtTime(m.auditValidUntil)}. It needs a fresh audit before production use.</div>`;
      case ST.Flagged:
        return `<div class="callout callout-bad verdict"><strong>Do not use: flagged.</strong> ${esc(Chain.label(last.auditor))} reported: ${esc(last.notes)}</div>`;
      case ST.Tainted: {
        const t = data.model(m.taintedBy);
        return `<div class="callout callout-bad verdict"><strong>Do not use: derived from a flagged model.</strong> Its ancestor ${esc(modelLabel(t))} (#${t.id}) was flagged, so this model inherits the risk.</div>`;
      }
      default:
        return `<div class="callout callout-bad verdict"><strong>Revoked by its developer:</strong> ${esc(m.revokeReason || "no reason given")}</div>`;
    }
  }

  function passportHtml(data, m, fileNote) {
    const sc = signatureCheck(m);
    const sig = PassportCrypto.splitSignature(m.signature);
    return `
      <div class="card passport">
        <div class="card-head"><div><div class="muted small">Model passport #${m.id}</div><h2>${esc(modelLabel(m))}</h2></div>${statusChip(m)}</div>
        ${verdictHtml(data, m)}
        <div class="grid-2" style="margin-top:14px;align-items:start">
          <div>
            ${fileNote ? `<div class="kv"><span>Checked file</span><span>${esc(fileNote)}</span></div>` : ""}
            <div class="kv"><span>Developer</span><span><strong>${esc(Chain.label(m.developer))}</strong> <code>${UI.short(m.developer, 4)}</code></span></div>
            <div class="kv"><span>Framework</span><span>${esc(m.framework)}</span></div>
            <div class="kv"><span>Registered</span><span>${UI.fmtTime(m.registeredAt)}</span></div>
            <div class="kv"><span>Weights SHA-256</span><code class="wrap">${m.fileHash}</code></div>
            <div class="kv"><span>Signature</span><span><code title="${m.signature}">${UI.short(m.signature, 6)}</code> v=${sig.v} ·
              ${sc.ok ? `<span class="chip chip-ok">valid · recovers to developer</span>` : `<span class="chip chip-bad">invalid</span>`}</span></div>
            <h3 class="sub">Training data</h3>
            <ul class="plain">${m.datasetIds
              .map((id) => {
                const d = data.dataset(id);
                return `<li><strong>#${d.id} ${esc(d.name)}</strong> <span class="muted small">· ${esc(Chain.label(d.provider))} · ${d.chunkCount} chunks · ${esc(d.license)} · root <code title="${d.merkleRoot}">${UI.short(d.merkleRoot, 4)}</code></span></li>`;
              })
              .join("")}</ul>
          </div>
          <div>
            <h3 class="sub" style="margin-top:0">Lineage (this model → base)</h3>
            ${lineageChainHtml(data, m)}
          </div>
        </div>
        <h3 class="sub">Audit trail</h3>
        ${
          m.audits.length
            ? `<div class="table-wrap"><table class="table"><thead><tr><th>Time</th><th>Auditor</th><th>Verdict</th><th>Notes</th><th>Report hash</th></tr></thead><tbody>${m.audits
                .map(
                  (a) => `<tr><td data-label="Time">${UI.fmtTime(a.time)}</td><td data-label="Auditor">${esc(Chain.label(a.auditor))}</td>
                  <td data-label="Verdict">${a.passed ? `<span class="chip chip-ok">Pass</span>` : `<span class="chip chip-bad">Flagged</span>`}</td>
                  <td data-label="Notes">${esc(a.notes)}</td><td data-label="Report"><code title="${a.reportHash}">${UI.short(a.reportHash, 4)}</code></td></tr>`
                )
                .join("")}</tbody></table></div>`
            : `<p class="muted">No audits yet.</p>`
        }
      </div>`;
  }

  function modelsTable(data, { actions, compact } = {}) {
    if (!data.models.length) return `<div class="empty">No model passports yet. Register one as a developer.</div>`;
    if (compact)
      return `<div class="table-wrap"><table class="table"><thead><tr><th>Model</th><th>Developer</th><th>Status</th></tr></thead><tbody>${data.models
        .map(
          (m) => `<tr><td data-label="Model"><strong>${esc(modelLabel(m))}</strong> <span class="muted small">#${m.id}</span>
            <div class="muted small">${m.parentId ? `fine-tuned from #${m.parentId}` : "base model"} · datasets ${m.datasetIds.map((i) => "#" + i).join(", ")}</div></td>
            <td data-label="Developer">${esc(Chain.label(m.developer))}</td><td data-label="Status">${statusChip(m)}</td></tr>`
        )
        .join("")}</tbody></table></div>`;
    return `<div class="table-wrap"><table class="table">
      <thead><tr><th>Model</th><th>Developer</th><th>Derived from</th><th>Datasets</th><th>Status</th>${actions ? "<th></th>" : ""}</tr></thead>
      <tbody>${data.models
        .map((m) => {
          const p = m.parentId ? data.model(m.parentId) : null;
          return `<tr>
            <td data-label="Model"><strong>${esc(modelLabel(m))}</strong> <span class="muted small">#${m.id}</span><div class="muted small">${esc(m.framework)}</div></td>
            <td data-label="Developer">${esc(Chain.label(m.developer))}</td>
            <td data-label="Derived from">${p ? `${esc(modelLabel(p))} <span class="muted small">#${p.id}</span>` : `<span class="muted">base model</span>`}</td>
            <td data-label="Datasets">${m.datasetIds.map((id) => `<span class="chip" title="${esc(data.dataset(id).name)}">#${id}</span>`).join(" ")}</td>
            <td data-label="Status">${statusChip(m)}</td>
            ${actions ? `<td data-label="">${actions(m)}</td>` : ""}
          </tr>`;
        })
        .join("")}</tbody></table></div>`;
  }

  function datasetsTable(data) {
    if (!data.datasets.length) return `<div class="empty">No datasets yet. Register one as a data provider.</div>`;
    const mans = manifests();
    return `<div class="table-wrap"><table class="table">
      <thead><tr><th>Dataset</th><th>Provider</th><th>Chunks</th><th>Merkle root</th><th>Manifest</th></tr></thead>
      <tbody>${data.datasets
        .map(
          (d) => `<tr>
          <td data-label="Dataset"><strong>${esc(d.name)}</strong> <span class="muted small">#${d.id}</span><div class="muted small">${fmtBytes(d.totalBytes)} · ${esc(d.license)}</div></td>
          <td data-label="Provider">${esc(Chain.label(d.provider))}</td>
          <td data-label="Chunks">${d.chunkCount}</td>
          <td data-label="Root"><code title="${d.merkleRoot}">${UI.short(d.merkleRoot, 5)}</code></td>
          <td data-label="Manifest">${mans[d.merkleRoot] ? `<span class="chip chip-ok">published</span>` : `<span class="chip">sample file</span>`}</td>
        </tr>`
        )
        .join("")}</tbody></table></div>`;
  }

  /** Sample prerequisites: registered parent id and dataset ids (null when missing). */
  async function samplePrereqs(sample, data) {
    let parentId = 0;
    const missing = [];
    if (sample.parent) {
      const h = await modelHash(await getFile("s:" + sample.parent));
      const p = data.models.find((m) => m.fileHash === h);
      if (p) parentId = p.id;
      else missing.push(`parent model ${SAMPLE_MODELS.find((x) => x.key === sample.parent).file}`);
    }
    const datasetIds = [];
    for (const key of sample.datasets) {
      const t = await datasetTree(await getFile("s:" + key));
      const d = data.datasets.find((x) => x.merkleRoot === t.root);
      if (d) datasetIds.push(d.id);
      else missing.push(`dataset "${SAMPLE_DATASETS.find((x) => x.key === key).name}"`);
    }
    return { parentId, datasetIds, missing };
  }

  // ------------------------------------------------------------------
  // Views
  // ------------------------------------------------------------------
  async function viewHome(el, { data, go }) {
    const trusted = data.models.filter((m) => m.status === ST.Audited).length;
    const unsafe = data.models.filter((m) => m.status === ST.Flagged || m.status === ST.Tainted).length;
    el.innerHTML = `
      ${pageHead(
        "ModelPassport: AI Model &amp; Dataset Provenance",
        "Models and datasets downloaded from the internet can be poisoned or swapped, and nobody can prove who trained a model, on which data, or whether it was audited. ModelPassport gives every model a verifiable passport on a consortium blockchain.",
        `<button class="btn" id="start-btn">${Shell.icon("upload")} Register a sample dataset</button>
         <button class="btn btn-secondary" id="verify-btn">${Shell.icon("search")} Verify a model</button>`
      )}
      <div class="grid-4" style="margin-bottom:16px">
        <div class="card stat"><span class="stat-value">${data.datasets.length}</span><span class="stat-label">Datasets (Merkle roots)</span></div>
        <div class="card stat"><span class="stat-value">${data.models.length}</span><span class="stat-label">Model passports</span></div>
        <div class="card stat"><span class="stat-value">${trusted}</span><span class="stat-label">Audited &amp; trusted</span></div>
        <div class="card stat"><span class="stat-value">${unsafe}</span><span class="stat-label">Flagged or derived from flagged</span></div>
      </div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-head"><h2>How it works</h2></div>
        <div class="flow" style="--steps:4">
          <div class="flow-step"><h3>Commit the data</h3><p>A data provider splits the dataset into 20-row chunks, hashes them into a Merkle tree and records only the root on-chain.</p></div>
          <div class="flow-step"><h3>Sign the passport</h3><p>The developer signs the SHA-256 of the weights, the parent model and the dataset IDs. The contract checks the signature with ecrecover.</p></div>
          <div class="flow-step"><h3>Independent audit</h3><p>An auditor passes or flags the model with a hashed report. A flag warns every model fine-tuned from it.</p></div>
          <div class="flow-step"><h3>Verify before use</h3><p>Hash the downloaded file and look up its passport. For datasets, the Merkle diff shows exactly which chunks were poisoned.</p></div>
        </div>
      </div>
      <div class="grid-2" style="align-items:start">
        <div class="card"><div class="card-head"><h2>Model passports</h2><a href="#/lineage" class="small">Lineage tree</a></div>${modelsTable(data, { compact: true })}</div>
        <div class="card">
          <div class="card-head"><h2>Demo script (5 minutes)</h2></div>
          <ol class="demo-steps">
            <li><a href="#/providers">Data Providers</a>: register <em>Skin Lesion Features</em> and <em>Clinic B</em>. Watch chunk → leaves → Merkle root → transaction.</li>
            <li><a href="#/developers">Developers</a>: MedVision AI signs and registers <em>skin-lesion-classifier v1</em>, then <em>v2</em> fine-tuned from v1.</li>
            <li><a href="#/auditors">Auditors</a>: TrustAI Auditors passes v1. The report hash goes on-chain.</li>
            <li><a href="#/verify">Verify</a>: check <em>skin-lesion-classifier-v2.bin</em>: signature, lineage, datasets, audits. Then prove one dataset row with a Merkle proof.</li>
            <li><a href="#/poison">Poison Lab</a>: flip a few labels; the diff names exactly the changed chunks. Patch a few weight bytes; no passport matches.</li>
            <li><a href="#/auditors">Auditors</a>: flag v1 as poisoned. <a href="#/lineage">Lineage</a> now warns on v2 too.</li>
            <li><a href="#/developers">Developers</a>: NeuralForge tries to build on v2. The smart contract blocks it.</li>
            <li><a href="#/explorer">Blockchain Explorer</a>: hash-linked blocks and the audit log.</li>
          </ol>
        </div>
      </div>
      <div class="card" style="margin-top:16px"><div class="card-head"><h2>Registered datasets</h2><a href="#/providers" class="small">Data Providers</a></div>${datasetsTable(data)}</div>`;
    el.querySelector("#start-btn").addEventListener("click", () => {
      Shell.state.dsForm = null;
      go("providers");
    });
    el.querySelector("#verify-btn").addEventListener("click", () => go("verify"));
  }

  async function viewConsortium(el, { data, state, action }) {
    const free = Chain.accounts
      .map((a, i) => ({ a, i }))
      .filter(({ a, i }) => i > 0 && !data.members.some((m) => sameAddr(m.address, a)));
    el.innerHTML = `
      ${pageHead("AI Safety Consortium (admin)", `Acting as <code>${UI.short(admin(), 4)}</code>, the contract deployer. The consortium is permissioned: only the admin admits members and assigns one role to each.`)}
      <div class="grid-2" style="align-items:start">
        <div class="card">
          <div class="card-head"><h2>Members</h2><span class="muted small">${data.members.length} members</span></div>
          <div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Role</th><th>Account</th><th>Status</th><th></th></tr></thead><tbody>
          ${data.members
            .map(
              (m) => `<tr><td data-label="Name"><strong>${esc(m.name)}</strong></td>
              <td data-label="Role"><span class="chip chip-accent">${ROLE_LABEL[m.role]}</span></td>
              <td data-label="Account"><code>${UI.short(m.address, 4)}</code></td>
              <td data-label="Status">${memberChip(m)}</td>
              <td data-label=""><button class="btn btn-secondary btn-sm" data-toggle="${m.address}" data-active="${m.active}">${m.active ? "Suspend" : "Activate"}</button></td></tr>`
            )
            .join("")}</tbody></table></div>
        </div>
        <form class="card" id="member-form" autocomplete="off">
          <div class="card-head"><h2>Admit a new member</h2></div>
          ${
            free.length
              ? `<div class="field"><label for="mem-account">Account</label><select id="mem-account">${free
                  .map(({ a, i }) => `<option value="${a}">Account #${i} · ${UI.short(a, 4)}</option>`)
                  .join("")}</select></div>
                 <div class="field"><label for="mem-role">Role</label><select id="mem-role">
                   <option value="${ROLE.DataProvider}">Data provider</option><option value="${ROLE.Developer}">Model developer</option><option value="${ROLE.Auditor}" selected>Auditor</option></select></div>
                 <div class="field"><label for="mem-name">Organisation name</label><input id="mem-name" type="text" required placeholder="e.g. Northwind Robustness Lab"></div>
                 <button class="btn" type="submit" id="mem-btn">${Shell.icon("users")} Register member</button>`
              : `<p class="muted">All demo accounts are already members.</p>`
          }
          <p class="muted small" style="margin-top:12px">Suspended members keep their history, but the contract rejects any new dataset, model or audit from them.</p>
        </form>
      </div>`;
    el.querySelectorAll("[data-toggle]").forEach((b) =>
      b.addEventListener("click", () =>
        action(b, async () => {
          await Chain.send(admin(), "setMemberActive", [b.dataset.toggle, b.dataset.active !== "true"]);
          UI.toast(`${Chain.label(b.dataset.toggle)} ${b.dataset.active === "true" ? "suspended" : "re-activated"}`, "success");
        })
      )
    );
    const form = el.querySelector("#member-form");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = el.querySelector("#mem-name").value.trim();
      if (!name) return;
      action(el.querySelector("#mem-btn"), async () => {
        await Chain.send(admin(), "registerMember", [el.querySelector("#mem-account").value, Number(el.querySelector("#mem-role").value), name]);
        UI.toast(`${name} joined the consortium`, "success");
      });
    });
  }

  function previewHtml(file) {
    if (!file) return "";
    if (!PassportCrypto.isTable(file.name)) return `<p class="muted small">${esc(file.name)} · ${fmtBytes(file.bytes.length)} · split into byte chunks</p>`;
    const lines = UI.utf8.decode(file.bytes.slice(0, 4000)).split("\n").slice(0, 6).filter(Boolean);
    const cells = lines.map((l) => l.replace(/\r$/, "").split(","));
    const total = (UI.utf8.decode(file.bytes).match(/\n/g) || []).length;
    return `<div class="table-wrap preview"><table class="table"><thead><tr>${cells[0].map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${cells
      .slice(1)
      .map((r) => `<tr>${r.map((c, i) => `<td data-label="${esc(cells[0][i] || "")}">${esc(c)}</td>`).join("")}</tr>`)
      .join("")}</tbody></table></div><p class="muted small" style="margin-top:6px">${esc(file.name)} · ${fmtBytes(file.bytes.length)} · ${Math.max(0, total - 1)} data rows (first 5 shown)</p>`;
  }

  async function viewProviders(el, { data, state, action }) {
    if (!data.providers.length) return (el.innerHTML = `<div class="empty">No data providers registered.</div>`);
    const f = (state.dsForm = state.dsForm || {});
    if (!data.providers.some((p) => sameAddr(p.address, f.provider))) f.provider = data.providers[0].address;
    const me = data.providers.find((p) => sameAddr(p.address, f.provider));
    const mineIdx = Chain.accounts.findIndex((a) => sameAddr(a, me.address));
    const mySamples = SAMPLE_DATASETS.filter((s) => s.provider === mineIdx);
    if (!f.ref || !(await getFile(f.ref))) {
      // first sample of this provider that is not registered yet
      let pick = mySamples[0];
      for (const s of mySamples) {
        const t = await datasetTree(await getFile("s:" + s.key));
        if (!data.datasets.some((d) => d.merkleRoot === t.root)) {
          pick = s;
          break;
        }
      }
      f.ref = pick ? "s:" + pick.key : null;
      f.name = pick ? pick.name : "";
      f.license = pick ? pick.license : LICENSES[0];
    }
    const file = await getFile(f.ref);
    const r = state.dsResult;
    el.innerHTML = `
      ${pageHead("Data Providers", "A provider commits to the exact content of a dataset by registering the Merkle root of its chunks. Anyone can later prove that a file, or a single row, is part of it.")}
      ${tabs(data.providers, me.address, "provider")}
      <div class="grid-2" style="align-items:start;margin-bottom:16px">
        <form class="card" id="ds-form" autocomplete="off">
          <div class="card-head"><h2>Register a dataset</h2><span class="muted small">as ${esc(me.name)} ${memberChip(me)}</span></div>
          <div class="field"><label for="ds-file">Dataset file</label>
            <div class="row nowrap-row">${await fileSelect("ds-file", "dataset", f.ref, { samplesFilter: (k) => mySamples.some((s) => s.key === k) })}
            <label class="btn btn-secondary btn-sm">Upload CSV / file<input type="file" id="ds-upload" hidden></label></div>
            <span class="hint">Files are hashed in your browser. Only the Merkle root goes on-chain; the leaf list is published off-chain.</span></div>
          ${previewHtml(file)}
          <div class="grid-2" style="gap:12px;margin-top:12px">
            <div class="field"><label for="ds-name">Dataset name</label><input id="ds-name" type="text" required value="${esc(f.name || "")}"></div>
            <div class="field"><label for="ds-license">Licence</label><select id="ds-license">${LICENSES.map((l) => `<option ${l === f.license ? "selected" : ""}>${l}</option>`).join("")}</select></div>
          </div>
          <button class="btn" type="submit" id="ds-btn">${Shell.icon("layers")} Build Merkle tree &amp; register</button>
        </form>
        <div class="card">
          <div class="card-head"><h2>What happens</h2></div>
          <div id="ds-steps">${r ? UI.checklist(r.items) : `<p class="muted">The steps run in your browser and are shown here: chunking, leaf hashing, the Merkle tree, the blockchain transaction and the manifest.</p>`}</div>
          ${r && r.levels ? `<h3 class="sub">Merkle tree</h3>${merkleTreeHtml(r.levels)}` : ""}
        </div>
      </div>
      <div class="card"><div class="card-head"><h2>Registered datasets</h2></div>${datasetsTable(data)}</div>`;

    el.querySelectorAll("[data-provider]").forEach((b) =>
      b.addEventListener("click", () => {
        state.dsForm = { provider: b.dataset.provider };
        Shell.render();
      })
    );
    el.querySelector("#ds-file").addEventListener("change", async (e) => {
      const nf = await getFile(e.target.value);
      f.ref = nf.ref;
      f.name = nf.sample ? nf.sample.name : nf.name.replace(/\.[^.]+$/, "");
      if (nf.sample) f.license = nf.sample.license;
      Shell.render();
    });
    el.querySelector("#ds-upload").addEventListener("change", async (e) => {
      const nf = await readUpload(e.target, "dataset");
      if (!nf) return;
      f.ref = nf.ref;
      f.name = nf.name.replace(/\.[^.]+$/, "");
      Shell.render();
    });
    el.querySelector("#ds-name").addEventListener("input", (e) => (f.name = e.target.value));
    el.querySelector("#ds-license").addEventListener("change", (e) => (f.license = e.target.value));
    el.querySelector("#ds-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = el.querySelector("#ds-name").value.trim();
      if (!name) return UI.toast("Give the dataset a name", "error");
      action(el.querySelector("#ds-btn"), () => registerDataset({ provider: me.address, ref: f.ref, name, license: el.querySelector("#ds-license").value }));
    });
  }

  async function viewDevelopers(el, { data, state, action }) {
    if (!data.developers.length) return (el.innerHTML = `<div class="empty">No developers registered.</div>`);
    const f = (state.devForm = state.devForm || {});
    if (!data.developers.some((p) => sameAddr(p.address, f.developer))) f.developer = data.developers[0].address;
    const me = data.developers.find((p) => sameAddr(p.address, f.developer));
    const myIdx = Chain.accounts.findIndex((a) => sameAddr(a, me.address));
    const mySamples = SAMPLE_MODELS.filter((s) => s.developer === myIdx);

    const fillFromSample = async (sample) => {
      const pre = await samplePrereqs(sample, data);
      Object.assign(f, { ref: "s:" + sample.key, name: sample.name, version: sample.version, framework: sample.framework, parentId: pre.parentId, datasetIds: pre.datasetIds });
      return pre;
    };
    if (!f.ref || !(await getFile(f.ref))) {
      // first sample of this developer that is not registered yet and whose prerequisites exist
      let pick = null;
      let fallback = null;
      for (const s of mySamples) {
        const h = await modelHash(await getFile("s:" + s.key));
        if (data.models.some((m) => m.fileHash === h)) continue;
        const pre = await samplePrereqs(s, data);
        fallback = fallback || s;
        if (!pre.missing.length) {
          pick = s;
          break;
        }
      }
      if (pick || fallback) await fillFromSample(pick || fallback);
      else Object.assign(f, { ref: mySamples[0] ? "s:" + mySamples[0].key : null, name: "", version: "", framework: FRAMEWORKS[0], parentId: 0, datasetIds: [] });
    }
    const file = await getFile(f.ref);
    const header = file ? PassportCrypto.readWeightsHeader(file.bytes) : null;
    const pending = file && file.sample ? (await samplePrereqs(file.sample, data)).missing : [];
    const r = state.modelResult;
    const mine = data.models.filter((m) => sameAddr(m.developer, me.address));
    el.innerHTML = `
      ${pageHead("Model Developers", "A developer registers the SHA-256 of a model's weights file with its lineage and training datasets, signed with their own key. The smart contract verifies the signature with ecrecover before it accepts the passport.")}
      ${tabs(data.developers, me.address, "developer")}
      <div class="grid-2" style="align-items:start;margin-bottom:16px">
        <form class="card" id="model-form" autocomplete="off">
          <div class="card-head"><h2>Register a model passport</h2><span class="muted small">as ${esc(me.name)} ${memberChip(me)}</span></div>
          <div class="field"><label for="model-file">Weights file</label>
            <div class="row nowrap-row">${await fileSelect("model-file", "model", f.ref)}
            <label class="btn btn-secondary btn-sm">Upload weights<input type="file" id="model-upload" hidden></label></div>
            <span class="hint">${file ? `${esc(file.name)} · ${fmtBytes(file.bytes.length)}${header ? ` · ${esc(header.arch)} ${header.layers.map((l) => l.join("×")).join(", ")} · ${header.params.toLocaleString()} float32 weights` : ""}` : ""}</span></div>
          ${pending.length ? `<div class="callout callout-warn small" style="margin-bottom:12px">This sample needs ${esc(pending.join(" and "))} to be registered first.</div>` : ""}
          <div class="grid-3" style="gap:12px">
            <div class="field"><label for="m-name">Model name</label><input id="m-name" type="text" required value="${esc(f.name || "")}"></div>
            <div class="field"><label for="m-version">Version</label><input id="m-version" type="text" required value="${esc(f.version || "")}"></div>
            <div class="field"><label for="m-fw">Framework</label><select id="m-fw">${FRAMEWORKS.map((x) => `<option ${x === f.framework ? "selected" : ""}>${x}</option>`).join("")}</select></div>
          </div>
          <div class="field"><label for="m-parent">Fine-tuned from (parent model)</label>
            <select id="m-parent"><option value="0">None: this is a base model</option>${data.models
              .map((m) => `<option value="${m.id}" ${m.id === f.parentId ? "selected" : ""}>#${m.id} ${esc(modelLabel(m))} · ${esc(Chain.label(m.developer))} · ${STATUS_UI[m.status].label}</option>`)
              .join("")}</select></div>
          <div class="field"><label>Training / fine-tuning datasets</label>
            ${
              data.datasets.length
                ? `<div class="row">${data.datasets
                    .map((d) => `<label class="chip check-chip"><input type="checkbox" name="ds" value="${d.id}" ${(f.datasetIds || []).includes(d.id) ? "checked" : ""}> #${d.id} ${esc(d.name)}</label>`)
                    .join("")}</div>`
                : `<p class="muted small">No datasets registered yet: ask a data provider first.</p>`
            }</div>
          <div class="row"><button class="btn" type="submit" id="model-btn">${Shell.icon("key")} Sign &amp; register passport</button>
            <button type="button" class="btn btn-ghost btn-sm" id="next-sample">Load next sample</button></div>
        </form>
        <div class="card">
          <div class="card-head"><h2>What happens</h2></div>
          <div id="model-steps">${r ? UI.checklist(r.items) : `<p class="muted">Hashing, the passport message, the ECDSA signature and the on-chain registration appear here step by step.</p>`}</div>
          ${
            r && r.sig
              ? `<h3 class="sub">ECDSA signature (secp256k1)</h3>
                 <div class="kv"><span>r</span><code class="wrap">${r.sig.r}</code></div>
                 <div class="kv"><span>s</span><code class="wrap">${r.sig.s}</code></div>
                 <div class="kv"><span>v</span><span>${r.sig.v} · low-s ${r.sig.lowS ? "✓ (not malleable)" : "✕"}</span></div>`
              : ""
          }
        </div>
      </div>
      <div class="card"><div class="card-head"><h2>Passports by ${esc(me.name)}</h2></div>
        ${modelsTable(
          { ...data, models: mine },
          { actions: (m) => (m.revoked ? `<span class="muted small">revoked</span>` : `<button class="btn btn-secondary btn-sm" data-revoke="${m.id}">Revoke</button>`) }
        )}</div>`;

    const saveFields = () => {
      f.name = el.querySelector("#m-name").value;
      f.version = el.querySelector("#m-version").value;
      f.framework = el.querySelector("#m-fw").value;
      f.parentId = Number(el.querySelector("#m-parent").value);
      f.datasetIds = [...el.querySelectorAll('input[name="ds"]:checked')].map((i) => Number(i.value));
    };
    el.querySelectorAll("[data-developer]").forEach((b) =>
      b.addEventListener("click", () => {
        state.devForm = { developer: b.dataset.developer };
        Shell.render();
      })
    );
    el.querySelector("#model-file").addEventListener("change", async (e) => {
      const nf = await getFile(e.target.value);
      if (nf.sample) await fillFromSample(nf.sample);
      else {
        saveFields();
        f.ref = nf.ref;
      }
      Shell.render();
    });
    el.querySelector("#model-upload").addEventListener("change", async (e) => {
      const nf = await readUpload(e.target, "model");
      if (!nf) return;
      saveFields();
      Object.assign(f, { ref: nf.ref, name: nf.name.replace(/\.[^.]+$/, ""), version: "v1" });
      Shell.render();
    });
    el.querySelector("#next-sample").addEventListener("click", async () => {
      for (const s of mySamples) {
        const h = await modelHash(await getFile("s:" + s.key));
        if (data.models.some((m) => m.fileHash === h)) continue;
        const pre = await fillFromSample(s);
        if (pre.missing.length) UI.toast(`Register ${pre.missing.join(" and ")} first`, "info");
        return Shell.render();
      }
      UI.toast(`All of ${me.name}'s sample models are registered`, "info");
    });
    ["#m-name", "#m-version", "#m-fw", "#m-parent"].forEach((sel) => el.querySelector(sel).addEventListener("change", saveFields));
    el.querySelectorAll('input[name="ds"]').forEach((i) => i.addEventListener("change", saveFields));
    el.querySelector("#model-form").addEventListener("submit", (e) => {
      e.preventDefault();
      saveFields();
      if (!f.datasetIds.length) return UI.toast("Select at least one training dataset", "error");
      action(el.querySelector("#model-btn"), () =>
        registerModel({ developer: me.address, ref: f.ref, name: f.name.trim(), version: f.version.trim(), framework: f.framework, parentId: f.parentId, datasetIds: f.datasetIds })
      );
    });
    el.querySelectorAll("[data-revoke]").forEach((b) =>
      b.addEventListener("click", () => {
        const reason = prompt("Reason for revoking this model:", "Superseded by a newer version");
        if (reason) action(b, () => revokeModel(me.address, Number(b.dataset.revoke), reason));
      })
    );
  }

  async function viewAuditors(el, { data, state, action }) {
    if (!data.auditors.length) return (el.innerHTML = `<div class="empty">No auditors registered.</div>`);
    if (!data.auditors.some((a) => sameAddr(a.address, state.auditor))) state.auditor = data.auditors[0].address;
    const me = data.auditors.find((a) => sameAddr(a.address, state.auditor));
    const f = (state.auditForm = state.auditForm || { verdict: "pass", finding: FINDINGS[0] });
    const auditable = data.models.filter((m) => !m.revoked && !m.flagged);
    if (!auditable.some((m) => m.id === f.modelId)) {
      const firstOpen = auditable.find((m) => m.status === ST.Unaudited || m.status === ST.AuditExpired) || auditable[0];
      f.modelId = firstOpen ? firstOpen.id : null;
    }
    const r = state.auditResult;
    const allAudits = data.models
      .flatMap((m) => m.audits.map((a) => ({ ...a, model: m })))
      .sort((a, b) => b.time - a.time);
    const reports = Chain.store.get("reports", {});
    el.innerHTML = `
      ${pageHead(
        "Independent Auditors",
        "Auditors re-check a model's passport, signature, datasets and lineage, then record a pass (valid for 180 days) or a flag with the hash of their report. A flag warns every model derived from the flagged one.",
        `<button class="btn btn-secondary" id="ff-btn" title="Move blockchain time forward 181 days to see audits expire">${Shell.icon("forward")} Jump +181 days</button>`
      )}
      ${tabs(data.auditors, me.address, "auditor")}
      <div class="grid-2" style="align-items:start;margin-bottom:16px">
        <form class="card" id="audit-form" autocomplete="off">
          <div class="card-head"><h2>Audit a model</h2><span class="muted small">as ${esc(me.name)} ${memberChip(me)}</span></div>
          ${
            auditable.length
              ? `<div class="field"><label for="audit-model">Model</label><select id="audit-model">${auditable
                  .map((m) => `<option value="${m.id}" ${m.id === f.modelId ? "selected" : ""}>#${m.id} ${esc(modelLabel(m))} · ${esc(Chain.label(m.developer))} · ${STATUS_UI[m.status].label}</option>`)
                  .join("")}</select></div>
                <fieldset class="field verdict-pick"><legend>Verdict</legend>
                  <label><input type="radio" name="verdict" value="pass" ${f.verdict === "pass" ? "checked" : ""}> Pass: no poisoning or backdoor found</label>
                  <label><input type="radio" name="verdict" value="flag" ${f.verdict === "flag" ? "checked" : ""}> Flag: poisoned or vulnerable</label>
                </fieldset>
                <div class="field ${f.verdict === "flag" ? "" : "hidden"}" id="finding-field"><label for="audit-finding">Finding</label><select id="audit-finding">${FINDINGS.map((x) => `<option ${x === f.finding ? "selected" : ""}>${x}</option>`).join("")}</select></div>
                <div class="field"><label for="audit-notes">Notes (stored on-chain)</label><input id="audit-notes" type="text" value="${esc(
                  f.notes || (f.verdict === "flag" ? "Label-flip attack confirmed in training chunks" : "Trigger scan and label audit clean")
                )}"></div>
                <button class="btn" type="submit" id="audit-btn">${Shell.icon("shield")} Run checks &amp; record verdict</button>`
              : `<p class="muted">No models to audit. Flagged and revoked models cannot be audited again.</p>`
          }
        </form>
        <div class="card">
          <div class="card-head"><h2>Audit steps</h2></div>
          <div id="audit-steps">${r ? UI.checklist(r.items) : `<p class="muted">The auditor's checks, the report hash and the on-chain verdict appear here.</p>`}</div>
        </div>
      </div>
      <div class="card"><div class="card-head"><h2>Audit log</h2><span class="muted small">Passing audits are valid for 180 days of blockchain time.</span></div>
      ${
        allAudits.length
          ? `<div class="table-wrap"><table class="table"><thead><tr><th>Time</th><th>Model</th><th>Auditor</th><th>Verdict</th><th>Notes</th><th>Report</th></tr></thead><tbody>${allAudits
              .map(
                (a) => `<tr><td data-label="Time" class="nowrap">${UI.fmtTime(a.time)}</td><td data-label="Model">${esc(modelLabel(a.model))} <span class="muted small">#${a.model.id}</span></td>
                <td data-label="Auditor">${esc(Chain.label(a.auditor))}</td>
                <td data-label="Verdict">${a.passed ? `<span class="chip chip-ok">Pass</span>` : `<span class="chip chip-bad">Flagged</span>`}</td>
                <td data-label="Notes">${esc(a.notes)}</td>
                <td data-label="Report"><code title="${a.reportHash}">${UI.short(a.reportHash, 4)}</code>${reports[a.reportHash] ? ` <button class="btn btn-ghost btn-sm" data-report="${a.reportHash}">Download</button>` : ""}</td></tr>`
              )
              .join("")}</tbody></table></div>`
          : `<div class="empty">No audits yet.</div>`
      }</div>`;

    el.querySelectorAll("[data-auditor]").forEach((b) =>
      b.addEventListener("click", () => {
        state.auditor = b.dataset.auditor;
        Shell.render();
      })
    );
    el.querySelector("#ff-btn").addEventListener("click", (e) =>
      action(e.currentTarget, async () => {
        await Chain.fastForward(181 * DAY);
        UI.toast("Blockchain time moved forward 181 days: earlier audits have expired", "success");
      })
    );
    const form = el.querySelector("#audit-form");
    const msel = el.querySelector("#audit-model");
    if (!msel) return;
    msel.addEventListener("change", () => (f.modelId = Number(msel.value)));
    form.querySelectorAll('input[name="verdict"]').forEach((i) =>
      i.addEventListener("change", () => {
        f.verdict = i.value;
        f.notes = "";
        Shell.render();
      })
    );
    el.querySelector("#audit-finding").addEventListener("change", (e) => (f.finding = e.target.value));
    el.querySelector("#audit-notes").addEventListener("input", (e) => (f.notes = e.target.value));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      f.modelId = Number(msel.value);
      action(el.querySelector("#audit-btn"), async () => {
        await auditModel({
          auditor: me.address,
          modelId: f.modelId,
          passed: f.verdict === "pass",
          finding: el.querySelector("#audit-finding").value,
          notes: el.querySelector("#audit-notes").value.trim() || "-",
        });
        state.auditForm = { verdict: "pass", finding: FINDINGS[0] };
      });
    });
    el.querySelectorAll("[data-report]").forEach((b) =>
      b.addEventListener("click", () => UI.download(`audit-report-${b.dataset.report.slice(2, 10)}.txt`, reports[b.dataset.report]))
    );
  }

  async function viewVerify(el, { data, state, action }) {
    const tab = state.verifyTab || "model";
    state.vmRef = state.vmRef && (await getFile(state.vmRef)) ? state.vmRef : "s:skin2";
    if (!state.vdRef || !(await getFile(state.vdRef))) state.vdRef = "s:skin";
    const vdFile = await getFile(state.vdRef);
    if (!data.datasets.some((d) => d.id === state.vdDataset) && data.datasets.length) {
      const t = await datasetTree(vdFile);
      const match =
        data.datasets.find((d) => d.merkleRoot === t.root || d.merkleRoot === vdFile.baseRoot) ||
        data.datasets.find((d) => vdFile.sample && d.name === vdFile.sample.name);
      state.vdDataset = (match || data.datasets[0]).id;
    }
    const vm = state.vm;
    const vmModel = vm && vm.modelId ? data.model(vm.modelId) : null;
    const vd = state.vd;
    const proof = state.proof && vd && state.proof.datasetId === vd.datasetId ? state.proof : null;

    const modelTab = `
      <div class="grid-2" style="align-items:start;margin-bottom:16px">
        <form class="card" id="vm-form">
          <div class="card-head"><h2>Check a downloaded model</h2></div>
          <div class="field"><label for="vm-file">Model file</label>
            <div class="row nowrap-row">${await fileSelect("vm-file", "model", state.vmRef)}
            <label class="btn btn-secondary btn-sm">Upload file<input type="file" id="vm-upload" hidden></label></div>
            <span class="hint">The file is hashed locally; only the hash is looked up on-chain.</span></div>
          <button class="btn" type="submit" id="vm-btn">${Shell.icon("search")} Verify model</button>
        </form>
        <div class="card"><div class="card-head"><h2>Checks</h2></div>
          <div id="vm-steps">${vm && vm.items ? UI.checklist(vm.items) : `<p class="muted">Hash → passport lookup → signature → lineage → datasets → audits.</p>`}</div>
          ${vm && vm.items && !vm.found ? `<div class="callout callout-bad verdict" style="margin-top:12px"><strong>Do not use this file.</strong> Its SHA-256 matches no passport in the registry.</div>` : ""}
        </div>
      </div>
      ${vmModel ? passportHtml(data, vmModel, vm.fileName ? `${vm.fileName} · sha256 matches` : "") : ""}`;

    const ds = data.dataset(state.vdDataset);
    const datasetTab = data.datasets.length
      ? `
      <div class="grid-2" style="align-items:start;margin-bottom:16px">
        <form class="card" id="vd-form">
          <div class="card-head"><h2>Check a dataset file</h2></div>
          <div class="field"><label for="vd-file">Dataset file</label>
            <div class="row nowrap-row">${await fileSelect("vd-file", "dataset", state.vdRef)}
            <label class="btn btn-secondary btn-sm">Upload file<input type="file" id="vd-upload" hidden></label></div></div>
          <div class="field"><label for="vd-dataset">Claimed dataset (on-chain)</label><select id="vd-dataset">${data.datasets
            .map((d) => `<option value="${d.id}" ${d.id === state.vdDataset ? "selected" : ""}>#${d.id} ${esc(d.name)} · ${esc(Chain.label(d.provider))}</option>`)
            .join("")}</select></div>
          <button class="btn" type="submit" id="vd-btn">${Shell.icon("layers")} Verify dataset</button>
        </form>
        <div class="card"><div class="card-head"><h2>Result</h2></div>
          <div id="vd-a">${vd ? "" : `<p class="muted">Re-chunk the file, rebuild the Merkle root and compare it with the root on-chain. If it differs, the provider's manifest pinpoints the changed chunks.</p>`}</div>
          <div id="vd-b"></div>
          ${datasetResultHtml(vd)}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Prove a single row (Merkle proof)</h2><span class="muted small">Only ${ds ? Math.ceil(Math.log2(Math.max(2, ds.chunkCount))) : "a few"} sibling hashes are needed, not the whole dataset.</span></div>
        <form class="row" id="proof-form" style="margin-bottom:12px">
          <label for="proof-row" class="small"><strong>Row number</strong></label>
          <input id="proof-row" type="number" min="1" step="1" value="${proof ? proof.row : 57}" style="width:110px">
          <button class="btn" type="submit" id="proof-btn">${Shell.icon("check")} Build &amp; check proof</button>
          <span class="muted small">uses the file and dataset selected above</span>
        </form>
        ${proof ? proofHtml(proof) : `<p class="muted">Pick a row: its chunk is hashed into a leaf and combined with sibling hashes up to the root, in the browser and by the contract's <code>verifyChunk()</code>.</p>`}
      </div>`
      : `<div class="card empty">No datasets registered yet.</div>`;

    el.innerHTML = `
      ${pageHead("Verify before use", "Anyone can check a model or dataset file against the registry. Nothing is uploaded: files are hashed in the browser and only hashes are compared with the blockchain.")}
      <div class="segmented" role="tablist" style="margin-bottom:16px">
        <button type="button" role="tab" data-tab="model" class="${tab === "model" ? "active" : ""}">${Shell.icon("cpu")} Model passport</button>
        <button type="button" role="tab" data-tab="dataset" class="${tab === "dataset" ? "active" : ""}">${Shell.icon("layers")} Dataset</button>
      </div>
      ${tab === "model" ? modelTab : datasetTab}`;

    el.querySelectorAll("[data-tab]").forEach((b) =>
      b.addEventListener("click", () => {
        state.verifyTab = b.dataset.tab;
        Shell.render();
      })
    );
    if (tab === "model") {
      el.querySelector("#vm-file").addEventListener("change", (e) => (state.vmRef = e.target.value));
      el.querySelector("#vm-upload").addEventListener("change", async (e) => {
        const nf = await readUpload(e.target, "model");
        if (nf) {
          state.vmRef = nf.ref;
          Shell.render();
        }
      });
      el.querySelector("#vm-form").addEventListener("submit", (e) => {
        e.preventDefault();
        state.vmRef = el.querySelector("#vm-file").value;
        action(el.querySelector("#vm-btn"), () => verifyModelFile(state.vmRef, data));
      });
      return;
    }
    if (!data.datasets.length) return;
    el.querySelector("#vd-file").addEventListener("change", async (e) => {
      state.vdRef = e.target.value;
      state.vdDataset = null; // re-guess the claimed dataset
      Shell.render();
    });
    el.querySelector("#vd-upload").addEventListener("change", async (e) => {
      const nf = await readUpload(e.target, "dataset");
      if (nf) {
        state.vdRef = nf.ref;
        state.vdDataset = null;
        Shell.render();
      }
    });
    el.querySelector("#vd-dataset").addEventListener("change", (e) => (state.vdDataset = Number(e.target.value)));
    el.querySelector("#vd-form").addEventListener("submit", (e) => {
      e.preventDefault();
      state.vdDataset = Number(el.querySelector("#vd-dataset").value);
      state.proof = null;
      action(el.querySelector("#vd-btn"), async () => {
        el.querySelector("#vd-a").innerHTML = "";
        state.vd = await verifyDatasetFile(state.vdRef, state.vdDataset, data, el.querySelector("#vd-a"), el.querySelector("#vd-b"));
        UI.toast(state.vd.intact ? "Dataset intact: Merkle root matches the blockchain" : `Dataset modified: ${state.vd.changed ? state.vd.changed.length : "?"} chunk(s) differ`, state.vd.intact ? "success" : "error", 6000);
      });
    });
    el.querySelector("#proof-form").addEventListener("submit", (e) => {
      e.preventDefault();
      state.vdDataset = Number(el.querySelector("#vd-dataset").value);
      const row = Number(el.querySelector("#proof-row").value);
      action(el.querySelector("#proof-btn"), async () => {
        if (!state.vd || state.vd.ref !== state.vdRef || state.vd.datasetId !== state.vdDataset) {
          state.vd = await verifyDatasetFile(state.vdRef, state.vdDataset, data, null, null);
        }
        const p = await proveRow(state.vdRef, state.vdDataset, row, data);
        UI.toast(p.ok && p.onchain ? `Row ${row} proven to belong to dataset #${p.datasetId}` : `Row ${row} is NOT part of dataset #${p.datasetId}`, p.ok && p.onchain ? "success" : "error");
      });
    });
  }

  async function viewPoison(el, { data, state, action }) {
    const dsOptions = [];
    for (const d of data.datasets) if (await originalDatasetFile(d)) dsOptions.push(d);
    const mdOptions = [];
    for (const m of data.models) if (await originalModelFile(m.fileHash)) mdOptions.push(m);
    if (!dsOptions.some((d) => d.id === state.pdDataset)) state.pdDataset = dsOptions[0] ? dsOptions[0].id : null;
    if (!mdOptions.some((m) => m.id === state.pmModel)) state.pmModel = mdOptions[0] ? mdOptions[0].id : null;
    const pd = state.poisonDs && state.poisonDs.datasetId === state.pdDataset ? state.poisonDs : null;
    const pm = state.poisonModel && state.poisonModel.modelId === state.pmModel ? state.poisonModel : null;

    el.innerHTML = `
      ${pageHead("Poison Lab", "Play the attacker: tamper with a registered dataset or model file, then watch the registry catch it. The tampered copies are kept in this browser session and can also be checked on the Verify page.")}
      <div class="grid-2" style="align-items:start">
        <div class="card">
          <div class="card-head"><h2>${Shell.icon("bug")} Label-flipping attack on a dataset</h2></div>
          ${
            dsOptions.length
              ? `<form id="pd-form" class="stack" style="gap:10px">
                  <div class="field" style="margin:0"><label for="pd-dataset">Registered dataset</label><select id="pd-dataset">${dsOptions
                    .map((d) => `<option value="${d.id}" ${d.id === state.pdDataset ? "selected" : ""}>#${d.id} ${esc(d.name)}</option>`)
                    .join("")}</select></div>
                  <div class="row"><label for="pd-n" class="small"><strong>Labels to flip</strong></label><input id="pd-n" type="number" min="1" max="20" value="${state.pdN || 4}" style="width:90px">
                    <button class="btn btn-danger" type="submit" id="pd-btn">Flip labels &amp; verify</button></div>
                </form>`
              : `<p class="muted">Register a dataset first (Data Providers).</p>`
          }
          <div id="pd-a" style="margin-top:14px"></div><div id="pd-b"></div>
          ${
            pd
              ? `<h3 class="sub">What the attacker changed</h3>
                 <div class="table-wrap"><table class="table"><thead><tr><th>Row</th><th>Label</th><th>Chunk</th></tr></thead><tbody>${pd.rows
                   .map((r) => `<tr><td data-label="Row">${r.row}</td><td data-label="Label"><span class="chip">${esc(r.from)}</span> → <span class="chip chip-bad">${esc(r.to)}</span></td><td data-label="Chunk">#${1 + Math.floor((r.row - 1) / (pd.manifest ? pd.manifest.rowsPerChunk : 20))}</td></tr>`)
                   .join("")}</tbody></table></div>
                 ${datasetResultHtml(pd)}
                 <div class="callout ${pd.exact ? "callout-ok" : "callout-warn"}" style="margin-top:12px">${
                   pd.exact
                     ? `<strong>Detected exactly.</strong> The Merkle diff found chunk(s) ${pd.expected.join(", ")}: precisely the chunks holding the flipped rows.`
                     : `Tampering detected; changed chunks: ${(pd.changed || []).join(", ")}.`
                 }</div>`
              : `<p class="muted small" style="margin-top:8px">Flipping labels is a classic data-poisoning attack: a few wrong labels can teach a model a bias or a backdoor while the file still looks normal.</p>`
          }
        </div>
        <div class="card">
          <div class="card-head"><h2>${Shell.icon("cpu")} Backdoor attack on model weights</h2></div>
          ${
            mdOptions.length
              ? `<form id="pm-form" class="stack" style="gap:10px">
                  <div class="field" style="margin:0"><label for="pm-model">Registered model</label><select id="pm-model">${mdOptions
                    .map((m) => `<option value="${m.id}" ${m.id === state.pmModel ? "selected" : ""}>#${m.id} ${esc(modelLabel(m))}</option>`)
                    .join("")}</select></div>
                  <div class="row"><label for="pm-n" class="small"><strong>Bytes to patch</strong></label><input id="pm-n" type="number" min="1" max="64" value="${state.pmN || 12}" style="width:90px">
                    <button class="btn btn-danger" type="submit" id="pm-btn">Inject backdoor &amp; verify</button></div>
                </form>`
              : `<p class="muted">Register a model first (Developers).</p>`
          }
          <div id="pm-steps" style="margin-top:14px">${pm ? UI.checklist(pm.items) : ""}</div>
          ${
            pm
              ? `<h3 class="sub">Bytes around the patch</h3>
                 <div class="hexdiff">${[
                   ["genuine", pm.before],
                   ["backdoored", pm.after],
                 ]
                   .map(
                     ([name, hex]) => `<div><span class="muted small">${name} (from offset 0x${pm.from.toString(16)})</span><code class="wrap">${hex
                       .map((h, i) => (h !== pm.before[i] || pm.before[i] !== pm.after[i] ? `<mark class="${name === "genuine" ? "old" : "new"}">${h}</mark>` : h))
                       .join(" ")}</code></div>`
                   )
                   .join("")}</div>
                 <div class="kv" style="margin-top:8px"><span>Passport hash</span><code class="wrap">${pm.origHash}</code></div>
                 <div class="kv"><span>Tampered hash</span><code class="wrap">${pm.hash}</code></div>
                 <div class="callout ${pm.detected ? "callout-ok" : "callout-bad"}" style="margin-top:10px">${
                   pm.detected
                     ? `<strong>Detected.</strong> Changing ${pm.end - pm.start + 1} bytes changed the SHA-256 completely, so the file matches no passport. <a href="#/verify" id="pm-verify">Check it on the Verify page</a>.`
                     : "Not detected."
                 }</div>`
              : `<p class="muted small" style="margin-top:8px">A backdoor hides in a handful of weights: the model behaves normally until it sees a trigger. You cannot spot it by looking at the file, but its hash changes.</p>`
          }
        </div>
      </div>`;

    const pdForm = el.querySelector("#pd-form");
    if (pdForm) {
      el.querySelector("#pd-dataset").addEventListener("change", (e) => (state.pdDataset = Number(e.target.value)));
      pdForm.addEventListener("submit", (e) => {
        e.preventDefault();
        state.pdDataset = Number(el.querySelector("#pd-dataset").value);
        state.pdN = Math.max(1, Math.min(20, Number(el.querySelector("#pd-n").value) || 4));
        action(el.querySelector("#pd-btn"), () => poisonDataset(state.pdDataset, state.pdN, data));
      });
    }
    const pmForm = el.querySelector("#pm-form");
    if (pmForm) {
      el.querySelector("#pm-model").addEventListener("change", (e) => (state.pmModel = Number(e.target.value)));
      pmForm.addEventListener("submit", (e) => {
        e.preventDefault();
        state.pmModel = Number(el.querySelector("#pm-model").value);
        state.pmN = Math.max(1, Math.min(64, Number(el.querySelector("#pm-n").value) || 12));
        action(el.querySelector("#pm-btn"), () => backdoorModel(state.pmModel, state.pmN, data));
      });
    }
    const pv = el.querySelector("#pm-verify");
    if (pv)
      pv.addEventListener("click", () => {
        state.verifyTab = "model";
        state.vmRef = pm.ref;
        state.vm = null;
      });
  }

  async function viewLineage(el, { data, state, go }) {
    const node = (m) => {
      const kids = data.models.filter((x) => x.parentId === m.id);
      const cls = m.status === ST.Flagged ? "is-flagged" : m.status === ST.Tainted ? "is-tainted" : m.status === ST.Revoked ? "is-revoked" : "";
      const t = m.status === ST.Tainted ? data.model(m.taintedBy) : null;
      return `<li class="${cls}">
        <div class="tnode">
          <div class="tnode-head"><strong>${esc(modelLabel(m))}</strong><span class="muted small">#${m.id}</span>${statusChip(m)}</div>
          <div class="muted small">${esc(Chain.label(m.developer))} · ${esc(m.framework)} · trained on ${m.datasetIds.map((id) => esc(data.dataset(id).name)).join(", ")}</div>
          ${t ? `<div class="taint-note">⚠ Derived from a flagged model: ${esc(modelLabel(t))} (#${t.id})</div>` : ""}
          ${m.status === ST.Flagged ? `<div class="taint-note">✕ Flagged: ${esc(m.audits[m.audits.length - 1].notes)}</div>` : ""}
          <button class="btn btn-ghost btn-sm" data-passport="${m.id}">View passport →</button>
        </div>
        ${kids.length ? `<ul>${kids.map(node).join("")}</ul>` : ""}
      </li>`;
    };
    const roots = data.models.filter((m) => !m.parentId);
    const flagged = data.models.filter((m) => m.status === ST.Flagged);
    el.innerHTML = `
      ${pageHead("Model lineage", "Every model points to the model it was fine-tuned from. When an auditor flags a model, the whole branch below it is marked, because poisoned weights are inherited by fine-tuning.")}
      ${flagged.length ? `<div class="callout callout-bad" style="margin-bottom:16px"><strong>${flagged.length} flagged model${flagged.length > 1 ? "s" : ""}.</strong> ${data.models.filter((m) => m.status === ST.Tainted).length} model(s) derived from them are marked as unsafe. The contract refuses new models on these branches.</div>` : ""}
      <div class="card">
        <div class="card-head"><h2>Lineage tree</h2>
          <div class="legend"><span><span class="chip chip-ok">Audited</span></span><span><span class="chip chip-warn">Not audited</span></span><span><span class="chip chip-bad">Flagged / derived</span></span></div></div>
        ${roots.length ? `<ul class="tree">${roots.map(node).join("")}</ul>` : `<div class="empty">No models registered yet.</div>`}
      </div>`;
    el.querySelectorAll("[data-passport]").forEach((b) =>
      b.addEventListener("click", () => {
        state.verifyTab = "model";
        state.vm = { modelId: Number(b.dataset.passport), items: null, found: true };
        go("verify");
      })
    );
  }

  function formatEvent(e) {
    const a = e.args;
    switch (e.name) {
      case "MemberRegistered":
        return `${a.name} joined as ${(ROLE_LABEL[Number(a.role)] || "member").toLowerCase()}`;
      case "MemberStatusChanged":
        return `${Chain.label(a.account)} ${a.active ? "re-activated" : "suspended"}`;
      case "DatasetRegistered":
        return `${Chain.label(a.provider)} registered dataset #${a.datasetId} "${a.name}" · ${a.chunkCount} chunks · Merkle root ${UI.short(a.merkleRoot, 4)}`;
      case "ModelRegistered":
        return `${Chain.label(a.developer)} registered ${a.name} ${a.version} as model #${a.modelId}${Number(a.parentId) ? ` (fine-tuned from #${a.parentId})` : " (base model)"} · signature verified · sha256 ${UI.short(a.fileHash, 4)}`;
      case "ModelAudited":
        return a.passed
          ? `${Chain.label(a.auditor)} passed model #${a.modelId} until ${UI.fmtTime(a.validUntil)} · report ${UI.short(a.reportHash, 4)}`
          : `${Chain.label(a.auditor)} FLAGGED model #${a.modelId} as unsafe · report ${UI.short(a.reportHash, 4)}`;
      case "ModelRevoked":
        return `${Chain.label(a.developer)} revoked model #${a.modelId}: ${a.reason}`;
      default:
        return "";
    }
  }

  async function viewExplorer(el) {
    el.innerHTML = `${pageHead("Blockchain Explorer", "Every registration, signature check and audit above is a transaction in a block. Each block stores the hash of the previous one, so rewriting an old passport would break the chain.")}<div id="explorer-host"></div>`;
    await Explorer.render(el.querySelector("#explorer-host"), { formatEvent });
  }

  async function viewAbout(el) {
    el.innerHTML = `
      ${pageHead("About the project", "ModelPassport: an AI model and dataset provenance registry on a consortium blockchain.")}
      <div class="stack">
        <div class="card">
          <h2>Problem</h2>
          <p style="margin-top:8px">Teams download pre-trained models and public datasets every day. A file can be swapped or poisoned on the way (flipped labels, backdoored weights), and there is no trustworthy record of who trained a model, on which data, what it was fine-tuned from, or whether anyone audited it.</p>
          <h2 style="margin-top:14px">Solution</h2>
          <ul style="margin:8px 0 0;padding-left:18px">
            <li><strong>Datasets as Merkle roots:</strong> a provider commits to every 20-row chunk of a dataset with one 32-byte root. A changed row changes its chunk's leaf, and the diff names that chunk.</li>
            <li><strong>Signed model passports:</strong> the SHA-256 of the weights, the parent model and the dataset IDs are signed by the developer. The contract checks the ECDSA signature with <code>ecrecover</code>.</li>
            <li><strong>Independent audits:</strong> auditors record pass / flag verdicts with a report hash. A flag taints every descendant, and the contract refuses new models on a flagged branch.</li>
            <li><strong>Verify before use:</strong> anyone hashes a downloaded file and looks up its passport; nothing is uploaded.</li>
          </ul>
        </div>
        <div class="card">
          <h2>Syllabus mapping (22CS743)</h2>
          <div class="table-wrap" style="margin-top:8px"><table class="table"><thead><tr><th>Module</th><th>Concept</th><th>Where it is used</th></tr></thead><tbody>
            <tr><td data-label="Module">II</td><td data-label="Concept">SHA-256, Merkle trees and Merkle proofs, hash-linked blocks</td><td data-label="Used in">SHA-256 of weights files and dataset chunks; Merkle root per dataset; single-row Merkle proofs checked in the browser and by <code>verifyChunk()</code>; explorer shows each block's previous-hash link</td></tr>
            <tr><td data-label="Module">III</td><td data-label="Concept">Ethereum, EVM, smart contracts, digital signatures (ECDSA)</td><td data-label="Used in"><code>ModelRegistry.sol</code> stores passports and audits; developers sign with secp256k1 keys (EIP-191) and the contract recovers the signer with <code>ecrecover</code>, rejecting malleable signatures</td></tr>
            <tr><td data-label="Module">IV</td><td data-label="Concept">Consortium / permissioned blockchain</td><td data-label="Used in">The AI Safety Consortium admits data providers, developers and auditors with one role each and can suspend them; every function checks the caller's role</td></tr>
            <tr><td data-label="Module">V</td><td data-label="Concept">Security, privacy, applications (AI supply chain)</td><td data-label="Used in">Detects dataset poisoning (label flipping) and model tampering (backdoors); audit trail with expiry; revocation; lineage taint; only hashes go on-chain</td></tr>
          </tbody></table></div>
        </div>
        <div class="grid-2">
          <div class="card">
            <h2>Merkle tree design</h2>
            <ul style="margin:8px 0 0;padding-left:18px">
              <li><strong>Chunks:</strong> CSV/TSV/TXT files: the header line is chunk 0, then 20 data rows per chunk (more per chunk if a file would exceed 256 chunks). Other files: equal byte blocks of at least 4 KiB.</li>
              <li><strong>Leaf:</strong> <code>SHA-256(0x00 ‖ chunk)</code>. <strong>Node:</strong> <code>SHA-256(0x01 ‖ left ‖ right)</code>. The prefixes keep leaves and nodes apart.</li>
              <li><strong>Index-based pairs</strong> (not sorted): position decides left/right. An unpaired last node moves up unchanged.</li>
              <li><strong>Manifest:</strong> the list of leaf hashes is published off-chain. A verifier first rebuilds its root and compares it with the on-chain root, then uses it to find the changed chunks.</li>
            </ul>
          </div>
          <div class="card">
            <h2>Passport signature</h2>
            <p class="small" style="margin-top:8px">message = keccak256("ModelPassport" ‖ chainId ‖ registry address ‖ fileHash ‖ parentId ‖ keccak256(datasetIds))</p>
            <p class="small">digest = keccak256("\\x19Ethereum Signed Message:\\n32" ‖ message) (EIP-191 personal_sign)</p>
            <p class="small">The contract splits the 65-byte signature into r, s, v, rejects v ∉ {27, 28} and s &gt; n/2 (malleable copies), calls <code>ecrecover</code> and requires the result to be the sender. The chain id and contract address stop a signature being replayed elsewhere.</p>
          </div>
        </div>
        <div class="grid-2">
          <div class="card">
            <h2>On-chain vs off-chain</h2>
            <ul style="margin:8px 0 0;padding-left:18px">
              <li><strong>On-chain:</strong> members and roles, dataset Merkle roots and sizes, model weights hashes, lineage, dataset links, developer signatures, audit verdicts with report hashes, revocations.</li>
              <li><strong>Off-chain:</strong> the dataset and model files, the dataset manifests (leaf lists) and the full audit reports. Their hashes on-chain make them tamper-evident.</li>
            </ul>
          </div>
          <div class="card">
            <h2>Technology</h2>
            <ul style="margin:8px 0 0;padding-left:18px">
              <li>Solidity 0.8.24 smart contract, Hardhat (local blockchain + 22 tests)</li>
              <li>In-browser Ethereum chain (Ganache) for zero-install demos</li>
              <li>ethers.js v6 (ECDSA signing, keccak256), Web Crypto API (SHA-256)</li>
              <li>Deterministic sample CSV datasets and synthetic float32 weight files generated in the browser</li>
              <li>HTML, CSS and JavaScript (no build step), hosted on GitHub Pages</li>
            </ul>
          </div>
        </div>
        <div class="card callout-warn">
          <h2>Limitations</h2>
          <ul style="margin:6px 0 0;padding-left:18px">
            <li>A passport proves where a file came from and that it is unchanged. It cannot prove the model is safe; that is the auditor's job, and the demo audit checks are simplified.</li>
            <li>Poisoning that the data provider performs before registering is not detected by the Merkle root; it only catches changes made after registration.</li>
            <li>The demo keeps developers' keys in the in-browser chain; real developers would sign with a hardware wallet. Large real-world model files would be hashed in a streaming way.</li>
            <li>A production deployment would run on a permissioned network (for example Hyperledger Besu) operated by the consortium.</li>
          </ul>
        </div>
      </div>`;
  }

  // ------------------------------------------------------------------
  Shell.start({
    brand: { name: "ModelPassport", tagline: "AI model & dataset provenance registry", icon: "cpu" },
    timeTravel: false,
    load,
    chain: {
      storageKey: "modelpassport",
      artifact: window.CONTRACT_ARTIFACT,
      errors: ERRORS,
      async isSeeded(chain) {
        const [accts] = await chain.contract.getMembers();
        return accts.length > 0;
      },
      async seed(chain) {
        for (const [i, role, name] of CONSORTIUM) await chain.send(chain.accounts[0], "registerMember", [chain.accounts[i], role, name]);
      },
    },
    routes: [
      { id: "home", title: "Overview", icon: "home", render: viewHome },
      { id: "consortium", title: "Consortium Admin", icon: "users", section: "Roles", render: viewConsortium },
      { id: "providers", title: "Data Providers", icon: "upload", section: "Roles", render: viewProviders },
      { id: "developers", title: "Developers", icon: "cpu", section: "Roles", render: viewDevelopers },
      { id: "auditors", title: "Auditors", icon: "shield", section: "Roles", render: viewAuditors },
      { id: "verify", title: "Verify", icon: "search", section: "Investigate", render: viewVerify },
      { id: "poison", title: "Poison Lab", icon: "bug", section: "Investigate", render: viewPoison },
      { id: "lineage", title: "Lineage", icon: "layers", section: "Investigate", render: viewLineage },
      { id: "explorer", title: "Blockchain Explorer", icon: "blocks", section: "Investigate", render: viewExplorer },
      { id: "about", title: "About & Syllabus", icon: "book", section: "Project", render: viewAbout },
    ],
  });

  // Exposed for automated tests.
  window.PassportApp = {
    load,
    getFile,
    registerDataset,
    registerModel,
    auditModel,
    revokeModel,
    verifyModelFile,
    verifyDatasetFile,
    proveRow,
    poisonDataset,
    backdoorModel,
    manifestFor,
    SAMPLE_DATASETS,
    SAMPLE_MODELS,
  };
})();
