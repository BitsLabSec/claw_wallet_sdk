import assert from "node:assert/strict";

import {
  canUseLocalReactivation,
  describeLifecycleExpectations,
  isProvisionedWalletStatus,
} from "./lifecycle-state.mjs";

const FIXTURES = [
  {
    name: "provisioned wallet waiting for pin",
    status: {
      status: "provisioned_waiting_for_pin",
      has_provisioned_share1: true,
      can_reactivate_locally: false,
    },
    expected: {
      provisioned: true,
      reactivatable: false,
      unlockBranch: "provisioned",
      reactivateBranch: "not_locally_reactivatable",
    },
  },
  {
    name: "imported wallet already ready still treated as provisioned lineage",
    status: {
      status: "ready",
      has_provisioned_share1: true,
      can_reactivate_locally: false,
    },
    expected: {
      provisioned: true,
      reactivatable: false,
      unlockBranch: "provisioned",
      reactivateBranch: "not_locally_reactivatable",
    },
  },
  {
    name: "local wallet that can reactivate",
    status: {
      status: "ready",
      has_provisioned_share1: false,
      can_reactivate_locally: true,
    },
    expected: {
      provisioned: false,
      reactivatable: true,
      unlockBranch: "non_provisioned",
      reactivateBranch: "local_reactivation",
    },
  },
  {
    name: "ephemeral local wallet without persisted local reactivate",
    status: {
      status: "ready",
      has_provisioned_share1: false,
      can_reactivate_locally: false,
    },
    expected: {
      provisioned: false,
      reactivatable: false,
      unlockBranch: "non_provisioned",
      reactivateBranch: "not_locally_reactivatable",
    },
  },
];

for (const fixture of FIXTURES) {
  const actual = describeLifecycleExpectations(fixture.status);
  assert.equal(
    isProvisionedWalletStatus(fixture.status),
    fixture.expected.provisioned,
    `${fixture.name}: provisioned classification mismatch`,
  );
  assert.equal(
    canUseLocalReactivation(fixture.status),
    fixture.expected.reactivatable,
    `${fixture.name}: local reactivation classification mismatch`,
  );
  assert.deepEqual(actual, {
    unlockBranch: fixture.expected.unlockBranch,
    reactivateBranch: fixture.expected.reactivateBranch,
  });
}

process.stdout.write("lifecycle fixture tests passed\n");
