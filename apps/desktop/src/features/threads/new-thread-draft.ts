/**
 * A new-thread surface keeps its unsent draft only while it stays on the
 * workspace the draft was typed in: an unsent draft is user data, so it may be
 * discarded only by switching workspace or by a successful start. A surface with
 * no resolvable workspace has nothing to attach the draft to.
 */
export function shouldKeepNewThreadDraft(
  nextWorkspaceId: string | undefined,
  rootWorkspaceId: string | undefined,
): boolean {
  return Boolean(nextWorkspaceId) && nextWorkspaceId === rootWorkspaceId;
}
