export const ROLE_PERMISSIONS: Record<string, string[]> = {
	platform_admin: [
		"events.read.all",
		"events.create.all",
		"events.update.all",
		"events.publish.all",
		"events.delete.all",
		"media.upload.all",
		"qpr.manage",
		"accounts.manage",
		"audit.read",
	],
	division_admin: [
		"events.read.own_division",
		"events.create.own_division",
		"events.update.own_division",
		"events.publish.own_division",
		"events.delete.own_division",
		"media.upload.own_division",
	],
	contributor: [
		"events.read.own_division",
		"events.create_draft.own_division",
		"events.update_draft.own_division",
		"media.upload.own_division",
	],
	viewer: ["events.read.own_division"],
};

export const hasPermission = (
	userPermissions: string[],
	requiredPermission: string,
	options?: { isOwnDivision?: boolean; resourceStatus?: "draft" | "published" },
): boolean => {
	const base = requiredPermission.replace(/\.(all|own_division)$/, "");
	const requiresOwnDivision = requiredPermission.endsWith(".own_division");

	if (userPermissions.includes(`${base}.all`)) {
		return true;
	}

	if (!requiresOwnDivision && userPermissions.includes(requiredPermission)) {
		return true;
	}

	if (
		requiresOwnDivision &&
		options?.isOwnDivision &&
		userPermissions.includes(`${base}.own_division`)
	) {
		return true;
	}

	if (
		requiredPermission === "events.create.own_division" &&
		options?.isOwnDivision &&
		userPermissions.includes("events.create_draft.own_division")
	) {
		return true;
	}

	if (
		requiredPermission === "events.update.own_division" &&
		options?.isOwnDivision &&
		options.resourceStatus === "draft" &&
		userPermissions.includes("events.update_draft.own_division")
	) {
		return true;
	}

	return false;
};
