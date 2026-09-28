# Privacy policy / 隐私政策

Last updated: 2026-09-29

## English

LLM Usage displays Codex and Claude subscription usage and records a local history. When you connect an account, it processes OAuth authorization codes, access and refresh tokens, account identifiers, account labels (which may include an email address), usage limits, reset times, and query errors. It stores these items in `chrome.storage.local` in your Chrome profile. Usage history is kept for up to 30 days. This storage is local to the browser profile and is not encrypted by the extension itself.

The extension sends authentication and usage requests directly to OpenAI and Anthropic endpoints to provide its features. It does not transmit your tokens, account information, or usage history to a server operated by the extension developer. It does not sell data, show ads, or use analytics. It observes only the OAuth callback navigation for a sign-in that you started; it does not collect general browsing history.

You can remove an account from the popup. This deletes its locally stored tokens, snapshots, errors, and history. Removing an account does not revoke a token at OpenAI or Anthropic. Removing the extension clears its local storage under Chrome's normal extension removal behavior. Exported history files remain wherever you saved them.

Information received through Chrome APIs is used only to provide the extension's stated purpose. This use adheres to the Chrome Web Store User Data Policy, including its Limited Use requirements.

For questions or privacy requests, open an issue in the project's GitHub repository.

## 中文

LLM Usage 用于展示 Codex 和 Claude 的订阅额度并记录本地历史。连接账号时，扩展会处理 OAuth 授权码、访问令牌和刷新令牌、账号标识、账号名称（可能包含电子邮箱）、额度、重置时间及查询错误。这些信息保存在 Chrome 用户资料的 `chrome.storage.local` 中。额度历史最多保留 30 天。数据位于本地浏览器资料中，扩展自身不对该存储额外加密。

扩展直接向 OpenAI 和 Anthropic 的接口发送认证及额度请求，以提供上述功能。扩展不会把令牌、账号信息或额度历史发送到开发者运营的服务器；不出售数据、不投放广告，也不使用分析服务。扩展仅监听你主动发起登录时的 OAuth 回调导航，不收集一般浏览记录。

你可以在弹出窗口移除账号，这会删除该账号保存在本地的令牌、快照、错误和历史记录。移除账号不会撤销 OpenAI 或 Anthropic 服务端的令牌。卸载扩展后，Chrome 会按正常卸载流程清除其本地存储；已导出的历史文件仍保留在你保存的位置。

通过 Chrome API 获取的信息只用于扩展声明的用途，并遵守 Chrome 网上应用店用户数据政策及其 Limited Use 要求。

如有疑问或隐私请求，请在项目 GitHub 仓库中提交 issue。
