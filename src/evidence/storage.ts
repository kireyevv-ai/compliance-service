export function buildLocalStorageRef(relativePath: string): string {
  return `local-vps://${relativePath.replace(/^[/\\]+/, "")}`;
}
