# Chrome Web Store listing copy

## English

**Name:** LLM Usage

**Short description:** Track Codex and Claude usage limits, reset times, and local history from your browser.

**Detailed description:**

LLM Usage keeps your Codex and Claude subscription usage in one place. Connect multiple accounts, open the popup to see each available usage window and its reset time, and check the toolbar badge for the remaining 5-hour allowance of your first two accounts.

- View 5-hour, 7-day, and other usage windows returned by the providers.
- See reset times, last refresh time, and available Codex reset credits when reported.
- Open a local history chart and export recorded samples as JSON.
- Refresh on demand or let the extension check periodically while Chrome is running.
- Remove an account and its locally stored tokens and history at any time.

OAuth tokens, account details, usage snapshots, and history are stored in Chrome's local extension storage. The extension contacts OpenAI and Anthropic directly for sign-in, token refresh, and usage data. It does not send this data to a developer-operated server. Browser shutdowns create gaps in the history chart; missing samples are never estimated.

LLM Usage is an independent project and is not affiliated with, endorsed by, or supported by OpenAI or Anthropic. Provider endpoints and OAuth flows may change.

**Single purpose:** Display Codex and Claude subscription usage and maintain a local history of that usage.

**Permission explanations:** `storage` saves tokens and usage history locally; `alarms` schedules checks; `tabs` and `webNavigation` complete OAuth sign-in and show the result page; `declarativeNetRequestWithHostAccess` sets the User-Agent only on this extension's Claude token requests. Host permissions limit network access to the OpenAI and Anthropic sign-in and usage endpoints.

## 中文

**名称：** LLM Usage

**简短介绍：** 在浏览器中查看 Codex 和 Claude 的额度、重置时间及本地历史记录。

**详细介绍：**

LLM Usage 将 Codex 和 Claude 的订阅额度集中显示。你可以连接多个账号，在弹出窗口查看各额度窗口及重置时间，并通过工具栏徽标轮流查看前两个账号的 5 小时剩余额度。

- 展示服务商返回的 5 小时、7 天及其他额度窗口。
- 显示重置时间、上次刷新时间，以及可用时的 Codex 重置次数。
- 查看本地历史曲线，并将采样记录导出为 JSON。
- 手动查询，或在 Chrome 运行时定期查询。
- 随时移除账号及其本地保存的令牌和历史记录。

OAuth 令牌、账号信息、额度快照和历史记录保存在 Chrome 扩展的本地存储中。扩展直接与 OpenAI 和 Anthropic 通信，以完成登录、令牌刷新和额度查询；不会将这些数据发送给开发者运营的服务器。关闭浏览器期间的历史记录会留空，不会推算缺失数据。

LLM Usage 是独立项目，与 OpenAI 或 Anthropic 无关联，也未获得其认可或支持。服务商接口和 OAuth 流程可能变化。

**单一用途：** 展示 Codex 和 Claude 的订阅额度，并在本机记录额度历史。

**权限说明：** `storage` 用于在本地保存令牌和历史记录；`alarms` 用于定时查询；`tabs` 和 `webNavigation` 用于完成 OAuth 登录并显示结果页；`declarativeNetRequestWithHostAccess` 仅修改本扩展发往 Claude 令牌接口的 User-Agent。主机权限限定在 OpenAI 和 Anthropic 的登录及额度接口。
