// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {RunRegistry} from "../src/RunRegistry.sol";

contract AnchorCaller {
    function anchorFor(RunRegistry registry, bytes32 root) external {
        registry.anchor(root, bytes32(uint256(8)), bytes32(uint256(9)), 1, bytes32(uint256(10)), RunRegistry.ResultStatus.Complete);
    }
}

contract RunRegistryTest {
    RunRegistry private registry;

    function setUp() public {
        registry = new RunRegistry();
    }

    function testStoresExactAnchorFields() public {
        bytes32 root = keccak256("bundle");
        bytes32 policy = keccak256("policy");
        bytes32 graph = keccak256("graph");
        bytes32 engine = keccak256("0.1.0");
        registry.anchor(root, policy, graph, 37_500_000, engine, RunRegistry.ResultStatus.Complete);

        RunRegistry.Anchor memory stored = registry.getAnchor(address(this), root);
        require(stored.policyHash == policy, "policy mismatch");
        require(stored.graphHash == graph, "graph mismatch");
        require(stored.maximumLoss == 37_500_000, "loss mismatch");
        require(stored.engineVersionHash == engine, "engine mismatch");
        require(stored.status == RunRegistry.ResultStatus.Complete, "status mismatch");
        require(stored.submitter == address(this), "submitter mismatch");
        require(stored.anchoredAt > 0, "timestamp missing");
    }

    function testRejectsDuplicateBundleRoot() public {
        bytes32 root = keccak256("bundle");
        registry.anchor(root, bytes32(uint256(1)), bytes32(uint256(2)), 1, bytes32(uint256(3)), RunRegistry.ResultStatus.Complete);
        (bool success,) = address(registry).call(
            abi.encodeCall(
                RunRegistry.anchor,
                (root, bytes32(uint256(9)), bytes32(uint256(9)), 9, bytes32(uint256(9)), RunRegistry.ResultStatus.Unknown)
            )
        );
        require(!success, "duplicate root accepted");
    }

    function testRejectsZeroRootAndUnsetStatus() public {
        (bool zeroRoot,) = address(registry).call(
            abi.encodeCall(
                RunRegistry.anchor,
                (bytes32(0), bytes32(uint256(1)), bytes32(uint256(2)), 0, bytes32(uint256(3)), RunRegistry.ResultStatus.Complete)
            )
        );
        require(!zeroRoot, "zero root accepted");

        (bool unsetStatus,) = address(registry).call(
            abi.encodeCall(
                RunRegistry.anchor,
                (keccak256("other"), bytes32(uint256(1)), bytes32(uint256(2)), 0, bytes32(uint256(3)), RunRegistry.ResultStatus.Unset)
            )
        );
        require(!unsetStatus, "unset status accepted");
    }

    function testSubmitterNamespacePreventsRootFrontRunning() public {
        bytes32 root = keccak256("shared-bundle");
        AnchorCaller other = new AnchorCaller();
        other.anchorFor(registry, root);
        registry.anchor(root, bytes32(uint256(1)), bytes32(uint256(2)), 3, bytes32(uint256(4)), RunRegistry.ResultStatus.Complete);

        RunRegistry.Anchor memory ours = registry.getAnchor(address(this), root);
        RunRegistry.Anchor memory theirs = registry.getAnchor(address(other), root);
        require(ours.maximumLoss == 3, "our anchor blocked");
        require(theirs.maximumLoss == 1, "other anchor changed");
    }

    function testUnknownCannotClaimMaximumLoss() public {
        (bool success,) = address(registry).call(
            abi.encodeCall(
                RunRegistry.anchor,
                (keccak256("unknown"), bytes32(uint256(1)), bytes32(uint256(2)), 1, bytes32(uint256(3)), RunRegistry.ResultStatus.Unknown)
            )
        );
        require(!success, "unknown result claimed a loss bound");
    }
}
