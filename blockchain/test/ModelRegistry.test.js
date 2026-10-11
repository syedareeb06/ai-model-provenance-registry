const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const Role = { None: 0, DataProvider: 1, Developer: 2, Auditor: 3 };
const Status = { Unaudited: 0, Audited: 1, AuditExpired: 2, Flagged: 3, Tainted: 4, Revoked: 5 };
const sha = (text) => ethers.sha256(ethers.toUtf8Bytes(text));
const HALF_ORDER = BigInt("0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0");
const ORDER = HALF_ORDER * 2n + 1n;

// ---- Merkle tree, same convention as the contract and the web app ----
const leafHash = (chunk) => ethers.sha256(ethers.concat(["0x00", ethers.toUtf8Bytes(chunk)]));
const nodeHash = (l, r) => ethers.sha256(ethers.concat(["0x01", l, r]));
function buildTree(chunks) {
  const levels = [chunks.map(leafHash)];
  while (levels[levels.length - 1].length > 1) {
    const cur = levels[levels.length - 1];
    const next = [];
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? nodeHash(cur[i], cur[i + 1]) : cur[i]);
    levels.push(next);
  }
  return levels;
}
function proofFor(levels, index) {
  const proof = [];
  for (let l = 0; l < levels.length - 1; l++) {
    const sib = index ^ 1;
    if (sib < levels[l].length) proof.push(levels[l][sib]);
    index >>= 1;
  }
  return proof;
}

// ---- Passport signature (EIP-191 personal_sign over passportMessage) ----
async function passportMessage(registry, fileHash, parentId, datasetIds) {
  const { chainId } = await ethers.provider.getNetwork();
  return ethers.solidityPackedKeccak256(
    ["string", "uint256", "address", "bytes32", "uint256", "bytes32"],
    ["ModelPassport", chainId, await registry.getAddress(), fileHash, parentId, ethers.solidityPackedKeccak256(["uint256[]"], [datasetIds])]
  );
}
async function signPassport(signer, registry, fileHash, parentId, datasetIds) {
  return signer.signMessage(ethers.getBytes(await passportMessage(registry, fileHash, parentId, datasetIds)));
}

