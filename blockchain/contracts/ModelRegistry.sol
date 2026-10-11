// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ModelRegistry - ModelPassport: AI model & dataset provenance registry
/// @notice A consortium (admin + data providers + model developers + independent
///         auditors) gives every AI model a "passport":
///           - data providers register a dataset as the Merkle root of its chunks,
///           - developers register the SHA-256 of a model's weights file together
///             with its lineage (parent model) and training datasets, signed with
///             their own key (ECDSA, checked on-chain with ecrecover),
///           - auditors record pass / flag verdicts with the hash of their report.
///         Anyone can then hash a downloaded model or dataset and check it here.
/// @dev Only hashes, roots, signatures and short metadata are stored on-chain.
///      The files themselves and the per-chunk "manifest" stay off-chain; the
///      Merkle root on-chain is the source of truth for both.
///
///      Merkle tree convention (shared with the web app and the tests):
///        leaf = sha256(0x00 ‖ chunkBytes)
///        node = sha256(0x01 ‖ left ‖ right)          (index-based, not sorted)
///        an unpaired last node is promoted to the next level unchanged.
///      The 0x00 / 0x01 prefixes stop a leaf from being passed off as a node.
contract ModelRegistry {
    enum Role { None, DataProvider, Developer, Auditor }

    /// @dev Computed by statusOf(): most severe condition first.
    enum Status { Unaudited, Audited, AuditExpired, Flagged, Tainted, Revoked }

    struct Member {
        Role role;
        string name;
        bool active;
    }

    struct Dataset {
        string name;
        string license;
        bytes32 merkleRoot;   // root of the Merkle tree over the dataset's chunks
        uint32 chunkCount;    // number of leaves (needed to check a Merkle proof)
        uint64 totalBytes;
        address provider;
        uint64 registeredAt;
    }

    struct Model {
        string name;          // e.g. "skin-lesion-classifier"
        string version;       // e.g. "v1"
        string framework;     // e.g. "PyTorch"
        bytes32 fileHash;     // sha256 of the weights file
        uint256 parentId;     // model it was fine-tuned from (0 = base model)
        uint256[] datasetIds; // datasets used for training / fine-tuning
        address developer;
        bytes signature;      // developer's ECDSA signature over the passport message
        uint64 registeredAt;
        uint8 depth;          // 0 for a base model, parent depth + 1 otherwise
        bool flagged;         // an auditor found it poisoned / vulnerable
        bool revoked;         // withdrawn by its developer
        uint64 auditValidUntil; // 0 = never passed an audit
        string revokeReason;
    }

    struct Audit {
        address auditor;
        bool passed;
        bytes32 reportHash;   // sha256 of the full audit report (kept off-chain)
        string notes;
        uint64 time;
    }

    /// @notice A passing audit is trusted for this long, then the model needs a re-audit.
    uint256 public constant AUDIT_VALIDITY = 180 days;
    /// @notice Longest allowed lineage (base model + 7 generations of fine-tuning).
    uint8 public constant MAX_DEPTH = 8;
    uint256 public constant MAX_DATASETS = 8;
    /// @dev secp256k1 group order / 2. Signatures with a larger `s` are malleable copies.
    uint256 private constant HALF_ORDER = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    address public immutable admin;

    mapping(address => Member) public members;
    address[] private memberList;

    uint256 public datasetCount; // ids start at 1
    uint256 public modelCount;   // ids start at 1
    mapping(uint256 => Dataset) private datasets;
    mapping(uint256 => Model) private models;
    mapping(uint256 => Audit[]) private audits;
    mapping(bytes32 => uint256) private datasetByRoot;
    mapping(bytes32 => uint256) private modelByHash;

    event MemberRegistered(address indexed account, Role role, string name);
    event MemberStatusChanged(address indexed account, bool active);
    event DatasetRegistered(uint256 indexed datasetId, address indexed provider, bytes32 merkleRoot, uint32 chunkCount, string name);
    event ModelRegistered(uint256 indexed modelId, address indexed developer, bytes32 fileHash, uint256 indexed parentId, string name, string version);
    event ModelAudited(uint256 indexed modelId, address indexed auditor, bool passed, bytes32 reportHash, uint64 validUntil);
    event ModelRevoked(uint256 indexed modelId, address indexed developer, string reason);

    error NotAdmin();
    error MissingRole(Role required);
    error InvalidMember();
    error AlreadyRegistered(address account);
    error InvalidDataset();
    error DuplicateDataset(uint256 existingId);
    error UnknownDataset(uint256 datasetId);
    error InvalidModel();
    error InvalidDatasetList();
    error DuplicateModel(uint256 existingId);
    error UnknownModel(uint256 modelId);
    error ParentFlagged(uint256 flaggedId);
    error ParentRevoked(uint256 parentId);
    error LineageTooDeep();
    error InvalidSignature();
    error SignerMismatch(address recovered);
    error ModelIsRevoked(uint256 modelId);
    error ModelIsFlagged(uint256 modelId);
    error NotModelDeveloper();
    error EmptyReport();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    /// @dev The caller must be an ACTIVE member with exactly this role.
    modifier onlyRole(Role role) {
        _requireRole(role);
        _;
    }

    modifier modelExists(uint256 modelId) {
        if (modelId == 0 || modelId > modelCount) revert UnknownModel(modelId);
        _;
    }

    modifier datasetExists(uint256 datasetId) {
        if (datasetId == 0 || datasetId > datasetCount) revert UnknownDataset(datasetId);
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    // ------------------------------------------------------------------
    // Consortium membership (Module IV: permissioned participants)
    // ------------------------------------------------------------------

    function registerMember(address account, Role role, string calldata name) external onlyAdmin {
        if (account == address(0) || role == Role.None || bytes(name).length == 0) revert InvalidMember();
        if (members[account].role != Role.None) revert AlreadyRegistered(account);
        members[account] = Member(role, name, true);
        memberList.push(account);
        emit MemberRegistered(account, role, name);
    }

    function setMemberActive(address account, bool active) external onlyAdmin {
        if (members[account].role == Role.None) revert InvalidMember();
        members[account].active = active;
        emit MemberStatusChanged(account, active);
    }

    // ------------------------------------------------------------------
    // Datasets
    // ------------------------------------------------------------------

    /// @notice Register a dataset by the Merkle root of its chunks. The same root
    ///         (= the same content) can only be registered once.
    function registerDataset(
        string calldata name,
        bytes32 merkleRoot,
        uint32 chunkCount,
        uint64 totalBytes,
        string calldata license
    ) external onlyRole(Role.DataProvider) returns (uint256 datasetId) {
        if (bytes(name).length == 0 || merkleRoot == bytes32(0) || chunkCount == 0 || totalBytes == 0) revert InvalidDataset();
        uint256 existing = datasetByRoot[merkleRoot];
        if (existing != 0) revert DuplicateDataset(existing);

        datasetId = ++datasetCount;
        datasets[datasetId] = Dataset({
            name: name,
            license: license,
            merkleRoot: merkleRoot,
            chunkCount: chunkCount,
            totalBytes: totalBytes,
            provider: msg.sender,
            registeredAt: uint64(block.timestamp)
        });
        datasetByRoot[merkleRoot] = datasetId;
        emit DatasetRegistered(datasetId, msg.sender, merkleRoot, chunkCount, name);
    }

    // ------------------------------------------------------------------
    // Models
    // ------------------------------------------------------------------

    /// @notice Register a model passport. The developer signs
    ///         passportMessage(fileHash, parentId, datasetIds) with their wallet
    ///         (EIP-191 personal_sign); the contract recovers the signer and
    ///         requires it to be the caller.
    /// @param parentId   model this one was fine-tuned from, 0 for a base model
    /// @param datasetIds registered datasets used for (pre-)training or fine-tuning
    function registerModel(
        string calldata name,
        string calldata version,
        bytes32 fileHash,
        uint256 parentId,
        uint256[] calldata datasetIds,
        string calldata framework,
        bytes calldata signature
    ) external onlyRole(Role.Developer) returns (uint256 modelId) {
        if (bytes(name).length == 0 || bytes(version).length == 0) revert InvalidModel();
        modelId = _registerPassport(fileHash, parentId, datasetIds, signature);
        Model storage m = models[modelId];
        m.name = name;
        m.version = version;
        m.framework = framework;
        emit ModelRegistered(modelId, msg.sender, m.fileHash, m.parentId, m.name, m.version);
    }

    /// @notice An independent auditor records a verdict. A pass is valid for
    ///         AUDIT_VALIDITY; a fail flags the model (poisoned / vulnerable) and
    ///         taints every model fine-tuned from it.
    function auditModel(uint256 modelId, bool passed, bytes32 reportHash, string calldata notes)
        external
        onlyRole(Role.Auditor)
        modelExists(modelId)
    {
        Model storage m = models[modelId];
        if (m.revoked) revert ModelIsRevoked(modelId);
        if (m.flagged) revert ModelIsFlagged(modelId);
        if (reportHash == bytes32(0)) revert EmptyReport();

        uint64 validUntil = 0;
        if (passed) {
            // A model built on a flagged ancestor cannot be "cleaned" by an audit.
            uint256 tainted = _flaggedAncestor(m.parentId);
            if (tainted != 0) revert ParentFlagged(tainted);
            validUntil = uint64(block.timestamp + AUDIT_VALIDITY);
            m.auditValidUntil = validUntil;
        } else {
            m.flagged = true;
            m.auditValidUntil = 0;
        }
        audits[modelId].push(Audit(msg.sender, passed, reportHash, notes, uint64(block.timestamp)));
        emit ModelAudited(modelId, msg.sender, passed, reportHash, validUntil);
    }

    /// @notice The developer withdraws their own model (e.g. superseded or leaked keys).
    function revokeModel(uint256 modelId, string calldata reason) external modelExists(modelId) {
        Model storage m = models[modelId];
        if (m.developer != msg.sender) revert NotModelDeveloper();
        if (m.revoked) revert ModelIsRevoked(modelId);
        m.revoked = true;
        m.revokeReason = reason;
        emit ModelRevoked(modelId, msg.sender, reason);
    }

    // ------------------------------------------------------------------
    // Signatures (Module III: ECDSA verified on-chain)
    // ------------------------------------------------------------------

    /// @notice The 32-byte message a developer signs for a passport. It binds the
    ///         weights hash, the parent and the dataset list, and includes the
    ///         chain id and this contract's address so a signature cannot be
    ///         replayed on another chain or registry.
    function passportMessage(bytes32 fileHash, uint256 parentId, uint256[] calldata datasetIds) public view returns (bytes32) {
        return keccak256(
            abi.encodePacked("ModelPassport", block.chainid, address(this), fileHash, parentId, keccak256(abi.encodePacked(datasetIds)))
        );
    }

    /// @notice Recover who signed `message` with personal_sign (EIP-191):
    ///         digest = keccak256("\x19Ethereum Signed Message:\n32" ‖ message).
    /// @dev Implemented without libraries. Rejects wrong length, v other than
    ///      27/28 (0/1 accepted and normalised), high-s (malleable) signatures and
    ///      signatures that recover to the zero address.
    function recoverPassportSigner(bytes32 message, bytes calldata signature) public pure returns (address signer) {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert InvalidSignature();
        if (uint256(s) > HALF_ORDER) revert InvalidSignature();

        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", message));
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
    }

    // ------------------------------------------------------------------
    // Merkle proofs (Module II)
    // ------------------------------------------------------------------

    /// @notice Check that `chunk` is leaf number `index` of a registered dataset.
    /// @param proof sibling hashes from the leaf level up to (not including) the root;
    ///              levels where the node has no sibling (promoted) are skipped.
    function verifyChunk(uint256 datasetId, uint256 index, bytes calldata chunk, bytes32[] calldata proof)
        external
        view
        datasetExists(datasetId)
        returns (bool)
    {
        Dataset storage d = datasets[datasetId];
        uint256 width = d.chunkCount;
        if (index >= width) return false;
        bytes32 node = sha256(abi.encodePacked(bytes1(0x00), chunk));
        uint256 used = 0;
        while (width > 1) {
            if (index % 2 == 1 || index + 1 < width) {
                if (used == proof.length) return false;
                bytes32 sibling = proof[used++];
                node = index % 2 == 1 ? _hashPair(sibling, node) : _hashPair(node, sibling);
            }
            index /= 2;
            width = (width + 1) / 2;
        }
        return used == proof.length && node == d.merkleRoot;
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function getMembers() external view returns (address[] memory accounts, Member[] memory info) {
        accounts = memberList;
        info = new Member[](memberList.length);
        for (uint256 i = 0; i < memberList.length; i++) info[i] = members[memberList[i]];
    }

    function getDataset(uint256 datasetId) external view datasetExists(datasetId) returns (Dataset memory) {
        return datasets[datasetId];
    }

    function getModel(uint256 modelId) external view modelExists(modelId) returns (Model memory) {
        return models[modelId];
    }

    function getAudits(uint256 modelId) external view modelExists(modelId) returns (Audit[] memory) {
        return audits[modelId];
    }

    /// @return id of the model whose weights hash to `fileHash`, 0 if none
    function findModelByHash(bytes32 fileHash) external view returns (uint256) {
        return modelByHash[fileHash];
    }

    /// @return id of the dataset with this Merkle root, 0 if none
    function findDatasetByRoot(bytes32 merkleRoot) external view returns (uint256) {
        return datasetByRoot[merkleRoot];
    }

    /// @notice The model's ancestry: [modelId, parent, grandparent, …, base model].
    /// @dev Bounded: depth is always < MAX_DEPTH.
    function getLineage(uint256 modelId) external view modelExists(modelId) returns (uint256[] memory chain) {
        chain = new uint256[](uint256(models[modelId].depth) + 1);
        for (uint256 i = 0; i < chain.length; i++) {
            chain[i] = modelId;
            modelId = models[modelId].parentId;
        }
    }

    /// @return the first flagged model in this model's lineage (itself included), 0 if none
    function taintedBy(uint256 modelId) external view modelExists(modelId) returns (uint256) {
        return _flaggedAncestor(modelId);
    }

    function statusOf(uint256 modelId) public view modelExists(modelId) returns (Status) {
        Model storage m = models[modelId];
        if (m.flagged) return Status.Flagged;
        if (_flaggedAncestor(m.parentId) != 0) return Status.Tainted;
        if (m.revoked) return Status.Revoked;
        if (m.auditValidUntil == 0) return Status.Unaudited;
        if (block.timestamp > m.auditValidUntil) return Status.AuditExpired;
        return Status.Audited;
    }

    /// @notice Safe to use: audited, audit still valid, not revoked, no flagged ancestor.
    function isTrusted(uint256 modelId) external view returns (bool) {
        return statusOf(modelId) == Status.Audited;
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    function _requireRole(Role role) private view {
        Member storage m = members[msg.sender];
        if (m.role != role || !m.active) revert MissingRole(role);
    }

    /// @dev Checks hash uniqueness, lineage, datasets and the developer's signature,
    ///      then stores the passport's provenance fields.
    function _registerPassport(bytes32 fileHash, uint256 parentId, uint256[] calldata datasetIds, bytes calldata signature)
        private
        returns (uint256 modelId)
    {
        if (fileHash == bytes32(0)) revert InvalidModel();
        if (modelByHash[fileHash] != 0) revert DuplicateModel(modelByHash[fileHash]);
        uint8 depth = _checkParent(parentId);
        _checkDatasets(datasetIds);

        address signer = recoverPassportSigner(passportMessage(fileHash, parentId, datasetIds), signature);
        if (signer != msg.sender) revert SignerMismatch(signer);

        modelId = ++modelCount;
        Model storage m = models[modelId];
        m.fileHash = fileHash;
        m.parentId = parentId;
        m.datasetIds = datasetIds;
        m.developer = msg.sender;
        m.signature = signature;
        m.registeredAt = uint64(block.timestamp);
        m.depth = depth;
        modelByHash[fileHash] = modelId;
    }

    function _checkParent(uint256 parentId) private view returns (uint8 depth) {
        if (parentId == 0) return 0;
        if (parentId > modelCount) revert UnknownModel(parentId);
        Model storage p = models[parentId];
        uint256 tainted = _flaggedAncestor(parentId);
        if (tainted != 0) revert ParentFlagged(tainted);
        if (p.revoked) revert ParentRevoked(parentId);
        if (p.depth + 1 >= MAX_DEPTH) revert LineageTooDeep();
        return p.depth + 1;
    }

    function _checkDatasets(uint256[] calldata ids) private view {
        if (ids.length == 0 || ids.length > MAX_DATASETS) revert InvalidDatasetList();
        for (uint256 i = 0; i < ids.length; i++) {
            if (ids[i] == 0 || ids[i] > datasetCount) revert UnknownDataset(ids[i]);
            for (uint256 j = 0; j < i; j++) {
                if (ids[j] == ids[i]) revert InvalidDatasetList();
            }
        }
    }

    function _flaggedAncestor(uint256 modelId) private view returns (uint256) {
        for (uint256 i = 0; modelId != 0 && i < MAX_DEPTH; i++) {
            if (models[modelId].flagged) return modelId;
            modelId = models[modelId].parentId;
        }
        return 0;
    }

    function _hashPair(bytes32 left, bytes32 right) private pure returns (bytes32) {
        return sha256(abi.encodePacked(bytes1(0x01), left, right));
    }
}
