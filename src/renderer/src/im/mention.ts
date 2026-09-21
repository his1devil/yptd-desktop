/**
 * OpenIM 的 `groupAtType`：一个会话「@」状态的那一位。
 *
 * ```
 * 0 Normal   1 MentionedMe   2 MentionedAll   3 MentionedAllAndMe   4 GroupNotice
 * ```
 *
 * **4 是群公告，不是有人 @ 你。** 把它算进来的后果是：谁改一次群公告，那个频道就顶着
 * 红色的「@N」进了收件箱的「提及我的」和托盘的「N 条待处理」，而根本没人找你。TUI 那边
 * （`crates/im-model/src/translate.rs`）一直是只认 1..3 的，这里跟它对齐。
 *
 * 另一半同样要紧：这一位**不会被标已读清掉**。SDK 的 mark-read 只写 `unread_count: 0`，
 * 而且 unread 已经是 0 时直接返回。清它要单独调 `im.resetAt`（`setConversation`）。
 */
export function isMention(groupAtType: number | undefined): boolean {
  return groupAtType !== undefined && groupAtType >= 1 && groupAtType <= 3
}
