export function isProvisionedWalletStatus(status) {
  return (
    status?.status === "provisioned_waiting_for_pin" ||
    status?.has_provisioned_share1 === true
  );
}

export function canUseLocalReactivation(status) {
  return status?.can_reactivate_locally === true;
}

export function describeLifecycleExpectations(status) {
  return {
    unlockBranch: isProvisionedWalletStatus(status) ? "provisioned" : "non_provisioned",
    reactivateBranch: canUseLocalReactivation(status) ? "local_reactivation" : "not_locally_reactivatable",
  };
}