describe("ModelRegistry", function () {
  async function deployFixture() {
    const [admin, openHealth, agriSense, medVision, neuralForge, trustAI, outsider] = await ethers.getSigners();
    const registry = await ethers.deployContract("ModelRegistry", [], admin);
    await registry.registerMember(openHealth.address, Role.DataProvider, "OpenHealth Data Lab");
    await registry.registerMember(agriSense.address, Role.DataProvider, "AgriSense Open Data");
    await registry.registerMember(medVision.address, Role.Developer, "MedVision AI");
    await registry.registerMember(neuralForge.address, Role.Developer, "NeuralForge Studio");
    await registry.registerMember(trustAI.address, Role.Auditor, "TrustAI Auditors");

    const chunks = ["age,bp,label", "41,120,0\n52,140,1", "37,118,0\n66,151,1", "29,110,0", "58,135,1"];
    const levels = buildTree(chunks);
    const root = levels[levels.length - 1][0];
    await registry.connect(openHealth).registerDataset("Skin Lesion Features", root, chunks.length, 4200, "CC-BY-4.0");
    await registry.connect(agriSense).registerDataset("Crop Leaf Survey", sha("crop"), 8, 9000, "CC0-1.0");

    return { registry, admin, openHealth, agriSense, medVision, neuralForge, trustAI, outsider, chunks, levels, root };
  }

  /** base model #1 (MedVision, dataset 1) and fine-tuned child #2 (dataset 2) */
  async function modelsFixture() {
    const f = await deployFixture();
    const { registry, medVision } = f;
    const v1 = sha("skin-lesion-classifier-v1 weights");
    const v2 = sha("skin-lesion-classifier-v2 weights");
    await registry.connect(medVision).registerModel("skin-lesion-classifier", "v1", v1, 0, [1], "PyTorch", await signPassport(medVision, registry, v1, 0, [1]));
    await registry.connect(medVision).registerModel("skin-lesion-classifier", "v2", v2, 1, [2], "PyTorch", await signPassport(medVision, registry, v2, 1, [2]));
    return { ...f, v1, v2 };
  }

  describe("Consortium membership", function () {
    it("lists members with their roles; the deployer is the admin", async function () {
      const { registry, admin, trustAI } = await loadFixture(deployFixture);
      expect(await registry.admin()).to.equal(admin.address);
      const [accounts, info] = await registry.getMembers();
      expect(accounts.length).to.equal(5);
      expect(info[4].name).to.equal("TrustAI Auditors");
      expect((await registry.members(trustAI.address)).role).to.equal(Role.Auditor);
    });

    it("only the admin can register or suspend members", async function () {
      const { registry, outsider, openHealth } = await loadFixture(deployFixture);
      await expect(registry.connect(outsider).registerMember(outsider.address, Role.Auditor, "Fake Auditor"))
        .to.be.revertedWithCustomError(registry, "NotAdmin");
      await expect(registry.connect(outsider).setMemberActive(openHealth.address, false))
        .to.be.revertedWithCustomError(registry, "NotAdmin");
    });

    it("rejects invalid member details and duplicate registration", async function () {
      const { registry, outsider, medVision } = await loadFixture(deployFixture);
      await expect(registry.registerMember(ethers.ZeroAddress, Role.Auditor, "X")).to.be.revertedWithCustomError(registry, "InvalidMember");
      await expect(registry.registerMember(outsider.address, Role.None, "X")).to.be.revertedWithCustomError(registry, "InvalidMember");
      await expect(registry.registerMember(outsider.address, Role.Auditor, "")).to.be.revertedWithCustomError(registry, "InvalidMember");
      await expect(registry.setMemberActive(outsider.address, false)).to.be.revertedWithCustomError(registry, "InvalidMember");
      await expect(registry.registerMember(medVision.address, Role.Auditor, "Again"))
        .to.be.revertedWithCustomError(registry, "AlreadyRegistered")
        .withArgs(medVision.address);
    });
  });

  describe("Datasets and Merkle roots", function () {
    it("a data provider registers a dataset by its Merkle root", async function () {
      const { registry, openHealth, root } = await loadFixture(deployFixture);
      const d = await registry.getDataset(1);
      expect(d.merkleRoot).to.equal(root);
      expect(d.chunkCount).to.equal(5);
      expect(d.provider).to.equal(openHealth.address);
      expect(await registry.findDatasetByRoot(root)).to.equal(1);
      expect(await registry.findDatasetByRoot(sha("unknown"))).to.equal(0);
      await expect(registry.connect(openHealth).registerDataset("Cardio", sha("cardio"), 3, 100, "CC0-1.0"))
        .to.emit(registry, "DatasetRegistered")
        .withArgs(3, openHealth.address, sha("cardio"), 3, "Cardio");
    });

    it("only active data providers can register datasets", async function () {
      const { registry, medVision, openHealth } = await loadFixture(deployFixture);
      await expect(registry.connect(medVision).registerDataset("X", sha("x"), 1, 1, "MIT"))
        .to.be.revertedWithCustomError(registry, "MissingRole")
        .withArgs(Role.DataProvider);
      await registry.setMemberActive(openHealth.address, false);
      await expect(registry.connect(openHealth).registerDataset("X", sha("x"), 1, 1, "MIT"))
        .to.be.revertedWithCustomError(registry, "MissingRole");
    });

    it("rejects empty datasets and duplicate roots", async function () {
      const { registry, openHealth, agriSense, root } = await loadFixture(deployFixture);
      await expect(registry.connect(openHealth).registerDataset("X", ethers.ZeroHash, 1, 1, "MIT")).to.be.revertedWithCustomError(registry, "InvalidDataset");
      await expect(registry.connect(openHealth).registerDataset("X", sha("x"), 0, 1, "MIT")).to.be.revertedWithCustomError(registry, "InvalidDataset");
      await expect(registry.connect(openHealth).registerDataset("", sha("x"), 1, 1, "MIT")).to.be.revertedWithCustomError(registry, "InvalidDataset");
      // Same content registered again (even by another provider) is refused.
      await expect(registry.connect(agriSense).registerDataset("Copy", root, 5, 4200, "MIT"))
        .to.be.revertedWithCustomError(registry, "DuplicateDataset")
        .withArgs(1);
      await expect(registry.getDataset(99)).to.be.revertedWithCustomError(registry, "UnknownDataset").withArgs(99);
    });

    it("verifyChunk accepts a correct Merkle proof for every chunk (odd leaf count)", async function () {
      const { registry, chunks, levels } = await loadFixture(deployFixture);
      for (let i = 0; i < chunks.length; i++) {
        expect(await registry.verifyChunk(1, i, ethers.toUtf8Bytes(chunks[i]), proofFor(levels, i))).to.equal(true);
      }
    });

    it("verifyChunk rejects a poisoned chunk, a wrong index and a bad proof", async function () {
      const { registry, chunks, levels } = await loadFixture(deployFixture);
      const proof = proofFor(levels, 1);
      // label flipped in row 2 of chunk 1
      expect(await registry.verifyChunk(1, 1, ethers.toUtf8Bytes("41,120,0\n52,140,0"), proof)).to.equal(false);
      expect(await registry.verifyChunk(1, 2, ethers.toUtf8Bytes(chunks[1]), proof)).to.equal(false);
      expect(await registry.verifyChunk(1, 9, ethers.toUtf8Bytes(chunks[1]), proof)).to.equal(false);
      expect(await registry.verifyChunk(1, 1, ethers.toUtf8Bytes(chunks[1]), proof.slice(0, 1))).to.equal(false);
      expect(await registry.verifyChunk(1, 1, ethers.toUtf8Bytes(chunks[1]), [...proof, ethers.ZeroHash])).to.equal(false);
    });
  });

  describe("Model passports and ECDSA signatures", function () {
    it("passportMessage binds chain id, registry address, weights, parent and datasets", async function () {
      const { registry } = await loadFixture(deployFixture);
      const h = sha("weights");
      expect(await registry.passportMessage(h, 0, [1, 2])).to.equal(await passportMessage(registry, h, 0, [1, 2]));
      expect(await registry.passportMessage(h, 0, [1, 2])).to.not.equal(await registry.passportMessage(h, 0, [2, 1]));
    });

    it("a developer registers a signed base model and a fine-tuned child", async function () {
      const { registry, medVision } = await loadFixture(deployFixture);
      const v1 = sha("v1");
      const sig = await signPassport(medVision, registry, v1, 0, [1]);
      await expect(registry.connect(medVision).registerModel("skin-lesion-classifier", "v1", v1, 0, [1], "PyTorch", sig))
        .to.emit(registry, "ModelRegistered")
        .withArgs(1, medVision.address, v1, 0, "skin-lesion-classifier", "v1");
      const v2 = sha("v2");
      await registry.connect(medVision).registerModel("skin-lesion-classifier", "v2", v2, 1, [1, 2], "PyTorch", await signPassport(medVision, registry, v2, 1, [1, 2]));

      const m = await registry.getModel(2);
      expect(m.parentId).to.equal(1);
      expect(m.depth).to.equal(1);
      expect(m.datasetIds).to.deep.equal([1n, 2n]);
      expect(m.developer).to.equal(medVision.address);
      expect(ethers.verifyMessage(ethers.getBytes(await registry.passportMessage(v2, 1, [1, 2])), m.signature)).to.equal(medVision.address);
      expect(await registry.findModelByHash(v2)).to.equal(2);
      expect(await registry.findModelByHash(sha("tampered"))).to.equal(0);
      expect(await registry.getLineage(2)).to.deep.equal([2n, 1n]);
      expect(await registry.statusOf(2)).to.equal(Status.Unaudited);
    });

    it("only active developers can register models", async function () {
      const { registry, openHealth } = await loadFixture(deployFixture);
      const h = sha("m");
      await expect(registry.connect(openHealth).registerModel("m", "v1", h, 0, [1], "ONNX", await signPassport(openHealth, registry, h, 0, [1])))
        .to.be.revertedWithCustomError(registry, "MissingRole")
        .withArgs(Role.Developer);
    });

    it("rejects a passport signed by someone else", async function () {
      const { registry, medVision, neuralForge } = await loadFixture(deployFixture);
      const h = sha("m");
      const sig = await signPassport(neuralForge, registry, h, 0, [1]);
      await expect(registry.connect(medVision).registerModel("m", "v1", h, 0, [1], "PyTorch", sig))
        .to.be.revertedWithCustomError(registry, "SignerMismatch")
        .withArgs(neuralForge.address);
    });

    it("rejects a signature whose lineage claim was altered", async function () {
      const { registry, medVision } = await loadFixture(deployFixture);
      const h = sha("m");
      const sig = await signPassport(medVision, registry, h, 0, [1]);
      // Same signature, but the submitted dataset list now also claims dataset 2.
      await expect(registry.connect(medVision).registerModel("m", "v1", h, 0, [1, 2], "PyTorch", sig))
        .to.be.revertedWithCustomError(registry, "SignerMismatch");
    });

    it("rejects malformed and malleable (high-s) signatures", async function () {
      const { registry, medVision } = await loadFixture(deployFixture);
      const h = sha("m");
      const msg = await passportMessage(registry, h, 0, [1]);
      const sig = ethers.Signature.from(await signPassport(medVision, registry, h, 0, [1]));
      expect(await registry.recoverPassportSigner(msg, sig.serialized)).to.equal(medVision.address);

      // (r, n - s, flipped v) is also a valid ECDSA signature for the same key: must be refused.
      const highS = ethers.concat([sig.r, ethers.toBeHex(ORDER - BigInt(sig.s), 32), sig.v === 27 ? "0x1c" : "0x1b"]);
      await expect(registry.recoverPassportSigner(msg, highS)).to.be.revertedWithCustomError(registry, "InvalidSignature");
      await expect(registry.connect(medVision).registerModel("m", "v1", h, 0, [1], "PyTorch", highS))
        .to.be.revertedWithCustomError(registry, "InvalidSignature");

      const badV = ethers.concat([sig.r, sig.s, "0x1d"]);
      await expect(registry.recoverPassportSigner(msg, badV)).to.be.revertedWithCustomError(registry, "InvalidSignature");
      await expect(registry.recoverPassportSigner(msg, ethers.dataSlice(sig.serialized, 0, 64))).to.be.revertedWithCustomError(registry, "InvalidSignature");
      const zeroR = ethers.concat([ethers.ZeroHash, sig.s, "0x1b"]);
      await expect(registry.recoverPassportSigner(msg, zeroR)).to.be.revertedWithCustomError(registry, "InvalidSignature");
      // v = 0/1 style is normalised to 27/28
      const v01 = ethers.concat([sig.r, sig.s, sig.v === 27 ? "0x00" : "0x01"]);
      expect(await registry.recoverPassportSigner(msg, v01)).to.equal(medVision.address);
    });

    it("rejects invalid model details, unknown references and duplicate weights", async function () {
      const { registry, medVision, v1 } = await loadFixture(modelsFixture);
      const h = sha("new");
      const reg = async (name, version, hash, parent, ds) =>
        registry.connect(medVision).registerModel(name, version, hash, parent, ds, "PyTorch", await signPassport(medVision, registry, hash, parent, ds));
      await expect(reg("", "v1", h, 0, [1])).to.be.revertedWithCustomError(registry, "InvalidModel");
      await expect(reg("m", "v1", ethers.ZeroHash, 0, [1])).to.be.revertedWithCustomError(registry, "InvalidModel");
      await expect(reg("m", "v1", h, 0, [])).to.be.revertedWithCustomError(registry, "InvalidDatasetList");
      await expect(reg("m", "v1", h, 0, [1, 1])).to.be.revertedWithCustomError(registry, "InvalidDatasetList");
      await expect(reg("m", "v1", h, 0, [7])).to.be.revertedWithCustomError(registry, "UnknownDataset").withArgs(7);
      await expect(reg("m", "v1", h, 42, [1])).to.be.revertedWithCustomError(registry, "UnknownModel").withArgs(42);
      await expect(reg("copy", "v9", v1, 0, [1])).to.be.revertedWithCustomError(registry, "DuplicateModel").withArgs(1);
      await expect(registry.getModel(0)).to.be.revertedWithCustomError(registry, "UnknownModel");
    });

    it("bounds the lineage depth", async function () {
      const { registry, neuralForge } = await loadFixture(deployFixture);
      const max = Number(await registry.MAX_DEPTH());
      let parent = 0;
      for (let i = 0; i < max; i++) {
        const h = sha("gen" + i);
        await registry.connect(neuralForge).registerModel("chain", "g" + i, h, parent, [2], "JAX", await signPassport(neuralForge, registry, h, parent, [2]));
        parent = i + 1;
      }
      expect((await registry.getLineage(max)).length).to.equal(max);
      const h = sha("too deep");
      await expect(registry.connect(neuralForge).registerModel("chain", "x", h, parent, [2], "JAX", await signPassport(neuralForge, registry, h, parent, [2])))
        .to.be.revertedWithCustomError(registry, "LineageTooDeep");
    });
  });

  describe("Audits, flagging and lineage taint", function () {
    it("an auditor passes a model; the audit and report hash are recorded", async function () {
      const { registry, trustAI } = await loadFixture(modelsFixture);
      const report = sha("audit report v1: no backdoor triggers found");
      const tx = registry.connect(trustAI).auditModel(1, true, report, "Clean: trigger scan + label audit");
      await expect(tx).to.emit(registry, "ModelAudited");
      const audits = await registry.getAudits(1);
      expect(audits.length).to.equal(1);
      expect(audits[0].auditor).to.equal(trustAI.address);
      expect(audits[0].reportHash).to.equal(report);
      expect(await registry.statusOf(1)).to.equal(Status.Audited);
      expect(await registry.isTrusted(1)).to.equal(true);
      expect(await registry.isTrusted(2)).to.equal(false); // child not audited yet
    });

    it("only active auditors can audit, with a report, on existing models", async function () {
      const { registry, medVision, trustAI } = await loadFixture(modelsFixture);
      await expect(registry.connect(medVision).auditModel(1, true, sha("r"), "self-audit"))
        .to.be.revertedWithCustomError(registry, "MissingRole")
        .withArgs(Role.Auditor);
      await expect(registry.connect(trustAI).auditModel(1, true, ethers.ZeroHash, "no report"))
        .to.be.revertedWithCustomError(registry, "EmptyReport");
      await expect(registry.connect(trustAI).auditModel(9, true, sha("r"), "x"))
        .to.be.revertedWithCustomError(registry, "UnknownModel")
        .withArgs(9);
    });

    it("a passing audit expires after AUDIT_VALIDITY and can be renewed", async function () {
      const { registry, trustAI } = await loadFixture(modelsFixture);
      await registry.connect(trustAI).auditModel(1, true, sha("r1"), "ok");
      const validUntil = (await registry.getModel(1)).auditValidUntil;
      expect(validUntil).to.equal(BigInt(await time.latest()) + (await registry.AUDIT_VALIDITY()));

      await time.increaseTo(validUntil);
      expect(await registry.isTrusted(1)).to.equal(true);
      await time.increase(1);
      expect(await registry.statusOf(1)).to.equal(Status.AuditExpired);
      expect(await registry.isTrusted(1)).to.equal(false);

      await registry.connect(trustAI).auditModel(1, true, sha("r2"), "re-audit");
      expect(await registry.statusOf(1)).to.equal(Status.Audited);
      expect((await registry.getAudits(1)).length).to.equal(2);
    });

    it("flagging a model taints its whole descendant lineage", async function () {
      const { registry, medVision, neuralForge, trustAI } = await loadFixture(modelsFixture);
      await registry.connect(trustAI).auditModel(2, true, sha("r"), "ok");
      await expect(registry.connect(trustAI).auditModel(1, false, sha("poison report"), "Backdoor trigger found"))
        .to.emit(registry, "ModelAudited")
        .withArgs(1, trustAI.address, false, sha("poison report"), 0);

      expect(await registry.statusOf(1)).to.equal(Status.Flagged);
      expect(await registry.statusOf(2)).to.equal(Status.Tainted);
      expect(await registry.taintedBy(2)).to.equal(1);
      expect(await registry.isTrusted(2)).to.equal(false);

      // No new model may be built on the flagged branch (child or grandchild).
      const h = sha("lite");
      for (const parent of [1, 2]) {
        await expect(registry.connect(neuralForge).registerModel("lite", "v1", h, parent, [1], "ONNX", await signPassport(neuralForge, registry, h, parent, [1])))
          .to.be.revertedWithCustomError(registry, "ParentFlagged")
          .withArgs(1);
      }
      // A tainted model cannot be passed, and a flagged model cannot be re-audited.
      await expect(registry.connect(trustAI).auditModel(2, true, sha("r"), "ok")).to.be.revertedWithCustomError(registry, "ParentFlagged").withArgs(1);
      await expect(registry.connect(trustAI).auditModel(1, true, sha("r"), "ok")).to.be.revertedWithCustomError(registry, "ModelIsFlagged").withArgs(1);
      // Revoking the flagged model does not remove the taint.
      await registry.connect(medVision).revokeModel(1, "Withdrawn after audit");
      expect(await registry.statusOf(1)).to.equal(Status.Flagged);
      expect(await registry.statusOf(2)).to.equal(Status.Tainted);
    });
  });

  describe("Revocation", function () {
    it("only the model's developer can revoke it, once", async function () {
      const { registry, medVision, neuralForge } = await loadFixture(modelsFixture);
      await expect(registry.connect(neuralForge).revokeModel(2, "not mine")).to.be.revertedWithCustomError(registry, "NotModelDeveloper");
      await expect(registry.connect(medVision).revokeModel(2, "Superseded by v3"))
        .to.emit(registry, "ModelRevoked")
        .withArgs(2, medVision.address, "Superseded by v3");
      expect(await registry.statusOf(2)).to.equal(Status.Revoked);
      expect((await registry.getModel(2)).revokeReason).to.equal("Superseded by v3");
      await expect(registry.connect(medVision).revokeModel(2, "again")).to.be.revertedWithCustomError(registry, "ModelIsRevoked").withArgs(2);
    });

    it("a revoked model cannot be audited or used as a parent", async function () {
      const { registry, medVision, trustAI } = await loadFixture(modelsFixture);
      await registry.connect(medVision).revokeModel(1, "Key compromised");
      await expect(registry.connect(trustAI).auditModel(1, true, sha("r"), "ok")).to.be.revertedWithCustomError(registry, "ModelIsRevoked").withArgs(1);
      const h = sha("child");
      await expect(registry.connect(medVision).registerModel("c", "v1", h, 1, [1], "PyTorch", await signPassport(medVision, registry, h, 1, [1])))
        .to.be.revertedWithCustomError(registry, "ParentRevoked")
        .withArgs(1);
    });
  });
});
