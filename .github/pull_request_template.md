**改了什么、为什么 / What and why**


**怎么测的 / How it was tested**

- [ ] `cd plugin/engine && npx tsc --noEmit && npx vitest run`
- [ ] `claude plugin validate plugin && claude plugin test plugin`
- [ ] 改了面板或 skill 的，在 Claude App 里手动试过

**检查 / Checklist**

- [ ] 没有真实的人名、公司名和域名、内部仓库名、工单号、令牌（用 bob.lee、PROJ-123、acme/shop 这类占位）
- [ ] 用户能看到的变化记进了 CHANGELOG.md 的「未发布」
- [ ] 贴的 `chief doctor` 输出、日志去掉了工作区名和敏感内容
