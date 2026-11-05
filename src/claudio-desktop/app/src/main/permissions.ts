import type { Session } from "electron";

const ALLOWED_PERMISSIONS = new Set(["fullscreen"]);

export function restrictPermissions(session: Session): void {
  session.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  session.setPermissionCheckHandler((_contents, permission) => ALLOWED_PERMISSIONS.has(permission));
}
