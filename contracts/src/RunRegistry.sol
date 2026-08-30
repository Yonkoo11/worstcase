// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Immutable, minimal bindings for Worstcase evidence bundles.
/// @dev This registry does not judge analytical correctness; it only records exact fields.
contract RunRegistry {
    enum ResultStatus {
        Unset,
        Complete,
        Unknown
    }

    struct Anchor {
        bytes32 policyHash;
        bytes32 graphHash;
        uint256 maximumLoss;
        bytes32 engineVersionHash;
        ResultStatus status;
        address submitter;
        uint64 anchoredAt;
    }

    error AlreadyAnchored(bytes32 bundleRoot);
    error InvalidBundleRoot();
    error InvalidResultStatus();
    error UnknownResultHasLoss();

    mapping(address submitter => mapping(bytes32 bundleRoot => Anchor)) private anchors;

    event RunAnchored(
        bytes32 indexed bundleRoot,
        bytes32 indexed policyHash,
        bytes32 indexed graphHash,
        uint256 maximumLoss,
        bytes32 engineVersionHash,
        ResultStatus status,
        address submitter
    );

    function anchor(
        bytes32 bundleRoot,
        bytes32 policyHash,
        bytes32 graphHash,
        uint256 maximumLoss,
        bytes32 engineVersionHash,
        ResultStatus status
    ) external {
        if (bundleRoot == bytes32(0)) revert InvalidBundleRoot();
        if (status == ResultStatus.Unset) revert InvalidResultStatus();
        if (status == ResultStatus.Unknown && maximumLoss != 0) revert UnknownResultHasLoss();
        if (anchors[msg.sender][bundleRoot].status != ResultStatus.Unset) revert AlreadyAnchored(bundleRoot);

        anchors[msg.sender][bundleRoot] = Anchor({
            policyHash: policyHash,
            graphHash: graphHash,
            maximumLoss: maximumLoss,
            engineVersionHash: engineVersionHash,
            status: status,
            submitter: msg.sender,
            anchoredAt: uint64(block.timestamp)
        });
        emit RunAnchored(bundleRoot, policyHash, graphHash, maximumLoss, engineVersionHash, status, msg.sender);
    }

    function getAnchor(address submitter, bytes32 bundleRoot) external view returns (Anchor memory) {
        return anchors[submitter][bundleRoot];
    }
}
